import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '@midnight-ntwrk/ledger-v8';
import { bech32m } from '@scure/base';
import { AgentSupplierClient } from './agent-supplier-client.mjs';
import { agentGrantMessage } from './agent-authorization.mjs';
import { organizationSigningBytes } from './organization-auth.mjs';

function fixture() {
  const key = L.sampleSigningKey(), verifyingKey = L.signatureVerifyingKey(key), recipient = L.addressFromKey(verifyingKey);
  const scope = {
    schema: 'line:agent-grant/v1',
    grantId: 'c71dc18b-5000-4000-8000-e4fd3877bceb',
    networkId: 'preprod',
    runnerOrigin: 'http://127.0.0.1:8765',
    facilityAddress: '11'.repeat(32),
    domain: '22'.repeat(32),
    sourceFingerprint: '33'.repeat(32),
    ownerAddress: bech32m.encodeFromBytes('mn_addr_preprod', Buffer.from(recipient, 'hex')),
    runnerPublicKey: '44'.repeat(32),
    runnerSigningPublicKey: '4b'.repeat(32),
    returnPublicKey: '4c'.repeat(32),
    agentPk: '55'.repeat(32),
    generation: '2',
    bookCommitment: '66'.repeat(32),
    nonce: '77'.repeat(32),
    issuedAt: 1000,
    expiresAt: 100000,
    maxSpend: '100000',
    maxFee: '2000',
    allowedServices: ['line-doc-extract-v1'],
    allowedMerchants: ['88'.repeat(32)],
  };
  const proof = { verifyingKey, signature: L.signData(key, organizationSigningBytes(agentGrantMessage(scope))) };
  let now = 5000, ownerMatches = true, quotes = 0;
  // Authority-boundary fixture only; actual order/fulfillment logic has separate
  // tests against OrganizationMerchants. This fixture claims no chain evidence.
  const service = {
    authorizeOrganization: async (facility, owner) => ownerMatches && facility === scope.facilityAddress && owner === recipient,
    catalog: () => ({ network: 'preprod', sourceFingerprint: scope.sourceFingerprint, services: [{ id: 'line-doc-extract-v1', profile: { publicKey: '88'.repeat(32) } }, { id: 'unapproved', profile: { publicKey: '99'.repeat(32) } }] }),
    quote: async (id, contractAddress, service) => { quotes++; return { id, contractAddress, service }; },
    order: id => ({ id, contractAddress: scope.facilityAddress, service: 'line-doc-extract-v1', pending: false }),
    redeem: async () => { throw Error('This authorization fixture performs no redemption'); },
  };
  return { scope, proof, service, options: { service, scope, proof, pairing: scope, now: () => now }, setNow: value => { now = value; }, setOwner: value => { ownerMatches = value; }, quotes: () => quotes };
}

test('local supplier requires actual owner signature and pinned scope; remote mode has no bypass', async () => {
  const f = fixture();
  assert.throws(() => new AgentSupplierClient(), /actual local supplier/);
  assert.throws(() => new AgentSupplierClient({ ...f.options, mode: 'remote' }), /not implemented/);
  assert.throws(() => new AgentSupplierClient({ ...f.options, scope: { ...f.scope, maxSpend: '200000' } }), /signature/);
  const client = new AgentSupplierClient(f.options);
  assert.equal((await client.catalog()).services.length, 1);
  await client.createOrder({ id: '11111111-1111-4111-8111-111111111111', contractAddress: f.scope.facilityAddress, service: 'line-doc-extract-v1', document: 'Supplied document', objective: 'refund policy' });
  assert.equal(f.quotes(), 1);
  f.setOwner(false);
  await assert.rejects(client.getOrder('11111111-1111-4111-8111-111111111111'), /does not own/);
});

test('expired authorization cannot post a new quote while existing obligations remain readable', async () => {
  const f = fixture(), client = new AgentSupplierClient(f.options), id = '11111111-1111-4111-8111-111111111111';
  f.setNow(f.scope.expiresAt);
  await assert.rejects(client.createOrder({ id, contractAddress: f.scope.facilityAddress, service: 'line-doc-extract-v1', document: 'doc', objective: 'policy' }), /currently valid/);
  assert.equal(f.quotes(), 0);
  assert.equal((await client.getOrder(id)).order.id, id);
});

test('retirement inspection authenticates the owner and excludes another facility even for unsigned preparation',async()=>{
  const f=fixture(),client=new AgentSupplierClient(f.options);
  await assert.rejects(client.observePending(),/cannot safely inspect/);
  f.service.observePending=async()=>({status:'unsigned-preparation',pendingOperation:true,contractAddress:'ff'.repeat(32),operationId:'another-owner'});
  await assert.rejects(client.observePending(),/Another supplier operation/);
  f.service.observePending=async()=>({status:'no-pending-operation',pendingOperation:false});
  f.setNow(f.scope.expiresAt);
  assert.deepEqual(await client.observePending(),{status:'no-pending-operation',pendingOperation:false});
  f.setOwner(false);
  await assert.rejects(client.observePending(),/does not own/);
});
