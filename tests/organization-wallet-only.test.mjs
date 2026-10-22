import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bech32m } from '@scure/base';
import * as L from '@midnight-ntwrk/ledger-v8';
import { resolve } from 'node:path';
import { startOrganizationServer } from '../server/organization-server.mjs';
import { organizationSigningBytes } from '../server/organization-auth.mjs';

test('wallet-only host starts without signing credentials, authenticates reads and refuses hosted purchases', async () => {
  const origin = 'http://127.0.0.1:31555';
  const env = { LINE_PUBLIC_ORIGIN: origin, LINE_ORGANIZATION_MODE: 'wallet-only', MIDNIGHT_BLOCKFROST_PROJECT_ID: 'test-provider-credential' };
  const app = await startOrganizationServer({ env, port: 0, host: '127.0.0.1', publicDirectory: resolve('dist') });
  const endpoint = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { Origin: origin, 'X-Line-Organization': 'wallet', 'Content-Type': 'application/json' };
  const request = (path, body, cookie) => fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    const ready = await request('/readyz');
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { ready: true, mode: 'wallet-only' });
    const page = await request('/app');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const entry = (await page.text()).match(/src="([^"]+\.js)"/)[1];
    assert.equal((await request(entry)).headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await request('/assets/missing-old-build.js')).status, 404);
    assert.equal((await request('/assets/missing-old-build.js')).headers.get('cache-control'), 'no-store');
    const catalog = await (await request('/api/organization/catalog')).json();
    assert.equal(catalog.hostedSupplierAutomation, false);
    assert.deepEqual(catalog.services, []);
    assert.equal(JSON.stringify(catalog).includes(env.MIDNIGHT_BLOCKFROST_PROJECT_ID), false);
    assert.equal((await request('/api/organization/network')).status, 401);
    const key = L.sampleSigningKey(), verifyingKey = L.signatureVerifyingKey(key);
    const address = bech32m.encodeFromBytes('mn_addr_preprod', Buffer.from(L.addressFromKey(verifyingKey), 'hex'));
    const challenge = await (await request('/api/organization/auth/challenge', { address })).json();
    const verified = await request('/api/organization/auth/verify', { nonce: challenge.nonce, proof: { verifyingKey, signature: L.signData(key, organizationSigningBytes(challenge.message)) } });
    assert.equal(verified.status, 200);
    const cookie = verified.headers.get('set-cookie').split(';')[0];
    const network = await request('/api/organization/network', undefined, cookie);
    assert.equal(network.status, 200);
    assert.equal((await network.json()).indexerUri, origin + '/api/organization/network/indexer');
    const refused = await request('/api/organization/orders', { id: '11111111-1111-4111-8111-111111111111' }, cookie);
    assert.equal(refused.status, 503);
    assert.match((await refused.json()).error, /Hosted API checkout is unavailable/);
    assert.equal((await request('/api/line/test-payout')).status, 404);
  } finally { await app.close(); }
});

test('an unknown hosting mode cannot silently start a custody wallet', async () => {
  await assert.rejects(startOrganizationServer({ env: { LINE_ORGANIZATION_MODE: 'typo' } }), /supplier or wallet-only/);
});
