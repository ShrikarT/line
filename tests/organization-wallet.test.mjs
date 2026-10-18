import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { OrganizationWallet } from '../server/organization-wallet.mjs';
import { OrganizationMerchants } from '../server/organization-merchants.mjs';

// Published BIP39 test vectors only. No facade, RPC client or chain submission
// is started by these storage/ownership tests.
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const another = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
function environment(t) {
  const directory = mkdtempSync(join(tmpdir(), 'line-supplier-owner-'));
  t.after(() => { assert(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'line-supplier-owner-')); rmSync(directory, { recursive: true, force: true }); });
  return { MIDNIGHT_SUPPLIER_MNEMONIC: mnemonic, MIDNIGHT_STORAGE_PASSWORD: 'SupplierStorageControl123!', MIDNIGHT_BLOCKFROST_PROJECT_ID: 'test-provider-control', LINE_SUPPLIER_DATA_DIR: directory };
}
const snapshot = owner => JSON.stringify({ networkId: 'preprod', publicKey: { publicKey: owner.dustKey.publicKey.toString() }, cacheControl: 'encrypted cache persistence control' });
function attachStorageOnlyFacade(owner, dust = snapshot(owner), stop = async () => {}) {
  owner.facade = { dust: { serializeState: async () => dust }, unshielded: { serializeState: async () => '{"networkId":"preprod"}' }, stop };
  return dust;
}
test('supplier ownership is encrypted, deterministic across reopen and contains no issuer or agent role', async t => {
  const env = environment(t), owner = await OrganizationWallet.open(env);
  assert.equal(owner.facade, undefined); assert.equal(owner.api, undefined);
  const roles = Object.keys(owner.keys); assert.deepEqual(roles.sort(), ['merchantA', 'merchantB']);
  const before = { recipients: { A: owner.recipients.A.address, B: owner.recipients.B.address }, keyA: owner.keys.merchantA.slice(), keyB: owner.keys.merchantB.slice() };
  assert.notEqual(before.recipients.A, before.recipients.B);
  const dust = attachStorageOnlyFacade(owner); await owner.persistWallet(); await owner.close();
  const checkpointPath = join(env.LINE_SUPPLIER_DATA_DIR, 'wallet-owner', readdirSync(join(env.LINE_SUPPLIER_DATA_DIR, 'wallet-owner')).find(name => name.endsWith('.checkpoint')));
  const ciphertext = readFileSync(checkpointPath, 'utf8');
  for (const excluded of [mnemonic, env.MIDNIGHT_STORAGE_PASSWORD, dust, 'encrypted cache persistence control', Buffer.from(before.keyA).toString('hex')]) assert(!ciphertext.includes(excluded));
  const restored = await OrganizationWallet.open(env);
  try { assert.equal(restored.record.dust, dust); assert.equal(restored.recipients.A.address, before.recipients.A); assert.equal(restored.recipients.B.address, before.recipients.B); assert.deepEqual(restored.keys.merchantA, before.keyA); assert.deepEqual(restored.keys.merchantB, before.keyB); }
  finally { await restored.close(); }
});
test('a live owner, wrong identity and wrong password cannot replace existing supplier custody', async t => {
  const env = environment(t), owner = await OrganizationWallet.open(env);
  await assert.rejects(OrganizationWallet.open(env), /owner|owned/);
  await owner.close();
  await assert.rejects(OrganizationWallet.open({ ...env, MIDNIGHT_SUPPLIER_MNEMONIC: another }), /unauthenticated|incompatible/);
  await assert.rejects(OrganizationWallet.open({ ...env, MIDNIGHT_STORAGE_PASSWORD: 'WrongStorageControl123!' }), /unauthenticated|incompatible/);
  const restored = await OrganizationWallet.open(env); await restored.close();
});
test('uncertain wallet-cache persistence keeps memory unchanged and blocks further mutations', async t => {
  const env = environment(t), owner = await OrganizationWallet.open(env), previous = structuredClone(owner.record);
  attachStorageOnlyFacade(owner);
  const save = owner.store.save.bind(owner.store); owner.store.save = async () => { throw Error('Actual persistence boundary rejected'); };
  await assert.rejects(owner.persistWallet(), /persistence boundary/);
  assert.deepEqual(owner.record, previous); assert.throws(() => owner.assertOpen(), /stopped and reopened/);
  owner.store.save = save; await owner.close();
  const reopened = await OrganizationWallet.open(env); reopened.assertOpen(); await reopened.close();
});
test('ownership is retained until the facade really stops and cleanup can then be retried', async t => {
  const env = environment(t), owner = await OrganizationWallet.open(env);
  let mayStop = false;
  attachStorageOnlyFacade(owner, snapshot(owner), async () => { if (!mayStop) throw Error('Facade is still active'); });
  await assert.rejects(owner.close(), /still active/);
  assert.throws(() => owner.assertOpen(), /stopped and reopened/);
  await assert.rejects(OrganizationWallet.open(env), /owner|owned/);
  mayStop = true; await owner.close();
  const replacement = await OrganizationWallet.open(env); await replacement.close();
});
test('invalid startup configuration is rejected before creating wallet custody', async t => {
  const env = environment(t);
  await assert.rejects(OrganizationWallet.open({ ...env, MIDNIGHT_SUPPLIER_MNEMONIC: 'invalid' }), /valid supplier/);
  await assert.rejects(OrganizationWallet.open({ ...env, MIDNIGHT_BLOCKFROST_PROJECT_ID: undefined }), /project token/);
  assert.deepEqual(readdirSync(env.LINE_SUPPLIER_DATA_DIR), []);
});

test('the actual encrypted supplier controller reopens without historical operator files or network startup', async t => {
  const env = environment(t), password = env.MIDNIGHT_STORAGE_PASSWORD;
  let owner = await OrganizationWallet.open(env);
  const retained = { id: '11111111-1111-4111-8111-111111111111', address: 'ab'.repeat(32), service: 'text-metrics', document: 'retained supplier input', inputDigest: 'control', status: 'created', quote: null, result: null };
  try {
    // Configuration changes after acquiring custody cannot silently rotate the
    // encryption password used by the controller.
    env.MIDNIGHT_STORAGE_PASSWORD = 'ChangedEnvironmentControl123!';
    const service = await OrganizationMerchants.create(owner, owner.recipients);
    assert.equal(owner.facade, undefined); assert.equal(owner.api, undefined);
    assert.equal(service.catalog().services.length, 2);
    assert(resolve(service.directory).startsWith(resolve(env.LINE_SUPPLIER_DATA_DIR) + sep));
    service.state.orders.push(retained); await service.save();
    service.ownsParent = true; await service.close();
    await assert.rejects(service.quote(retained.id, retained.address, retained.service, retained.document), /closed/);
    owner = await OrganizationWallet.open({ ...env, MIDNIGHT_STORAGE_PASSWORD: password });
    const reopened = await OrganizationMerchants.create(owner, owner.recipients);
    assert.deepEqual(reopened.state.orders, [retained]);
    assert.equal(reopened.order(retained.id).status, 'created');
    assert.equal(reopened.state.receipts.length, 0);
    reopened.ownsParent = true; await reopened.close();
  } finally { await owner.close(); }
});

test('supplier shutdown drains an admitted quote before releasing wallet custody', async t => {
  const env = environment(t), owner = await OrganizationWallet.open(env);
  const service = await OrganizationMerchants.create(owner, owner.recipients);
  service.ownsParent = true;
  let started, resume;
  const admitted = new Promise(resolve => { started = resolve; });
  const inspection = new Promise(resolve => { resume = resolve; });
  service.inspect = async () => { started(); await inspection; throw Error('Inspection ended without constructing a transaction'); };
  const pending = service.quote('22222222-2222-4222-8222-222222222222', 'ab'.repeat(32), 'text-metrics', 'Actual request input');
  const rejected = assert.rejects(pending, /without constructing/);
  await admitted;
  await assert.rejects(service.redeem('22222222-2222-4222-8222-222222222222', 'unused'), /another operation/);
  const closing = service.close();
  try {
    await assert.rejects(OrganizationWallet.open(env), /owner|owned/);
    await assert.rejects(service.quote('22222222-2222-4222-8222-222222222222', 'ab'.repeat(32), 'text-metrics', 'Actual request input'), /closed/);
  } finally { resume(); await rejected; await closing; }
  const reopened = await OrganizationWallet.open(env); await reopened.close();
});
