import { EXPIRED_OPENING as openingPolicy } from '../src/lib/organization/expired-opening-policy.ts';
import { EXPIRED_DISABLE as disablePolicy } from '../src/lib/organization/expired-disable-policy.ts';

/** Fixed public-state reads only. Neither signed bytes nor arbitrary RPC input is accepted. */
export const expiredOpeningReader = options => expiredStateReader(options, openingPolicy, 'line:expired-opening-evidence/v1');
export const expiredDisableReader = options => expiredStateReader(options, disablePolicy, 'line:expired-disable-evidence/v1');
function expiredStateReader({ endpoints, fetchImpl = globalThis.fetch }, policy, schema) {
  let requestId = 0;
  async function post(url, body, signal) {
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok || !response.body) throw Error('Recovery provider unavailable');
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) { await reader.cancel(); throw Error('Recovery response too large'); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  return async signal => {
    if (!endpoints.nodeUri) throw Error('Recovery node unavailable');
    const timeout = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(25000)]);
    const rpc = async (method, params = []) => {
      const id = ++requestId, value = await post(endpoints.nodeUri, { jsonrpc: '2.0', id, method, params }, timeout);
      if (value?.jsonrpc !== '2.0' || value.id !== id || value.error || value.result == null) throw Error('Recovery RPC unavailable');
      return value.result;
    };
    const hash = value => { if (!/^0x[0-9a-f]{64}$/.test(value)) throw Error('Invalid recovery hash'); return value.slice(2); };
    const finalizedHash = hash(await rpc('chain_getFinalizedHead'));
    const header = await rpc('chain_getHeader', ['0x' + finalizedHash]);
    if (!/^0x[0-9a-f]+$/.test(header?.number)) throw Error('Invalid recovery header');
    const height = Number(BigInt(header.number));
    if (!Number.isSafeInteger(height) || height <= policy.baselineHeight) throw Error('Recovery checkpoint unavailable');
    if (hash(await rpc('chain_getBlockHash', [0])) !== policy.genesisHash || hash(await rpc('chain_getBlockHash', [policy.baselineHeight])) !== policy.baselineHash) throw Error('Recovery chain mismatch');
    const baselineRuntime = await rpc('state_getRuntimeVersion', ['0x' + policy.baselineHash]);
    const runtime = await rpc('state_getRuntimeVersion', ['0x' + finalizedHash]);
    if ([baselineRuntime, runtime].some(v => v.specName !== 'midnight' || v.specVersion !== policy.runtimeSpecVersion)) throw Error('Recovery runtime has not been reviewed');
    const baseline = await rpc('midnight_contractState', [policy.address, '0x' + policy.baselineHash]);
    const state = await rpc('midnight_contractState', [policy.address, '0x' + finalizedHash]);
    const storage = await rpc('state_getStorage', [policy.timestampKey, '0x' + finalizedHash]);
    if (!/^0x[0-9a-f]{16}$/.test(storage)) throw Error('Recovery timestamp unavailable');
    const timestamp = Number(Buffer.from(storage.slice(2), 'hex').readBigUInt64LE());
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw Error('Invalid recovery timestamp');
    const indexed = await post(endpoints.indexerUri, { query: 'query LINE_EXPIRY_BLOCK($offset: BlockOffset!) { block(offset:$offset) { hash height timestamp } }', variables: { offset: { hash: finalizedHash } } }, timeout);
    if (indexed.errors || indexed.data?.block?.hash !== finalizedHash || indexed.data.block.height !== height || indexed.data.block.timestamp !== timestamp) throw Error('Recovery providers disagree');
    const bytes = value => { if (typeof value !== 'string' || !/^(?:0x)?(?:[0-9a-f]{2})+$/.test(value) || value.length > 256000) throw Error('Recovery state unavailable'); return value.replace(/^0x/, ''); };
    return { schema, address: policy.address, genesisHash: policy.genesisHash, runtimeSpecVersion: runtime.specVersion,
      baseline: { hash: policy.baselineHash, height: policy.baselineHeight, state: bytes(baseline) }, finalized: { hash: finalizedHash, height, timestamp, state: bytes(state) } };
  };
}
