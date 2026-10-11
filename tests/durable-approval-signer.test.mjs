import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { DurableApprovalSigner, recoverStoppedSignerLease } from '../scripts/durable-approval-signer.mjs';
import { roleHash, ORDER, RADIX, actionBody, approvalMessage, challenge } from '../scripts/signed-pool-signers.mjs';
import { encodeVaultJson } from '../src/lib/security/vault-codec.ts';

const NOW=1_800_000_000,bytes=()=>new Uint8Array(randomBytes(32));
const equal=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&Buffer.from(a).equals(Buffer.from(b));
function agentPolicy(request,{publicKey,config,clockUnixSeconds}){
 const v=request.values;
 const allowed=request.name==='draw'&&request.args.length===3&&v.bookOpening&&equal(v.bookOpening.identity,roleHash('agent',publicKey,config.domain))&&
  equal(v.bookOpening.domain,config.domain)&&equal(v.quoteMerchantPk,config.allowedMerchant)&&
  typeof v.drawAmount==='bigint'&&v.drawAmount>0n&&v.drawAmount<=30n&&
  typeof request.args[2]==='bigint'&&request.args[2]>=0n&&request.args[2]<=2n&&
  typeof request.args[1]==='bigint'&&request.args[1]>BigInt(clockUnixSeconds)&&request.args[1]<=config.validBefore;
 return {allowed,reservationCost:allowed?v.drawAmount+request.args[2]:0n};
}
function setup(){
 mkdirSync('.compact-keys',{recursive:true});
 const directory=mkdtempSync(resolve('.compact-keys/durable-approval-test-')),key=bytes(),domain=bytes(),merchant=bytes();
 const options={directory,encryptionKey:key,custodyId:'agent-evaluation',role:'agent',authorize:agentPolicy,clock:()=>NOW};
 const signer=new DurableApprovalSigner({...options,create:true});
 signer.bindPolicy({domain,maxAuthorizedCost:50n,allowedMerchant:merchant,validBefore:BigInt(NOW+1000)});
 const descriptor={name:'draw',args:[bytes(),BigInt(NOW+300),1n],domain,privateFinance:true,
  values:{bookOpening:{domain,identity:roleHash('agent',signer.publicKey,domain),limit:100n,outstanding:0n,epoch:0n,generation:1n,
   expiry:BigInt(NOW+1000),flatFee:1n,basisPoints:0n,status:1},salt:bytes(),newSalt:bytes(),quoteMerchantPk:merchant,
   drawAmount:20n,noteNonce:bytes(),noteSalt:bytes()}};
 return {directory,key,domain,options,signer,descriptor,request:{operationId:'purchase:1',descriptor}};
}
function verify(response,descriptor){
 const [op,body]=actionBody(response.rolePublicKey,descriptor);
 const message=approvalMessage(descriptor.domain,op,body,response.authorizationNonce);
 const h=challenge(message,response.rolePublicKey,response.roleApproval.announcement);
 const s=response.roleApproval.response.hi*RADIX+response.roleApproval.response.lo;
 assert(s>=0n&&s<ORDER);
 assert.deepEqual(RT.ecMulGenerator(s),RT.ecAdd(response.roleApproval.announcement,RT.ecMul(response.rolePublicKey,h%ORDER)));
 assert.equal(response.challengeQuotient,h/ORDER);
 assert.equal(response.challengeRemainder.hi*RADIX+response.challengeRemainder.lo,h%ORDER);
}

test('committed approval and public identity survive lost response and restart',()=>{
 const x=setup();const pk=x.signer.publicKey,response=x.signer.approve(x.request);verify(response,x.descriptor);
 x.signer.close();const restored=new DurableApprovalSigner(x.options);
 try{assert.deepEqual(restored.publicKey,pk);assert.deepEqual(restored.approve(x.request),response);}
 finally{restored.close();}
 const ciphertext=readFileSync(join(x.directory,'signer.enc.json'),'utf8');
 assert(!ciphertext.includes('purchase:1')&&!ciphertext.includes('drawAmount')&&!ciphertext.includes('scalar'));
});
test('retry canonicalizes key ordering and does not expose a mutable cached response',()=>{
 const x=setup();try{
  const response=x.signer.approve(x.request),originalNonce=new Uint8Array(response.authorizationNonce);
  response.authorizationNonce[0]^=1;
  const descriptor=Object.fromEntries(Object.entries(x.descriptor).reverse());
  const retry=x.signer.approve({...x.request,descriptor});assert.deepEqual(retry.authorizationNonce,originalNonce);verify(retry,x.descriptor);
 }finally{x.signer.close();}
});
test('reused operation identity rejects altered price or note terms',()=>{
 const x=setup();try{
  x.signer.approve(x.request);
  const descriptor=structuredClone(x.descriptor);descriptor.values.drawAmount=19n;
  assert.throws(()=>x.signer.approve({...x.request,descriptor}),/could not be authorized/);
  descriptor.values.drawAmount=20n;descriptor.values.noteNonce=bytes();
  assert.throws(()=>x.signer.approve({...x.request,descriptor}),/could not be authorized/);
 }finally{x.signer.close();}
});
test('reserved authorization budget survives restart and does not count retries twice',()=>{
 const x=setup();x.signer.approve(x.request);x.signer.approve(x.request);x.signer.close();
 const restored=new DurableApprovalSigner(x.options);try{
  restored.approve({...x.request,operationId:'purchase:2'});
  assert.throws(()=>restored.approve({...x.request,operationId:'purchase:3'}),/could not be authorized/);
 }finally{restored.close();}
});
test('wrong merchant, foreign domain, excessive price, expired quote and wrong borrower reject',()=>{
 const x=setup();try{
  for(const mutate of [d=>d.values.quoteMerchantPk=bytes(),d=>d.domain=bytes(),d=>d.values.drawAmount=31n,
   d=>d.args[1]=BigInt(NOW),d=>d.values.bookOpening.identity=bytes(),d=>d.values.bookOpening.domain=bytes()]){
   const descriptor=structuredClone(x.descriptor);mutate(descriptor);
   assert.throws(()=>x.signer.approve({...x.request,descriptor}),/could not be authorized/);
  }
 }finally{x.signer.close();}
});
test('client-supplied signing scalar, reserve openings and authorization nonce reject',()=>{
 const x=setup();try{
  for(const field of ['callerSecret','agentSecret','reserveOpening','reserveSalt','newReserveSalt','nullifierKey']){
   const descriptor=structuredClone(x.descriptor);descriptor.values[field]=bytes();
   assert.throws(()=>x.signer.approve({...x.request,descriptor}),/could not be authorized/);
  }
  for(const field of ['authorizationNonce','challengeLiftForTest']){
   const descriptor=structuredClone(x.descriptor);descriptor[field]=bytes();
   assert.throws(()=>x.signer.approve({...x.request,descriptor}),/could not be authorized/);
  }
 }finally{x.signer.close();}
});
test('role-owner policy cannot be rebound to another contract or raised budget',()=>{
 const x=setup();try{
  assert.throws(()=>x.signer.bindPolicy({domain:bytes(),maxAuthorizedCost:500n}),/cannot change/);
  assert.throws(()=>x.signer.bindPolicy({domain:x.domain,maxAuthorizedCost:500n}),/cannot change/);
 }finally{x.signer.close();}
});
test('wrong storage key or role fails closed and releases only its own lease',()=>{
 const x=setup();x.signer.close();
 assert.throws(()=>new DurableApprovalSigner({...x.options,encryptionKey:bytes()}),/could not be authenticated/);
 assert.throws(()=>new DurableApprovalSigner({...x.options,role:'merchant'}),/could not be authenticated/);
 assert.throws(()=>new DurableApprovalSigner({...x.options,custodyId:'another-agent'}),/could not be authenticated/);
 const restored=new DurableApprovalSigner(x.options);restored.close();
});
test('tampered ciphertext never restores a signer',()=>{
 const x=setup();x.signer.close();const file=join(x.directory,'signer.enc.json'),original=readFileSync(file,'utf8'),envelope=JSON.parse(original);
 envelope.ciphertext=(envelope.ciphertext[0]==='0'?'1':'0')+envelope.ciphertext.slice(1);writeFileSync(file,JSON.stringify(envelope));
 assert.throws(()=>new DurableApprovalSigner(x.options),/could not be authenticated/);
 writeFileSync(file,original);const restored=new DurableApprovalSigner(x.options);restored.close();
});
test('a second owner cannot open the store or reclaim a live owner lease',()=>{
 const x=setup();try{
  assert.throws(()=>new DurableApprovalSigner(x.options),/EEXIST/);
  assert.throws(()=>recoverStoppedSignerLease({directory:x.directory,expectedPid:process.pid}),/not been confirmed stopped/);
  verify(x.signer.approve(x.request),x.descriptor);
 }finally{x.signer.close();}
});
test('failed persistence emits no approval and requires reopening',()=>{
 const x=setup(),file=join(x.directory,'signer.enc.json'),backup=join(x.directory,'backup.enc.json');
 renameSync(file,backup);mkdirSync(file);
 try{
  assert.throws(()=>x.signer.approve(x.request));
  assert.throws(()=>x.signer.approve(x.request),/uncertain persistence/);
 }finally{x.signer.close();rmdirSync(file);renameSync(backup,file);}
 const restored=new DurableApprovalSigner(x.options);try{verify(restored.approve(x.request),x.descriptor);}finally{restored.close();}
});
test('unknown operation and policy exceptions fail without exposing policy error details',()=>{
 const x=setup();try{
  assert.throws(()=>x.signer.approve({...x.request,descriptor:{...x.descriptor,name:'rotateIssuer'}}),/could not be authorized/);
 }finally{x.signer.close();}
 const directory=mkdtempSync(resolve('.compact-keys/durable-approval-test-'));
 const signer=new DurableApprovalSigner({directory,encryptionKey:bytes(),role:'agent',create:true,
  custodyId:'throwing-policy-evaluation',
  authorize:()=>{throw Error('private policy detail');}});
 try{signer.bindPolicy({domain:x.domain,maxAuthorizedCost:1n});
  assert.throws(()=>signer.approve(x.request),error=>error.message==='Approval could not be authorized.');
 }finally{signer.close();}
});
test('explicit stale lease recovery requires the exact terminal process identity',async()=>{
 const directory=mkdtempSync(resolve('.compact-keys/durable-approval-test-')),key=bytes();
 const code=`import {DurableApprovalSigner} from './scripts/durable-approval-signer.mjs';
  new DurableApprovalSigner({directory:process.env.LINE_SIGNER_TEST_DIR,encryptionKey:Buffer.from(process.env.LINE_SIGNER_TEST_KEY_HEX,'hex'),
   custodyId:'crash-evaluation',
   role:'agent',create:true,authorize:()=>({allowed:false,reservationCost:0n})});process.exit(0);`;
 const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],
  {env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,LINE_SIGNER_TEST_DIR:directory,LINE_SIGNER_TEST_KEY_HEX:Buffer.from(key).toString('hex')},stdio:'ignore'});
 await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',status=>status===0?resolve():reject(Error('Fixture child failed.')));});
 const lease=JSON.parse(readFileSync(join(directory,'signer.lock'),'utf8'));assert.equal(lease.pid,child.pid);
 assert.throws(()=>recoverStoppedSignerLease({directory,expectedPid:child.pid+1}));
 recoverStoppedSignerLease({directory,expectedPid:child.pid});
 const restored=new DurableApprovalSigner({directory,encryptionKey:key,custodyId:'crash-evaluation',role:'agent',authorize:()=>({allowed:false,reservationCost:0n})});
 restored.close();
});

test('crash after journal commit recovers the original approval without another budget reservation',async()=>{
 const x=setup();x.signer.close();
 const code=`import {DurableApprovalSigner} from './scripts/durable-approval-signer.mjs';
 import {roleHash} from './scripts/signed-pool-signers.mjs';
 import {decodeVaultJson} from './src/lib/security/vault-codec.ts';
 const equal=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&Buffer.from(a).equals(Buffer.from(b));
 const NOW=1800000000;
 ${agentPolicy.toString()}
 const signer=new DurableApprovalSigner({directory:process.env.LINE_SIGNER_TEST_DIR,custodyId:'agent-evaluation',
  encryptionKey:Buffer.from(process.env.LINE_SIGNER_TEST_KEY_HEX,'hex'),role:'agent',authorize:agentPolicy,clock:()=>NOW});
 signer.approve(decodeVaultJson(process.env.LINE_SIGNER_TEST_REQUEST));process.exit(0);`;
 const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{stdio:'ignore',
  env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,LINE_SIGNER_TEST_DIR:x.directory,
   LINE_SIGNER_TEST_KEY_HEX:Buffer.from(x.key).toString('hex'),LINE_SIGNER_TEST_REQUEST:encodeVaultJson(x.request)}});
 await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',status=>status===0?resolve():reject(Error('Fixture child failed.')));});
 recoverStoppedSignerLease({directory:x.directory,expectedPid:child.pid});
 const file=join(x.directory,'signer.enc.json'),committed=readFileSync(file,'utf8'),restored=new DurableApprovalSigner(x.options);
 try{
  const approval=restored.approve(x.request);verify(approval,x.descriptor);assert.equal(readFileSync(file,'utf8'),committed);
  assert.deepEqual(restored.approve(x.request),approval);
  restored.approve({...x.request,operationId:'purchase:2'});
  assert.throws(()=>restored.approve({...x.request,operationId:'purchase:3'}),/could not be authorized/);
 }finally{restored.close();}
});

test('baseline role gates and draw budget cannot be bypassed by a permissive policy',()=>{
 const x=setup(),directory=mkdtempSync(resolve('.compact-keys/durable-approval-test-'));
 const signer=new DurableApprovalSigner({directory,encryptionKey:bytes(),custodyId:'baseline-evaluation',role:'agent',create:true,
  authorize:()=>({allowed:true,reservationCost:0n})});
 try{
  signer.bindPolicy({domain:x.domain,maxAuthorizedCost:100n});
  for(const descriptor of [{...x.descriptor,name:'fundReserve',args:[1n]},
   {...x.descriptor,name:'openLine',args:[1n]},
   {...x.descriptor,name:'cancelOrExpireNote',args:[bytes(),2n,1n]},x.descriptor])
   assert.throws(()=>signer.approve({...x.request,descriptor}),/could not be authorized/);
 }finally{signer.close();x.signer.close();}
});
