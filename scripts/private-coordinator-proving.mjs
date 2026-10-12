/** Local synthetic-ledger proving inside the private financial worker.
 * Only public transactions/states leave this module. No network or asset APIs.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve,dirname} from 'node:path';
import * as RT from '@midnight-ntwrk/compact-runtime';
import * as L from '@midnight-ntwrk/ledger-v8';
import {NodeZkConfigProvider} from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {setNetworkId} from '@midnight-ntwrk/midnight-js-network-id';
import {EncryptedCheckoutStore} from '../server/checkout-storage.ts';
import {nativeLocalProvingProvider} from './native-local-proving-provider.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),ID='66666666-6666-4666-8666-666666666666';
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const CIRCUITS=['registerMerchant','disableMerchant','fundReserve','withdrawUnencumberedReserve','withdrawFees','openLine','postQuote','draw','redeemDraw','cancelOrExpireNote','acknowledgeRepayment','setStatus'];
export function coordinatorProofDirectory(directory,operationId){
 assert(typeof operationId==='string'&&/^[a-zA-Z0-9:._-]{1,128}$/.test(operationId));
 // The financial store requires a dedicated directory with no subdirectories.
 return resolve(directory)+'-proven-'+sha(Buffer.from(operationId));
}
export function validateCoordinatorProofConfig(config,scope){
 assert.equal(scope.networkId,'synthetic-preview');const dir=resolve(config.managedDir);
 assert.equal(sha(readFileSync('contracts/experimental/line-private-offer.compact')),scope.sourceSha256);
 assert.equal(sha(readFileSync(join(dir,'contract/index.js'))),scope.executableSha256);
 const info=json(join(dir,'compiler/contract-info.json')),manifestPath=join(dirname(dir),'key-generation.json'),manifest=json(manifestPath);
 assert.equal(sha(readFileSync(manifestPath)),config.keyManifestSha256);
 assert.equal(info['compiler-version'],'0.31.1');assert.equal(info['runtime-version'],'0.16.0');
 assert.equal(manifest.complete,true);assert.equal(manifest.sourceSha256,scope.sourceSha256);assert.equal(manifest.compiler,'0.31.1');
 assert.deepEqual(info.circuits.map(x=>x.name).sort(),[...CIRCUITS].sort());assert.deepEqual(manifest.circuits.map(x=>x.name).sort(),[...CIRCUITS].sort());
 for(const c of manifest.circuits){assert.equal(sha(readFileSync(join(dir,'zkir',c.name+'.zkir'))),c.zkirSha256);
  assert.deepEqual(Object.keys(c.artifacts).sort(),[`zkir/${c.name}.bzkir`,`keys/${c.name}.prover`,`keys/${c.name}.verifier`].sort());
  for(const [p,v]of Object.entries(c.artifacts)){const b=readFileSync(join(dir,p));assert.equal(sha(b),v.sha256);assert.equal(b.length,v.bytes);}}
 assert.deepEqual(Object.keys(config.nativeExecutables).sort(),['checker','prover','verifier']);
 for(const name of ['checker','prover','verifier'])assert.equal(sha(readFileSync(config[name])),config.nativeExecutables[name]);
 setNetworkId('preview');return {dir,info};
}
function strictness(){const s=new L.WellFormedStrictness();s.enforceBalancing=false;s.verifyNativeProofs=true;s.verifyContractProofs=true;s.enforceLimits=true;s.verifySignatures=true;return s;}
function verifiedApply(config,local,tx,seconds,label){
 const work=resolve(config.publicArtifactsDirectory);mkdirSync(work,{recursive:true});
 const statePath=join(work,label+'.public-state.bin'),txPath=join(work,label+'.proven-public-tx.bin');
 writeFileSync(statePath,local.serialize());writeFileSync(txPath,tx.serialize());
 const checked=spawnSync(config.verifier,[statePath,txPath,String(seconds)],{encoding:'utf8',timeout:60_000,maxBuffer:100_000});
 assert.equal(checked.status,0,'Separate native verification rejected.');assert.match(checked.stdout,/CRYPTOGRAPHIC_VERIFICATION_PASSED/);
 const t=BigInt(seconds),formed=tx.wellFormed(local,strictness(),new Date(seconds*1000));
 const [next,outcome]=local.apply(formed,new L.TransactionContext(local,{secondsSinceEpoch:t,secondsSinceEpochErr:0,parentBlockHash:'0'.repeat(64),lastBlockTime:t-1n}));
 assert.equal(outcome.type,'success');return next;
}
function provider(config,checks){return nativeLocalProvingProvider({managedDir:config.managedDir,checker:config.checker,prover:config.prover,parameterCache:config.parameterCache,
 onCheck:x=>checks.push(x),onDiagnostic:x=>checks.push({nativeProcessFailure:x})});}
export async function initializeCoordinatorProofLedger(initial,config,scope,seconds){
 const {dir,info}=validateCoordinatorProofConfig(config,scope),zk=new NodeZkConfigProvider(dir);
 for(const {name}of info.circuits){const op=new RT.ContractOperation();op.verifierKey=await zk.getVerifierKey(name);initial.currentContractState.setOperation(name,op);}
 const deploy=new L.ContractDeploy(L.ContractState.deserialize(initial.currentContractState.serialize()));
 const tx=L.Transaction.fromParts('preview',undefined,undefined,L.Intent.new(new Date((seconds+3600)*1000)).addDeploy(deploy));
 const proven=(await tx.prove(provider(config,[]),L.CostModel.initialCostModel())).bind();
 const next=verifiedApply(config,L.LedgerState.blank('preview'),proven,seconds,'genesis');
 return {address:deploy.address,transaction:proven.serialize(),publicLedgerState:next.serialize(),seconds};
}
export async function proveRestoredCoordinator({config,scope,directory,password,pending,restored,initialQueryContext,publicLedgerState}){
 let stage='configuration',store;
 try{
 const {dir}=validateCoordinatorProofConfig(config,scope);assert(publicLedgerState instanceof Uint8Array&&publicLedgerState.length<=1_000_000);
 const predecessorHash=sha(publicLedgerState),binding=sha(JSON.stringify({schema:'line-private-coordinator-proof/v1',scope,operationId:pending.operationId,fingerprint:pending.fingerprint,predecessorHash}));
 stage='cache-open';store=await EncryptedCheckoutStore.openBound(coordinatorProofDirectory(directory,pending.operationId),password,binding);
 stage='public-predecessor';
  const rows=await store.loadAll();assert(rows.length<=1);const seconds=pending.before.financial.unixSeconds;
  const local=L.LedgerState.deserialize(publicLedgerState),current=local.index(scope.contractAddress);
  assert(current);assert.deepEqual(current.data.state.encode(),RT.ContractState.deserialize(pending.before.publicState).data.state.encode());
  const zk=new NodeZkConfigProvider(dir);assert.deepEqual(new Uint8Array(current.operation(pending.circuit).verifierKey),new Uint8Array(await zk.getVerifierKey(pending.circuit)));
  let record;
  if(rows.length){
   record=rows[0];assert.equal(record.schema,'line-private-coordinator-proof/v1');assert.equal(record.operationFingerprint,pending.fingerprint);assert.equal(record.predecessorSha256,predecessorHash);
   assert.equal(sha(record.transaction),record.transactionSha256);
   const proven=L.Transaction.deserialize('signature','proof','binding',record.transaction),next=verifiedApply(config,local,proven,seconds,'restored-'+pending.operationId.replaceAll(':','-'));
   assert.deepEqual(next.serialize(),record.publicLedgerState);assert.deepEqual(next.index(scope.contractAddress).data.state.encode(),RT.ContractState.deserialize(pending.candidate.publicState).data.state.encode());
   return {...record,restoredWithoutReproving:true,networkFinalityVerified:false};
  }
  stage='transcript-construction';const context=new L.QueryContext(new L.ChargedState(L.StateValue.decode(initialQueryContext.state.state.encode())),scope.contractAddress);
  context.block=initialQueryContext.block;context.effects=initialQueryContext.effects;
  let partition=context;for(const entry of restored.context.currentQueryContext.comIndices)partition=partition.insertCommitment(...entry);
  const data=restored.proofData,parts=L.partitionTranscripts([new L.PreTranscript(partition,data.publicTranscript)],local.parameters);assert.equal(parts.length,1);
  const call=new L.ContractCallPrototype(scope.contractAddress,pending.circuit,current.operation(pending.circuit),parts[0][0],parts[0][1],data.privateTranscriptOutputs,data.input,data.output,L.communicationCommitmentRandomness(),pending.circuit);
  const tx=L.Transaction.fromPartsRandomized('preview',undefined,undefined,L.Intent.new(new Date((seconds+3600)*1000)).addCall(call)),checks=[],started=Date.now();
  stage='native-proving';const proven=(await tx.prove(provider(config,checks),L.CostModel.initialCostModel())).bind(),duration=Date.now()-started;
  stage='native-verification';const next=verifiedApply(config,local,proven,seconds,'prepared-'+pending.operationId.replaceAll(':','-'));
  assert.deepEqual(next.index(scope.contractAddress).data.state.encode(),RT.ContractState.deserialize(pending.candidate.publicState).data.state.encode());
  record={schema:'line-private-coordinator-proof/v1',operationFingerprint:pending.fingerprint,predecessorSha256:predecessorHash,transaction:proven.serialize(),transactionSha256:sha(proven.serialize()),
   publicLedgerState:next.serialize(),seconds,provingDurationMs:duration,checks,proofVerifiedInSeparateRustProcess:true};
  stage='proof-publication';await store.save(ID,record);
  return {...record,restoredWithoutReproving:false,networkFinalityVerified:false};
 }catch(error){error.coordinatorProofStage=stage;throw error;}finally{if(store)await store.close();}
}
