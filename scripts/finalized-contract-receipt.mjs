/** Read-only provider-backed receipt reconciliation. No wallet or submission APIs.
 * TLS indexer/RPC responses are the authority; this is not a light-client proof.
 */
import * as L from '@midnight-ntwrk/ledger-v8';
import {ContractState as CompactContractState} from '@midnight-ntwrk/compact-runtime';
import {assertEndpointCredentials} from '../src/lib/runtime/endpoints.ts';

export class ReceiptError extends Error {constructor(code){super(code);this.code=code;}}
const need=(condition,code)=>{if(!condition)throw new ReceiptError(code);};
const MAX_BYTES=4*1024*1024;
const hash=value=>{
 need(typeof value==='string'&&/^(?:0x)?[a-fA-F0-9]{64}$/.test(value),'RECEIPT_HASH_INVALID');
 return value.replace(/^0x/,'').toLowerCase();
};
// The ledger SDK encodes identifiers as a variant byte plus a 32-byte hash.
const identifier=value=>{
 need(typeof value==='string'&&/^(?:0x)?[a-fA-F0-9]{66}$/.test(value),'TRANSACTION_IDENTIFIERS_INVALID');
 return value.replace(/^0x/,'').toLowerCase();
};
const bytes=value=>{
 need(typeof value==='string'&&/^(?:0x)?(?:[a-fA-F0-9]{2})+$/.test(value)&&value.length<=MAX_BYTES,'NETWORK_BYTES_INVALID');
 return new Uint8Array(Buffer.from(value.replace(/^0x/,''),'hex'));
};
const height=value=>Number.isSafeInteger(value)&&value>0;
export function validateReceiptMetadata(row,tx,address,finalizedHeight,canonicalHash,{allowFailure=false}={}){
 need(row&&typeof row==='object'&&tx&&typeof tx==='object','RECEIPT_METADATA_INVALID');
 need(['deploy','call','key-registration'].includes(row.kind),'CONTRACT_ACTION_KIND_INVALID');
 need(height(row.blockHeight)&&height(finalizedHeight),'RECEIPT_HEIGHT_INVALID');
 need(hash(tx.hash)===hash(row.txHash)&&tx.block?.height===row.blockHeight,'RECEIPT_HASH_HEIGHT_MISMATCH');
 const failed=allowFailure&&tx.transactionResult?.status==='FAILURE';
 need(tx.transactionResult?.status==='SUCCESS'||failed,'TRANSACTION_NOT_ENTIRELY_SUCCESSFUL');
 // Indexer v4 omits per-segment outcomes for entire success/failure; the
 // official Midnight.js provider uses them only for PARTIAL_SUCCESS. Keep
 // requiring explicit aggregate SUCCESS, and reject contradictory outcomes.
 const segments=tx.transactionResult.segments;
 need(segments===null||(Array.isArray(segments)&&(!failed||segments.length>0)&&segments.every(s=>s&&s.success===!failed)),'FAILED_TRANSACTION_SEGMENT');
 need(row.blockHeight<=finalizedHeight,'BLOCK_NOT_FINALIZED');
 need(hash(canonicalHash)===hash(tx.block.hash),'INDEXER_RPC_BLOCK_MISMATCH');
 // Entire failure may have no resulting contract action/state in the indexer.
 // The canonical raw transaction below must still bind kind, target, entrypoint
 // and original identifier. No candidate state is promoted for this outcome.
 if(failed)return null;
 need(Array.isArray(tx.contractActions),'CONTRACT_ACTIONS_INVALID');
 const actions=tx.contractActions.filter(action=>{need(action&&typeof action==='object','CONTRACT_ACTIONS_INVALID');return hash(action.address)===hash(address);});
 need(actions.length===1,'CONTRACT_ACTION_NOT_UNIQUE');const action=actions[0];
 need(action.__typename===(row.kind==='deploy'?'ContractDeploy':row.kind==='call'?'ContractCall':'ContractUpdate'),'CONTRACT_ACTION_KIND_MISMATCH');
 if(row.kind==='call')need(typeof row.name==='string'&&action.entryPoint===row.name,'CIRCUIT_ENTRY_POINT_MISMATCH');
 return action;
}
const QUERY=`query LINE_RECEIPT_AUDIT($offset: TransactionOffset!) {
 transactions(offset: $offset) {
  __typename hash raw protocolVersion
  block { height hash timestamp }
  contractActions { __typename address state ... on ContractCall { entryPoint } }
  ... on RegularTransaction { identifiers transactionResult { status segments { id success } } fees { paidFees } }
 }
}`;

export function createFinalizedReceiptReader({endpoints,fetchImpl=globalThis.fetch}){
 try{assertEndpointCredentials(endpoints);}catch{throw new ReceiptError('NETWORK_READ_CREDENTIALS_MISSING');}
 for(const value of [endpoints.indexerUri,endpoints.nodeUri]){
  let url;try{url=new URL(value);}catch{throw new ReceiptError('NETWORK_READ_ENDPOINT_INVALID');}
  need(url.protocol==='https:'&&!url.username&&!url.password,'NETWORK_READ_ENDPOINT_INVALID');
 }
 need(typeof fetchImpl==='function','NETWORK_READ_TRANSPORT_INVALID');
 const indexerUri=endpoints.indexerUri,nodeUri=endpoints.nodeUri;
 let id=0;
 async function post(url,body){
  const signal=AbortSignal.timeout(30000);let response;
  try{response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});}
  catch{throw new ReceiptError('SERVICE_REQUEST_FAILED');}
  const rejectResponse=async code=>{try{await response.body?.cancel();}catch{}throw new ReceiptError(code);};
  if(!response.ok)await rejectResponse('SERVICE_HTTP_FAILED');
  const length=response.headers.get('content-length');
  if(!(length===null||(/^\d+$/.test(length)&&Number(length)<=MAX_BYTES)))await rejectResponse('SERVICE_RESPONSE_TOO_LARGE');
  need(response.body,'SERVICE_RESPONSE_INVALID');
  const reader=response.body.getReader();let size=0;const chunks=[];
  try{
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>MAX_BYTES){await reader.cancel();throw new ReceiptError('SERVICE_RESPONSE_TOO_LARGE');}chunks.push(value);}
  }catch(error){if(error instanceof ReceiptError)throw error;throw new ReceiptError('SERVICE_RESPONSE_FAILED');}
  finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ReceiptError('SERVICE_JSON_INVALID');}
 }
 async function rpc(method,params=[]){
  const requestId=++id,result=await post(nodeUri,{jsonrpc:'2.0',id:requestId,method,params});
  need(result&&result.jsonrpc==='2.0'&&result.id===requestId&&!result.error&&result.result!=null,'RPC_RESULT_INVALID');return result.result;
 }
 async function read(row,address,allowFailure){
  need(row&&typeof row==='object','RECEIPT_METADATA_INVALID');
  need(Boolean(row.txHash)!==Boolean(row.identifier),'RECEIPT_LOOKUP_INVALID');
  const offset=row.identifier?{identifier:identifier(row.identifier)}:{hash:hash(row.txHash)};
  hash(address);need(row.identifier&&row.blockHeight===undefined||height(row.blockHeight),'RECEIPT_HEIGHT_INVALID');
  const finalizedHash=hash(await rpc('chain_getFinalizedHead'));
  const header=await rpc('chain_getHeader',['0x'+finalizedHash]);
  need(header&&typeof header.number==='string'&&/^0x[0-9a-fA-F]+$/.test(header.number),'FINALIZED_HEIGHT_INVALID');
  const finalizedHeight=Number(BigInt(header.number));need(height(finalizedHeight),'FINALIZED_HEIGHT_INVALID');
  if(row.blockHeight!==undefined)need(row.blockHeight<=finalizedHeight,'BLOCK_NOT_FINALIZED');
  const indexed=await post(indexerUri,{query:QUERY,variables:{offset}});
  need(indexed&&!indexed.errors&&Array.isArray(indexed.data?.transactions),'INDEXER_QUERY_INVALID');
  need(indexed.data.transactions.length===1,'REPORTED_TRANSACTION_NOT_UNIQUE');const tx=indexed.data.transactions[0];
  need(tx&&typeof tx==='object','RECEIPT_METADATA_INVALID');
  const expected={...row,txHash:row.txHash??tx.hash,blockHeight:row.blockHeight??tx.block?.height};
  need(height(expected.blockHeight),'RECEIPT_HEIGHT_INVALID');need(expected.blockHeight<=finalizedHeight,'BLOCK_NOT_FINALIZED');
  const canonicalHash=hash(await rpc('chain_getBlockHash',[expected.blockHeight]));
  const action=validateReceiptMetadata(expected,tx,address,finalizedHeight,canonicalHash,{allowFailure});
  const failed=tx.transactionResult.status==='FAILURE';
  let raw,state=null,compactState=null;const encodedTx=bytes(tx.raw),encodedState=failed?null:bytes(action.state);
  try{raw=L.Transaction.deserialize('signature','proof','binding',encodedTx);if(encodedState){state=L.ContractState.deserialize(encodedState);compactState=CompactContractState.deserialize(encodedState);}}
  catch{throw new ReceiptError('NETWORK_BYTES_DECODE_FAILED');}
  need(Buffer.from(raw.serialize()).equals(Buffer.from(encodedTx))&&(!encodedState||Buffer.from(state.serialize()).equals(Buffer.from(encodedState))),'NETWORK_BYTES_NOT_CANONICAL');
  need(hash(raw.transactionHash())===hash(expected.txHash),'RAW_TRANSACTION_HASH_MISMATCH');
  need(Array.isArray(tx.identifiers),'TRANSACTION_IDENTIFIERS_INVALID');
  const identifiers=tx.identifiers.map(identifier).sort(),actual=raw.identifiers().map(identifier).sort();
  need(identifiers.length===actual.length&&identifiers.every((v,i)=>v===actual[i]),'RAW_TRANSACTION_IDENTIFIERS_MISMATCH');
  if(row.identifier)need(actual.includes(identifier(row.identifier)),'SUBMITTED_IDENTIFIER_MISSING');
  const actions=[...(raw.intents?.values()??[])].flatMap(intent=>intent.actions).filter(a=>hash(a.address)===hash(address));
  need(actions.length===1,'RAW_CONTRACT_ACTION_NOT_UNIQUE');const rawAction=actions[0];
  need(row.kind==='call'?rawAction instanceof L.ContractCall:row.kind==='deploy'?rawAction instanceof L.ContractDeploy:rawAction instanceof L.MaintenanceUpdate,'RAW_CONTRACT_ACTION_KIND_MISMATCH');
  if(row.kind==='call')need((typeof rawAction.entryPoint==='string'?rawAction.entryPoint:Buffer.from(rawAction.entryPoint).toString('utf8'))===row.name,'RAW_CIRCUIT_ENTRY_POINT_MISMATCH');
  return {transaction:tx,action,raw,state,compactState,canonicalHash,finalizedHead:{hash:finalizedHash,height:finalizedHeight},networkFinalityVerified:true,outcome:failed?'failure':'success',
   trust:'Configured TLS indexer and RPC; not independent full-node or local proof verification.'};
 }
 // Existing receipt consumers remain success-only. The explicit outcome reader
 // also accepts exact total failure; partial/unknown outcomes remain rejected.
 return {read:(row,address)=>read(row,address,false),readOutcome:(row,address)=>read(row,address,true)};
}
