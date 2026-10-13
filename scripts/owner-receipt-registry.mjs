/** Owner-local receipt admission. No remote provisioning or settlement claim.
 * Records must be authenticated by the owner before admission. The fixture
 * explicitly admits synthetic records. Software storage is not an HSM.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EncryptedCheckoutStore} from '../server/checkout-storage.ts';
import {encodeVaultJson,decodeVaultJson} from '../src/lib/security/vault-codec.ts';
const ID='77777777-7777-4777-8777-777777777777',SCHEMA='line-owner-receipts/v1';
const clone=v=>decodeVaultJson(encodeVaultJson(v)),hex=b=>Buffer.from(b).toString('hex');
const equal=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&Buffer.from(a).equals(Buffer.from(b));
const byte32=v=>v instanceof Uint8Array&&v.length===32,u64=v=>typeof v==='bigint'&&v>=0n&&v<(1n<<64n);
const fp=v=>createHash('sha256').update(encodeVaultJson(v)).digest('hex'); // Local provenance, never a Compact hash replacement.
function scopeValue(scope){
 assert.deepEqual(Object.keys(scope).sort(),['custodyId','domain','beneficiaryIdentity','denomination'].sort());
 assert(typeof scope.custodyId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(scope.custodyId));
 assert(byte32(scope.domain)&&byte32(scope.beneficiaryIdentity));assert(typeof scope.denomination==='string'&&scope.denomination.length>0&&scope.denomination.length<=64);
 return {custodyId:scope.custodyId,domain:new Uint8Array(scope.domain),beneficiaryIdentity:new Uint8Array(scope.beneficiaryIdentity),denomination:scope.denomination};
}
function recordValue(record,scope){
 assert(['repayment','refund'].includes(record.purpose));
 const keys=['purpose','paymentRef','amount','domain','beneficiaryIdentity','denomination','evidenceClass',...(record.purpose==='refund'?['noteCommit']:[])];
 assert.deepEqual(Object.keys(record).sort(),keys.sort());
 assert(byte32(record.paymentRef)&&record.paymentRef.some(n=>n!==0)&&u64(record.amount));
 assert(record.purpose==='refund'||record.amount>0n);if(record.purpose==='refund')assert(byte32(record.noteCommit)&&record.noteCommit.some(n=>n!==0));
 assert(equal(record.domain,scope.domain)&&equal(record.beneficiaryIdentity,scope.beneficiaryIdentity)&&record.denomination===scope.denomination);
 assert(['synthetic-fixture','owner-reported'].includes(record.evidenceClass));return clone(record);
}
export class OwnerReceiptRegistry{
 #store;#scope;#state;#binding;#unavailable=false;#publication;
 static async open({directory,password,scope,create=false}){
  const selected=scopeValue(scope),binding=fp({schema:SCHEMA,scope:selected}),store=await EncryptedCheckoutStore.openBound(directory,password,binding);
  try{
   const entries=await store.loadAll();assert.equal(entries.length,create?0:1);
   const registry=new OwnerReceiptRegistry();registry.#store=store;registry.#scope=selected;registry.#binding=binding;
   registry.#state=create?{schema:SCHEMA,scope:selected,records:{}}:entries[0];
   assert.equal(registry.#state.schema,SCHEMA);assert.deepEqual(registry.#state.scope,selected);
   assert(Object.keys(registry.#state.records).length<=256);
   for(const [key,record]of Object.entries(registry.#state.records)){recordValue(record,selected);assert.equal(key,hex(record.paymentRef));}
   if(create)await registry.#publish(registry.#state);return registry;
  }catch(error){await store.close();throw error;}
 }
 #available(){assert(!this.#unavailable&&!this.#publication,'Receipt registry is closed, publishing or uncertain.');}
 get binding(){this.#available();return this.#binding;}
 get(paymentRef){this.#available();assert(byte32(paymentRef));const r=this.#state.records[hex(paymentRef)];return r?clone(r):undefined;}
 async admit(record){
  this.#available();const r=recordValue(record,this.#scope),key=hex(r.paymentRef),saved=this.#state.records[key];
  if(saved){assert.deepEqual(saved,r,'A receipt reference cannot be reassigned.');return clone(saved);}
  assert(Object.keys(this.#state.records).length<256,'Receipt capacity reached; explicit archival is required.');
  await this.#publish({...this.#state,records:{...this.#state.records,[key]:r}});return clone(r);
 }
 async #publish(next){
  try{this.#publication=this.#store.save(ID,next);await this.#publication;this.#state=clone(next);}
  catch(error){this.#unavailable=true;throw error;}finally{this.#publication=undefined;}
 }
 async close(){this.#unavailable=true;if(this.#publication)await this.#publication.catch(()=>{});await this.#store.close();}
}
