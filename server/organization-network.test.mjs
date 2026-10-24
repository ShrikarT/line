import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { bech32m } from '@scure/base';
import * as L from '@midnight-ntwrk/ledger-v8';
import * as R from '@midnight-ntwrk/compact-runtime';
import { startOrganizationServer } from './organization-server.mjs';
import { EXPIRED_OPENING as openingPolicy } from '../src/lib/organization/expired-opening-policy.ts';
import { EXPIRED_DISABLE as disablePolicy } from '../src/lib/organization/expired-disable-policy.ts';
import { EXPIRED_QUOTE as quotePolicy } from '../src/lib/organization/expired-quote-policy.ts';
import { Contract } from '../contracts/managed/organization/contract/index.js';
import { blankPrivate, WITNESSES } from '../src/lib/line/compact-harness.ts';
import { issuerPublicKey, merchantPublicKey, pad32 } from '../src/lib/line/encoding.ts';

function createFacilityStateForRecipient(recipientHex) {
  const closedHex = readFileSync(new URL('../tests/fixtures/organization-closed-state.hex', import.meta.url), 'utf8').trim();
  const closedState = L.ContractState.deserialize(Buffer.from(closedHex, 'hex'));
  const issuer = pad32('test-issuer');
  const merchant = pad32('test-merchant');
  const nonce = pad32('test-nonce');
  const recipient = { bytes: Buffer.from(recipientHex, 'hex') };
  const contract = new Contract(WITNESSES);
  const ps = blankPrivate({ callerSecret: issuer });
  const init = contract.initialState(R.createConstructorContext(ps, '0'.repeat(64)), issuerPublicKey(issuer), merchantPublicKey(merchant), nonce, recipient, recipient, new Uint8Array(32));
  const newState = L.ContractState.deserialize(init.currentContractState.serialize());
  newState.maintenanceAuthority = closedState.maintenanceAuthority;
  for (const op of closedState.operations()) {
    newState.setOperation(op, closedState.operation(op));
  }
  return Buffer.from(newState.serialize()).toString('hex');
}

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'line-network-test-'));
  writeFileSync(join(directory, 'index.html'), '<title>Network transport control</title>');
  const requests = [], connections = [], settings = { reply: null, rpc: null };
  const upstream = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body); requests.push({ url: req.url, headers: req.headers, body: input });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    let result = null, rpcError = null;
    if (input.method && settings.rpc) {
      try {
        result = await settings.rpc(input.method, input.params);
      } catch (err) {
        rpcError = { code: -32000, message: err.message };
      }
    }
    const responsePayload = input.method && settings.rpc
      ? (rpcError ? { jsonrpc: '2.0', id: input.id, error: rpcError } : { jsonrpc: '2.0', id: input.id, result })
      : (settings.reply ?? { data: { contractAction: null } });
    res.end(JSON.stringify(responsePayload));
  });
  const sockets = new WebSocketServer({ server: upstream });
  sockets.on('connection', (socket, req) => {
    connections.push({ socket, url: req.url, headers: req.headers, messages: [] });
    const entry = connections.at(-1);
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString()); entry.messages.push(message);
      if (message.type === 'connection_init') socket.send(JSON.stringify({ type: 'connection_ack' }));
      if (message.type === 'subscribe') socket.send(JSON.stringify({ type: 'next', id: message.id, payload: { data: { control: 'actual upstream WebSocket frame' } } }));
    });
  });
  await new Promise(yes => upstream.listen(0, '127.0.0.1', yes));
  const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  const token = 'synthetic-provider-credential-control';
  const origin = 'https://line.example';
  const app = await startOrganizationServer({ env: { LINE_PUBLIC_ORIGIN: origin }, port: 0, host: '127.0.0.1', publicDirectory: directory, createService: async () => ({
    endpoints: { nodeUri: `${upstreamOrigin}/rpc?project_id=${token}`, indexerUri: `${upstreamOrigin}/graphql?project_id=${token}`, indexerWsUri: `${upstreamOrigin.replace('http:', 'ws:')}/ws?project_id=${token}` },
    catalog: () => ({ services: [] }), close: async () => {},
  }) });
  t.after(async () => {
    await app.close(); for (const socket of sockets.clients) socket.terminate();
    await new Promise(yes => sockets.close(yes)); await new Promise(yes => upstream.close(yes));
    assert(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'line-network-test-')); rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { Origin: origin, 'X-Line-Organization': 'wallet', 'Content-Type': 'application/json' };
  const key = L.sampleSigningKey(), verifyingKey = L.signatureVerifyingKey(key);
  const address = bech32m.encodeFromBytes('mn_addr_preprod', Buffer.from(L.addressFromKey(verifyingKey), 'hex'));
  const challenge = await (await fetch(base + '/api/organization/auth/challenge', { method: 'POST', headers, body: JSON.stringify({ address }) })).json();
  const signature = L.signData(key, Buffer.from(`midnight_signed_message:${Buffer.byteLength(challenge.message)}:${challenge.message}`));
  const verified = await fetch(base + '/api/organization/auth/verify', { method: 'POST', headers, body: JSON.stringify({ nonce: challenge.nonce, proof: { verifyingKey, signature } }) });
  assert.equal(verified.status, 200);
  const cookie = verified.headers.get('set-cookie').split(';')[0];
  return {
    app, base, origin,
    headers: { ...headers, Cookie: cookie },
    cookie, requests, connections, token, settings,
    recipient: Buffer.from(L.addressFromKey(verifyingKey), 'hex').toString('hex'),
  };
}

test('the production entry provides authenticated public read URLs without returning its provider credential', async t => {
  const f = await fixture(t);
  const response = await fetch(f.base + '/api/organization/network', { headers: f.headers });
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.deepEqual(metadata, { networkId: 'preprod', indexerUri: `${f.origin}/api/organization/network/indexer`, indexerWsUri: `wss://line.example/api/organization/network/indexer/ws` });
  assert(!JSON.stringify(metadata).includes(f.token)); assert(metadata.indexerUri.startsWith('https://')); assert(metadata.indexerWsUri.startsWith('wss://'));
  const unauthenticated = await fetch(f.base + '/api/organization/network', { headers: { Origin: f.origin } });
  assert.equal(unauthenticated.status, 401);
  const unauthenticatedBody = await unauthenticated.json();
  assert.equal(unauthenticatedBody.code, 'WALLET_AUTH_REQUIRED');
  const foreignOrigin = await fetch(f.base + '/api/organization/network', { headers: { ...f.headers, Origin: 'https://attacker.example' } });
  assert.equal(foreignOrigin.status, 403);
});

for (const configuration of [
  { policy: openingPolicy, path: 'expired-opening', fixture: 'organization-closed-state.hex', schema: 'line:expired-opening-evidence/v1', height: 3077281, timestamp: 1792598700000 },
  { policy: disablePolicy, path: 'expired-disable', fixture: 'organization-merchant2-draw-state.hex', schema: 'line:expired-disable-evidence/v1', height: 3102500, timestamp: 1792755000000 },
  { policy: quotePolicy, path: 'expired-quote', fixture: 'organization-compensated-state.hex', schema: 'line:expired-quote-evidence/v1', height: 3105000, timestamp: 1792764600000 },
  { policy: disablePolicy, path: 'expired-compensation', fixture: 'organization-merchant2-draw-state.hex', schema: 'line:expired-compensation-evidence/v1', height: 3104000, timestamp: 1792760400000 },
]) test(`${configuration.path} endpoint pins finalized state reads, requires authentication and rejects provider disagreement`, async t => {
  const expiryPolicy = configuration.policy;
  const f = await fixture(t), path = f.base + '/api/organization/network/' + configuration.path;
  const state = readFileSync(new URL('../tests/fixtures/' + configuration.fixture, import.meta.url), 'utf8');
  const head = 'aa'.repeat(32), { height, timestamp } = configuration;
  const storage = Buffer.alloc(8); storage.writeBigUInt64LE(BigInt(timestamp));
  f.settings.rpc = (method, params) => {
    if (method === 'chain_getFinalizedHead') return '0x' + head;
    if (method === 'chain_getHeader') { assert.deepEqual(params, ['0x' + head]); return { number: '0x' + height.toString(16) }; }
    if (method === 'chain_getBlockHash') return '0x' + (params[0] === 0 ? expiryPolicy.genesisHash : expiryPolicy.baselineHash);
    if (method === 'state_getRuntimeVersion') return { specName: 'midnight', specVersion: expiryPolicy.runtimeSpecVersion };
    if (method === 'midnight_contractState') { assert.equal(params[0], expiryPolicy.address); assert(['0x' + head, '0x' + expiryPolicy.baselineHash].includes(params[1])); return '0x' + state; }
    if (method === 'state_getStorage') { assert.deepEqual(params, [expiryPolicy.timestampKey, '0x' + head]); return '0x' + storage.toString('hex'); }
    throw Error('Arbitrary RPC forwarding is prohibited');
  };
  f.settings.reply = { data: { block: { hash: head, height, timestamp } } };
  assert.equal((await fetch(path, { headers: { Origin: f.origin } })).status, 401);
  assert.equal(f.requests.length, 0);
  const response = await fetch(path, { headers: f.headers }); assert.equal(response.status, 200);
  const evidence = await response.json();
  assert.equal(evidence.schema, configuration.schema); assert.equal(evidence.baseline.hash, expiryPolicy.baselineHash);
  assert.equal(evidence.finalized.state, state); assert.equal(evidence.baseline.state, state); assert.equal(evidence.finalized.timestamp, timestamp);
  assert(!JSON.stringify(evidence).includes(f.token));
  assert.equal((await fetch(path + '?method=author_submitExtrinsic', { headers: f.headers })).status, 400);
  assert.equal((await fetch(path, { method: 'POST', headers: f.headers, body: JSON.stringify({ method: 'author_submitExtrinsic' }) })).status, 404);
  f.settings.reply.data.block.timestamp--;
  const failed = await fetch(path, { headers: f.headers }); assert.equal(failed.status, 503);
  assert(!JSON.stringify(await failed.json()).includes(f.token));
});

// === DEDICATED INTEGRATION TESTS FOR FINALIZED-FACILITY-STATE ===

test('finalized-facility-state requires wallet authentication and rejects unauthenticated or expired sessions', async t => {
  const f = await fixture(t);
  const path = f.base + '/api/organization/network/finalized-facility-state';
  const facilityAddress = 'aa'.repeat(32);

  // Missing cookie
  const unauth = await fetch(path, {
    method: 'POST',
    headers: { Origin: f.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: facilityAddress }),
  });
  assert.equal(unauth.status, 401);
  const unauthBody = await unauth.json();
  assert.equal(unauthBody.code, 'WALLET_AUTH_REQUIRED');

  // Expired / invalid cookie
  const badCookie = await fetch(path, {
    method: 'POST',
    headers: { Origin: f.origin, Cookie: 'line_session=invalid-session-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: facilityAddress }),
  });
  assert.equal(badCookie.status, 401);
  const badCookieBody = await badCookie.json();
  assert.equal(badCookieBody.code, 'WALLET_AUTH_REQUIRED');
});

test('finalized-facility-state rejects foreign origin or non-POST methods', async t => {
  const f = await fixture(t);
  const path = f.base + '/api/organization/network/finalized-facility-state';
  const facilityAddress = 'aa'.repeat(32);

  // Foreign origin
  const foreign = await fetch(path, {
    method: 'POST',
    headers: { ...f.headers, Origin: 'https://attacker.example' },
    body: JSON.stringify({ address: facilityAddress }),
  });
  assert.equal(foreign.status, 403);

  // GET method
  const getReq = await fetch(path, {
    method: 'GET',
    headers: f.headers,
  });
  assert.equal(getReq.status, 405);
});

test('finalized-facility-state validates request media-type and body schema', async t => {
  const f = await fixture(t);
  const path = f.base + '/api/organization/network/finalized-facility-state';
  const facilityAddress = 'aa'.repeat(32);

  // Non-JSON content type
  const textReq = await fetch(path, {
    method: 'POST',
    headers: { ...f.headers, 'Content-Type': 'text/plain' },
    body: JSON.stringify({ address: facilityAddress }),
  });
  assert.equal(textReq.status, 415);

  // Array body
  const arrayReq = await fetch(path, {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify([facilityAddress]),
  });
  assert.equal(arrayReq.status, 400);

  // Extra unknown fields
  const extraReq = await fetch(path, {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify({ address: facilityAddress, extra: 'bad' }),
  });
  assert.equal(extraReq.status, 400);

  // Missing address
  const missingReq = await fetch(path, {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify({}),
  });
  assert.equal(missingReq.status, 400);

  // Invalid hex address
  const badHexReq = await fetch(path, {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify({ address: 'not-hex' }),
  });
  assert.equal(badHexReq.status, 400);

  // Query parameter prohibited
  const queryReq = await fetch(path + '?address=' + facilityAddress, {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify({ address: facilityAddress }),
  });
  assert.equal(queryReq.status, 400);
});

test('finalized-facility-state enforces 512-byte request body limit', async t => {
  const f = await fixture(t);
  const path = f.base + '/api/organization/network/finalized-facility-state';
  const facilityAddress = 'aa'.repeat(32);

  const oversizedReq = await fetch(path, {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify({ address: facilityAddress, padding: 'x'.repeat(600) }),
  });
  assert.equal(oversizedReq.status, 413);
  const body = await oversizedReq.json();
  assert.equal(body.error, 'Payload is too large.');
});

test('finalized-facility-state enforces wallet facility ownership', async t => {
  const f = await fixture(t);
  const path = f.base + '/api/organization/network/finalized-facility-state';
  const facilityAddress = 'aa'.repeat(32);
  const head = 'ab'.repeat(32);
  const height = 3105000;
  const timestamp = 1792764600000;
  const storage = Buffer.alloc(8);
  storage.writeBigUInt64LE(BigInt(timestamp));

  // Facility owned by different recipient
  const wrongState = createFacilityStateForRecipient('ee'.repeat(32));
  f.settings.rpc = (method) => {
    if (method === 'chain_getFinalizedHead') return '0x' + head;
    if (method === 'chain_getHeader') return { number: '0x' + height.toString(16) };
    if (method === 'chain_getBlockHash') return '0x' + openingPolicy.genesisHash;
    if (method === 'state_getRuntimeVersion') return { specName: 'midnight', specVersion: openingPolicy.runtimeSpecVersion };
    if (method === 'midnight_contractState') return '0x' + wrongState;
    if (method === 'state_getStorage') return '0x' + storage.toString('hex');
    throw Error('Arbitrary RPC forwarding prohibited');
  };
  f.settings.reply = { data: { block: { hash: head, height, timestamp } } };

  const response = await fetch(path, {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify({ address: facilityAddress }),
  });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, 'This wallet does not own the selected organization facility.');
});

test('finalized-facility-state enforces concurrency ceiling', async t => {
  const f = await fixture(t);
  const path = f.base + '/api/organization/network/finalized-facility-state';
  const facilityAddress = 'aa'.repeat(32);

  // Set up an upstream RPC that hangs until released
  let releaseHanging;
  const hangingPromise = new Promise(yes => { releaseHanging = yes; });
  let count = 0;
  f.settings.rpc = async (method) => {
    if (method === 'chain_getFinalizedHead') {
      count++;
      await hangingPromise;
      return '0x' + 'ab'.repeat(32);
    }
    return null;
  };

  // Launch 8 concurrent requests (filling capacity)
  const inflight = Array.from({ length: 8 }, () =>
    fetch(path, { method: 'POST', headers: f.headers, body: JSON.stringify({ address: facilityAddress }) })
  );

  // Poll until all 8 requests enter rpc and are pending
  for (let i = 0; i < 50 && count < 8; i++) {
    await new Promise(r => setTimeout(r, 20));
  }
  assert.equal(count, 8);

  // The 9th request must be rejected with 429
  const busyRes = await fetch(path, {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify({ address: facilityAddress }),
  });
  assert.equal(busyRes.status, 429);
  const busyBody = await busyRes.json();
  assert.equal(busyBody.error, 'Facility state reads are busy.');

  // Release in-flight requests
  releaseHanging();
  await Promise.allSettled(inflight);
});

test('finalized-facility-state successfully reads pinned block and returns bounded evidence', async t => {
  const f = await fixture(t);
  const path = f.base + '/api/organization/network/finalized-facility-state';
  const facilityAddress = 'aa'.repeat(32);
  const head = 'ab'.repeat(32);
  const height = 3105000;
  const timestamp = 1792764600000;
  const storage = Buffer.alloc(8);
  storage.writeBigUInt64LE(BigInt(timestamp));
  const validState = createFacilityStateForRecipient(f.recipient);

  f.settings.rpc = (method, params) => {
    if (method === 'chain_getFinalizedHead') return '0x' + head;
    if (method === 'chain_getHeader') { assert.deepEqual(params, ['0x' + head]); return { number: '0x' + height.toString(16) }; }
    if (method === 'chain_getBlockHash') return '0x' + (params[0] === 0 ? openingPolicy.genesisHash : '00'.repeat(32));
    if (method === 'state_getRuntimeVersion') return { specName: 'midnight', specVersion: openingPolicy.runtimeSpecVersion };
    if (method === 'midnight_contractState') { assert.equal(params[0], facilityAddress); assert.equal(params[1], '0x' + head); return '0x' + validState; }
    if (method === 'state_getStorage') { assert.deepEqual(params, [openingPolicy.timestampKey, '0x' + head]); return '0x' + storage.toString('hex'); }
    throw Error('Arbitrary RPC forwarding is prohibited: ' + method);
  };
  f.settings.reply = { data: { block: { hash: head, height, timestamp } } };

  const response = await fetch(path, {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify({ address: facilityAddress }),
  });
  assert.equal(response.status, 200);
  const evidence = await response.json();
  assert.equal(evidence.schema, 'line:finalized-facility-state/v1');
  assert.equal(evidence.networkId, 'preprod');
  assert.equal(evidence.facilityAddress, facilityAddress);
  assert.equal(evidence.genesisHash, openingPolicy.genesisHash);
  assert.equal(evidence.runtimeSpecVersion, openingPolicy.runtimeSpecVersion);
  assert.equal(evidence.finalized.hash, head);
  assert.equal(evidence.finalized.height, height);
  assert.equal(evidence.finalized.timestampMs, timestamp);
  assert.equal(evidence.finalized.state, validState);
  assert(!JSON.stringify(evidence).includes(f.token));
});

test('finalized-facility-state fails closed on provider disagreement with numeric indexer timestamp', async t => {
  const f = await fixture(t);
  const path = f.base + '/api/organization/network/finalized-facility-state';
  const facilityAddress = 'aa'.repeat(32);
  const head = 'ab'.repeat(32);
  const height = 3105000;
  const timestamp = 1792764600000;
  const storage = Buffer.alloc(8);
  storage.writeBigUInt64LE(BigInt(timestamp));
  const validState = createFacilityStateForRecipient(f.recipient);

  f.settings.rpc = (method) => {
    if (method === 'chain_getFinalizedHead') return '0x' + head;
    if (method === 'chain_getHeader') return { number: '0x' + height.toString(16) };
    if (method === 'chain_getBlockHash') return '0x' + openingPolicy.genesisHash;
    if (method === 'state_getRuntimeVersion') return { specName: 'midnight', specVersion: openingPolicy.runtimeSpecVersion };
    if (method === 'midnight_contractState') return '0x' + validState;
    if (method === 'state_getStorage') return '0x' + storage.toString('hex');
    throw Error('Arbitrary RPC forwarding prohibited');
  };

  // Indexer timestamp disagrees numerically (timestamp - 1000)
  f.settings.reply = { data: { block: { hash: head, height, timestamp: timestamp - 1000 } } };

  const response = await fetch(path, {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify({ address: facilityAddress }),
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'The Preprod finalized facility state is unavailable. Retry the original operation.');
  assert(!JSON.stringify(body).includes(f.token));
});

test('finalized-facility-state redacts all provider credentials, URLs, and diagnostics in errors', async t => {
  const f = await fixture(t);
  const path = f.base + '/api/organization/network/finalized-facility-state';
  const facilityAddress = 'aa'.repeat(32);

  // Upstream node returns an error containing internal token and URL
  f.settings.rpc = () => {
    throw new Error(`Failed to contact upstream at http://internal.node.example?project_id=${f.token}`);
  };

  const response = await fetch(path, {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify({ address: facilityAddress }),
  });
  assert.equal(response.status, 503);
  const rawText = await response.text();
  assert(!rawText.includes(f.token));
  assert(!rawText.includes('internal.node.example'));
  assert.deepEqual(JSON.parse(rawText), {
    error: 'The Preprod finalized facility state is unavailable. Retry the original operation.',
  });
});

test('finalized-facility-state re-authenticates live session before response delivery', async t => {
  const f = await fixture(t);
  const path = f.base + '/api/organization/network/finalized-facility-state';
  const facilityAddress = 'aa'.repeat(32);
  const head = 'ab'.repeat(32);
  const height = 3105000;
  const timestamp = 1792764600000;
  const storage = Buffer.alloc(8);
  storage.writeBigUInt64LE(BigInt(timestamp));
  const validState = createFacilityStateForRecipient(f.recipient);

  // Invalidate session right before rpc returns
  f.settings.rpc = async (method) => {
    if (method === 'chain_getFinalizedHead') {
      // Invalidate the auth session in the auth provider mid-flight
      await fetch(f.base + '/api/organization/auth/logout', { method: 'POST', headers: f.headers });
      return '0x' + head;
    }
    if (method === 'chain_getHeader') return { number: '0x' + height.toString(16) };
    if (method === 'chain_getBlockHash') return '0x' + openingPolicy.genesisHash;
    if (method === 'state_getRuntimeVersion') return { specName: 'midnight', specVersion: openingPolicy.runtimeSpecVersion };
    if (method === 'midnight_contractState') return '0x' + validState;
    if (method === 'state_getStorage') return '0x' + storage.toString('hex');
    throw Error('Arbitrary RPC forwarding prohibited');
  };
  f.settings.reply = { data: { block: { hash: head, height, timestamp } } };

  const response = await fetch(path, {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify({ address: facilityAddress }),
  });
  assert.equal(response.status, 401);
});

test('finalized-facility-state honors caller abort signal', async t => {
  const f = await fixture(t);
  const path = f.base + '/api/organization/network/finalized-facility-state';
  const facilityAddress = 'aa'.repeat(32);

  const controller = new AbortController();
  f.settings.rpc = async () => {
    controller.abort();
    await new Promise(r => setTimeout(r, 100));
    return '0x' + 'ab'.repeat(32);
  };

  await assert.rejects(
    () => fetch(path, {
      method: 'POST',
      headers: f.headers,
      body: JSON.stringify({ address: facilityAddress }),
      signal: controller.signal,
    }),
    /abort/i
  );
});

test('read-only HTTP forwards only a fixed credentialed query and redacts provider diagnostics', async t => {
  const f = await fixture(t), path = f.base + '/api/organization/network/indexer';
  const operation = { query: 'query Control($address: String!) { contractAction(address:$address) { state } }', variables: { address: 'ab'.repeat(32) }, operationName: 'Control' };
  const query = body => fetch(path, { method: 'POST', headers: f.headers, body: JSON.stringify(body) });
  const response = await query({ ...operation, url: 'https://attacker.example', authorization: 'must not forward' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { data: { contractAction: null } });
  assert.equal(f.requests.length, 1); assert.deepEqual(f.requests[0].body, operation); assert(f.requests[0].url.includes(f.token));
  for (const header of ['cookie', 'authorization', 'x-line-organization', 'x-line-wallet']) assert.equal(f.requests[0].headers[header], undefined);
  for (const body of [
    { query: 'mutation { submitTransaction(raw:"abc") }' },
    { query: 'query A { block { hash } } query B { block { hash } }', operationName: 'A' },
    { query: 'query { __schema { types { name } } }' },
    { query: 'query { ...Root } fragment Root on Query { block { hash } }' },
    { query: 'query { block { hash } }', variables: [] },
  ]) assert.equal((await query(body)).status, 400);
  assert.equal(f.requests.length, 1);
  assert.equal((await fetch(path + '?url=https://attacker.example', { method: 'POST', headers: f.headers, body: JSON.stringify(operation) })).status, 400);
  f.settings.reply = { data: { control: f.token }, errors: [{ message: `Failed at https://provider.example?project_id=${f.token}`, extensions: { secret: f.token } }], extensions: { secret: f.token } };
  const redacted = await (await query(operation)).text(); assert(!redacted.includes(f.token)); assert(!redacted.includes('provider.example')); assert(!redacted.includes('extensions'));
});

async function connect(f, headers = { Origin: f.origin, Cookie: f.cookie }) {
  const socket = new WebSocket(f.base.replace('http:', 'ws:') + '/api/organization/network/indexer/ws', 'graphql-transport-ws', { headers });
  await once(socket, 'open'); return socket;
}

test('native WebSocket subscriptions preserve read frames, strip init credentials, and close after sign-out', async t => {
  const f = await fixture(t), socket = await connect(f); t.after(() => socket.terminate());
  let received = once(socket, 'message'); socket.send(JSON.stringify({ type: 'connection_init', payload: { project_id: 'client-control', Authorization: 'must not forward' } }));
  assert.deepEqual(JSON.parse((await received)[0].toString()), { type: 'connection_ack' });
  received = once(socket, 'message');
  const payload = { query: 'subscription Control { contractActions(address:"abc") { state } }', operationName: 'Control' };
  socket.send(JSON.stringify({ type: 'subscribe', id: 'request-1', payload }));
  assert.deepEqual(JSON.parse((await received)[0].toString()), { type: 'next', id: 'request-1', payload: { data: { control: 'actual upstream WebSocket frame' } } });
  assert.deepEqual(f.connections[0].messages, [{ type: 'connection_init' }, { type: 'subscribe', id: 'request-1', payload }]);
  assert(f.connections[0].url.includes(f.token)); assert.equal(f.connections[0].headers.cookie, undefined);
  const closed = once(socket, 'close'), upstreamClosed = once(f.connections[0].socket, 'close');
  await fetch(f.base + '/api/organization/auth/logout', { method: 'POST', headers: f.headers });
  await Promise.all([closed, upstreamClosed]);
});

test('WebSocket admission rejects unsigned or foreign-origin callers and mutation frames never reach the provider', async t => {
  const f = await fixture(t);
  for (const headers of [{ Origin: f.origin }, { Origin: 'https://other.example', Cookie: f.cookie }]) {
    const socket = new WebSocket(f.base.replace('http:', 'ws:') + '/api/organization/network/indexer/ws', 'graphql-transport-ws', { headers });
    const response = await new Promise(yes => { socket.on('error', () => {}); socket.on('unexpected-response', (_request, reply) => { reply.resume(); socket.terminate(); yes(reply.statusCode); }); });
    assert([401, 403].includes(response));
  }
  assert.equal(f.connections.length, 0);
  const socket = await connect(f); let received = once(socket, 'message'); socket.send(JSON.stringify({ type: 'connection_init' })); await received;
  const closed = once(socket, 'close'); socket.send(JSON.stringify({ type: 'subscribe', id: 'bad', payload: { query: 'mutation { submitTransaction(raw:"abc") }' } })); await closed;
  assert.deepEqual(f.connections[0].messages, [{ type: 'connection_init' }]);
});
