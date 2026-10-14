import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as L from '@midnight-ntwrk/ledger-v8';
import {StateValue,ChargedState} from '@midnight-ntwrk/compact-runtime';
import {createFinalizedReceiptReader,validateReceiptMetadata} from '../scripts/finalized-contract-receipt.mjs';
import {resolveMidnightEndpoints} from '../src/lib/runtime/endpoints.ts';

// Previously published public proof bytes; no keys, proving or network calls.
const raw=readFileSync('tests/fixtures/private-offer-public-pairs/3-openLine.proven-public-tx.bin');
const decoded=L.Transaction.deserialize('signature','proof','binding',raw);
const call=[...decoded.intents.values()].flatMap(intent=>intent.actions)[0];
const address=call.address,txHash=decoded.transactionHash(),blockHash='ef'.repeat(32),headHash='fa'.repeat(32);
const state=new L.ContractState().serialize();
const row={kind:'call',name:'openLine',txHash,blockHeight:120};
const receipt=()=>({hash:txHash,raw:raw.toString('hex'),identifiers:decoded.identifiers(),block:{height:120,hash:blockHash},
 transactionResult:{status:'SUCCESS',segments:[{id:0,success:true}]},contractActions:[{__typename:'ContractCall',address,entryPoint:'openLine',state:Buffer.from(state).toString('hex')}]});
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function fixture({mutate=()=>{},transport}={}){
 const tx=receipt();mutate(tx);const requests=[];
 const fetchImpl=async(url,options)=>{
  const request=JSON.parse(options.body);requests.push({url,options,request});
  const override=await transport?.({url,options,request,tx});if(override)return override;
  if(request.query)return json({data:{transactions:[tx]}});
  const result=request.method==='chain_getFinalizedHead'?'0x'+headHash:request.method==='chain_getHeader'?{number:'0x7d'}:'0x'+blockHash;
  return json({jsonrpc:'2.0',id:request.id,result});
 };
 return {tx,requests,reader:createFinalizedReceiptReader({endpoints:resolveMidnightEndpoints({networkId:'preview'}),fetchImpl})};
}
test('reader fetches finality and canonical block, then binds metadata to actual public call bytes',async()=>{
 const f=fixture(),result=await f.reader.read(row,address);
 assert.equal(result.raw.transactionHash(),txHash);assert.equal(result.networkFinalityVerified,true);
 assert(result.compactState.data instanceof StateValue||result.compactState.data instanceof ChargedState,'Generated bindings require Compact runtime state, not ledger-v8 state.');
 assert.deepEqual(result.compactState.serialize(),state);
 assert.deepEqual(result.finalizedHead,{hash:headHash,height:125});assert.deepEqual(result.state.serialize(),state);
 assert.deepEqual(f.requests.filter(x=>!x.request.query).map(x=>x.request.method),['chain_getFinalizedHead','chain_getHeader','chain_getBlockHash']);
 for(const {options}of f.requests){assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);}
 assert(!JSON.stringify(f.requests.map(x=>x.request)).includes('privateState'));
});
test('reader does not accept indexer metadata naming another circuit in the same raw transaction',async()=>{
 const f=fixture({mutate:tx=>{tx.contractActions[0].entryPoint='draw';}});
 await assert.rejects(f.reader.read({...row,name:'draw'},address),/RAW_CIRCUIT_ENTRY_POINT_MISMATCH/);
});
test('reader validates raw bytes and finality when entire-success segment outcomes are null',async()=>{
 const f=fixture({mutate:tx=>{tx.transactionResult.segments=null;}});
 const result=await f.reader.read(row,address);
 assert.equal(result.networkFinalityVerified,true);
 assert.deepEqual(result.state.serialize(),state);
});
test('reader rejects a fabricated contract address even with matching indexer metadata',async()=>{
 const other='ab'.repeat(32),f=fixture({mutate:tx=>{tx.contractActions[0].address=other;}});
 await assert.rejects(f.reader.read(row,other),/RAW_CONTRACT_ACTION_NOT_UNIQUE/);
});
test('reader rejects a call relabeled as verifier-key registration',async()=>{
 const f=fixture({mutate:tx=>{tx.contractActions[0].__typename='ContractUpdate';}});
 await assert.rejects(f.reader.read({...row,kind:'key-registration'},address),/RAW_CONTRACT_ACTION_KIND_MISMATCH/);
});
test('reader decodes deployment and maintenance action types without treating them as circuit calls',async()=>{
 // Public serialization fixtures only: no proofs, signatures or validity claim.
 const deploy=new L.ContractDeploy(new L.ContractState());
 const maintenance=new L.MaintenanceUpdate(address,[],0n);
 for(const [kind,type,action]of [['deploy','ContractDeploy',deploy],['key-registration','ContractUpdate',maintenance]]){
  const intent=L.Intent.new(new Date(1800000300*1000));
  const pending=L.Transaction.fromParts('preview',undefined,undefined,kind==='deploy'?intent.addDeploy(action):intent.addMaintenanceUpdate(action));
  const unexpected=async()=>{throw Error('Serialization fixture must not request a proof.');};
  const transaction=(await pending.prove({check:unexpected,prove:unexpected},L.CostModel.initialCostModel())).bind();
  const expected={kind,txHash:transaction.transactionHash(),blockHeight:120};
  const f=fixture({mutate:tx=>{tx.hash=expected.txHash;tx.raw=Buffer.from(transaction.serialize()).toString('hex');tx.identifiers=transaction.identifiers();
   tx.contractActions=[{__typename:type,address:action.address,state:Buffer.from(state).toString('hex')}];}});
  const observed=await f.reader.read(expected,action.address);assert.equal(observed.action.__typename,type);
 }
});
for(const [label,mutate,code]of [
 ['wrong raw transaction hash',tx=>{tx.hash='ab'.repeat(32);},'RECEIPT_HASH_HEIGHT_MISMATCH'],
 ['wrong identifiers',tx=>{tx.identifiers=['00'+'ab'.repeat(32)];},'RAW_TRANSACTION_IDENTIFIERS_MISMATCH'],
 ['malformed identifier width',tx=>{tx.identifiers=['ab'.repeat(32)];},'TRANSACTION_IDENTIFIERS_INVALID'],
 ['missing identifiers',tx=>{delete tx.identifiers;},'TRANSACTION_IDENTIFIERS_INVALID'],
 ['malformed raw hex',tx=>{tx.raw+='0';},'NETWORK_BYTES_INVALID'],
 ['malformed state hex',tx=>{tx.contractActions[0].state='gg';},'NETWORK_BYTES_INVALID'],
 ['trailing raw bytes',tx=>{tx.raw+='00';},'NETWORK_BYTES'],
 ['trailing state bytes',tx=>{tx.contractActions[0].state+='00';},'NETWORK_BYTES'],
 ['partial success',tx=>{tx.transactionResult.status='PARTIAL_SUCCESS';},'TRANSACTION_NOT_ENTIRELY_SUCCESSFUL'],
 ['missing segment outcomes',tx=>{delete tx.transactionResult.segments;},'FAILED_TRANSACTION_SEGMENT'],
 ['ambiguous action',tx=>{tx.contractActions.push({...tx.contractActions[0]});},'CONTRACT_ACTION_NOT_UNIQUE'],
 ])test(`reader rejects ${label}`,async()=>{const f=fixture({mutate});await assert.rejects(f.reader.read(row,address),new RegExp(code));});
test('reader rejects an unfinalized block before looking up the transaction',async()=>{
 const f=fixture();await assert.rejects(f.reader.read({...row,blockHeight:126},address),/BLOCK_NOT_FINALIZED/);
 assert.equal(f.requests.length,2);
});
test('reader rejects indexer and canonical RPC block disagreement',async()=>{
 const f=fixture({mutate:tx=>{tx.block.hash='ab'.repeat(32);}});await assert.rejects(f.reader.read(row,address),/INDEXER_RPC_BLOCK_MISMATCH/);
});
test('reader rejects mismatched JSON-RPC correlation and malformed finality headers',async()=>{
 for(const [method,response]of [['chain_getFinalizedHead',request=>({jsonrpc:'2.0',id:request.id+1,result:headHash})],
  ['chain_getHeader',request=>({jsonrpc:'2.0',id:request.id,result:{number:'125'}})]]){
  const f=fixture({transport:({request})=>request.method===method?json(response(request)):undefined});
  await assert.rejects(f.reader.read(row,address),/RPC_RESULT_INVALID|FINALIZED_HEIGHT_INVALID/);
 }
});
test('reader rejects credential-free Preprod and insecure transport before any fetch',()=>{
 assert.throws(()=>createFinalizedReceiptReader({endpoints:resolveMidnightEndpoints({networkId:'preprod'})}),/NETWORK_READ_CREDENTIALS_MISSING/);
 const endpoints=resolveMidnightEndpoints({networkId:'preview',nodeUri:'http://localhost:9944'});
 assert.throws(()=>createFinalizedReceiptReader({endpoints}),/NETWORK_READ_ENDPOINT_INVALID/);
});
test('reader bounds advertised and streamed response sizes',async()=>{
 const advertised=fixture({transport:()=>new Response('{}',{headers:{'content-length':String(4*1024*1024+1)}})});
 await assert.rejects(advertised.reader.read(row,address),/SERVICE_RESPONSE_TOO_LARGE/);
 let cancelled=false;
 const streamed=fixture({transport:()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4*1024*1024+1));},cancel(){cancelled=true;}}))});
 await assert.rejects(streamed.reader.read(row,address),/SERVICE_RESPONSE_TOO_LARGE/);assert(cancelled);
});
test('reader never returns provider error text or credential URLs',async()=>{
 const f=fixture({transport:()=>{throw Error('https://provider.invalid/?project_id=do-not-return');}});
 await assert.rejects(f.reader.read(row,address),error=>error.message==='SERVICE_REQUEST_FAILED'&&!error.message.includes('project_id'));
});
test('reader rejects malformed service JSON and HTTP failures without provider content',async()=>{
 for(const [response,code]of [[()=>new Response('{'), 'SERVICE_JSON_INVALID'],[()=>new Response('private provider detail',{status:403}), 'SERVICE_HTTP_FAILED']]){
  const f=fixture({transport:response});await assert.rejects(f.reader.read(row,address),error=>error.message===code);
 }
});
test('reader rejects null or ambiguous indexer receipt collections',async()=>{
 for(const transactions of [[null],[receipt(),receipt()]]){
  const f=fixture({transport:({request})=>request.query?json({data:{transactions}}):undefined});
  await assert.rejects(f.reader.read(row,address),/RECEIPT_METADATA_INVALID|REPORTED_TRANSACTION_NOT_UNIQUE/);
 }
});
test('metadata rejects negative or unsafe heights and missing boolean segment outcomes',()=>{
 for(const blockHeight of [-1,0,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateReceiptMetadata({...row,blockHeight},receipt(),address,125,blockHash),/RECEIPT_HEIGHT_INVALID/);
 const tx=receipt();tx.transactionResult.segments=[{success:'true'}];assert.throws(()=>validateReceiptMetadata(row,tx,address,125,blockHash),/FAILED_TRANSACTION_SEGMENT/);
});
