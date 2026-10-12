/** Source/instance-bound local financial recovery, not network confirmation.
 * SHA-256 fingerprints only journal provenance and serialized bytes. Compact
 * commitments remain actual Compact persistentCommit/persistentHash values.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EncryptedCheckoutStore} from '../server/checkout-storage.ts';
import {encodeVaultJson,decodeVaultJson} from '../src/lib/security/vault-codec.ts';
const SCHEMA='line-private-finance-journal/v1',ID='55555555-5555-4555-8555-555555555555';
const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>decodeVaultJson(encodeVaultJson(value));
const fp=value=>hash(encodeVaultJson(value));
const equal=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&Buffer.from(a).equals(Buffer.from(b));
const names=new Set(['registerMerchant','disableMerchant','fundReserve','withdrawUnencumberedReserve','withdrawFees','openLine','postQuote','draw','redeemDraw','cancelOrExpireNote','acknowledgeRepayment','setStatus']);
const normalize=scope=>{
 assert(scope&&typeof scope==='object');
 assert.deepEqual(Object.keys(scope).sort(),['sourceSha256','executableSha256','contractAddress','contractDomain','networkId'].sort());
 assert(['synthetic-preview','preprod'].includes(scope.networkId));
 for(const key of ['sourceSha256','executableSha256','contractAddress','contractDomain'])assert(/^[0-9a-f]{64}$/.test(scope[key]));
 return Object.fromEntries(['networkId','sourceSha256','executableSha256','contractAddress','contractDomain'].map(key=>[key,scope[key]]));
};
const checkpoint=value=>{
 assert(value&&value.publicState instanceof Uint8Array&&value.publicState.length>0&&value.publicState.length<=1_000_000);
 assert(value.privateState&&typeof value.privateState==='object');assert(value.financial&&typeof value.financial==='object');
 assert.deepEqual(Object.keys(value).sort(),['publicState','privateState','financial'].sort());return clone(value);
};
const authorizationIntent=value=>{
 assert(value&&typeof value==='object');
 assert.deepEqual(Object.keys(value).sort(),['operationId','circuit','circuitArgs','witnesses','descriptor','semanticRequest','before','fingerprint'].sort());
 assert(typeof value.operationId==='string'&&/^[a-zA-Z0-9:._-]{1,128}$/.test(value.operationId));
 assert(names.has(value.circuit)&&Array.isArray(value.circuitArgs));
 for(const key of ['witnesses','descriptor','semanticRequest'])assert(value[key]&&typeof value[key]==='object'&&!Array.isArray(value[key]));
 checkpoint(value.before);const {fingerprint,...intent}=value;assert.equal(fp(intent),fingerprint);return value;
};
export class PrivateFinanceJournal {
 #store;#scope;#record;#unavailable=false;
 static async open({directory,password,scope,create=false}){
  const selected=normalize(scope),binding=fp({schema:SCHEMA,scope:selected});
  const store=await EncryptedCheckoutStore.openBound(directory,password,binding);
  try{
   const entries=await store.loadAll();assert(entries.length<=1,'Financial journal must have one checkpoint.');
   if(create)assert.equal(entries.length,0,'Financial checkpoint already exists.');else assert.equal(entries.length,1,'Financial checkpoint is missing.');
   const journal=new PrivateFinanceJournal();journal.#store=store;journal.#scope=selected;
   journal.#record=create?{schema:SCHEMA,scope:selected,revision:0,confirmed:null,pending:null,completed:[]}:entries[0];
   assert.equal(journal.#record.schema,SCHEMA);assert.deepEqual(journal.#record.scope,selected);
   assert(Number.isSafeInteger(journal.#record.revision)&&journal.#record.revision>=0);
   assert(Array.isArray(journal.#record.completed)&&journal.#record.completed.length<=256);
   assert.equal(new Set(journal.#record.completed.map(c=>c.operationId)).size,journal.#record.completed.length);
   for(const c of journal.#record.completed)assert(typeof c.operationId==='string'&&/^[0-9a-f]{64}$/.test(c.fingerprint)&&/^[0-9a-f]{64}$/.test(c.stateSha256));
   if(journal.#record.confirmed)checkpoint(journal.#record.confirmed);
   if(journal.#record.authorizationIntent){const intent=authorizationIntent(journal.#record.authorizationIntent);assert(!journal.#record.pending,'Authorization intent and candidate cannot coexist.');assert.equal(fp(intent.before),fp(journal.#record.confirmed));assert(!journal.#record.completed.some(x=>x.operationId===intent.operationId));}
   if(journal.#record.pending){const {fingerprint,...operation}=journal.#record.pending;assert.equal(fp(operation),fingerprint);assert.equal(fp(operation.before),fp(journal.#record.confirmed));checkpoint(operation.candidate);}
   if(create)await journal.#publish(journal.#record);
   return journal;
  }catch(error){await store.close();throw error;}
 }
 #available(){assert(!this.#unavailable,'Financial publication is uncertain; reopen and reconcile.');}
 async #publish(next){
  assert(Number.isSafeInteger(next.revision)&&next.revision>=0);
  try{await this.#store.save(ID,next);this.#record=clone(next);}
  catch(error){this.#unavailable=true;throw error;}
 }
 async initialize(initial){this.#available();assert.equal(this.#record.confirmed,null);assert.equal(this.#record.pending,null);
  await this.#publish({...this.#record,revision:this.#record.revision+1,confirmed:checkpoint(initial)});
 }
 snapshot(){this.#available();return clone(this.#record);}
 async stageAuthorization({operationId,circuit,circuitArgs,witnesses,descriptor,semanticRequest,before}){
  this.#available();assert(!this.#record.pending,'An unresolved financial candidate blocks authorization.');
  assert(typeof operationId==='string'&&/^[a-zA-Z0-9:._-]{1,128}$/.test(operationId));assert(names.has(circuit)&&Array.isArray(circuitArgs));
  assert(witnesses&&typeof witnesses==='object'&&descriptor&&typeof descriptor==='object');
  assert(!this.#record.completed.some(x=>x.operationId===operationId),'Completed operation cannot stage a new authorization.');
  const prior=checkpoint(before);assert.equal(fp(prior),fp(this.#record.confirmed),'Authorization predecessor differs.');
  const intent={operationId,circuit,circuitArgs:clone(circuitArgs),witnesses:clone(witnesses),descriptor:clone(descriptor),semanticRequest:clone(semanticRequest),before:prior};
  const fingerprint=fp(intent);
  authorizationIntent({...intent,fingerprint});assert(this.#record.completed.length<256,'Financial operation capacity reached; explicit archival is required.');
  if(this.#record.authorizationIntent){assert.equal(this.#record.authorizationIntent.fingerprint,fingerprint,'Unresolved authorization blocks new work.');return clone(this.#record.authorizationIntent);}
  await this.#publish({...this.#record,revision:this.#record.revision+1,authorizationIntent:{...intent,fingerprint}});return clone(this.#record.authorizationIntent);
 }
 async prepare({operationId,circuit,circuitArgs,witnesses,before,candidate}){
  this.#available();assert(typeof operationId==='string'&&/^[a-zA-Z0-9:._-]{1,128}$/.test(operationId));
  assert(names.has(circuit)&&Array.isArray(circuitArgs));assert(witnesses&&typeof witnesses==='object');
  const prior=checkpoint(before),next=checkpoint(candidate);
  const operation={operationId,circuit,circuitArgs:clone(circuitArgs),witnesses:clone(witnesses),before:prior,candidate:next};
  const fingerprint=fp(operation),completed=this.#record.completed.find(item=>item.operationId===operationId);
  if(completed){assert.equal(completed.fingerprint,fingerprint,'Operation ID already binds another financial candidate.');return {status:'confirmed',...clone(completed)};}
  assert(this.#record.confirmed&&equal(this.#record.confirmed.publicState,prior.publicState),'Prepared predecessor differs from confirmed state.');
  assert.equal(fp(this.#record.confirmed),fp(prior),'Prepared predecessor lost private financial data.');
  if(this.#record.authorizationIntent){const intent=this.#record.authorizationIntent;assert.equal(intent.operationId,operationId);assert.equal(intent.circuit,circuit);
   assert.deepEqual(intent.circuitArgs,circuitArgs);assert.equal(fp(intent.before),fp(prior));
   for(const [key,value]of Object.entries(intent.witnesses))assert.equal(fp(value),fp(witnesses[key]),'Prepared witness differs from saved authorization intent.');}
  if(this.#record.pending){assert.equal(this.#record.pending.fingerprint,fingerprint,'An unresolved financial candidate blocks new work.');return {status:'prepared',...clone(this.#record.pending)};}
  assert(this.#record.completed.length<256,'Financial operation capacity reached; explicit archival is required.');
  await this.#publish({...this.#record,revision:this.#record.revision+1,pending:{...operation,fingerprint},authorizationIntent:null});
  return {status:'prepared',...clone(this.#record.pending)};
 }
 async confirm(operationId,observedPublicState){
  this.#available();const pending=this.#record.pending;
  if(!pending){const done=this.#record.completed.find(item=>item.operationId===operationId);assert(done,'Unknown financial operation.');assert(observedPublicState instanceof Uint8Array&&hash(observedPublicState)===done.stateSha256,'Confirmation differs from the accepted candidate.');return;}
  assert.equal(pending.operationId,operationId);assert(equal(observedPublicState,pending.candidate.publicState),'Candidate is not observed; retain the pending opening and reconcile.');
  const completed={operationId,fingerprint:pending.fingerprint,stateSha256:hash(observedPublicState)};
  await this.#publish({...this.#record,revision:this.#record.revision+1,confirmed:pending.candidate,pending:null,completed:[...this.#record.completed,completed]});
 }
 async close(){this.#unavailable=true;await this.#store.close();}
}
