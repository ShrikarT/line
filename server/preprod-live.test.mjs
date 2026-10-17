import test from 'node:test';
import assert from 'node:assert/strict';
import {PreprodLive} from './preprod-live.mjs';
import {boot,blankPrivate,call,readLedger} from '../src/lib/line/compact-harness.ts';
import {merchantPublicKey} from '../src/lib/line/encoding.ts';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as L from '@midnight-ntwrk/ledger-v8';
import {assertFundedFeeTransaction} from './preprod-fees.mjs';

test('actual rejected empty-fee bytes fail the guard; confirmed funded bytes pass',()=>{
 const decode=name=>L.Transaction.deserialize('signature','proof','binding',readFileSync(`tests/fixtures/preprod-fees/${name}.bin`));
 const rejected=decode('rejected-empty-fee'),confirmed=decode('confirmed-funded');
 const strict=new L.WellFormedStrictness();
 for(const key of ['enforceBalancing','verifyNativeProofs','verifyContractProofs','enforceLimits','verifySignatures'])strict[key]=false;
 assert.throws(()=>rejected.wellFormed(L.LedgerState.blank('preprod'),strict,new Date('2026-10-17T03:33:00Z')),/transaction is not in normal form/);
 assert.throws(()=>assertFundedFeeTransaction(rejected),/empty DUST intent/);
 assert.equal(assertFundedFeeTransaction(confirmed),confirmed);
});

async function fixture(){
 const keys={issuer:new Uint8Array(32).fill(31),merchantA:new Uint8Array(32).fill(32),merchantB:new Uint8Array(32).fill(33),agent:new Uint8Array(32).fill(34)};
 const salt=new Uint8Array(32).fill(35);let session=await boot(keys.issuer,keys.merchantA,new Uint8Array(32).fill(36),undefined,()=>Math.floor(Date.now()/1000));
 const initial=blankPrivate({callerSecret:keys.issuer,agentSecret:keys.agent,lineLimit:60n,salt});
 for(const op of [{name:'fundReserve',args:[200n]},{name:'registerMerchant',args:[merchantPublicKey(keys.merchantB)]},{name:'openLine',args:[BigInt(Math.floor(Date.now()/1000)+86400),0n,0n]}]){
  const result=await call(session,initial,op);assert.equal(result.ok,true,result.ok?'':result.error);session=result.session;
 }
 const runtime=Object.create(PreprodLive.prototype);runtime.keys=keys;runtime.state={phase:'ready',contractAddress:'ab'.repeat(32),limit:60n,outstanding:0n,epoch:0n,salt,orders:[],receipts:[],pending:null};
 runtime.publicProvider={queryContractState:async()=>({data:session.state.data??session.state})};runtime.save=async()=>{};
 runtime.call=async(id,name,args,input,after)=>{
  const existing=runtime.state.receipts.find(r=>r.id===id);if(existing)return existing;
  const result=await call(session,blankPrivate(input),{name,args});if(!result.ok)throw Error(result.error);session=result.session;
  const receipt={id,kind:'call',name};runtime.state={...after,receipts:[...runtime.state.receipts,receipt]};return receipt;
 };
 return {runtime,ledger:()=>readLedger(session)};
}
test('live checkout uses actual generated Compact quote/draw/redemption and exact retry charges once',async()=>{
 const f=await fixture(),id='12345678-1234-1234-1234-123456789abc';
 const result=await f.runtime.purchase(id,'An agent buys two services.');
 assert.equal(result.orders.length,2);assert(result.orders.every(o=>o.status==='delivered'));
 assert.equal(result.privateBook.outstanding,45);assert.equal(result.privateBook.remaining,15);
 const clock=f.ledger().actionClock,salt=f.runtime.state.salt;
 await f.runtime.purchase(id,'An agent buys two services.');assert.equal(f.ledger().actionClock,clock);assert.deepEqual(f.runtime.state.salt,salt);assert.equal(f.runtime.state.receipts.length,6);
 await assert.rejects(f.runtime.purchase(id,'Another document.'),/another document/);assert.equal(f.ledger().actionClock,clock);
});

test('a confirmed pending repayment is recovered before calculating the next private book',async()=>{
 const f=await fixture(),directory=mkdtempSync(join(tmpdir(),'line-reconcile-'));f.runtime.directory=directory;
 try{
  await f.runtime.purchase('12345678-1234-1234-1234-123456789abc','A document.');const before=structuredClone(f.runtime.state);
  await f.runtime.acknowledge('12345678-1234-1234-1234-123456789def');const after=structuredClone(f.runtime.state);
  f.runtime.state={...before,pending:{id:'pending-repay',after,record:{id:'pending-repay',kind:'call',name:'acknowledgeRepayment',disposition:'submitted',txId:'retained',contractAddress:before.contractAddress}}};
  f.runtime.reader={read:async()=>({transaction:{block:{height:123}},finalizedHead:{height:124}})};
  await f.runtime.purchase('12345678-1234-1234-1234-123456789aaa','New work after repayment.');
  assert.equal(f.runtime.state.outstanding,45n);assert.equal(f.runtime.state.epoch,5n);assert.equal(f.runtime.state.pending,null);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

for(const orphan of [false,true])test(`restart submits only the exact provably unsubmitted bytes (${orphan?'orphan bytes':'prepared journal'})`,async()=>{
 const directory=mkdtempSync(join(tmpdir(),'line-prepared-')),runtime=Object.create(PreprodLive.prototype);
 try{
  const raw=readFileSync('tests/fixtures/private-offer-public-pairs/3-openLine.proven-public-tx.bin'),tx=L.Transaction.deserialize('signature','proof','binding',raw);
  const address=[...tx.intents.values()][0].actions[0].address;
  runtime.directory=directory;runtime.state={contractAddress:address,receipts:[],pending:{id:'recovered-open',kind:'call',name:'openLine',after:{contractAddress:address,receipts:[],orders:[],limit:60n,outstanding:0n,epoch:0n,salt:new Uint8Array(32)},record:null}};
  if(!orphan)runtime.state.pending.record=runtime.transactionRecord(runtime.state.pending,tx);
  writeFileSync(join(directory,'recovered-open.bin'),raw);
  let submissions=0;const saved=[];runtime.save=async()=>{saved.push(structuredClone(runtime.state));};
  runtime.api={tx:{midnight:{sendMnTransaction:hex=>({toHex:()=>{assert.equal(hex,'0x'+raw.toString('hex'));return 'exact-extrinsic';}})}}};
  runtime.endpoints={nodeUri:'https://example.invalid'};
  runtime.fetchImpl=async(_url,options)=>{assert.equal(runtime.state.pending.record.disposition,'submission-attempted');assert.equal(saved.at(-1).pending.record.disposition,'submission-attempted');assert.equal(JSON.parse(options.body).params[0],'exact-extrinsic');submissions++;return new Response(JSON.stringify({result:'extrinsic-hash'}));};
  runtime.reader={read:async()=>({transaction:{block:{height:123}},finalizedHead:{height:124}})};
  await runtime.recoverPending();await runtime.recoverPending();
  assert.equal(submissions,1);assert.equal(runtime.state.receipts.length,1);assert.equal(runtime.state.receipts[0].txHash,tx.transactionHash());assert.equal(runtime.state.pending,null);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('uncertain submission is only reconciled and never rebroadcast when receipt lookup fails',async()=>{
 const runtime=Object.create(PreprodLive.prototype);runtime.state={pending:{id:'uncertain',record:{disposition:'submission-attempted',txId:'retained',kind:'call',name:'draw',contractAddress:'ab'.repeat(32)}}};
 runtime.reader={read:async()=>{throw Error('Not indexed');}};runtime.fetchImpl=async()=>assert.fail('Must not rebroadcast');
 await assert.rejects(runtime.recoverPending(),/Not indexed/);assert.equal(runtime.state.pending.id,'uncertain');
 await assert.rejects(runtime.operation('another','call','postQuote',{}, {},async()=>assert.fail('Must not execute')),/Reconcile/);
});

test('RPC rejection preserves its code and message while keeping the transaction uncertain',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'line-rejection-')),runtime=Object.create(PreprodLive.prototype);
 try{
  const raw=readFileSync('tests/fixtures/private-offer-public-pairs/3-openLine.proven-public-tx.bin'),tx=L.Transaction.deserialize('signature','proof','binding',raw);
  runtime.directory=directory;runtime.state={contractAddress:[...tx.intents.values()][0].actions[0].address,pending:{id:'rejected-open',kind:'call',name:'openLine'}};
  runtime.state.pending.record=runtime.transactionRecord(runtime.state.pending,tx);
  runtime.api={tx:{midnight:{sendMnTransaction:()=>({toHex:()=> 'same-extrinsic'})}}};runtime.endpoints={nodeUri:'https://example.invalid'};runtime.save=async()=>{};
  let attempts=0;runtime.fetchImpl=async()=>{attempts++;return new Response(JSON.stringify({error:{code:1010,message:'Invalid Transaction: Custom error: 170'}}));};
  await assert.rejects(runtime.submitPrepared(tx),/1010.*Custom error: 170/);
  const retained=JSON.parse(readFileSync(join(directory,'rejected-open.json'),'utf8'));
  assert.equal(retained.disposition,'submission-attempted');assert.equal(retained.submissionError.code,1010);assert.equal(retained.txHash,tx.transactionHash());
  runtime.reader={read:async()=>{throw Error('Not indexed');}};
  await assert.rejects(runtime.recoverPending(),/Not indexed/);assert.equal(attempts,1);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('actual Compact repayment restores the retained private book and repeated acknowledgement does not credit twice',async()=>{
 const f=await fixture();await f.runtime.purchase('12345678-1234-1234-1234-123456789abc','A document.');
 const repayId='12345678-1234-1234-1234-123456789def';
 await f.runtime.acknowledge(repayId);assert.equal(f.runtime.state.outstanding,0n);assert.equal(f.runtime.state.epoch,3n);
 const clock=f.ledger().actionClock;await f.runtime.acknowledge(repayId);assert.equal(f.ledger().actionClock,clock);
});
test('another purchase beyond the private limit gets generic rejection without changing debt or opening',async()=>{
 const f=await fixture();await f.runtime.purchase('12345678-1234-1234-1234-123456789abc','A document.');
 const salt=f.runtime.state.salt;await assert.rejects(f.runtime.purchase('12345678-1234-1234-1234-123456789def','More work.'),/^Error: Clearance could not be proven\.$/);
 assert.equal(f.runtime.state.outstanding,45n);assert.equal(f.runtime.state.epoch,2n);assert.deepEqual(f.runtime.state.salt,salt);
});
