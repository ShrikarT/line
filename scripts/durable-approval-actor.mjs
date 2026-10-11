#!/usr/bin/env node
/** Synthetic owner-controlled child actor for Compact interoperability tests.
 * The test owner supplies its storage key and immutable policy before startup.
 * Approver IPC has no policy-binding, identity-creation or key-export command.
 * Same-host tests are not independent administration or a production service.
 */
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DurableApprovalSigner} from './durable-approval-signer.mjs';
import {roleHash} from './signed-pool-signers.mjs';
import {encodeVaultJson as wire,decodeVaultJson as unwire} from '../src/lib/security/vault-codec.ts';

const self=fileURLToPath(import.meta.url);
const equal=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&Buffer.from(a).equals(Buffer.from(b));
const u64=n=>typeof n==='bigint'&&n>=0n&&n<=18446744073709551615n;

/** Example agent policy, owned by the synthetic borrower controller.
 * It does not verify service fulfillment, lender terms or external payments.
 */
export function fixtureAgentPolicy(request,{publicKey,config,clockUnixSeconds}){
 const {name,args,values:v}=request;
 const ownsBook=v.bookOpening&&equal(v.bookOpening.domain,config.domain)&&
  equal(v.bookOpening.identity,roleHash('agent',publicKey,config.domain));
 if(name==='openLine'){
  const allowed=args.length===4&&args[0]===0n&&u64(args[1])&&args[1]>BigInt(clockUnixSeconds)&&args[1]<=config.validBefore&&
   u64(args[2])&&args[2]<=config.maxFee&&u64(args[3])&&args[3]<=config.maxBasisPoints&&
   u64(v.lineLimit)&&v.lineLimit>0n&&v.lineLimit<=config.maxLineLimit&&equal(v.acceptedTerms,config.acceptedTerms)&&
   typeof v.hasPreviousBook==='boolean'&&(!v.hasPreviousBook||(ownsBook&&v.bookOpening.status===3&&v.bookOpening.outstanding===0n));
  return {allowed,reservationCost:0n};
 }
 if(name==='draw'){
  const allowed=args.length===3&&ownsBook&&v.bookOpening.status===1&&u64(args[1])&&args[1]>BigInt(clockUnixSeconds)&&args[1]<=config.validBefore&&
   u64(args[2])&&args[2]<=config.maxFee&&u64(v.drawAmount)&&v.drawAmount>0n&&v.drawAmount<=config.maxDrawAmount&&
   config.allowedMerchants.some(m=>equal(m,v.quoteMerchantPk));
  return {allowed,reservationCost:allowed?v.drawAmount+args[2]:0n};
 }
 return {allowed:false,reservationCost:0n};
}

async function actorMain(){
 let signer;
 try{
  const key=process.env.LINE_APPROVAL_ACTOR_TEST_KEY_HEX;
  assert(typeof key==='string'&&/^[0-9a-f]{64}$/.test(key));
  const profile=unwire(process.env.LINE_APPROVAL_ACTOR_TEST_PROFILE);
  assert(profile.role==='agent'&&typeof profile.create==='boolean');
  assert(Number.isSafeInteger(profile.syntheticUnixSeconds)&&profile.syntheticUnixSeconds>=0);
  signer=new DurableApprovalSigner({directory:profile.directory,encryptionKey:Buffer.from(key,'hex'),custodyId:profile.custodyId,
   role:profile.role,create:profile.create,authorize:fixtureAgentPolicy,clock:()=>profile.syntheticUnixSeconds});
  signer.bindPolicy(profile.config);
  // Remove our references from the environment; this is not heap zeroization.
  delete process.env.LINE_APPROVAL_ACTOR_TEST_KEY_HEX;delete process.env.LINE_APPROVAL_ACTOR_TEST_PROFILE;
 }catch{signer?.close();console.error('Durable fixture actor could not start.');process.exitCode=1;return;}
 const close=()=>{signer.close();};
 process.on('SIGTERM',()=>{close();process.exit(0);});
 process.on('disconnect',()=>{close();process.exit(0);});
 process.on('message',message=>{
  if(message?.kind==='stop'){close();process.disconnect();return;}
  if(message?.kind!=='approve'||!Number.isSafeInteger(message.id))return;
  try{
   assert(typeof message.body==='string'&&Buffer.byteLength(message.body)<=128*1024);
   const response=signer.approve(unwire(message.body));
   process.send({id:message.id,body:wire(response)});
  }catch{process.send({id:message.id,error:'Approval could not be authorized.'});}
 });
 process.send({ready:true,pid:process.pid,publicKey:wire(signer.publicKey)});
}

/** Test-owner launcher only: its explicit key is synthetic configuration.
 * A production coordinator must not receive the owner's storage key/profile.
 */
export function startDurableApprovalActor({directory,encryptionKey,custodyId,config,create=false,syntheticUnixSeconds,startupTimeoutMs=60_000}){
 assert(encryptionKey instanceof Uint8Array&&encryptionKey.length===32);
 assert(Number.isSafeInteger(startupTimeoutMs)&&startupTimeoutMs>0&&startupTimeoutMs<=60_000);
 const profile={directory:resolve(directory),custodyId,role:'agent',config,create,syntheticUnixSeconds};
 const child=fork(self,['--fixture-actor'],{execArgv:['--experimental-strip-types'],stdio:['ignore','ignore','pipe','ipc'],
  env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,
   LINE_APPROVAL_ACTOR_TEST_KEY_HEX:Buffer.from(encryptionKey).toString('hex'),LINE_APPROVAL_ACTOR_TEST_PROFILE:wire(profile)}});
 let readyResolve,readyReject,next=0,stopping=false,startupFailed=false,stopPromise;
 const pending=new Map(),ready=new Promise((yes,no)=>{readyResolve=yes;readyReject=no;});
 const timer=setTimeout(()=>{
  startupFailed=true;readyReject(Error('Durable fixture actor startup timed out.'));
  // This launcher owns the child. Do not leave an unreachable signer alive
  // after readiness fails; a later owner may reclaim only its confirmed-dead lease.
  child.kill();
 },startupTimeoutMs);
 child.on('error',error=>{clearTimeout(timer);readyReject(error);});
 child.on('exit',()=>{
  clearTimeout(timer);readyReject(Error('Durable fixture actor stopped before readiness.'));
  for(const {reject,timer}of pending.values()){clearTimeout(timer);reject(Error('Durable fixture actor response is uncertain.'));}pending.clear();
 });
 child.on('message',message=>{
  if(message.ready){clearTimeout(timer);readyResolve({pid:message.pid,pk:unwire(message.publicKey)});return;}
  const item=pending.get(message.id);if(!item)return;
  clearTimeout(item.timer);pending.delete(message.id);
  if(message.error)item.reject(Error('Approval could not be authorized.'));else item.resolve(unwire(message.body));
 });
 return {child,ready,
  approve(request){
   if(stopping||startupFailed||!child.connected)return Promise.reject(Error('Durable fixture actor is unavailable.'));
   let body;try{body=wire(request);}catch{return Promise.reject(Error('Approval could not be authorized.'));}
   return new Promise((resolve,reject)=>{
    const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Durable fixture actor response is uncertain.'));},60_000);
    pending.set(id,{resolve,reject,timer});
    try{child.send({kind:'approve',id,body},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});}
    catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
   });
  },
  async stop(){
   if(stopping)return stopPromise;stopping=true;
   if(child.exitCode!==null||child.signalCode!==null)return;
   stopPromise=new Promise((yes,no)=>{child.once('error',no);child.once('exit',code=>startupFailed||code===0?yes():no(Error('Durable fixture actor did not stop cleanly.')));});
   if(startupFailed)child.kill();else if(child.connected)child.send({kind:'stop'});await stopPromise;
  }
 };
}

if(process.argv[1]&&resolve(process.argv[1])===self&&process.argv[2]==='--fixture-actor')await actorMain();
