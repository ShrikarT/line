// Read-only by default; an explicit flag retries the exact already-signed bytes.
import { readFileSync, writeFileSync } from 'node:fs';
import { ApiPromise, HttpProvider } from '@polkadot/api';
import { u8aToHex } from '@polkadot/util';
import * as L from '@midnight-ntwrk/ledger-v8';
import { resolveMidnightEndpoints, sanitizeServiceError } from '../../src/lib/runtime/endpoints.ts';
const endpoints = resolveMidnightEndpoints({ networkId: 'preprod', blockfrostProjectId: process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID });
let id = 0, api;
async function rpc(method, params = []) {
  const response = await fetch(endpoints.nodeUri, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(30000) });
  return response.json();
}
try {
  const methods = (await rpc('rpc_methods')).result.methods;
  console.log(JSON.stringify({ methods: methods.filter(name => /dryRun|valid|pendingExtrinsics/i.test(name)) }));
  api = await ApiPromise.create({ provider: new HttpProvider(endpoints.nodeUri), noInitWarn: true });
  const ext = api.tx.midnight.sendMnTransaction(u8aToHex(readFileSync('.midnight-cache/test-settlement/setup-merchant-b.bin'))).toHex();
  const pending = await rpc('author_pendingExtrinsics');
  const result = { checkedAt: new Date().toISOString(), pendingPoolMatch: pending.result?.includes(ext), pendingPoolSize: pending.result?.length, dryRun: methods.includes('system_dryRun') ? await rpc('system_dryRun', [ext]) : 'unavailable' };
  if (api.call.taggedTransactionQueue?.validateTransaction) {
    const finalized = await api.rpc.chain.getFinalizedHead();
    result.validation = (await api.call.taggedTransactionQueue.validateTransaction('External', ext, finalized)).toJSON();
  }
  if (process.argv.includes('--resubmit-same-transaction')) {
    const status = await (await fetch('http://127.0.0.1:5174/api/preprod/settlement/status', { headers: { Origin: 'http://127.0.0.1:5174', 'X-Line-Preprod': 'operator' } })).json();
    if (status.busy || status.pending !== 'setup-merchant-b' || result.pendingPoolMatch !== false) throw Error('Exact retry prerequisites changed.');
    const raw = L.Transaction.deserialize('signature', 'proof', 'binding', readFileSync('.midnight-cache/test-settlement/setup-merchant-b.bin'));
    const record = JSON.parse(readFileSync('.midnight-cache/test-settlement/setup-merchant-b.json', 'utf8'));
    if (raw.transactionHash() !== record.txHash || [...raw.intents.values()].some(intent => intent.ttl.getTime() <= Date.now())) throw Error('Saved transaction expired or changed.');
    result.exactRetry = await rpc('author_submitExtrinsic', [ext]);
  }
  writeFileSync('artifacts/preprod-2026-10-16/token-rejection-diagnostic.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) { console.error(sanitizeServiceError(error.message)); process.exitCode = 1; }
finally { await api?.disconnect(); }
