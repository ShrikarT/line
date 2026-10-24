import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeOperationJournal } from './native-operation-journal.mjs';
import { OrganizationMerchants } from './organization-merchants.mjs';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import * as L from '@midnight-ntwrk/ledger-v8';
import { createFinalizedReceiptReader } from '../scripts/finalized-contract-receipt.mjs';
import { resolveMidnightEndpoints } from '../src/lib/runtime/endpoints.ts';

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

function observationFixture(t,{status='SUCCESS',segments=null,mutate=()=>{},beforeResponse=async()=>{}}={}){
  const directory=mkdtempSync(join(tmpdir(),'line-journal-observe-'));
  t.after(()=>{assert(resolve(directory).startsWith(resolve(tmpdir())+sep+'line-journal-observe-'));rmSync(directory,{recursive:true,force:true});});
  // Historical public bytes + controlled providers only. No wallet, current
  // chain lookup, proof generation, signing or submission takes place.
  const raw=readFileSync('tests/fixtures/private-offer-public-pairs/3-openLine.proven-public-tx.bin');
  const tx=L.Transaction.deserialize('signature','proof','binding',raw),address=[...tx.intents.values()].flatMap(i=>i.actions)[0].address;
  const journal=new NativeOperationJournal();journal.directory=directory;
  journal.state={contractAddress:address,orders:[{status:'created'}],receipts:[],pending:{id:'observe-original',kind:'call',name:'openLine',after:{contractAddress:address,orders:[{status:'quoted'}]},record:null}};
  journal.state.pending.record={...journal.transactionRecord(journal.state.pending,tx),disposition:'submission-attempted'};
  const path=join(directory,'observe-original.bin');writeFileSync(path,raw);
  journal.control={set:async()=>assert.fail('Observation must not persist or promote anything')};
  journal.fetchImpl=async()=>assert.fail('Observation must not submit');
  journal.submitPrepared=async()=>assert.fail('Observation must not recover prepared bytes');
  const blockHash='ed'.repeat(32),headHash='fa'.repeat(32),requests=[];
  const receipt={hash:tx.transactionHash(),raw:raw.toString('hex'),identifiers:tx.identifiers(),block:{height:120,hash:blockHash},transactionResult:{status,segments},contractActions:status==='FAILURE'?[]:[{__typename:'ContractCall',address,entryPoint:'openLine',state:Buffer.from(new L.ContractState().serialize()).toString('hex')}]};
  mutate(receipt);
  journal.reader=createFinalizedReceiptReader({endpoints:resolveMidnightEndpoints({networkId:'preview'}),fetchImpl:async(_url,options)=>{
    const request=JSON.parse(options.body);requests.push(request);await beforeResponse(request);
    const result=request.method==='chain_getFinalizedHead'?'0x'+headHash:request.method==='chain_getHeader'?{number:'0x7d'}:'0x'+blockHash;
    return new Response(JSON.stringify(request.query?{data:{transactions:[receipt]}}:{jsonrpc:'2.0',id:request.id,result}),{headers:{'content-type':'application/json'}});
  }});
  return {journal,path,raw,tx,requests,address};
}

for(const outcome of ['SUCCESS','FAILURE'])test(`non-submitting inspection observes exact finalized ${outcome} but retains original bytes and candidate`,async t=>{
  const f=observationFixture(t,{status:outcome}),prior=structuredClone(f.journal.state),observed=await f.journal.observePending();
  assert.equal(observed.status,`finalized-${outcome.toLowerCase()}-observed`);assert.equal(observed.pendingOperation,true);
  assert.equal(observed.identifier,f.tx.identifiers().at(-1));assert.equal(observed.originalTransactionHash,f.tx.transactionHash());assert.equal(observed.publishedTransactionHash,f.tx.transactionHash());
  assert.equal(observed.blockHeight,120);assert.deepEqual(f.journal.state,prior);assert.deepEqual(readFileSync(f.path),f.raw);
  assert(f.requests.every(request=>!request.method||request.method.startsWith('chain_get')));
  await assert.rejects(f.journal.operation('replacement','call','openLine',{}, {},async()=>assert.fail('Must retain original pending')),/Reconcile the pending/);
});

test('non-submitting inspection retains unsigned, orphan and prepared operations without querying or submitting',async t=>{
  const f=observationFixture(t);f.journal.state.pending.record.disposition='prepared';
  assert.equal((await f.journal.observePending()).status,'prepared-not-submitted-by-journal');
  f.journal.state.pending.record=null;
  assert.equal((await f.journal.observePending()).status,'prepared-not-submitted-by-journal');
  unlinkSync(f.path);
  assert.equal((await f.journal.observePending()).status,'unsigned-preparation');
  assert.equal(f.requests.length,0);assert.equal(f.journal.state.pending.id,'observe-original');
  f.journal.state.pending=null;
  assert.deepEqual(await f.journal.observePending(),{status:'no-pending-operation',pendingOperation:false});
});

test('non-submitting inspection fails closed for missing/tampered bytes, partial or unrelated outcomes and poisoned storage',async t=>{
  const f=observationFixture(t),prior=structuredClone(f.journal.state);
  writeFileSync(f.path,Buffer.concat([f.raw,Buffer.from([0])]));
  await assert.rejects(f.journal.observePending(),/canonical|deserializ|unused|trailing/i);
  writeFileSync(f.path,f.raw);f.journal.state.pending.record.txHash='aa'.repeat(32);
  await assert.rejects(f.journal.observePending(),/journal mismatch/);f.journal.state=structuredClone(prior);
  unlinkSync(f.path);await assert.rejects(f.journal.observePending(),/bytes are unavailable/);
  const partial=observationFixture(t,{status:'PARTIAL_SUCCESS',segments:[{id:0,success:false}]});
  await assert.rejects(partial.journal.observePending(),/TRANSACTION_NOT_ENTIRELY_SUCCESSFUL/);
  const unrelated=observationFixture(t,{mutate:tx=>{tx.identifiers=['00'+'ab'.repeat(32)];}});
  await assert.rejects(unrelated.journal.observePending(),/IDENTIFIERS_MISMATCH/);
  assert(partial.journal.state.pending&&unrelated.journal.state.pending);
  partial.journal.persistenceUncertain=true;
  await assert.rejects(partial.journal.observePending(),/storage is uncertain/);
});

test('supplier mutation guard covers observation and stale journal changes invalidate a delayed result',async t=>{
  let release,entered;const waiting=new Promise(resolve=>{entered=resolve;});
  const f=observationFixture(t,{beforeResponse:async request=>{if(request.query){entered();await new Promise(resolve=>{release=resolve;});}}});
  const service=new OrganizationMerchants();Object.assign(service,f.journal);service.parent={assertOpen(){}};
  const work=service.observePending();await waiting;
  await assert.rejects(service.runMutation(()=>assert.fail('Must serialize observation')),/another operation/);
  service.state.pending.record.disposition='submitted';
  release();await assert.rejects(work,/changed during inspection/);
  assert.equal(service.state.pending.id,'observe-original');
});
