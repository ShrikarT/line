import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {coordinatorDrawFee,coordinatorOfferBinding,coordinatorRetainClaims,coordinatorSelectClaim} from '../scripts/private-owner-coordinator.mjs';
import {roleHash} from '../scripts/private-offer-signers.mjs';
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
const claimFixture=()=>{
 const bytes=()=>new Uint8Array(randomBytes(32)),points={merchantA:RT.ecMulGenerator(1n),merchantB:RT.ecMulGenerator(2n)};
 const merchant=roleHash('merchant',points.merchantA),offer={Q:bytes(),merchant,nonce:bytes(),bindingSalt:bytes(),amount:10n};
 const note={D:bytes(),Q:offer.Q,merchant,identity:bytes(),nonce:bytes(),salt:bytes(),generation:1n,amount:10n};
 return {points,offers:{merchantA:offer},notes:{merchantA:note},book:{identity:note.identity},bindingSalt:bytes()};
};
test('older quote and note openings survive replacement of current supplier selectors',()=>{
 const f=claimFixture(),oldOffer=structuredClone(f.offers.merchantA),oldNote=structuredClone(f.notes.merchantA),a=coordinatorRetainClaims(f);
 a.offers.merchantA={...oldOffer,Q:new Uint8Array(randomBytes(32)),nonce:new Uint8Array(randomBytes(32))};
 a.notes.merchantA={...oldNote,D:new Uint8Array(randomBytes(32)),nonce:new Uint8Array(randomBytes(32)),salt:new Uint8Array(randomBytes(32))};
 const b=coordinatorRetainClaims(a);assert.equal(Object.keys(b.offerRecords).length,2);assert.equal(Object.keys(b.noteRecords).length,2);
 assert.deepEqual(coordinatorSelectClaim(b,'offer','merchantA',Buffer.from(oldOffer.Q).toString('hex')),oldOffer);
 assert.deepEqual(coordinatorSelectClaim(b,'note','merchantA',Buffer.from(oldNote.D).toString('hex')),oldNote);
 assert.deepEqual(coordinatorSelectClaim(b,'note','merchantA'),b.notes.merchantA);assert.equal(f.offerRecords,undefined);
});
test('archive selectors reject foreign suppliers, missing records and ambiguous identifiers',()=>{
 const f=coordinatorRetainClaims(claimFixture()),id=Buffer.from(f.notes.merchantA.D).toString('hex');
 for(const [kind,merchant,selector]of [['note','merchantB',id],['note','merchantA','00'.repeat(32)],['note','merchantA','0x'+id],['offer','merchantA',id]])assert.throws(()=>coordinatorSelectClaim(f,kind,merchant,selector));
});
test('retention preserves legacy openings and rejects replacement of an archived nonce',()=>{
 const f=claimFixture();delete f.notes.merchantA.identity;const saved=coordinatorRetainClaims(f);
 assert.deepEqual(coordinatorSelectClaim(saved,'note','merchantA'),f.notes.merchantA);
 saved.notes.merchantA.nonce=new Uint8Array(randomBytes(32));assert.throws(()=>coordinatorRetainClaims(saved),/cannot change/);
});
