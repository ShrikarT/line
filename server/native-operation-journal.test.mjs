import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeOperationJournal } from './native-operation-journal.mjs';

test('failed receipt persistence never publishes candidate state and prevents further operations', async () => {
  const journal = new NativeOperationJournal();
  const row = { id: 'redeem-control', kind: 'call', name: 'redeemDraw', contractAddress: 'ab'.repeat(32), txId: 'cd'.repeat(32) };
  const prior = { orders: [{ status: 'quoted' }], receipts: [], pending: { record: row, after: { orders: [{ status: 'redeemed' }] } } };
  journal.state = prior;
  journal.reader = { read: async () => ({ transaction: { block: { height: 1 } }, finalizedHead: 'control' }) };
  let enter, fail;
  const entered = new Promise(resolve => { enter = resolve; });
  journal.control = { set: async (_, candidate) => { assert.equal(candidate.pending, null); enter(); await new Promise((_, reject) => { fail = reject; }); } };
  const work = journal.reconcile();
  const rejected = assert.rejects(work, /Persistence fault control/);
  await entered;
  try { assert.equal(journal.state, prior, 'the confirmed candidate must stay private until its write commits'); }
  finally { fail(Error('Persistence fault control')); await rejected; }
  assert.equal(journal.state, prior);
  let executed = false;
  await assert.rejects(journal.operation('new-charge', 'call', 'draw', {}, {}, async () => { executed = true; }), /storage|reopen/i);
  assert.equal(executed, false);
});

test('a failed controller write blocks retry before another journal or network action', async () => {
  const journal = new NativeOperationJournal(); journal.state = { receipts: [], pending: null };
  let writes = 0, executed = 0;
  journal.control = { set: async () => { writes++; throw Error('Disk unavailable control'); } };
  await assert.rejects(journal.save(), /Disk unavailable/);
  await assert.rejects(journal.operation('new-charge', 'call', 'draw', {}, {}, async () => { executed++; }), /storage|reopen/i);
  await assert.rejects(journal.recoverPending(), /storage|reopen/i);
  assert.equal(writes, 1); assert.equal(executed, 0);
});
