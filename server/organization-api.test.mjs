import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { bech32m } from '@scure/base';
import * as L from '@midnight-ntwrk/ledger-v8';
import { organizationApi } from './organization-api.mjs';
import { OrganizationAuth, organizationSigningBytes } from './organization-auth.mjs';

test('production HTTP authenticates wallet ownership, serializes streamed requests and drains shutdown', async () => {
  const owner = L.sampleSigningKey(), other = L.sampleSigningKey(), recipient = L.addressFromKey(L.signatureVerifyingKey(owner)), address = 'ab'.repeat(32);
  const id = '11111111-1111-4111-8111-111111111111', orders = new Map();
  let quotes = 0, closed = false, resume, entered;
  const started = new Promise(resolve => { entered = resolve; }), pause = new Promise(resolve => { resume = resolve; });
  const service = {
    catalog: () => ({ services: [{ id: 'text-metrics' }] }),
    authorizeOrganization: async (value, account) => { await Promise.resolve(); return value === address && account === recipient; },
    order: value => orders.get(value) ?? null,
    quote: async value => { quotes++; entered(); await pause; orders.set(value, { id: value, contractAddress: address, result: 'private result control' }); },
    redeem: async () => { assert.fail('No redemption authorized by this transport test'); },
    close: async () => { closed = true; },
  };
  let api;
  const server = createServer((req, res) => { void api.middleware(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`; api = organizationApi({ service, origin });
  const headers = { Origin: origin, 'X-Line-Organization': 'wallet', 'Content-Type': 'application/json' };
  const request = (path, body, cookie) => fetch(origin + '/api/organization/' + path, { method: body ? 'POST' : 'GET', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  async function signIn(key) {
    const verifyingKey = L.signatureVerifyingKey(key), walletAddress = bech32m.encodeFromBytes('mn_addr_preprod', Buffer.from(L.addressFromKey(verifyingKey), 'hex'));
    const challenge = await (await request('auth/challenge', { address: walletAddress })).json();
    const verified = await request('auth/verify', { nonce: challenge.nonce, proof: { verifyingKey, signature: L.signData(key, organizationSigningBytes(challenge.message)) } });
    assert.equal(verified.status, 200); return verified.headers.get('set-cookie').split(';')[0];
  }
  const input = { id, contractAddress: address, service: 'text-metrics', document: 'Actual request input' };
  try {
    assert.equal((await request('catalog')).status, 200);
    assert.equal((await request('orders', input)).status, 401); assert.equal(quotes, 0);
    for (const delegated of [recipient, '{bad-json', JSON.stringify({ recipient, grantId: 'forged', expiresAt: Date.now() + 86400000 })]) {
      const forged = await fetch(origin + '/api/organization/orders', { method: 'POST', headers: { ...headers, 'X-Line-Agent-Grant': delegated }, body: JSON.stringify(input) });
      assert.equal(forged.status, 401);
      assert.equal(quotes, 0, 'Caller-provided recipient/grant must never authenticate a supplier mutation');
      assert.equal((await fetch(origin + '/api/organization/orders/' + id, { headers: { ...headers, 'X-Line-Agent-Grant': delegated } })).status, 401);
    }
    const wrong = await signIn(other), cookie = await signIn(owner);
    const wrongWallet = bech32m.encodeFromBytes('mn_addr_preprod', Buffer.from(L.addressFromKey(L.signatureVerifyingKey(other)), 'hex'));
    const ownerWallet = bech32m.encodeFromBytes('mn_addr_preprod', Buffer.from(L.addressFromKey(L.signatureVerifyingKey(owner)), 'hex'));
    const sessionState = await fetch(origin + '/api/organization/auth/session', { headers: { ...headers, Cookie: cookie, 'X-Line-Wallet': ownerWallet } });
    assert.equal(sessionState.status, 200);
    assert.deepEqual(await sessionState.json(), { authenticated: true, expiresAt: api.auth.require(cookie).expiresAt });
    assert.equal(sessionState.headers.get('set-cookie'), null);
    assert.equal((await request('auth/session', undefined, cookie)).status, 401);
    assert.equal((await fetch(origin + '/api/organization/auth/session', { headers: { ...headers, Cookie: cookie, 'X-Line-Wallet': wrongWallet } })).status, 401);
    const changedAccount = await fetch(origin + '/api/organization/orders/' + id, { headers: { ...headers, Cookie: cookie, 'X-Line-Wallet': wrongWallet } });
    assert.equal(changedAccount.status, 401); assert.equal((await changedAccount.json()).code, 'WALLET_AUTH_REQUIRED');
    assert.equal((await request('orders', input, wrong)).status, 404); assert.equal(quotes, 0);
    const pair = await Promise.all([request('orders', input, cookie), request('orders', { ...input, id: '22222222-2222-4222-8222-222222222222' }, cookie)]);
    assert.deepEqual(pair.map(response => response.status).sort(), [202, 409]); await started; assert.equal(quotes, 1);
    const hidden = await (await request(`orders/${id}`, undefined, wrong)).json();
    assert.deepEqual(hidden, { order: null, busy: false, error: null });
    const closing = api.close(); await Promise.resolve(); assert.equal(closed, false);
    assert.equal((await request('orders', input, cookie)).status, 503);
    resume(); await closing; assert.equal(closed, true);
    // Reuse the retained service across an API restart, then authenticate again.
    api = organizationApi({ service, origin });
    assert.equal((await request(`orders/${id}`, undefined, cookie)).status, 401);
    const wrongAgain = await signIn(other); assert.equal((await request(`orders/${id}`, undefined, wrongAgain)).status, 404);
    const ownerAgain = await signIn(owner), visible = await (await request(`orders/${id}`, undefined, ownerAgain)).json();
    assert.equal(visible.order.result, 'private result control'); assert.equal(quotes, 1);
    const foreign = await fetch(origin + '/api/organization/catalog', { headers: { ...headers, Origin: 'https://foreign.example' } });
    assert.equal(foreign.status, 403);
    assert.equal((await request('auth/logout', {}, ownerAgain)).status, 200);
    assert.equal((await request(`orders/${id}`, undefined, ownerAgain)).status, 401);
  } finally { resume(); await api.close(); await new Promise(resolve => server.close(resolve)); }
});

test('transport sign-in admission is bounded and expires without blocking the public catalog',async()=>{
  let now=1000000,api;
  const server=createServer((req,res)=>{void api.middleware(req,res,()=>res.end());});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  api=organizationApi({origin,auth:new OrganizationAuth(origin,()=>now),service:{catalog:()=>({services:[]}),close:async()=>{}}});
  const headers={Origin:origin,'X-Line-Organization':'wallet','Content-Type':'application/json'};
  const attempt=()=>fetch(origin+'/api/organization/auth/challenge',{method:'POST',headers,body:JSON.stringify({address:'invalid'})});
  try{
    const responses=await Promise.all(Array.from({length:121},attempt));
    assert.equal(responses.filter(response=>response.status===400).length,120);assert.equal(responses.filter(response=>response.status===429).length,1);
    assert.equal((await fetch(origin+'/api/organization/catalog',{headers})).status,200);
    now+=60001;assert.equal((await attempt()).status,400);
  }finally{await api.close();await new Promise(resolve=>server.close(resolve));}
});
