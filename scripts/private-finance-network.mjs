/** Owner-configured read-only authority for a financial journal's network lane.
 * Credentials remain in memory. Source/key provenance is owner-pinned, not
 * inferred from a hash string or a provider's success label.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as L from '@midnight-ntwrk/ledger-v8';
import {createFinalizedReceiptReader} from './finalized-contract-receipt.mjs';
import {encodeVaultJson} from '../src/lib/security/vault-codec.ts';
const sha=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&Buffer.from(a).equals(Buffer.from(b));
const circuits=['registerMerchant','disableMerchant','fundReserve','withdrawUnencumberedReserve','withdrawFees','openLine','postQuote','draw','redeemDraw','cancelOrExpireNote','acknowledgeRepayment','setStatus'];
const entry=value=>typeof value==='string'?value:Buffer.from(value).toString('utf8');
export function networkSubmission(scope,operationId,circuit,transaction){
 assert(transaction instanceof Uint8Array&&transaction.length>0&&transaction.length<=1_000_000,'Submitted transaction bytes are required.');
 const raw=L.Transaction.deserialize('signature','proof','binding',transaction);
 assert(same(raw.serialize(),transaction),'Submitted transaction encoding differs.');
 const actions=[...(raw.intents?.values()??[])].flatMap(intent=>intent.actions).filter(a=>a.address===scope.contractAddress);
 assert.equal(actions.length,1,'Submission must contain one target contract action.');
 assert(actions[0] instanceof L.ContractCall&&entry(actions[0].entryPoint)===circuit,'Submission differs from prepared circuit.');
 return {operationId,circuit,transaction:new Uint8Array(transaction),transactionSha256:sha(transaction),transactionHash:raw.transactionHash(),identifiers:raw.identifiers()};
}
export function financialNetworkAuthority(scope,config){
 assert.equal(scope.networkId,'preprod');assert(config&&typeof config==='object','Owner network authority is required.');
 assert.deepEqual(Object.keys(config).sort(),['endpoints','verifierKeys','sourceSha256','executableSha256'].sort());
 assert.equal(config.sourceSha256,scope.sourceSha256);assert.equal(config.executableSha256,scope.executableSha256);
 const endpoints={...config.endpoints};assert.equal(endpoints.networkId,scope.networkId);
 const keys=Object.fromEntries(Object.entries(config.verifierKeys).map(([name,key])=>{
  assert(key instanceof Uint8Array&&key.length>0&&key.length<=100_000);return [name,new Uint8Array(key)];
 }));assert.deepEqual(Object.keys(keys).sort(),[...circuits].sort());
 const base=value=>{const url=new URL(value);return url.origin+url.pathname;};
 const policy={networkId:scope.networkId,sourceSha256:scope.sourceSha256,executableSha256:scope.executableSha256,
  indexerService:base(endpoints.indexerUri),nodeService:base(endpoints.nodeUri),
  verifierKeySha256:Object.fromEntries(Object.entries(keys).map(([name,key])=>[name,sha(key)]))};
 const reader=createFinalizedReceiptReader({endpoints});
 function validateState(state,expected){
  assert.deepEqual(state.operations().map(entry).sort(),[...circuits].sort(),'Observed verifier inventory differs.');
  for(const name of circuits)assert(same(state.operation(name).verifierKey,keys[name]),'Observed verifier key differs.');
  const wanted=L.ContractState.deserialize(expected);
  assert.deepEqual(state.data.state.encode(),wanted.data.state.encode(),'Observed public effect differs; retain candidate.');
 }
 return {policy,async observe({transaction,kind,name,blockHeight,expectedPublicState}){
  assert(transaction instanceof Uint8Array&&transaction.length>0&&transaction.length<=1_000_000);
  assert(blockHeight===undefined||Number.isSafeInteger(blockHeight)&&blockHeight>0);assert(['deploy','call','key-registration'].includes(kind));
  const raw=L.Transaction.deserialize('signature','proof','binding',transaction);assert(same(raw.serialize(),transaction));
  const ids=raw.identifiers();assert(ids.length>0,'Submitted identifiers are required.');
  const observed=await reader.read({kind,name,identifier:ids.at(-1),blockHeight},scope.contractAddress);
  const observedIds=observed.raw.identifiers();assert(ids.every(id=>observedIds.includes(id)),'Receipt differs from saved submission.');
  // Merge may change the enclosing transaction, never the saved bound intent.
  for(const [segment,intent]of raw.intents??[])assert(observed.raw.intents?.has(segment)&&same(observed.raw.intents.get(segment).serialize(),intent.serialize()),'Finalized intent differs from saved submission.');
  validateState(observed.state,expectedPublicState);
  return {transactionHash:observed.raw.transactionHash(),transactionSha256:sha(observed.raw.serialize()),submittedTransactionHash:raw.transactionHash(),submittedTransactionSha256:sha(transaction),identifiers:ids,blockHeight:observed.transaction.block.height,
   blockHash:observed.canonicalHash,finalizedHead:observed.finalizedHead,stateDataSha256:sha(encodeVaultJson(observed.state.data.state.encode())),
   authority:'configured-tls-indexer-rpc',networkFinalityVerified:true};
 }};
}
