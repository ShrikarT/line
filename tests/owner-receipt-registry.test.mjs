import test from 'node:test';import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';import {resolve,join} from 'node:path';
import {OwnerReceiptRegistry} from '../scripts/owner-receipt-registry.mjs';
import {createCompensationPolicy} from '../scripts/approval-owner-compensation-policy.mjs';
const bytes=()=>new Uint8Array(randomBytes(32));
function fixture(){mkdirSync('.compact-keys',{recursive:true});const scope={custodyId:'issuer-receipts',domain:bytes(),beneficiaryIdentity:bytes(),denomination:'synthetic-units'};
 return {directory:mkdtempSync(resolve('.compact-keys/owner-receipts-test-')),password:Buffer.from(bytes()).toString('hex'),scope};}
const refund=scope=>({purpose:'refund',paymentRef:bytes(),amount:7n,domain:scope.domain,beneficiaryIdentity:scope.beneficiaryIdentity,denomination:scope.denomination,noteCommit:bytes(),evidenceClass:'synthetic-fixture'});
test('owner receipts survive reopen, retain immutable note bindings and return detached records',async()=>{
 const x=fixture(),record=refund(x.scope);let registry=await OwnerReceiptRegistry.open({...x,create:true});const binding=registry.binding;
 await registry.admit(record);await registry.admit(structuredClone(record));const changed=registry.get(record.paymentRef);changed.amount=8n;changed.noteCommit.fill(0);
 assert.deepEqual(registry.get(record.paymentRef),record);await assert.rejects(registry.admit({...record,amount:8n}));
 await registry.close();registry=await OwnerReceiptRegistry.open(x);try{assert.equal(registry.binding,binding);assert.deepEqual(registry.get(record.paymentRef),record);}finally{await registry.close();}
 const ciphertext=readFileSync(join(x.directory,'77777777-7777-4777-8777-777777777777.checkpoint'),'utf8');assert(!ciphertext.includes('noteCommit'));assert(!ciphertext.includes(Buffer.from(record.paymentRef).toString('hex')));
 await assert.rejects(OwnerReceiptRegistry.open({...x,scope:{...x.scope,denomination:'other'}}));await assert.rejects(OwnerReceiptRegistry.open({...x,password:Buffer.from(bytes()).toString('hex')}));
});
test('receipt admission rejects unbound fields, direction changes, invalid references and amounts',async()=>{
 const x=fixture(),r=await OwnerReceiptRegistry.open({...x,create:true}),record=refund(x.scope);try{
  for(const changed of [{...record,purpose:'unknown'},{...record,amount:-1n},{...record,domain:bytes()},{...record,beneficiaryIdentity:bytes()},
   {...record,denomination:'other'},{...record,paymentRef:new Uint8Array(32)},{...record,noteCommit:new Uint8Array(32)},{...record,extra:true}])await assert.rejects(r.admit(changed));
  await r.admit({...record,amount:0n});await assert.rejects(r.admit({...record,purpose:'repayment'}));
 }finally{await r.close();}
});
test('refund policy binds owner authority, note, reference, amount, receiver and deadline',async()=>{
 const x=fixture(),r=await OwnerReceiptRegistry.open({...x,create:true}),record=refund(x.scope);await r.admit(record);
 try{const authorize=createCompensationPolicy(r),context={role:'issuer',clockUnixSeconds:100,config:{compensationMode:'bounded',compensationModes:[0n,1n,2n],receiptAuthority:r.binding,
  domain:x.scope.domain,agentIdentity:x.scope.beneficiaryIdentity,denomination:x.scope.denomination,validBefore:500n}};
 const request={name:'cancelOrExpireNote',args:[record.noteCommit,2n,300n],values:{paymentRef:record.paymentRef,repayAmount:7n}};
 assert.deepEqual(authorize(request,context),{allowed:true,reservationCost:0n});
 for(const changed of [{...request,args:[bytes(),2n,300n]},{...request,args:[record.noteCommit,2n,100n]},
  {...request,values:{...request.values,repayAmount:6n}},{...request,values:{...request.values,paymentRef:bytes()}}])assert.equal(authorize(changed,context).allowed,false);
 assert.equal(authorize(request,{...context,role:'agent'}).allowed,false);assert.equal(authorize(request,{...context,config:{...context.config,receiptAuthority:'wrong'}}).allowed,false);
 assert.equal(authorize(request,{...context,config:{...context.config,agentIdentity:bytes()}}).allowed,false);
 }finally{await r.close();}
});
