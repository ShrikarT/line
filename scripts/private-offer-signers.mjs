#!/usr/bin/env node
/** Synthetic signer fixtures for the private-offer compatibility experiment.
 * Each child owns its scalar and computes the exact action digest. It emits
 * signatures, never scalars. These fixtures approve requested test actions;
 * they are NOT borrower consent UX, institutional policy or durable custody.
 */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { BYTES32, DRAW_NOTE_PREIMAGE_TYPE } from '../src/lib/line/encoding.ts';
import { encodeVaultJson as wire, decodeVaultJson as unwire } from '../src/lib/security/vault-codec.ts';
import { commit } from './private-pool-spike.mjs';
import {offerCommit} from './private-offer-encoding.mjs';

const self=fileURLToPath(import.meta.url);
export const ORDER=6554484396890773809930967563523245729705921265872317281365359162392183254199n;
export const RADIX=1n<<128n;
export const bytes=()=>new Uint8Array(randomBytes(32));
export const zero=new Uint8Array(32);
export const words=n=>({lo:n%RADIX,hi:n/RADIX});
export const u64=n=>RT.convertFieldToBytes(32,BigInt(n),'signed-pool fixture');
export function tag(text){const result=new Uint8Array(32);result.set(new TextEncoder().encode(text));return result;}
export const hash=list=>RT.persistentHash(new RT.CompactTypeVector(list.length,BYTES32),list);
export const pointHash=pk=>RT.upgradeFromTransient(RT.transientHash(RT.CompactTypeJubjubPoint,pk));
export const roleHash=(role,pk,domain)=>role==='agent'?hash([tag('line:id'),domain,pointHash(pk)]):hash([tag(`line:${role}:pk`),pointHash(pk)]);
export const approvalMessage=(domain,op,body,nonce)=>hash([tag('line:signed:approval'),domain,u64(op),body,nonce]);
export const challenge=(message,pk,announcement)=>RT.degradeToTransient(hash([message,pointHash(pk),pointHash(announcement)]));
export function actionBody(pk,{name,args,values:v,domain,feeReserve,privateFinance,reserveCommit}){
 const old=()=>commit(v.bookOpening,v.salt);
 switch(name){
  case 'registerMerchant': return [1,args[0]];
  case 'disableMerchant': return [2,args[0]];
  case 'fundReserve': return [3,privateFinance?hash([reserveCommit,u64(args[0])]):u64(args[0])];
  case 'withdrawUnencumberedReserve': return [4,privateFinance?hash([reserveCommit,u64(args[0])]):u64(args[0])];
  case 'withdrawFees': return [5,privateFinance?hash([reserveCommit,u64(feeReserve)]):u64(feeReserve)];
  case 'openLine': {
   const [mode,expiry,flatFee,basisPoints]=args;
   const identity=mode===0n?roleHash('agent',pk,domain):v.enrollmentIdentity;
   const fresh={domain,identity,limit:v.lineLimit,outstanding:0n,epoch:0n,
    generation:v.hasPreviousBook?v.bookOpening.generation+1n:1n,expiry,flatFee,basisPoints,status:1};
   const request=hash([tag('line:pool:enroll'),domain,commit(fresh,v.newSalt),v.hasPreviousBook?old():zero,v.acceptedTerms]);
   return [6,hash([request,u64(mode)])];
  }
  case 'postQuote': return [7,offerCommit({merchant:roleHash('merchant',pk),binding:v.quoteFacilityBinding,invoice:v.invoiceId,amount:v.quoteAmount,expiry:args[0],nonce:v.quoteNonce,domain})];
  case 'draw': {
   const [Q,expiry,fee]=args,b=v.bookOpening;
   const D=RT.persistentCommit(DRAW_NOTE_PREIMAGE_TYPE,{domain,lineGeneration:b.generation,identity:b.identity,quoteCommit:Q,
    merchantPk:v.quoteMerchantPk,amount:v.drawAmount,fee,noteNonce:v.noteNonce,expiry},v.noteSalt);
   return [8,hash([Q,old(),v.newSalt,D,u64(v.drawAmount),u64(fee),u64(expiry)])];
  }
  case 'redeemDraw': return [9,hash([args[0],u64(args[1]),u64(v.redeemAmount)])];
  case 'cancelOrExpireNote': {
   const [D,mode,expiry]=args;
   if(mode===0n)return privateFinance?[10,D]:null;
   return [10,mode===1n?hash([D,u64(mode),old(),v.newSalt,u64(expiry)]):hash([D,u64(mode),u64(expiry),u64(v.repayAmount),v.paymentRef])];
  }
  case 'acknowledgeRepayment': return [11,hash([old(),u64(v.repayAmount),u64(args[0]),v.paymentRef,v.receiptNonce,v.newSalt])];
  case 'setStatus': return [12,hash([old(),u64(args[0]),v.newSalt])];
  default: throw Error('Unknown approval operation.');
 }
}
function randomScalar(){for(;;){const value=BigInt('0x'+randomBytes(32).toString('hex'));if(value>0n&&value<ORDER)return value;}}
async function signerMain(){
 const key=randomScalar(),pk=RT.ecMulGenerator(key);
 process.on('message',message=>{
  try{
   const descriptor=unwire(message.body);
   assert(!('callerSecret' in descriptor.values)&&!('agentSecret' in descriptor.values),'Signing scalars cannot arrive by IPC.');
   if(descriptor.privateFinance)for(const name of ['reserveOpening','reserveSalt','newReserveSalt','nullifierKey'])
    assert(!(name in descriptor.values),'Reserve openings and nullifier key cannot enter signer IPC.');
   if(descriptor.name==='postQuote'||descriptor.name==='redeemDraw'){
    const allowed=descriptor.name==='postQuote'?['quoteFacilityBinding','invoiceId','quoteAmount','quoteNonce']:['redeemAmount'];
    assert(Object.keys(descriptor.values).every(k=>allowed.includes(k)),'Supplier request contains unrelated private values.');
    assert(descriptor.feeReserve===undefined,'Supplier cannot receive issuer fee accounting.');
   }
   const operation=actionBody(pk,descriptor);
   if(!operation){process.send({id:message.id,body:wire({})});return;}
   const [op,body]=operation,nonce=descriptor.authorizationNonce??bytes();
   const digest=approvalMessage(descriptor.domain,op,body,nonce);
   const r=randomScalar(),announcement=RT.ecMulGenerator(r);
   const h=challenge(digest,pk,announcement)+(descriptor.challengeLiftForTest?RT.MAX_FIELD+1n:0n),remainder=h%ORDER,quotient=h/ORDER;
   const response=(r+(remainder*key))%ORDER;
   process.send({id:message.id,body:wire({rolePublicKey:pk,roleApproval:{announcement,response:words(response)},
    authorizationNonce:nonce,challengeQuotient:quotient,challengeRemainder:words(remainder),challengeWords:words(h),
    challengeCarry:(quotient*(ORDER%RADIX)+(remainder%RADIX))/RADIX})});
  }catch(error){process.send({id:message.id,error:error.message});}
 });
 process.send({ready:true,pid:process.pid,pk:wire(pk)});
}
export function startSigner(label){
 const child=fork(self,['--signer'],{execArgv:['--experimental-strip-types'],stdio:['ignore','ignore','pipe','ipc']});
 const pending=new Map();let next=0,yes,no;
 const ready=new Promise((resolve,reject)=>{yes=resolve;no=reject;});
 const timer=setTimeout(()=>no(Error('Signer fixture startup timed out.')),60000);
 child.on('error',no);child.on('exit',code=>{clearTimeout(timer);no(Error(`Signer fixture exited: ${code}`));
  for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('Signer fixture exited.'));}pending.clear();});
 child.on('message',message=>{
  if(message.ready){clearTimeout(timer);yes({pid:message.pid,pk:unwire(message.pk)});return;}
  const item=pending.get(message.id);if(!item)return;clearTimeout(item.timer);pending.delete(message.id);
  if(message.error)item.reject(Error(message.error));else item.resolve(unwire(message.body));
 });
 return {label,child,ready,approve(descriptor){return new Promise((resolve,reject)=>{
  const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Signer fixture approval timed out.'));},60000);
  pending.set(id,{resolve,reject,timer});child.send({id,body:wire(descriptor)},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
 });}};
}
if(process.argv[1]&&resolve(process.argv[1])===self&&process.argv[2]==='--signer')await signerMain();
