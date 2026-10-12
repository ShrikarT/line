#!/usr/bin/env node
/** Experimental encrypted software signer; no network server or HSM claim.
 * The role owner supplies storage key and local policy. The coordinator gets
 * public identity/approvals only. A journal commit precedes every response.
 * Uses the candidate's exact Compact hashing and Jubjub approval semantics.
 */
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { encodeVaultJson, decodeVaultJson } from '../src/lib/security/vault-codec.ts';
import { ORDER, words, actionBody, approvalMessage, challenge, roleHash } from './signed-pool-signers.mjs';
import {offerCommit} from './private-offer-encoding.mjs';

const FORMAT='line:software-approval-store/v1';
const LEGACY_ABI='line-private-enrollment/v1',OFFER_ABI='line-private-offer/v1';
const byte32=v=>v instanceof Uint8Array&&v.length===32;
const uint64=v=>typeof v==='bigint'&&v>=0n&&v<=18446744073709551615n;
const status=v=>Number.isInteger(v)&&v>=0&&v<=3;
// These are the complete signer action tuples, including private finance
// arguments that Compact receives as witnesses rather than public inputs.
const ARG_TYPES={registerMerchant:[byte32],disableMerchant:[byte32],fundReserve:[uint64],withdrawUnencumberedReserve:[uint64],withdrawFees:[],
 openLine:[uint64,uint64,uint64,uint64],postQuote:[uint64],draw:[byte32,uint64,uint64],redeemDraw:[byte32,uint64],
 cancelOrExpireNote:[byte32,uint64,uint64],acknowledgeRepayment:[uint64],setStatus:[status]};
const UINT_VALUES=new Set(['lineLimit','quoteAmount','quoteGeneration','quoteFlatFee','quoteBasisPoints','drawAmount','redeemAmount','repayAmount']);
const MAX_FILE_BYTES=4*1024*1024,MAX_OPERATIONS=256;
const OPERATIONS=new Set(['registerMerchant','disableMerchant','fundReserve','withdrawUnencumberedReserve','withdrawFees','openLine',
 'postQuote','draw','redeemDraw','cancelOrExpireNote','acknowledgeRepayment','setStatus']);
const forbidden=['callerSecret','agentSecret','reserveOpening','reserveSalt','newReserveSalt','nullifierKey'];
const ROLE_OPERATIONS={issuer:new Set(['registerMerchant','disableMerchant','fundReserve','withdrawUnencumberedReserve','withdrawFees','openLine','cancelOrExpireNote','acknowledgeRepayment','setStatus']),
 agent:new Set(['openLine','draw','cancelOrExpireNote']),merchant:new Set(['postQuote','redeemDraw','cancelOrExpireNote']),permissionless:new Set(['cancelOrExpireNote'])};
const BOOK_FIELDS=new Set(['domain','identity','limit','outstanding','epoch','generation','expiry','flatFee','basisPoints','status']);
const VALUE_FIELDS={registerMerchant:[],disableMerchant:[],fundReserve:[],withdrawUnencumberedReserve:[],withdrawFees:[],
 openLine:['enrollmentIdentity','acceptedTerms','hasPreviousBook','lineLimit','newSalt','bookOpening','salt'],
 postQuote:['quoteBuyer','invoiceId','quoteAmount','quoteNonce','quoteGeneration','quoteFlatFee','quoteBasisPoints'],
 draw:['bookOpening','salt','newSalt','quoteMerchantPk','drawAmount','noteNonce','noteSalt'],redeemDraw:['redeemAmount'],
 acknowledgeRepayment:['bookOpening','salt','newSalt','repayAmount','paymentRef','receiptNonce'],setStatus:['bookOpening','salt','newSalt']};
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof Uint8Array);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex'); // Journal fingerprint only; never Compact hash replacement.
const clone=value=>decodeVaultJson(encodeVaultJson(value));
const canonical=value=>value instanceof Uint8Array?value:Array.isArray(value)?value.map(canonical):
 value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const fingerprint=value=>digest(encodeVaultJson(canonical(value)));
function scalar(){for(;;){const value=BigInt('0x'+randomBytes(32).toString('hex'));if(value>0n&&value<ORDER)return value;}}
const reject=()=>{throw Error('Approval could not be authorized.');};

export class DurableApprovalSigner {
 #directory;#file;#lock;#lease;#key;#aad;#state;#authorize;#clock;#approvalABI;#policyModuleSha256;#uncertain=false;#closed=false;
 constructor({directory,encryptionKey,custodyId,role,authorize,policyModuleSha256,create=false,clock=()=>Math.floor(Date.now()/1000),approvalABI=LEGACY_ABI}){
  assert(['issuer','agent','merchant','permissionless'].includes(role));
  assert([LEGACY_ABI,OFFER_ABI].includes(approvalABI),'Unsupported owner-selected approval ABI.');
  this.#approvalABI=approvalABI;
  assert(encryptionKey instanceof Uint8Array&&encryptionKey.length===32);
  assert(typeof custodyId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(custodyId));
  assert.equal(typeof authorize,'function');assert.equal(typeof clock,'function');
  assert(policyModuleSha256===undefined||typeof policyModuleSha256==='string'&&/^[0-9a-f]{64}$/.test(policyModuleSha256),'Invalid policy module fingerprint.');
  this.#policyModuleSha256=policyModuleSha256;
  this.#directory=resolve(directory);mkdirSync(this.#directory,{recursive:true,mode:0o700});
  assert(!lstatSync(this.#directory).isSymbolicLink(),'Signer directory must not be a symlink.');
  this.#file=join(this.#directory,'signer.enc.json');this.#lock=join(this.#directory,'signer.lock');
  // Preserve the existing enrollment journal namespace. The offer profile has
  // separate authenticated storage and cannot reopen a legacy identity silently.
  this.#key=Buffer.from(encryptionKey);this.#aad=Buffer.from(`${FORMAT}:${role}:${custodyId}${approvalABI===LEGACY_ABI?'':':'+approvalABI}`);
  this.#authorize=authorize;this.#clock=clock;
  try{
   this.#lease=openSync(this.#lock,'wx',0o600);writeFileSync(this.#lease,JSON.stringify({format:FORMAT,pid:process.pid}));fsyncSync(this.#lease);
   if(create){assert(!existsSync(this.#file),'Signer identity already exists.');
    this.#state={version:1,role,custodyId,scalar:scalar(),binding:null,approvedCost:0n,operations:{}};this.#persist(this.#state);
   }else this.#state=this.#read();
   assert.equal(this.#state.role,role);assert.equal(this.#state.version,1);
   assert.equal(this.#state.custodyId,custodyId);
   assert(this.#state.scalar>0n&&this.#state.scalar<ORDER);
   if(this.#state.binding){
    assert.equal(this.#state.binding.policyCodeSha256,digest(authorize.toString()),'Stored policy differs.');
    // A pinned store cannot be downgraded to function-text-only validation.
    // Legacy function-only stores are not silently upgraded to module pins.
    assert.equal(this.#state.binding.policyModuleSha256,policyModuleSha256,'Stored policy module differs.');
   }
  }catch(error){this.close();throw error;}
 }
 get publicKey(){this.#live();return RT.ecMulGenerator(this.#state.scalar);}
 get ownerScope(){this.#live();return {role:this.#state.role,approvalABI:this.#approvalABI,
  domain:this.#state.binding?new Uint8Array(this.#state.binding.config.domain):undefined};}
 bindPolicy(config){
  this.#live();assert(config.domain instanceof Uint8Array&&config.domain.length===32);
  assert(typeof config.maxAuthorizedCost==='bigint'&&config.maxAuthorizedCost>=0n&&config.maxAuthorizedCost<=18446744073709551615n);
  const binding={config:clone(config),policyCodeSha256:digest(this.#authorize.toString())};
  if(this.#policyModuleSha256!==undefined)binding.policyModuleSha256=this.#policyModuleSha256;
  if(this.#state.binding){assert.equal(fingerprint(binding),fingerprint(this.#state.binding),'Policy/domain binding cannot change.');return;}
  this.#commit({...this.#state,binding});
 }
 approve({operationId,descriptor}){
  this.#live();if(!this.#state.binding||typeof operationId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(operationId))reject();
  const encoded=encodeVaultJson(descriptor);if(Buffer.byteLength(encoded)>128*1024)reject();
  const request=decodeVaultJson(encoded),{config}=this.#state.binding;
  if(!request||!OPERATIONS.has(request.name)||request.privateFinance!==true||
   !(request.domain instanceof Uint8Array)||!Buffer.from(request.domain).equals(Buffer.from(config.domain))||
   !Array.isArray(request.args)||!isRecord(request.values)||
   request.authorizationNonce!==undefined||request.challengeLiftForTest!==undefined)reject();
  if(forbidden.some(key=>Object.hasOwn(request.values,key)))reject();
  if(request.args.length!==ARG_TYPES[request.name].length||request.args.some((v,i)=>!ARG_TYPES[request.name][i](v)))reject();
  if(Object.hasOwn(request,'reserveCommit')&&!byte32(request.reserveCommit))reject();
  if(Object.hasOwn(request,'feeReserve')&&!uint64(request.feeReserve))reject();
  const topFields=new Set(['name','args','domain','privateFinance','values']);
  if(['fundReserve','withdrawUnencumberedReserve','withdrawFees'].includes(request.name))topFields.add('reserveCommit');
  if(request.name==='withdrawFees')topFields.add('feeReserve');
  if(Object.keys(request).some(key=>!topFields.has(key)))reject();
  const allowedValues=new Set(request.name==='postQuote'&&this.#approvalABI===OFFER_ABI?
   ['quoteFacilityBinding','invoiceId','quoteAmount','quoteNonce']:request.name==='cancelOrExpireNote'?
   request.args[1]===0n?[]:request.args[1]===1n?['bookOpening','salt','newSalt']:['repayAmount','paymentRef']:VALUE_FIELDS[request.name]);
  if(Object.keys(request.values).some(key=>!allowedValues.has(key)))reject();
  for(const [key,value]of Object.entries(request.values)){
   if(key==='bookOpening')continue;
   if(key==='hasPreviousBook'){if(typeof value!=='boolean')reject();}
   else if(UINT_VALUES.has(key)){if(!uint64(value))reject();}
   else if(!byte32(value))reject();
  }
  if(Object.hasOwn(request.values,'bookOpening')&&(!isRecord(request.values.bookOpening)||
   Object.keys(request.values.bookOpening).some(key=>!BOOK_FIELDS.has(key))))reject();
  if(Object.hasOwn(request.values,'bookOpening'))for(const key of BOOK_FIELDS){
   const value=request.values.bookOpening[key];
   if(!(key==='domain'||key==='identity'?byte32(value):key==='status'?status(value):uint64(value)))reject();
  }
  if(!ROLE_OPERATIONS[this.#state.role].has(request.name))reject();
  if(request.name==='openLine'&&((this.#state.role==='issuer'&&request.args[0]!==1n)||(this.#state.role==='agent'&&request.args[0]!==0n)))reject();
  if(request.name==='cancelOrExpireNote'&&(request.args[1]!==0n&&
   !(this.#state.role==='issuer'&&(request.args[1]===1n||request.args[1]===2n))&&
   !(this.#state.role==='agent'&&request.args[1]===1n)))reject();
  const requestSha256=fingerprint(request),saved=Object.hasOwn(this.#state.operations,operationId)?this.#state.operations[operationId]:undefined;
  if(saved&&saved.requestSha256!==requestSha256)reject();
  const policyContext={publicKey:this.publicKey,role:this.#state.role,config:clone(config),clockUnixSeconds:this.#clock()};
  let decision;try{decision=this.#authorize(clone(request),policyContext);}catch{reject();}
  if(!decision||decision.allowed!==true||typeof decision.reservationCost!=='bigint'||decision.reservationCost<0n)reject();
  if(this.#state.role==='agent'&&request.name==='draw'&&
   (typeof request.values.drawAmount!=='bigint'||typeof request.args[2]!=='bigint'||request.values.drawAmount<=0n||request.args[2]<0n||
    decision.reservationCost!==request.values.drawAmount+request.args[2]))reject();
  if(saved)return clone(saved.response);
  if(Object.keys(this.#state.operations).length>=MAX_OPERATIONS||this.#state.approvedCost+decision.reservationCost>config.maxAuthorizedCost)reject();
  let operation;try{operation=request.name==='postQuote'&&this.#approvalABI===OFFER_ABI?
   [7,offerCommit({merchant:roleHash('merchant',this.publicKey),binding:request.values.quoteFacilityBinding,
    invoice:request.values.invoiceId,amount:request.values.quoteAmount,expiry:request.args[0],nonce:request.values.quoteNonce,domain:request.domain})]:
   actionBody(this.publicKey,request);}catch{reject();}if(!operation)reject();
  const [op,body]=operation,nonce=new Uint8Array(randomBytes(32)),message=approvalMessage(request.domain,op,body,nonce);
  const r=scalar(),announcement=RT.ecMulGenerator(r),h=challenge(message,this.publicKey,announcement),remainder=h%ORDER,quotient=h/ORDER;
  const response={rolePublicKey:this.publicKey,roleApproval:{announcement,response:words((r+remainder*this.#state.scalar)%ORDER)},
   authorizationNonce:nonce,challengeQuotient:quotient,challengeRemainder:words(remainder),challengeWords:words(h),
   challengeCarry:(quotient*(ORDER%(1n<<128n))+remainder%(1n<<128n))/(1n<<128n)};
  this.#commit({...this.#state,approvedCost:this.#state.approvedCost+decision.reservationCost,
   operations:{...this.#state.operations,[operationId]:{requestSha256,response}}});
  return clone(response);
 }
 #live(){assert(!this.#closed&&!this.#uncertain,'Signer must be reopened after closure or uncertain persistence.');}
 #commit(next){try{this.#persist(next);this.#state=next;}catch(error){this.#uncertain=true;throw error;}}
 #persist(state){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.#key,iv);cipher.setAAD(this.#aad);
  const ciphertext=Buffer.concat([cipher.update(encodeVaultJson(state),'utf8'),cipher.final()]);
  const envelope=JSON.stringify({format:FORMAT,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')});
  assert(Buffer.byteLength(envelope)<=MAX_FILE_BYTES);
  const temporary=join(this.#directory,`pending-${randomBytes(16).toString('hex')}.enc.json`);let fd;
  try{fd=openSync(temporary,'wx',0o600);writeFileSync(fd,envelope);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temporary,this.#file);}
  finally{if(fd!==undefined)closeSync(fd);if(existsSync(temporary))unlinkSync(temporary);}
 }
 #read(){
  try{
   const info=lstatSync(this.#file);assert(info.isFile()&&!info.isSymbolicLink()&&info.size<=MAX_FILE_BYTES);
   const e=JSON.parse(readFileSync(this.#file,'utf8'));assert.equal(e.format,FORMAT);
   assert(/^[0-9a-f]{24}$/.test(e.iv)&&/^[0-9a-f]{32}$/.test(e.tag)&&/^(?:[0-9a-f]{2})+$/.test(e.ciphertext));
   const decipher=createDecipheriv('aes-256-gcm',this.#key,Buffer.from(e.iv,'hex'));decipher.setAAD(this.#aad);decipher.setAuthTag(Buffer.from(e.tag,'hex'));
   return decodeVaultJson(Buffer.concat([decipher.update(Buffer.from(e.ciphertext,'hex')),decipher.final()]).toString('utf8'));
  }catch{throw Error('Signer storage could not be authenticated.');}
 }
 close(){
  if(this.#closed)return;this.#closed=true;
  if(this.#lease!==undefined){closeSync(this.#lease);this.#lease=undefined;unlinkSync(this.#lock);}
  this.#key?.fill(0);
 }
}

/** Owner-only stale-lease recovery. Never terminate a process or infer death
 * from timeout. Caller must provide the exact previously recorded PID. */
export function recoverStoppedSignerLease({directory,expectedPid}){
 assert(Number.isSafeInteger(expectedPid)&&expectedPid>0);
 const root=resolve(directory),lock=join(root,'signer.lock'),guard=join(root,'signer.recovery.lock');
 const owned=openSync(guard,'wx',0o600);
 try{
  writeFileSync(owned,JSON.stringify({format:FORMAT,pid:process.pid}));fsyncSync(owned);
  const info=lstatSync(lock);assert(info.isFile()&&!info.isSymbolicLink()&&info.size<1024);
  const lease=JSON.parse(readFileSync(lock,'utf8'));assert.equal(lease.format,FORMAT);assert.equal(lease.pid,expectedPid);
  let stopped=false;try{process.kill(expectedPid,0);}catch(error){if(error.code==='ESRCH')stopped=true;else throw error;}
  assert(stopped,'Signer process has not been confirmed stopped.');unlinkSync(lock);
 }finally{closeSync(owned);unlinkSync(guard);}
}
