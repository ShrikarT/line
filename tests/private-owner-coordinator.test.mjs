import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {coordinatorDrawFee,coordinatorOfferBinding,coordinatorRetainClaims,coordinatorSelectClaim,coordinatorUnencumberedReserve} from '../scripts/private-owner-coordinator.mjs';
import {roleHash} from '../scripts/private-offer-signers.mjs';
import {facilityBinding} from '../scripts/private-offer-encoding.mjs';
import {authorize as perOfferPolicy} from '../scripts/approval-owner-per-offer-policy.mjs';
import {authorize as fixedPolicy} from '../scripts/approval-owner-example-policy.mjs';
import {authorize as governancePolicy} from '../scripts/approval-owner-governance-policy.mjs';
import {authorize as lifecyclePolicy} from '../scripts/approval-owner-lifecycle-policy.mjs';

test('repayment owner records pin reference, amount, beneficiary, domain and denomination',()=>{
 const bytes=()=>new Uint8Array(randomBytes(32)),domain=bytes(),identity=bytes(),paymentRef=bytes();
 const book={domain,identity,limit:100n,outstanding:17n,epoch:1n,status:2};
 const receipt={paymentRef,amount:17n,domain,beneficiaryIdentity:identity,denomination:'synthetic-units'};
 const context={role:'issuer',clockUnixSeconds:100,config:{domain,agentIdentity:identity,lifecycleMode:'owner-records',validBefore:500n,denomination:'synthetic-units',receipts:[receipt]}};
 const request={name:'acknowledgeRepayment',args:[300n],values:{bookOpening:book,paymentRef,repayAmount:17n}};
 assert.deepEqual(lifecyclePolicy(request,context),{allowed:true,reservationCost:0n});
 for(const changed of [{...request,args:[100n]},{...request,args:[501n]},{...request,values:{...request.values,paymentRef:bytes()}},
  {...request,values:{...request.values,repayAmount:16n}},{...request,values:{...request.values,repayAmount:18n}},
  {...request,values:{...request.values,bookOpening:{...book,identity:bytes()}}},
  {...request,values:{...request.values,bookOpening:{...book,status:3}}}])assert.equal(lifecyclePolicy(changed,context).allowed,false);
 for(const config of [{...context.config,lifecycleMode:'off'},{...context.config,validBefore:undefined},
  {...context.config,receipts:[{...receipt,denomination:'other'}]},{...context.config,receipts:[{...receipt,domain:bytes()}]},
  {...context.config,receipts:[{...receipt,beneficiaryIdentity:bytes()}]}])assert.equal(lifecyclePolicy(request,{...context,config}).allowed,false);
 assert.equal(lifecyclePolicy(request,{...context,role:'agent'}).allowed,false);
 assert.equal(governancePolicy(request,context).allowed,false);
});

test('bilateral reopening requires debt-free own predecessor and owner-pinned terms catalog',()=>{
 const bytes=()=>new Uint8Array(randomBytes(32)),domain=bytes(),publicKey=RT.ecMulGenerator(19n),identity=roleHash('agent',publicKey,domain),terms=bytes();
 const config={domain,agentIdentity:identity,lifecycleMode:'owner-records',validBefore:500n,acceptedTermsCatalog:[terms],maxLineLimit:100n,maxFee:2n,maxBasisPoints:100n};
 const book={domain,identity,limit:100n,outstanding:0n,epoch:2n,generation:1n,status:3};
 const request={name:'openLine',args:[1n,300n,0n,100n],values:{enrollmentIdentity:identity,acceptedTerms:terms,hasPreviousBook:true,lineLimit:80n,bookOpening:book}};
 const context={role:'issuer',publicKey,clockUnixSeconds:100,config};
 assert.deepEqual(lifecyclePolicy(request,context),{allowed:true,reservationCost:80n});
 const agent={...context,role:'agent'},consent={...request,args:[0n,...request.args.slice(1)]};
 assert.deepEqual(lifecyclePolicy(consent,agent),{allowed:true,reservationCost:0n});
 for(const changed of [{...request,values:{...request.values,acceptedTerms:bytes()}},
  {...request,values:{...request.values,bookOpening:{...book,outstanding:1n}}},
  {...request,values:{...request.values,bookOpening:{...book,status:1}}},
  {...request,values:{...request.values,bookOpening:{...book,identity:bytes()}}},
  {...request,values:{...request.values,bookOpening:{...book,generation:(1n<<64n)-1n}}},
  {...request,values:{...request.values,lineLimit:101n}}])assert.equal(lifecyclePolicy(changed,context).allowed,false);
 assert.equal(lifecyclePolicy(consent,{...agent,publicKey:RT.ecMulGenerator(20n)}).allowed,false);
 assert.equal(lifecyclePolicy(request,{...context,config:{...config,lifecycleMode:'off'}}).allowed,false);
 assert.equal(fixedPolicy(request,{...context,config:{...config,acceptedTerms:terms}}).allowed,false);
});

test('free-reserve preflight retains every Compact lock including reported refund holds',()=>{
 const reserve={totalReserve:100n,encumberedReserve:10n,redeemedReserve:20n,feeReserve:3n,pendingFeeReserve:2n,refundReserve:5n,reportedRefundReserve:7n};
 assert.equal(coordinatorUnencumberedReserve(reserve),53n);
 assert.equal(coordinatorUnencumberedReserve({...reserve,totalReserve:47n}),0n);
 for(const change of [{totalReserve:46n},{refundReserve:-1n},{feeReserve:3},{redeemedReserve:1n<<64n}])assert.throws(()=>coordinatorUnencumberedReserve({...reserve,...change}));
});

test('opt-in issuer governance keeps own-book status, debt closure and withdrawal bounds',()=>{
 const b=()=>new Uint8Array(randomBytes(32)),domain=b(),identity=b(),book={domain,identity,status:1,outstanding:17n,limit:100n,epoch:1n};
 const context={role:'issuer',config:{domain,agentIdentity:identity,governanceMode:'bounded',allowedStatuses:[1,2,3],maxReserveWithdrawal:20n,maxFeeWithdrawal:5n}};
 const request={name:'setStatus',args:[2],values:{bookOpening:book}};
 assert.equal(governancePolicy(request,context).allowed,true);
 for(const changed of [{...request,args:[3]},{...request,args:[0]},{...request,args:[4]},
  {...request,values:{bookOpening:{...book,identity:b()}}},{...request,values:{bookOpening:{...book,domain:b()}}},
  {...request,values:{bookOpening:{...book,status:3}}},{...request,values:{bookOpening:{...book,epoch:(1n<<64n)-1n}}}])assert.equal(governancePolicy(changed,context).allowed,false);
 assert.equal(governancePolicy({...request,args:[3],values:{bookOpening:{...book,outstanding:0n}}},context).allowed,true);
 for(const change of [{...context,role:'agent'},{...context,config:{...context.config,governanceMode:'off'}},
  {...context,config:{...context.config,allowedStatuses:[1]}}])assert.equal(governancePolicy(request,change).allowed,false);
 for(const name of ['withdrawUnencumberedReserve','withdrawFees']){
  const amount=name==='withdrawFees'?4n:20n,withdraw={name,args:name==='withdrawFees'?[]:[amount],values:{},reserveCommit:b(),feeReserve:amount};
  assert.deepEqual(governancePolicy(withdraw,context),{allowed:true,reservationCost:amount});
  for(const changed of [{...withdraw,reserveCommit:undefined},{...withdraw,args:[21n],feeReserve:6n},
   {...withdraw,args:[0n],feeReserve:0n}])assert.equal(governancePolicy(changed,context).allowed,false);
  assert.equal(governancePolicy(withdraw,{...context,role:'merchant'}).allowed,false);
 }
 assert.equal(fixedPolicy(request,context).allowed,false);
 assert.equal(governancePolicy({name:'acknowledgeRepayment',args:[100n],values:{}},context).allowed,false);
});

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
