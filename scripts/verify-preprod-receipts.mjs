#!/usr/bin/env node
/** Read-only independent checks of the reported canonical Preprod receipts.
 * No wallet, seed, proving, signing or submission APIs are loaded. Credential
 * URLs and provider error messages are never written to output/evidence.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import * as L from '@midnight-ntwrk/ledger-v8';
import { resolveMidnightEndpoints, assertEndpointCredentials } from '../src/lib/runtime/endpoints.ts';

const sha=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>String(value).replace(/^0x/,'').toLowerCase();
class ReceiptError extends Error {constructor(code){super(code);this.code=code;}}
const need=(condition,code)=>{if(!condition)throw new ReceiptError(code);};
const QUERY=`query LINE_RECEIPT_AUDIT($offset: TransactionOffset!) {
 transactions(offset: $offset) {
  __typename hash raw protocolVersion
  block { height hash timestamp }
  contractActions { __typename address state ... on ContractCall { entryPoint } }
  ... on RegularTransaction { identifiers transactionResult { status segments { id success } } fees { paidFees } }
 }
}`;
async function post(url,body){
 let response;
 try{response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});}
 catch{throw new ReceiptError('SERVICE_REQUEST_FAILED');}
 need(response.ok,`SERVICE_HTTP_${response.status}`);
 try{return await response.json();}catch{throw new ReceiptError('SERVICE_JSON_INVALID');}
}
export function validateReceiptMetadata(row,tx,address,finalizedHeight,canonicalHash){
 need(hex(tx.hash)===row.txHash&&tx.block?.height===row.blockHeight,'RECEIPT_HASH_HEIGHT_MISMATCH');
 need(tx.transactionResult?.status==='SUCCESS','TRANSACTION_NOT_ENTIRELY_SUCCESSFUL');
 need(!(tx.transactionResult.segments??[]).some(segment=>!segment.success),'FAILED_TRANSACTION_SEGMENT');
 need(row.blockHeight<=finalizedHeight,'BLOCK_NOT_FINALIZED');
 need(hex(canonicalHash)===hex(tx.block.hash),'INDEXER_RPC_BLOCK_MISMATCH');
 const actions=(tx.contractActions??[]).filter(action=>hex(action.address)===address);
 need(actions.length===1,'CONTRACT_ACTION_NOT_UNIQUE');const action=actions[0];
 need(action.__typename===(row.kind==='deploy'?'ContractDeploy':row.kind==='call'?'ContractCall':'ContractUpdate'),'CONTRACT_ACTION_KIND_MISMATCH');
 if(row.kind==='call')need(action.entryPoint===row.name,'CIRCUIT_ENTRY_POINT_MISMATCH');
 return action;
}
async function main(){
 const evidenceFile=resolve(process.argv[2]??'deployment-evidence.json');
 const output=resolve(process.argv[3]??`.compact-keys/preprod-receipts-${Date.now()}/verification.json`);
 const bytes=readFileSync(evidenceFile),evidence=JSON.parse(bytes),source=readFileSync('contracts/line.compact');
 const fixture=JSON.parse(readFileSync('tests/fixtures/line-public-verifiers.json','utf8'));
 const {ledger}=await import(pathToFileURL(resolve('contracts/managed/line/contract/index.js')).href);
 need(sha(source)===fixture.sourceSha256,'LOCAL_SOURCE_KEY_FIXTURE_MISMATCH');
 need(/^[a-f0-9]{64}$/.test(evidence.contractAddress),'INVALID_REPORTED_ADDRESS');
 const report={schema:'line-preprod-receipt-check/v1',createdAt:new Date().toISOString(),network:'preprod',
  sourceSha256:sha(source),reportedEvidenceSha256:sha(bytes),contractAddress:evidence.contractAddress,
  complete:false,networkMetadataIndependentlyRequeried:false,allTwelveExecuted:false,privateCandidateDeployed:false,
  authenticSettlementEstablished:false,checks:[],trust:'Fresh Blockfrost indexer/RPC views over TLS; not an independently operated full node or a local re-verification of network proofs.'};
 const save=()=>{mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');};
 try{
  const endpoints=resolveMidnightEndpoints({networkId:'preprod',blockfrostProjectId:process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID});
  try{assertEndpointCredentials(endpoints);}catch{throw new ReceiptError('PREPROD_READ_ONLY_TOKEN_MISSING');}
  const rpc=async(method,params=[])=>{
   const result=await post(endpoints.nodeUri,{jsonrpc:'2.0',id:1,method,params});
   need(!result.error&&result.result!=null,'RPC_RESULT_INVALID');return result.result;
  };
  const finalizedHash=await rpc('chain_getFinalizedHead'),finalizedHeader=await rpc('chain_getHeader',[finalizedHash]);
  const finalizedHeight=Number(BigInt(finalizedHeader.number));need(Number.isSafeInteger(finalizedHeight),'FINALIZED_HEIGHT_INVALID');
  report.finalizedHead={hash:hex(finalizedHash),height:finalizedHeight};
  const rows=[{kind:'deploy',...evidence.deploy},...evidence.keyInsertions.map(item=>({kind:'key-registration',...item})),
   ...evidence.flowExecution.map(item=>({kind:'call',...item}))];
  need(rows.length===20,'REPORTED_RECEIPT_COUNT_INVALID');
  for(const row of rows){
   need(/^[a-f0-9]{64}$/.test(row.txHash)&&Number.isSafeInteger(row.blockHeight),'REPORTED_RECEIPT_INVALID');
   const queried=await post(endpoints.indexerUri,{query:QUERY,variables:{offset:{hash:row.txHash}}});
   need(!queried.errors&&Array.isArray(queried.data?.transactions),'INDEXER_QUERY_INVALID');
   need(queried.data.transactions.length===1,'REPORTED_TRANSACTION_NOT_UNIQUE');const tx=queried.data.transactions[0];
   const canonicalHash=await rpc('chain_getBlockHash',[row.blockHeight]);
   const action=validateReceiptMetadata(row,tx,evidence.contractAddress,finalizedHeight,canonicalHash);
   let raw,state;
   try{raw=L.Transaction.deserialize('signature','proof','binding',new Uint8Array(Buffer.from(hex(tx.raw),'hex')));
    state=L.ContractState.deserialize(new Uint8Array(Buffer.from(hex(action.state),'hex')));}
   catch{throw new ReceiptError('NETWORK_BYTES_DECODE_FAILED');}
   need(hex(raw.transactionHash())===row.txHash,'RAW_TRANSACTION_HASH_MISMATCH');
   assert.deepEqual(raw.identifiers().map(hex).sort(),tx.identifiers.map(hex).sort());
   const keys=state.operations().map(op=>typeof op==='string'?op:Buffer.from(op).toString('utf8'));
   const expected=row.kind==='deploy'?['registerMerchant']:row.kind==='key-registration'?
    ['registerMerchant',...evidence.keyInsertions.slice(0,evidence.keyInsertions.findIndex(item=>item.txHash===row.txHash)+1).map(item=>item.circuit)]:Object.keys(fixture.keys);
   assert.deepEqual(keys.sort(),expected.sort());
   for(const name of keys)need(Buffer.from(state.operation(name).verifierKey).equals(Buffer.from(fixture.keys[name],'base64')),'NETWORK_VERIFIER_KEY_MISMATCH');
   const v=ledger(state.data);
   report.checks.push({kind:row.kind,name:row.name??row.circuit??'deploy',txHash:row.txHash,blockHeight:row.blockHeight,
    rpcBlockHash:hex(canonicalHash),transactionStatus:tx.transactionResult.status,entryPoint:action.entryPoint??null,
    rawTransactionSha256:sha(raw.serialize()),stateSha256:sha(state.serialize()),registeredCircuitCount:keys.length,
    paidDustFees:tx.fees?.paidFees??null,publicAccounting:{T:String(v.totalReserve),E:String(v.encumberedReserve),R:String(v.redeemedReserve),F:String(v.feeReserve),P:String(v.pendingFeeReserve),U:String(v.refundReserve),X:String(v.reportedRefundReserve)}});
   save();console.log(`Verified ${row.kind}: ${row.name??row.circuit??'deploy'} at ${row.blockHeight}`);
  }
  report.networkMetadataIndependentlyRequeried=true;report.complete=true;report.executedCircuits=evidence.flowExecution.map(item=>item.name);
  save();console.log(JSON.stringify({result:'CANONICAL REPORTED RECEIPTS REQUERIED; EIGHT EXECUTED NAMES',evidence:output}));
 }catch(error){report.failureCode=error instanceof ReceiptError?error.code:'LOCAL_CHECK_FAILED';save();console.error(report.failureCode);process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{console.error('LOCAL_VERIFIER_SETUP_FAILED');process.exitCode=1;});
