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
import { resolveMidnightEndpoints, assertEndpointCredentials } from '../src/lib/runtime/endpoints.ts';
import { ReceiptError, createFinalizedReceiptReader } from './finalized-contract-receipt.mjs';
export { validateReceiptMetadata } from './finalized-contract-receipt.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const need=(condition,code)=>{if(!condition)throw new ReceiptError(code);};
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
  readerFingerprints:Object.fromEntries(['scripts/verify-preprod-receipts.mjs','scripts/finalized-contract-receipt.mjs','src/lib/runtime/endpoints.ts'].map(path=>[path,sha(readFileSync(path))])),
  complete:false,networkMetadataIndependentlyRequeried:false,allTwelveExecuted:false,privateCandidateDeployed:false,
  authenticSettlementEstablished:false,checks:[],trust:'Fresh Blockfrost indexer/RPC views over TLS; not an independently operated full node or a local re-verification of network proofs.'};
 const save=()=>{mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');};
 try{
  const endpoints=resolveMidnightEndpoints({networkId:'preprod',blockfrostProjectId:process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID});
  try{assertEndpointCredentials(endpoints);}catch{throw new ReceiptError('PREPROD_READ_ONLY_TOKEN_MISSING');}
  const reader=createFinalizedReceiptReader({endpoints});
  const rows=[{kind:'deploy',...evidence.deploy},...evidence.keyInsertions.map(item=>({kind:'key-registration',...item})),
   ...evidence.flowExecution.map(item=>({kind:'call',...item}))];
  need(rows.length===20,'REPORTED_RECEIPT_COUNT_INVALID');
  for(const row of rows){
   need(/^[a-f0-9]{64}$/.test(row.txHash)&&Number.isSafeInteger(row.blockHeight),'REPORTED_RECEIPT_INVALID');
   const observed=await reader.read(row,evidence.contractAddress);
   const {transaction:tx,action,raw,state,canonicalHash}=observed;
   report.finalizedHead=observed.finalizedHead;
   const keys=state.operations().map(op=>typeof op==='string'?op:Buffer.from(op).toString('utf8'));
   const expected=row.kind==='deploy'?['registerMerchant']:row.kind==='key-registration'?
    ['registerMerchant',...evidence.keyInsertions.slice(0,evidence.keyInsertions.findIndex(item=>item.txHash===row.txHash)+1).map(item=>item.circuit)]:Object.keys(fixture.keys);
   assert.deepEqual(keys.sort(),expected.sort());
   for(const name of keys)need(Buffer.from(state.operation(name).verifierKey).equals(Buffer.from(fixture.keys[name],'base64')),'NETWORK_VERIFIER_KEY_MISMATCH');
   const v=ledger(observed.compactState.data);
   report.checks.push({kind:row.kind,name:row.name??row.circuit??'deploy',txHash:row.txHash,blockHeight:row.blockHeight,
    rpcBlockHash:canonicalHash,finalizedHead:observed.finalizedHead,transactionStatus:tx.transactionResult.status,entryPoint:action.entryPoint??null,
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
