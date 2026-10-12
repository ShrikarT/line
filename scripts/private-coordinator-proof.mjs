/** Native verification of whole-worker recovery. The harness receives public
 * proofs/state only, and advances only after its own separate Rust verifier.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,join,dirname} from 'node:path';
import * as RT from '@midnight-ntwrk/compact-runtime';
import * as L from '@midnight-ntwrk/ledger-v8';
import {runRecoverableOwnerCoordinator} from './recoverable-owner-coordinator.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),json=p=>JSON.parse(readFileSync(p,'utf8')),SOURCE='contracts/experimental/line-private-offer.compact';
const [keyDir,freshDir]=process.argv.slice(2);assert(keyDir&&freshDir,'Provide full keys and fresh generated coordinator bindings.');
const dir=resolve(keyDir),checkedDir=resolve(freshDir),checkedPath=join(dirname(checkedDir),'evidence.json'),checked=json(checkedPath),sourceHash=sha(readFileSync(SOURCE));
assert.equal(checked.schema,'line-recoverable-owner-coordinator/v1');assert.equal(checked.freshCompilation,true);assert.equal(checked.traces.length,10);assert.equal(checked.controls.length,6);assert.equal(checked.crashes.length,8);assert.equal(checked.sourceSha256,sourceHash);
for(const [p,h]of Object.entries(checked.scriptFingerprints))assert.equal(sha(readFileSync(p)),h,'Fresh coordinator helper changed.');
for(const [p,h]of Object.entries(checked.artifacts)){assert.equal(sha(readFileSync(join(checkedDir,p))),h);assert.equal(sha(readFileSync(join(dir,p))),h);}
const info=json(join(dir,'compiler/contract-info.json')),manifestPath=join(dirname(dir),'key-generation.json'),manifest=json(manifestPath);
assert.equal(manifest.complete,true);assert.equal(manifest.sourceSha256,sourceHash);
const artifacts=Object.fromEntries(['contract/index.js','compiler/contract-info.json',...info.circuits.flatMap(({name})=>[`keys/${name}.prover`,`keys/${name}.verifier`,`zkir/${name}.bzkir`])].map(p=>{const b=readFileSync(join(dir,p));return[p,{sha256:sha(b),bytes:b.length}];}));
const native=(profile,name)=>resolve('.compact-keys/native-proof-target',profile,name+(process.platform==='win32'?'.exe':''));
const verifier=native('debug','line-native-proof-verifier'),checker=native('debug','line-native-preimage-checker'),prover=native('release','line-native-local-prover');
const guardian=resolve('.compact-keys/worker-guardian-target/debug/line-private-worker-guardian'+(process.platform==='win32'?'.exe':''));
const executables=Object.fromEntries([['verifier',verifier],['checker',checker],['prover',prover],['guardian',guardian]].map(([name,p])=>{assert(existsSync(p));return[name,sha(readFileSync(p))];}));
const helpers=[...Object.keys(checked.scriptFingerprints),'scripts/private-coordinator-proof.mjs','scripts/native-proof-verifier/src/main.rs','scripts/native-proof-verifier/Cargo.toml','scripts/native-proof-verifier/Cargo.lock',
 'scripts/native-preimage-checker/src/main.rs','scripts/native-preimage-checker/src/bin/line-native-local-prover.rs','scripts/native-preimage-checker/Cargo.toml','scripts/native-preimage-checker/Cargo.lock',
 'scripts/private-worker-guardian/src/main.rs','scripts/private-worker-guardian/Cargo.toml','scripts/private-worker-guardian/Cargo.lock'];
const scriptFingerprints=Object.fromEntries(helpers.map(p=>[p,sha(readFileSync(p))])),work=mkdtempSync(resolve('.compact-keys/private-coordinator-native-proof-'));
const localProof={managedDir:dir,keyManifestSha256:sha(readFileSync(manifestPath)),verifier,checker,prover,guardian,nativeExecutables:executables,
 parameterCache:process.argv[4]?resolve(process.argv[4]):join(work,'public-parameters'),publicArtifactsDirectory:join(work,'worker-public-artifacts')};
const traces=[],negativeChecks=[],cacheControls=[];let local=L.LedgerState.blank('preview'),stage='initialization',complete=false,fixture,failure,scope,containmentMode=null;
const report=()=>({schema:'line-private-coordinator-native-proof/v2',createdAt:new Date().toISOString(),complete,sourceSha256:sourceHash,artifacts,scriptFingerprints,nativeExecutables:executables,
 keyManifestSha256:localProof.keyManifestSha256,generatedPrerequisiteSha256:sha(readFileSync(checkedPath)),traces,negativeChecks,cacheControls,
 owners:4,merchants:2,financialCheckpointDurable:true,completeExecutionWorkerRestart:true,coordinatorWitnessesReturnedToHarness:false,proofWorkerContainmentRequired:true,containmentMode,
 abruptExits:fixture?.crashes??[],generatedRecoveryControls:fixture?.controls??[],coordinatorProcessInvocations:fixture?.coordinatorProcessInvocations??null,
 syntheticLedger:true,syntheticTime:true,feeBalancingEnabled:false,networkSubmitted:false,authenticAssetSettlement:false,independentAdministrativeCustody:false,fullHistoryPrivacyPassed:false,allTwelveCircuitsCoveredByThisReport:false,
 ...(failure?{failure}:{}),evidenceScope:'This lane targets ten restored worker calls, four mTLS owners and two merchants, with native proving inside the financial worker and separate Rust verification before synthetic state advances. Actual coverage is established only by traces and the complete flag. Same-host synthetic custody and caller-trusted confirmation; no network finality, assets or full-history privacy claim.'});
const checkpoint=()=>writeFileSync(join(work,'verification.json'),JSON.stringify(report(),null,2)+'\n');
function verify(tx,name,seconds){
 const statePath=join(work,`${traces.length}-${name}.public-state.bin`),txPath=join(work,`${traces.length}-${name}.proven-public-tx.bin`);
 writeFileSync(statePath,local.serialize());writeFileSync(txPath,tx.serialize());
 return spawnSync(verifier,[statePath,txPath,String(seconds)],{encoding:'utf8',timeout:60_000,maxBuffer:100_000});
}
function apply(tx,name,actor,seconds,expectedLedger){
 const check=verify(tx,name,seconds);assert.equal(check.status,0);assert.match(check.stdout,/CRYPTOGRAPHIC_VERIFICATION_PASSED/);
 const strict=new L.WellFormedStrictness();strict.enforceBalancing=false;strict.verifyNativeProofs=true;strict.verifyContractProofs=true;strict.enforceLimits=true;strict.verifySignatures=true;
 const t=BigInt(seconds),formed=tx.wellFormed(local,strict,new Date(seconds*1000)),[next,outcome]=local.apply(formed,new L.TransactionContext(local,{secondsSinceEpoch:t,secondsSinceEpochErr:0,parentBlockHash:'0'.repeat(64),lastBlockTime:t-1n}));
 assert.equal(outcome.type,'success');assert.deepEqual(next.serialize(),expectedLedger);local=next;
 traces.push({circuit:name,actor,proofVerifiedInSeparateRustProcess:true,transactionSha256:sha(tx.serialize()),bytes:tx.serialize().length});checkpoint();
 console.log(JSON.stringify({circuit:name,acceptedContractProofs:traces.length-1,restoredWorkerNativeVerificationPassed:true}));
}
try{
 checkpoint();await runRecoverableOwnerCoordinator({compiledDir:dir,localProof,
  async onInitialized({scope:actual,proofGenesis,now}){
   scope=actual;assert.equal(proofGenesis.address,scope.contractAddress);const tx=L.Transaction.deserialize('signature','proof','binding',proofGenesis.transaction);
   apply(tx,'syntheticDeployment','fixture',now,proofGenesis.publicLedgerState);
  },
  async onBeforeConfirm({operationId,request,prepared,prove}){
   stage=request.circuit+':prove-restored';const predecessor=local.serialize();let response;
   if(request.circuit==='draw'){
    await assert.rejects(prove(predecessor,{crashDuringProve:true}),error=>error.interruptedDuringNativeProve===true&&error.ownedProcessesStopped===true);
    await assert.rejects(prove(predecessor,{crashAfterPublication:true}),error=>error.exitCode===23);
    response=await prove(predecessor);assert.equal(response.value.restoredWithoutReproving,true);
    const exact=response.value.transaction,changed=new Uint8Array(predecessor);changed[changed.length-1]^=1;
    await assert.rejects(prove(changed));const repeated=await prove(predecessor);assert.deepEqual(repeated.value.transaction,exact);
    assert.equal(repeated.value.restoredWithoutReproving,true);cacheControls.push({circuit:'draw',activeProverInterrupted:true,ownedProcessesStopped:true,abruptPublicationRecovery:true,identicalTransactionRetry:true,wrongPublicPredecessorRejected:true});
   }else{response=await prove(predecessor);assert.equal(response.value.restoredWithoutReproving,false);}
   assert.equal(response.ownedProcessesStopped,true);assert(['windows-job','posix-group'].includes(response.containmentMode));containmentMode??=response.containmentMode;assert.equal(response.containmentMode,containmentMode);const p=response.value;
   assert.deepEqual(Object.keys(p).sort(),['operationId','circuit','fingerprint','publicState','schema','operationFingerprint','predecessorSha256','transaction','transactionSha256','publicLedgerState','seconds','provingDurationMs','checks','proofVerifiedInSeparateRustProcess','restoredWithoutReproving','networkFinalityVerified'].sort());
   assert.equal(p.fingerprint,prepared.fingerprint);assert.equal(p.operationFingerprint,prepared.fingerprint);assert.deepEqual(p.publicState,prepared.publicState);
   assert.equal(p.predecessorSha256,sha(predecessor));assert.equal(p.transactionSha256,sha(p.transaction));assert.equal(p.networkFinalityVerified,false);assert.equal(p.proofVerifiedInSeparateRustProcess,true);
   const tx=L.Transaction.deserialize('signature','proof','binding',p.transaction);
   if(request.circuit==='draw'){
    const proof=[...tx.intents.values()].flatMap(i=>i.actions).find(a=>a.entryPoint==='draw').proof.serialize(),raw=Buffer.from(p.transaction);
    const interior=Buffer.from(proof.slice(Math.floor(proof.length/2),Math.floor(proof.length/2)+32)),offset=raw.indexOf(interior);assert(offset>=0&&raw.indexOf(interior,offset+1)<0);raw[offset]^=1;
    const bad=verify(L.Transaction.deserialize('signature','proof','binding',raw),'corrupted-draw',p.seconds);
    assert.equal(bad.status,1);assert.match(bad.stderr+bad.stdout,/NATIVE_WELL_FORMED_REJECTED:.*proof/i);negativeChecks.push({circuit:'draw',decodableProofCorruption:true,rejectedByNativeCryptographicVerifier:true});
   }
   apply(tx,request.circuit,request.actor,p.seconds,p.publicLedgerState);traces.at(-1).provingDurationMs=p.provingDurationMs;traces.at(-1).preparedFingerprint=p.fingerprint;
   traces.at(-1).nativeChecks=p.checks;assert.deepEqual(local.index(scope.contractAddress).data.state.encode(),RT.ContractState.deserialize(prepared.publicState).data.state.encode());checkpoint();
  },async onComplete(r){fixture=r;}
 });
 assert.equal(traces.length,11);assert.equal(negativeChecks.length,2);assert.equal(cacheControls.length,2);assert.equal(fixture.crashes.length,12);assert.equal(fixture.controls.length,6);assert.equal(fixture.coordinatorProcessInvocations,62);
 for(const [p,h]of Object.entries(scriptFingerprints))assert.equal(sha(readFileSync(p)),h,'Proof helper changed during execution.');
 for(const [p,h]of Object.entries(artifacts))assert.equal(sha(readFileSync(join(dir,p))),h.sha256);
 for(const [name,p]of [['verifier',verifier],['checker',checker],['prover',prover],['guardian',guardian]])assert.equal(sha(readFileSync(p)),executables[name]);
 complete=true;checkpoint();console.log(JSON.stringify({complete:true,contractCalls:10,abruptExits:12,activeProverInterruptions:2,corruptedDrawRejections:2,report:join(work,'verification.json')}));
}catch(error){failure={stage,errorClass:error.name,category:'coordinator_proving_or_verification_failed',...(error.coordinatorProofStage?{workerStage:error.coordinatorProofStage}:{})};checkpoint();console.error('Restored coordinator native proof run failed: '+(error.coordinatorProofStage??stage));process.exitCode=1;}
