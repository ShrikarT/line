import test from 'node:test';
import assert from 'node:assert/strict';
import {PreprodLive} from './preprod-live.mjs';
import {boot,blankPrivate,call,readLedger} from '../src/lib/line/compact-harness.ts';
import {merchantPublicKey} from '../src/lib/line/encoding.ts';

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
