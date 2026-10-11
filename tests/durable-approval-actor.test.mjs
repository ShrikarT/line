import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {startDurableApprovalActor} from '../scripts/durable-approval-actor.mjs';
import {roleHash,ORDER,RADIX,actionBody,approvalMessage,challenge} from '../scripts/signed-pool-signers.mjs';

const NOW=1_800_000_000,bytes=()=>new Uint8Array(randomBytes(32));
async function setup(){
 mkdirSync('.compact-keys',{recursive:true});
 const directory=mkdtempSync(resolve('.compact-keys/durable-actor-test-')),domain=bytes(),merchant=bytes(),acceptedTerms=bytes();
 const options={directory,encryptionKey:bytes(),custodyId:'actor-agent-evaluation',syntheticUnixSeconds:NOW,
  config:{domain,maxAuthorizedCost:50n,maxLineLimit:100n,maxFee:2n,maxBasisPoints:0n,maxDrawAmount:30n,
   validBefore:BigInt(NOW+1000),allowedMerchants:[merchant],acceptedTerms}};
 const actor=startDurableApprovalActor({...options,create:true}),point=await actor.ready;
 const book={domain,identity:roleHash('agent',point.pk,domain),limit:100n,outstanding:0n,epoch:0n,generation:1n,
  expiry:BigInt(NOW+1000),flatFee:1n,basisPoints:0n,status:1};
 const descriptor={name:'draw',args:[bytes(),BigInt(NOW+300),1n],domain,privateFinance:true,
  values:{bookOpening:book,salt:bytes(),newSalt:bytes(),quoteMerchantPk:merchant,drawAmount:20n,noteNonce:bytes(),noteSalt:bytes()}};
 return {actor,options,point,descriptor,request:{operationId:'purchase:1',descriptor}};
}
function verify(response,descriptor){
 const [op,body]=actionBody(response.rolePublicKey,descriptor),h=challenge(approvalMessage(descriptor.domain,op,body,response.authorizationNonce),response.rolePublicKey,response.roleApproval.announcement);
 const s=response.roleApproval.response.hi*RADIX+response.roleApproval.response.lo;
 assert.deepEqual(RT.ecMulGenerator(s),RT.ecAdd(response.roleApproval.announcement,RT.ecMul(response.rolePublicKey,h%ORDER)));
}

test('child identity and committed approval survive a real process restart',async()=>{
 const x=await setup();let actor=x.actor;
 try{
  assert.notEqual(x.point.pid,process.pid);
  const response=await actor.approve(x.request);verify(response,x.descriptor);await actor.stop();
  actor=startDurableApprovalActor({...x.options,create:false});const restored=await actor.ready;
  assert.notEqual(restored.pid,x.point.pid);assert.deepEqual(restored.pk,x.point.pk);
  assert.deepEqual(await actor.approve(x.request),response);
  await actor.approve({...x.request,operationId:'purchase:2'});
  await assert.rejects(actor.approve({...x.request,operationId:'purchase:3'}),/could not be authorized/);
 }finally{await actor.stop();}
});

test('child policy rejects a foreign buyer, merchant, price, domain and malformed private payload',async()=>{
 const x=await setup();try{
  for(const mutate of [d=>d.values.bookOpening.identity=bytes(),d=>d.values.quoteMerchantPk=bytes(),d=>d.values.drawAmount=31n,
   d=>d.domain=bytes(),d=>d.values.reserveOpening={secret:bytes()},d=>d.ownerPolicy={maxAuthorizedCost:500n}]){
   const descriptor=structuredClone(x.descriptor);mutate(descriptor);
   await assert.rejects(x.actor.approve({...x.request,descriptor}),/could not be authorized/);
  }
  const cyclic={};cyclic.self=cyclic;
  await assert.rejects(x.actor.approve({operationId:'malformed:1',descriptor:cyclic}),/could not be authorized/);
  verify(await x.actor.approve(x.request),x.descriptor);
 }finally{await x.actor.stop();}
});

test('owner-approved facility terms are checked before agent consent',async()=>{
 const x=await setup();try{
  const descriptor={name:'openLine',args:[0n,BigInt(NOW+900),1n,0n],domain:x.options.config.domain,privateFinance:true,
   values:{enrollmentIdentity:x.descriptor.values.bookOpening.identity,hasPreviousBook:false,lineLimit:100n,newSalt:bytes(),acceptedTerms:x.options.config.acceptedTerms}};
  verify(await x.actor.approve({operationId:'consent:1',descriptor}),descriptor);
  for(const mutate of [d=>d.args[0]=1n,d=>d.values.lineLimit=101n,d=>d.values.acceptedTerms=bytes(),d=>d.args[1]=BigInt(NOW)]){
   const altered=structuredClone(descriptor);mutate(altered);
   await assert.rejects(x.actor.approve({operationId:'consent:2',descriptor:altered}),/could not be authorized/);
  }
 }finally{await x.actor.stop();}
});

test('failed readiness stops the owned child and does not leave an approval channel',async()=>{
 const x=await setup();await x.actor.stop();
 const actor=startDurableApprovalActor({...x.options,create:false,startupTimeoutMs:1});
 const exited=new Promise(resolve=>actor.child.once('exit',resolve));
 await assert.rejects(actor.ready,/startup timed out/);
 await exited;
 assert(actor.child.exitCode!==null||actor.child.signalCode!==null);
 await assert.rejects(actor.approve(x.request),/unavailable/);
 await actor.stop();
 // The same owner can still recover its original identity after this failure.
 const recovered=startDurableApprovalActor({...x.options,create:false});
 try{assert.deepEqual((await recovered.ready).pk,x.point.pk);verify(await recovered.approve(x.request),x.descriptor);}
 finally{await recovered.stop();}
});
