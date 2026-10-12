import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import * as L from '@midnight-ntwrk/ledger-v8';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {PrivateFinanceJournal} from '../scripts/private-finance-journal.mjs';
import {EncryptedCheckoutStore} from '../server/checkout-storage.ts';
import {resolveMidnightEndpoints} from '../src/lib/runtime/endpoints.ts';
const hex=()=>randomBytes(32).toString('hex'),bytes=()=>new Uint8Array(randomBytes(32));
const first=readFileSync('tests/fixtures/private-offer-public-pairs/3-openLine.proven-public-tx.bin');
const second=readFileSync('tests/fixtures/private-offer-public-pairs/8-openLine.proven-public-tx.bin');
const decode=b=>L.Transaction.deserialize('signature','proof','binding',b);
const address=[...decode(first).intents.values()].flatMap(i=>i.actions)[0].address;
const keyFixture=JSON.parse(readFileSync('tests/fixtures/line-public-verifiers.json','utf8'));
const keys=Object.fromEntries(Object.entries(keyFixture.keys).map(([name,key])=>[name,new Uint8Array(Buffer.from(key,'base64'))]));
const blockHash='ef'.repeat(32),headHash='fa'.repeat(32),json=value=>new Response(JSON.stringify(value));
function publicState(value){
 const state=new L.ContractState();state.data=new L.ChargedState(L.StateValue.newCell({value:RT.CompactTypeField.toValue(value),alignment:RT.CompactTypeField.alignment()}));
 for(const [name,key]of Object.entries(keys)){const op=new L.ContractOperation();op.verifierKey=key;state.setOperation(name,op);}return state;
}
// Provider simulation and serialization fixtures, not valid ledger transitions.
// Public proof bytes are decoded; no proofs are fabricated or verified here.
function fixture(t){
 mkdirSync('.compact-keys',{recursive:true});const initialState=publicState(1n),candidateState=publicState(2n);
 const scope={networkId:'preprod',sourceSha256:keyFixture.sourceSha256,executableSha256:hex(),contractAddress:address,contractDomain:hex()};
 const config={sourceSha256:scope.sourceSha256,executableSha256:scope.executableSha256,verifierKeys:keys,
  endpoints:resolveMidnightEndpoints({networkId:'preprod',blockfrostProjectId:'reader-test-project'})};
 const owner={directory:mkdtempSync(resolve('.compact-keys/finance-network-test-')),password:hex(),scope,networkConfirmation:config};
 const initial={publicState:initialState.serialize(),privateState:{salt:bytes()},financial:{book:{outstanding:0n},bookSalt:bytes()}},candidate={publicState:candidateState.serialize(),privateState:{salt:bytes()},financial:{book:{outstanding:16n},bookSalt:bytes()}};
 const operation={operationId:'purchase:network:1',circuit:'openLine',circuitArgs:[0n,1800000300n],witnesses:{newSalt:bytes()},before:initial,candidate};
 const response=(encoded,state)=>{const tx=decode(encoded);return {hash:tx.transactionHash(),raw:Buffer.from(encoded).toString('hex'),identifiers:tx.identifiers(),block:{height:120,hash:blockHash},
  transactionResult:{status:'SUCCESS',segments:[{id:0,success:true}]},contractActions:[{__typename:'ContractCall',address,entryPoint:'openLine',state:Buffer.from(state.serialize()).toString('hex')}]};};
 const services={bootstrap:response(first,initialState),candidate:response(second,candidateState),head:125,requests:[],intercept:null};
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const request=JSON.parse(options.body);services.requests.push(request);
  const override=await services.intercept?.(request);if(override)return override;
  if(request.query){const id=request.variables.offset.identifier;assert(id,'Journal must query a saved identifier, not a caller hash.');
   const tx=decode(first).identifiers().includes(id)?services.bootstrap:services.candidate;return json({data:{transactions:[tx]}});}
  const result=request.method==='chain_getFinalizedHead'?'0x'+headHash:request.method==='chain_getHeader'?{number:'0x'+services.head.toString(16)}:'0x'+blockHash;
  return json({jsonrpc:'2.0',id:request.id,result});
 });
 return {owner,initial,candidate,operation,services,initialState,candidateState};
}
async function bootstrap(x){const journal=await PrivateFinanceJournal.open({...x.owner,create:true});
 await journal.initializeFinalized(x.initial,{transaction:new Uint8Array(first),kind:'call',name:'openLine',blockHeight:120});return journal;
}
test('Preprod forbids caller-supplied bootstrap and confirmation',async t=>{
 const x=fixture(t),j=await PrivateFinanceJournal.open({...x.owner,create:true});try{
  await assert.rejects(j.initialize(x.initial),/finalized receipt/);await assert.rejects(j.confirm('purchase:network:1',x.candidate.publicState),/internally fetched/);
  assert.equal(j.snapshot().confirmed,null);assert.equal(j.snapshot().revision,0);
 }finally{await j.close();}
});
test('network bootstrap requires actual fetched state and the full pinned verifier inventory',async t=>{
 const x=fixture(t),j=await PrivateFinanceJournal.open({...x.owner,create:true});try{
  const state=publicState(1n);state.setOperation('openLine',new L.ContractOperation());x.services.bootstrap.contractActions[0].state=Buffer.from(state.serialize()).toString('hex');
  await assert.rejects(j.initializeFinalized(x.initial,{transaction:new Uint8Array(first),kind:'call',name:'openLine',blockHeight:120}),/verifier key differs/);
  assert.equal(j.snapshot().confirmed,null);
 }finally{await j.close();}
});
test('saved submission, exact candidate and finalized receipt survive reopening and an idempotent retry',async t=>{
 const x=fixture(t);let j=await bootstrap(x);await j.prepare(x.operation);const saved=await j.stageSubmission(x.operation.operationId,new Uint8Array(second));await j.close();
 j=await PrivateFinanceJournal.open(x.owner);try{
  assert.deepEqual(j.snapshot().submission,saved);assert.deepEqual(j.snapshot().confirmed,x.initial);
  const receipt=await j.confirmFinalized(x.operation.operationId);assert.equal(receipt.networkFinalityVerified,true);assert.equal(receipt.blockHeight,120);
  assert.equal(j.snapshot().pending,null);assert.equal(j.snapshot().submission,null);assert.deepEqual(j.snapshot().confirmed,x.candidate);assert.equal(j.snapshot().completed.length,1);
  const count=x.services.requests.length;assert.deepEqual(await j.confirmFinalized(x.operation.operationId),receipt);assert.equal(x.services.requests.length,count);
  await assert.rejects(j.confirmFinalized(x.operation.operationId,{blockHeight:119}),/hint differs/);
  await assert.rejects(j.confirmFinalized(x.operation.operationId,{observedPublicState:x.candidate.publicState}));
 }finally{await j.close();}
 j=await PrivateFinanceJournal.open(x.owner);try{assert.equal(j.snapshot().completed.length,1);assert.deepEqual(j.snapshot().confirmed,x.candidate);}finally{await j.close();}
});
test('network cannot confirm before durable submission or replace uncertain submitted bytes',async t=>{
 const x=fixture(t),j=await bootstrap(x);try{
  await j.prepare(x.operation);await assert.rejects(j.confirmFinalized(x.operation.operationId),/Saved submission/);
  const saved=await j.stageSubmission(x.operation.operationId,new Uint8Array(second)),revision=j.snapshot().revision;
  assert.deepEqual(await j.stageSubmission(x.operation.operationId,new Uint8Array(second)),saved);assert.equal(j.snapshot().revision,revision);
  await assert.rejects(j.stageSubmission(x.operation.operationId,new Uint8Array(first)),/cannot be replaced/);
  await assert.rejects(j.prepare({...x.operation,operationId:'replacement'}));assert.deepEqual(j.snapshot().confirmed,x.initial);
 }finally{await j.close();}
});
test('overlapping preparation and submission cannot replace the first durable network candidate',async t=>{
 const x=fixture(t),j=await bootstrap(x);try{
  const preparing=j.prepare(x.operation);await assert.rejects(j.prepare({...x.operation,operationId:'other'}),/publication is in progress/);await preparing;
  const staging=j.stageSubmission(x.operation.operationId,new Uint8Array(second));
  await assert.rejects(j.stageSubmission(x.operation.operationId,new Uint8Array(first)),/reconciliation is in progress/);await staging;
  assert.equal(j.snapshot().pending.operationId,x.operation.operationId);assert.deepEqual(j.snapshot().submission.transaction,new Uint8Array(second));
 }finally{await j.close();}
});
test('closing during publication retains the writer lease until the actual encrypted write finishes',async t=>{
 const x=fixture(t),j=await bootstrap(x),original=EncryptedCheckoutStore.prototype.save;
 let entered,release;const started=new Promise(r=>{entered=r;}),hold=new Promise(r=>{release=r;});
 t.mock.method(EncryptedCheckoutStore.prototype,'save',async function(id,snapshot){if(snapshot.pending){entered();await hold;}return original.call(this,id,snapshot);});
 const preparing=j.prepare(x.operation);await started;let closed=false;const closing=j.close().then(()=>{closed=true;});
 await new Promise(r=>setImmediate(r));assert.equal(closed,false);await assert.rejects(PrivateFinanceJournal.open(x.owner));
 release();await preparing;await closing;assert.equal(closed,true);
 const reopened=await PrivateFinanceJournal.open(x.owner);try{assert.equal(reopened.snapshot().pending.operationId,x.operation.operationId);}finally{await reopened.close();}
});
test('network accepts an SDK merge only when saved identifiers and exact bound intents survive',async t=>{
 const x=fixture(t),j=await bootstrap(x);try{
  await j.prepare(x.operation);await j.stageSubmission(x.operation.operationId,new Uint8Array(second));
  const unexpected=async()=>{throw Error('Empty merge fixture must not request a proof.');};
  const extra=(await L.Transaction.fromPartsRandomized('preview',undefined,undefined,L.Intent.new(new Date(1800000300*1000))).prove({check:unexpected,prove:unexpected},L.CostModel.initialCostModel())).bind();
  const merged=decode(second).merge(extra);assert.notEqual(merged.transactionHash(),decode(second).transactionHash());
  x.services.candidate.hash=merged.transactionHash();x.services.candidate.raw=Buffer.from(merged.serialize()).toString('hex');x.services.candidate.identifiers=merged.identifiers();
  const receipt=await j.confirmFinalized(x.operation.operationId);assert.equal(receipt.transactionHash,merged.transactionHash());
  assert.equal(receipt.submittedTransactionHash,decode(second).transactionHash());assert.equal(j.snapshot().completed.length,1);
 }finally{await j.close();}
});
test('network rejects altered proof bytes even if saved identifiers and provider success survive',async t=>{
 const x=fixture(t),j=await bootstrap(x);try{
  await j.prepare(x.operation);await j.stageSubmission(x.operation.operationId,new Uint8Array(second));const before=j.snapshot();
  const transaction=decode(second),action=[...transaction.intents.values()].flatMap(i=>i.actions)[0],proof=action.proof.serialize();
  const needle=Buffer.from(proof.slice(Math.floor(proof.length/2),Math.floor(proof.length/2)+32)),changed=Buffer.from(second),offset=changed.indexOf(needle);assert(offset>=0);changed[offset]^=1;
  const altered=decode(changed);assert.deepEqual(altered.identifiers(),transaction.identifiers());
  x.services.candidate.hash=altered.transactionHash();x.services.candidate.raw=changed.toString('hex');x.services.candidate.identifiers=altered.identifiers();
  await assert.rejects(j.confirmFinalized(x.operation.operationId),/Finalized intent differs/);assert.deepEqual(j.snapshot(),before);
 }finally{await j.close();}
});
for(const [name,mutate,pattern]of [
 ['unfinalized receipt',x=>{x.services.head=119;},/BLOCK_NOT_FINALIZED/],
 ['partial success',x=>{x.services.candidate.transactionResult.status='PARTIAL_SUCCESS';},/TRANSACTION_NOT_ENTIRELY_SUCCESSFUL/],
 ['wrong post-state',x=>{x.services.candidate.contractActions[0].state=Buffer.from(x.initialState.serialize()).toString('hex');},/public effect differs/],
 ['changed verifier',x=>{const state=publicState(2n);state.setOperation('draw',new L.ContractOperation());x.services.candidate.contractActions[0].state=Buffer.from(state.serialize()).toString('hex');},/verifier key differs/],
 ['foreign receipt',x=>{x.services.candidate=x.services.bootstrap;},/SUBMITTED_IDENTIFIER_MISSING/],
 ['canonical block disagreement',x=>{x.services.candidate.block.hash='aa'.repeat(32);},/INDEXER_RPC_BLOCK_MISMATCH/],
 ['request timeout',x=>{x.services.intercept=()=>{throw Error('provider timeout with private url');};},/SERVICE_REQUEST_FAILED/],
])test(`network retains candidate and exact submission after ${name}`,async t=>{
 const x=fixture(t),j=await bootstrap(x);try{
  await j.prepare(x.operation);await j.stageSubmission(x.operation.operationId,new Uint8Array(second));const before=j.snapshot();mutate(x);
  await assert.rejects(j.confirmFinalized(x.operation.operationId),pattern);assert.deepEqual(j.snapshot(),before);
 }finally{await j.close();}
});
test('reopening rejects changed key policy, service, source, executable or network',async t=>{
 const x=fixture(t),j=await bootstrap(x);await j.close();
 const keyCopy=Object.fromEntries(Object.entries(keys).map(([n,k])=>[n,new Uint8Array(k)]));keyCopy.openLine[0]^=1;
 for(const config of [{...x.owner.networkConfirmation,verifierKeys:keyCopy},
  {...x.owner.networkConfirmation,endpoints:{...x.owner.networkConfirmation.endpoints,nodeUri:'https://different.example/rpc'}},
  {...x.owner.networkConfirmation,sourceSha256:hex()}, {...x.owner.networkConfirmation,executableSha256:hex()},
  {...x.owner.networkConfirmation,endpoints:{...x.owner.networkConfirmation.endpoints,networkId:'preview'}}])
  await assert.rejects(PrivateFinanceJournal.open({...x.owner,networkConfirmation:config}));
 const resumed=await PrivateFinanceJournal.open(x.owner);try{assert.deepEqual(resumed.snapshot().confirmed,x.initial);}finally{await resumed.close();}
});
test('reader policy and keys are copied so caller mutation cannot redirect reconciliation',async t=>{
 const x=fixture(t),j=await bootstrap(x);try{
  x.owner.networkConfirmation.endpoints.nodeUri='https://changed.example/rpc';x.owner.networkConfirmation.verifierKeys={};
  await j.prepare(x.operation);await j.stageSubmission(x.operation.operationId,new Uint8Array(second));await j.confirmFinalized(x.operation.operationId);
  assert.equal(j.snapshot().completed.length,1);
 }finally{await j.close();}
});
test('a live receipt check excludes mutation and closing its journal prevents late publication',async t=>{
 const x=fixture(t),j=await bootstrap(x);await j.prepare(x.operation);await j.stageSubmission(x.operation.operationId,new Uint8Array(second));
 let started,release;const entered=new Promise(r=>{started=r;}),hold=new Promise(r=>{release=r;});
 x.services.intercept=async request=>{if(request.query){started();await hold;}};
 const checking=j.confirmFinalized(x.operation.operationId);await entered;
 await assert.rejects(j.confirmFinalized(x.operation.operationId),/in progress/);await assert.rejects(j.stageSubmission(x.operation.operationId,new Uint8Array(second)),/in progress/);
 await j.close();release();await assert.rejects(checking,/uncertain/);
 x.services.intercept=null;const restored=await PrivateFinanceJournal.open(x.owner);try{assert(restored.snapshot().pending);assert(restored.snapshot().submission);assert.deepEqual(restored.snapshot().confirmed,x.initial);}finally{await restored.close();}
});
test('publication failure after finalized observation retains the durable pending candidate',async t=>{
 const x=fixture(t),j=await bootstrap(x);await j.prepare(x.operation);await j.stageSubmission(x.operation.operationId,new Uint8Array(second));
 const path=join(x.owner.directory,'55555555-5555-4555-8555-555555555555.checkpoint'),original=readFileSync(path);unlinkSync(path);mkdirSync(path);
 await assert.rejects(j.confirmFinalized(x.operation.operationId));assert.throws(()=>j.snapshot(),/uncertain/);await j.close();rmdirSync(path);writeFileSync(path,original,{mode:0o600});
 const restored=await PrivateFinanceJournal.open(x.owner);try{assert(restored.snapshot().pending);await restored.confirmFinalized(x.operation.operationId);assert.equal(restored.snapshot().completed.length,1);}finally{await restored.close();}
});
