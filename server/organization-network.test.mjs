import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { bech32m } from '@scure/base';
import * as L from '@midnight-ntwrk/ledger-v8';
import { startOrganizationServer } from './organization-server.mjs';

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'line-network-test-'));
  writeFileSync(join(directory, 'index.html'), '<title>Network transport control</title>');
  const requests = [], connections = [], settings = { reply: null };
  const upstream = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(settings.reply ?? { data: { contractAction: null } }));
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
    endpoints: { indexerUri: `${upstreamOrigin}/graphql?project_id=${token}`, indexerWsUri: `${upstreamOrigin.replace('http:', 'ws:')}/ws?project_id=${token}` },
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
  return { app, base, origin, headers: { ...headers, Cookie: cookie }, cookie, requests, connections, token, settings };
}

test('the production entry provides authenticated public read URLs without returning its provider credential', async t => {
  const f = await fixture(t);
  const response = await fetch(f.base + '/api/organization/network', { headers: f.headers });
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.deepEqual(metadata, { networkId: 'preprod', indexerUri: `${f.origin}/api/organization/network/indexer`, indexerWsUri: `wss://line.example/api/organization/network/indexer/ws` });
  assert(!JSON.stringify(metadata).includes(f.token)); assert.equal(f.requests.length, 0);
  assert.equal((await fetch(f.base + '/api/organization/network', { headers: { Origin: f.origin } })).status, 401);
  assert.equal((await fetch(f.base + '/api/organization/network', { headers: { ...f.headers, Origin: 'https://other.example' } })).status, 403);
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
