import test from 'node:test';import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';import {resolve,join} from 'node:path';
import {PrivateFinanceJournal} from '../scripts/private-finance-journal.mjs';import {financeCommand} from '../scripts/private-finance-child.mjs';
const bytes=()=>new Uint8Array(randomBytes(32)),hex=()=>randomBytes(32).toString('hex');
function fixture(){
 mkdirSync('.compact-keys',{recursive:true});
 const owner={directory:mkdtempSync(resolve('.compact-keys/finance-journal-test-')),password:hex(),scope:{networkId:'synthetic-preview',sourceSha256:hex(),executableSha256:hex(),contractAddress:hex(),contractDomain:hex()}};
 const initial={publicState:bytes(),privateState:{reserve:{salt:bytes(),amount:200n}},financial:{book:{outstanding:0n},bookSalt:bytes(),bindingSalt:bytes(),nullifierKey:bytes()}};
 const candidate=structuredClone(initial);candidate.publicState=bytes();candidate.financial.book.outstanding=16n;candidate.financial.bookSalt=bytes();
 const operation={operationId:'purchase:1',circuit:'draw',circuitArgs:[bytes(),1800000300n],witnesses:{drawAmount:15n,drawFee:1n,newSalt:candidate.financial.bookSalt},before:initial,candidate};
 return {owner,initial,candidate,operation};
}
test('prepared witness/salt checkpoint survives independent storage processes without advancing early',async()=>{
 const x=fixture();const first=await financeCommand(x.owner,'initialize',x.initial);
 const prepared=await financeCommand(x.owner,'prepare',x.operation);assert.notEqual(first.pid,prepared.pid);
 const recovered=await financeCommand(x.owner,'snapshot');assert.notEqual(recovered.pid,prepared.pid);
 assert.deepEqual(recovered.value.confirmed,x.initial);assert.deepEqual(recovered.value.pending.candidate,x.candidate);assert.deepEqual(recovered.value.pending.witnesses,x.operation.witnesses);
 await assert.rejects(financeCommand(x.owner,'confirm',{operationId:'purchase:1',observedPublicState:x.initial.publicState}));
 assert.deepEqual((await financeCommand(x.owner,'snapshot')).value.pending.candidate,x.candidate);
 await financeCommand(x.owner,'confirm',{operationId:'purchase:1',observedPublicState:x.candidate.publicState});
 const done=(await financeCommand(x.owner,'snapshot')).value;assert.equal(done.pending,null);assert.deepEqual(done.confirmed,x.candidate);assert.equal(done.completed.length,1);
 await financeCommand(x.owner,'confirm',{operationId:'purchase:1',observedPublicState:x.candidate.publicState});
 await assert.rejects(financeCommand(x.owner,'prepare',{...x.operation,candidate:{...x.candidate,publicState:bytes()}}));
 assert.equal((await financeCommand(x.owner,'snapshot')).value.completed.length,1);
});
test('financial recovery rejects a different source, executable, contract, domain, network or password',async()=>{
 const x=fixture();let j=await PrivateFinanceJournal.open({...x.owner,create:true});await j.initialize(x.initial);await j.close();
 for(const field of Object.keys(x.owner.scope))await assert.rejects(PrivateFinanceJournal.open({...x.owner,scope:{...x.owner.scope,[field]:field==='networkId'?'preprod':hex()}}));
 await assert.rejects(PrivateFinanceJournal.open({...x.owner,password:hex()}));
 j=await PrivateFinanceJournal.open(x.owner);try{assert.deepEqual(j.snapshot().confirmed,x.initial);}finally{await j.close();}
});
test('one unresolved candidate blocks competing work and a live writer excludes another writer',async()=>{
 const x=fixture();const j=await PrivateFinanceJournal.open({...x.owner,create:true});try{
  await j.initialize(x.initial);await assert.rejects(PrivateFinanceJournal.open(x.owner));await j.prepare(x.operation);
  assert.deepEqual((await j.prepare(x.operation)).candidate,x.candidate);
  await assert.rejects(j.prepare({...x.operation,operationId:'purchase:2'}));await assert.rejects(j.prepare({...x.operation,before:{...x.initial,financial:{lostSalt:true}}}));
  assert.deepEqual(j.snapshot().confirmed,x.initial);
 }finally{await j.close();}
});
test('ciphertext does not contain openings and modified ciphertext cannot restore them',async()=>{
 const x=fixture();let j=await PrivateFinanceJournal.open({...x.owner,create:true});await j.initialize(x.initial);await j.prepare(x.operation);await j.close();
 const path=join(x.owner.directory,'55555555-5555-4555-8555-555555555555.checkpoint'),raw=readFileSync(path,'utf8');
 assert(!raw.includes(Buffer.from(x.initial.financial.nullifierKey).toString('hex')));assert(!raw.includes('outstanding'));assert(!raw.includes('drawAmount'));
 const e=JSON.parse(raw),b=Buffer.from(e.ciphertext,'base64');b[0]^=1;e.ciphertext=b.toString('base64');writeFileSync(path,JSON.stringify(e));
 await assert.rejects(PrivateFinanceJournal.open(x.owner));writeFileSync(path,raw);
 j=await PrivateFinanceJournal.open(x.owner);try{assert.deepEqual(j.snapshot().pending.candidate,x.candidate);}finally{await j.close();}
});
test('process loss after publication recovers both pending and confirmed data without a new candidate',async()=>{
 const x=fixture();await financeCommand(x.owner,'initialize',x.initial);
 await assert.rejects(financeCommand({...x.owner,crashAfterWrite:true},'prepare',x.operation),/uncertain/);
 assert.deepEqual((await financeCommand(x.owner,'snapshot')).value.pending.candidate,x.candidate);
 await assert.rejects(financeCommand({...x.owner,crashAfterWrite:true},'confirm',{operationId:'purchase:1',observedPublicState:x.candidate.publicState}),/uncertain/);
 const restored=(await financeCommand(x.owner,'snapshot')).value;assert.equal(restored.pending,null);assert.deepEqual(restored.confirmed,x.candidate);assert.equal(restored.completed.length,1);
 assert.equal((await financeCommand(x.owner,'prepare',x.operation)).value.status,'confirmed');
});
test('an actual publication failure closes mutation until the owner reopens committed data',async()=>{
 const x=fixture();let j=await PrivateFinanceJournal.open({...x.owner,create:true});await j.initialize(x.initial);
 const path=join(x.owner.directory,'55555555-5555-4555-8555-555555555555.checkpoint'),original=readFileSync(path);
 // This dedicated test file is replaced by a directory to make rename fail.
 unlinkSync(path);mkdirSync(path);
 await assert.rejects(j.prepare(x.operation));assert.throws(()=>j.snapshot(),/uncertain/);await assert.rejects(j.prepare(x.operation),/uncertain/);await j.close();
 rmdirSync(path);writeFileSync(path,original,{mode:0o600});
 j=await PrivateFinanceJournal.open(x.owner);try{assert.deepEqual(j.snapshot().confirmed,x.initial);assert.equal(j.snapshot().pending,null);}finally{await j.close();}
});

const intentFor=x=>({operationId:x.operation.operationId,circuit:x.operation.circuit,circuitArgs:x.operation.circuitArgs,witnesses:x.operation.witnesses,
 descriptor:{name:'draw',args:x.operation.circuitArgs,values:{amount:15n}},semanticRequest:{operationId:x.operation.operationId,actor:'agent',circuit:'draw',merchant:'merchantA'},before:x.initial});

test('write-ahead authorization survives reopening and permits only the identical intent',async()=>{
 const x=fixture(),intent=intentFor(x);let j=await PrivateFinanceJournal.open({...x.owner,create:true});await j.initialize(x.initial);
 const saved=await j.stageAuthorization(intent),revision=j.snapshot().revision;await j.close();
 const raw=readFileSync(join(x.owner.directory,'55555555-5555-4555-8555-555555555555.checkpoint'),'utf8');
 assert(!raw.includes('drawAmount'));assert(!raw.includes(Buffer.from(x.operation.witnesses.newSalt).toString('hex')));
 j=await PrivateFinanceJournal.open(x.owner);try{
  assert.equal(j.snapshot().pending,null);assert.deepEqual(j.snapshot().confirmed,x.initial);
  assert.deepEqual(await j.stageAuthorization(intent),saved);assert.equal(j.snapshot().revision,revision);
  for(const changed of [{...intent,operationId:'replacement'}, {...intent,semanticRequest:{...intent.semanticRequest,merchant:'merchantB'}},
   {...intent,witnesses:{...intent.witnesses,newSalt:bytes()}}, {...intent,descriptor:{...intent.descriptor,args:[]}}])await assert.rejects(j.stageAuthorization(changed));
  assert.deepEqual(j.snapshot().authorizationIntent,saved);
 }finally{await j.close();}
});

test('saved authorization must become the exact candidate and clears atomically on preparation',async()=>{
 const x=fixture(),j=await PrivateFinanceJournal.open({...x.owner,create:true});try{
  await j.initialize(x.initial);await j.stageAuthorization(intentFor(x));
  for(const changed of [{...x.operation,operationId:'replacement'}, {...x.operation,circuit:'postQuote'}, {...x.operation,circuitArgs:[]},
   {...x.operation,witnesses:{...x.operation.witnesses,newSalt:bytes()}}, {...x.operation,before:{...x.initial,financial:{lost:true}}}])await assert.rejects(j.prepare(changed));
  assert(j.snapshot().authorizationIntent);assert.equal(j.snapshot().pending,null);
  // Signed approval fields are added after the pre-RPC intent has been saved.
  const approved={...x.operation,witnesses:{...x.operation.witnesses,approvalS:123n}};await j.prepare(approved);
  assert.equal(j.snapshot().authorizationIntent,null);assert.deepEqual(j.snapshot().pending.witnesses,approved.witnesses);
  await assert.rejects(j.stageAuthorization(intentFor(x)));await j.confirm(x.operation.operationId,x.candidate.publicState);
  await assert.rejects(j.stageAuthorization(intentFor(x)));assert.equal(j.snapshot().completed.length,1);
 }finally{await j.close();}
});

test('failed intent publication cannot proceed to an owner approval or candidate',async()=>{
 const x=fixture(),j=await PrivateFinanceJournal.open({...x.owner,create:true});await j.initialize(x.initial);
 const path=join(x.owner.directory,'55555555-5555-4555-8555-555555555555.checkpoint'),raw=readFileSync(path);
 unlinkSync(path);mkdirSync(path);
 await assert.rejects(j.stageAuthorization(intentFor(x)));assert.throws(()=>j.snapshot(),/uncertain/);await assert.rejects(j.prepare(x.operation),/uncertain/);
 await j.close();rmdirSync(path);writeFileSync(path,raw,{mode:0o600});
 const restored=await PrivateFinanceJournal.open(x.owner);try{assert(!restored.snapshot().authorizationIntent);assert.equal(restored.snapshot().pending,null);}finally{await restored.close();}
});
