import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {coordinatorDrawFee,coordinatorOfferBinding} from '../scripts/private-owner-coordinator.mjs';
import {facilityBinding} from '../scripts/private-offer-encoding.mjs';
import {authorize as perOfferPolicy} from '../scripts/approval-owner-per-offer-policy.mjs';
import {authorize as fixedPolicy} from '../scripts/approval-owner-example-policy.mjs';

test('coordinator uses exact ceiling fees for zero, fractional and maximum basis points',()=>{
 assert.equal(coordinatorDrawFee(15n,1n,0n),1n);
 assert.equal(coordinatorDrawFee(15n,1n,100n),2n);
 assert.equal(coordinatorDrawFee(100n,1n,100n),2n);
 assert.equal(coordinatorDrawFee(101n,1n,100n),3n);
 assert.equal(coordinatorDrawFee(15n,1n,10000n),16n);
});

test('coordinator rejects invalid numeric terms and UInt64 cost overflow',()=>{
 const max=(1n<<64n)-1n;
 for(const args of [[0n,0n,0n],[-1n,1n,0n],[1n,-1n,0n],[1n,1n,-1n],[1n,1n,10001n],
  [1,1n,0n],[max+1n,0n,0n],[1n,max,0n],[max,0n,1n]])assert.throws(()=>coordinatorDrawFee(...args));
 assert.equal(coordinatorDrawFee(max,0n,0n),0n);
});
test('new offers receive independent Compact bindings to the same private facility',()=>{
 const book={domain:new Uint8Array(randomBytes(32)),identity:new Uint8Array(randomBytes(32)),generation:1n};
 const a=coordinatorOfferBinding(book),b=coordinatorOfferBinding(book);
 assert.notDeepEqual(a.bindingSalt,b.bindingSalt);assert.notDeepEqual(a.binding,b.binding);
 assert.deepEqual(a.binding,facilityBinding(book,a.bindingSalt));
 for(const change of [{...book,generation:2n},{...book,domain:new Uint8Array(randomBytes(32))},{...book,identity:new Uint8Array(randomBytes(32))}])assert.notDeepEqual(a.binding,facilityBinding(change,a.bindingSalt));
});
test('per-offer supplier policy requires explicit scope and preserves fixed-binding policy',()=>{
 const binding=new Uint8Array(randomBytes(32)),other=new Uint8Array(randomBytes(32));
 const request={name:'postQuote',args:[200n],values:{quoteFacilityBinding:binding,quoteAmount:15n}};
 const context={role:'merchant',clockUnixSeconds:100,config:{facilityBindingMode:'per-offer',validBefore:300n,maxQuoteAmount:15n}};
 assert.equal(perOfferPolicy(request,context).allowed,true);assert.equal(perOfferPolicy({...request,values:{...request.values,quoteFacilityBinding:other}},context).allowed,true);
 for(const selected of [{...context,role:'issuer'},{...context,role:'agent'},{...context,config:{...context.config,facilityBindingMode:'fixed'}}])assert.equal(perOfferPolicy(request,selected).allowed,false);
 const fixed={...context,config:{...context.config,facilityBinding:binding}};
 assert.equal(fixedPolicy(request,fixed).allowed,true);assert.equal(fixedPolicy({...request,values:{...request.values,quoteFacilityBinding:other}},fixed).allowed,false);
});
test('per-offer supplier policy denies invalid bindings, prices, deadlines and unsupported actions',()=>{
 const request={name:'postQuote',args:[200n],values:{quoteFacilityBinding:new Uint8Array(randomBytes(32)),quoteAmount:15n}};
 const context={role:'merchant',clockUnixSeconds:100,config:{facilityBindingMode:'per-offer',validBefore:300n,maxQuoteAmount:15n}};
 for(const change of [{...request,args:[100n]},{...request,args:[301n]},{...request,name:'fundReserve'},
  {...request,values:{...request.values,quoteAmount:16n}},{...request,values:{...request.values,quoteAmount:0n}},
  {...request,values:{...request.values,quoteFacilityBinding:new Uint8Array(32)}},{...request,values:{...request.values,quoteFacilityBinding:new Uint8Array(31)}}])assert.equal(perOfferPolicy(change,context).allowed,false);
 assert.equal(perOfferPolicy({name:'redeemDraw',args:[new Uint8Array(32),200n],values:{redeemAmount:15n}},context).allowed,true);
});
