import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '@midnight-ntwrk/ledger-v8';
import { bech32m } from '@scure/base';
import { agentGrantMessage, verifyAgentGrant, agentInputDigest, requireAgentBudget } from './agent-authorization.mjs';
import { organizationSigningBytes } from './organization-auth.mjs';

function fixture() {
  const key = L.sampleSigningKey(), verifyingKey = L.signatureVerifyingKey(key);
  const runnerSigningKey = L.sampleSigningKey(), runnerSigningPublicKey = L.signatureVerifyingKey(runnerSigningKey);
  const scope = {
    schema: 'line:agent-grant/v1',
    grantId: 'c71dc18b-5000-4000-8000-e4fd3877bceb',
    networkId: 'preprod',
    runnerOrigin: 'http://127.0.0.1:8765',
    facilityAddress: '11'.repeat(32),
    domain: '22'.repeat(32),
    sourceFingerprint: '33'.repeat(32),
    ownerAddress: bech32m.encodeFromBytes('mn_addr_preprod', Buffer.from(L.addressFromKey(verifyingKey), 'hex')),
    runnerPublicKey: '44'.repeat(32),
    runnerSigningPublicKey,
    returnPublicKey: '4a'.repeat(32),
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
  return { key, runnerSigningKey, scope, proof };
}

test('real ledger signature binds every grant field to a pinned pairing', () => {
  const { scope, proof } = fixture();
  assert.match(verifyAgentGrant(scope, proof, scope, 5000), /^[0-9a-f]{64}$/);
  for (const key of ['facilityAddress', 'domain', 'sourceFingerprint', 'runnerPublicKey', 'runnerSigningPublicKey', 'returnPublicKey', 'agentPk', 'bookCommitment', 'nonce']) {
    const changed = { ...scope, [key]: '99'.repeat(32) };
    assert.throws(() => verifyAgentGrant(changed, proof, changed, 5000), /signature/);
  }
  assert.throws(() => verifyAgentGrant(scope, proof, {}, 5000), /pinned pairing/);
  assert.throws(() => verifyAgentGrant(scope, proof, { ...scope, generation: '3' }, 5000), /pinned pairing/);
  assert.throws(() => verifyAgentGrant(scope, proof, { ...scope, runnerSigningPublicKey: '99'.repeat(32) }, 5000), /pinned pairing/);
  assert.throws(() => verifyAgentGrant(scope, proof, { ...scope, returnPublicKey: '99'.repeat(32) }, 5000), /pinned pairing/);
  assert.throws(() => verifyAgentGrant(scope, proof, scope, scope.expiresAt), /currently valid/);
  assert.throws(() => verifyAgentGrant(scope, proof, scope, 999), /currently valid/);
  assert.throws(() => verifyAgentGrant({ ...scope, maxSpend: '200000' }, proof, scope, 5000), /signature/);
  assert.throws(() => agentGrantMessage({ ...scope, hiddenScope: true }), /fields/);
  assert.throws(() => agentGrantMessage({ ...scope, maxSpend: '0100000' }), /amounts/);
  assert.throws(() => agentGrantMessage({ ...scope, runnerSigningPublicKey: scope.runnerPublicKey }), /distinct/);
  assert.throws(() => agentGrantMessage({ ...scope, runnerOrigin: 'http://127.0.0.1:' + '9'.repeat(250) }), /origin/);
});

test('another owner and unprefixed signatures cannot authorize an agent', () => {
  const { key, scope, proof } = fixture(), other = L.sampleSigningKey();
  const alien = { verifyingKey: L.signatureVerifyingKey(other), signature: L.signData(other, organizationSigningBytes(agentGrantMessage(scope))) };
  assert.throws(() => verifyAgentGrant(scope, alien, scope, 5000), /signature/);
  assert.throws(() => verifyAgentGrant(scope, { ...proof, signature: L.signData(key, Buffer.from(agentGrantMessage(scope))) }, scope, 5000), /signature/);
});

test('lifetime spending survives repayment and uncertain reservations consume capacity', () => {
  const { scope } = fixture(), purchase = { service: 'line-doc-extract-v1', merchantPk: '88'.repeat(32), principal: 50000n, fee: 1500n };
  assert.equal(requireAgentBudget(scope, { spent: 0n, reserved: 0n, revoked: false }, purchase, 5000), 51500n);
  assert.throws(() => requireAgentBudget(scope, { spent: 51500n, reserved: 0n, revoked: false }, purchase, 5000), /lifetime/);
  assert.throws(() => requireAgentBudget(scope, { spent: 0n, reserved: 51500n, revoked: false }, purchase, 5000), /lifetime/);
  assert.throws(() => requireAgentBudget(scope, { spent: 0n, reserved: 0n, revoked: true }, purchase, 5000), /inactive/);
  assert.throws(() => requireAgentBudget(scope, { spent: 0n, reserved: 0n, revoked: false }, { ...purchase, fee: 2001n }, 5000), /fee/);
});

test('task input digest binds exact unambiguous strings with Unicode and byte bounds', () => {
  assert.notEqual(agentInputDigest('a\0b', 'c'), agentInputDigest('a', 'b\0c'));
  assert.notEqual(agentInputDigest('report', 'first'), agentInputDigest('report', 'second'));
  assert.match(agentInputDigest('😀'.repeat(5000), '😀'.repeat(500)), /^[0-9a-f]{64}$/);
  assert.throws(() => agentInputDigest('x'.repeat(5001), 'question'), /5000/);
  assert.throws(() => agentInputDigest('report', '😀'.repeat(501)), /500/);
  assert.throws(() => agentInputDigest('\u0000'.repeat(5000), '\u0000'.repeat(500)), /too large/);
});
