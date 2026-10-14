import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {DurableApprovalSigner} from '../scripts/durable-approval-signer.mjs';
import {offerCommit} from '../scripts/private-offer-encoding.mjs';
import {roleHash,approvalMessage,challenge,ORDER,RADIX} from '../scripts/signed-pool-signers.mjs';
const NOW=1_800_000_000,bytes=()=>new Uint8Array(randomBytes(32));
function policy(request,{config,clockUnixSeconds}){
 return {allowed:request.name==='postQuote'&&request.args.length===1&&request.args[0]>BigInt(clockUnixSeconds)&&request.args[0]<=config.validBefore&&
  request.values.quoteAmount===config.price&&Buffer.from(request.values.invoiceId).equals(Buffer.from(config.invoice)),reservationCost:0n};
}
function setup(){
 mkdirSync('.compact-keys',{recursive:true});
 const directory=mkdtempSync(resolve('.compact-keys/durable-offer-test-')),domain=bytes(),invoice=bytes();
 const options={directory,encryptionKey:bytes(),custodyId:'supplier-offer-evaluation',role:'merchant',authorize:policy,clock:()=>NOW,approvalABI:'line-private-offer/v1'};
 const config={domain,maxAuthorizedCost:0n,price:15n,invoice,validBefore:BigInt(NOW+1000)};
 const signer=new DurableApprovalSigner({...options,create:true});signer.bindPolicy(config);
 const descriptor={name:'postQuote',args:[BigInt(NOW+300)],domain,privateFinance:true,
  values:{quoteFacilityBinding:bytes(),invoiceId:invoice,quoteAmount:15n,quoteNonce:bytes()}};
 return {options,config,signer,descriptor,request:{operationId:'invoice:1',descriptor}};
}
function verify(response,d){
 const Q=offerCommit({merchant:roleHash('merchant',response.rolePublicKey),binding:d.values.quoteFacilityBinding,invoice:d.values.invoiceId,
  amount:d.values.quoteAmount,expiry:d.args[0],nonce:d.values.quoteNonce,domain:d.domain});
 const h=challenge(approvalMessage(d.domain,7,Q,response.authorizationNonce),response.rolePublicKey,response.roleApproval.announcement);
 const s=response.roleApproval.response.hi*RADIX+response.roleApproval.response.lo;
 assert.deepEqual(RT.ecMulGenerator(s),RT.ecAdd(response.roleApproval.announcement,RT.ecMul(response.rolePublicKey,h%ORDER)));
}
test('durable supplier signs the exact private-offer digest and restores its committed approval',()=>{
 const x=setup();let signer=x.signer;
 try{
  const pk=signer.publicKey,response=signer.approve(x.request);verify(response,x.descriptor);
  signer.close();signer=new DurableApprovalSigner(x.options);signer.bindPolicy(x.config);
  assert.deepEqual(signer.publicKey,pk);assert.deepEqual(signer.approve(x.request),response);
  for(const key of ['bookOpening','quoteBuyer','quoteGeneration','quoteFlatFee','quoteBasisPoints','quoteBindingSalt'])
   assert.throws(()=>signer.approve({...x.request,descriptor:{...x.descriptor,values:{...x.descriptor.values,[key]:bytes()}}}),/could not be authorized/);
  assert.throws(()=>signer.approve({...x.request,descriptor:{...x.descriptor,approvalABI:'line-private-enrollment/v1'}}),/could not be authorized/);
  assert.throws(()=>signer.approve({...x.request,descriptor:{...x.descriptor,values:{...x.descriptor.values,quoteFacilityBinding:bytes()}}}),/could not be authorized/);
 }finally{signer.close();}
});
test('the owner-selected offer profile is authenticated in storage and cannot switch to the legacy ABI',()=>{
 const x=setup();const pk=x.signer.publicKey;x.signer.close();
 assert.throws(()=>new DurableApprovalSigner({...x.options,approvalABI:'line-private-enrollment/v1'}),/could not be authenticated/);
 assert.throws(()=>new DurableApprovalSigner({...x.options,approvalABI:'unknown'}),/Unsupported/);
 const restored=new DurableApprovalSigner(x.options);
 try{assert.deepEqual(restored.publicKey,pk);verify(restored.approve(x.request),x.descriptor);}
 finally{restored.close();}
});

test('supplier argument and value types reject hidden books before owner policy sees them',()=>{
 let policyCalls=0;
 const authorize=()=>{policyCalls++;return {allowed:true,reservationCost:0n};};
 const x=setup();x.signer.close();
 // Use a new owner identity because callback identity is bound in its journal.
 const directory=mkdtempSync(resolve('.compact-keys/durable-offer-type-test-'));
 const signer=new DurableApprovalSigner({...x.options,directory,authorize,create:true});signer.bindPolicy(x.config);
 try{
  const hiddenBook={limit:123n,outstanding:16n};
  for(const descriptor of [{...x.descriptor,args:[...x.descriptor.args,hiddenBook]},
   {...x.descriptor,args:[hiddenBook]},
   {...x.descriptor,values:{...x.descriptor.values,invoiceId:hiddenBook}},
   {...x.descriptor,values:{...x.descriptor.values,quoteAmount:hiddenBook}}])
   assert.throws(()=>signer.approve({...x.request,descriptor}),/could not be authorized/);
  assert.equal(policyCalls,0);
  verify(signer.approve(x.request),x.descriptor);assert.equal(policyCalls,1);
 }finally{signer.close();}
});
