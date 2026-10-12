/** Reverify the complete saved chain from the reporting-count failure.
 * Never edits the original incomplete report or generates replacement proofs.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,join,dirname} from 'node:path';
import * as L from '@midnight-ntwrk/ledger-v8';
const [runArg,keysArg,driverArg,outArg]=process.argv.slice(2);assert(runArg&&keysArg&&driverArg&&outArg);
const run=resolve(runArg),keys=resolve(keysArg),driver=resolve(driverArg),out=resolve(outArg),sha=b=>createHash('sha256').update(b).digest('hex');
const originalPath=join(run,'verification.json'),originalBytes=readFileSync(originalPath),r=JSON.parse(originalBytes);
assert(out!==originalPath&&!existsSync(out),'Revalidation requires a new output path.');
assert.equal(r.schema,'line-private-coordinator-native-proof/repeat-supplier/v1');assert.equal(r.complete,false);
assert.equal(r.failure.errorClass,'AssertionError');assert.equal(r.failure.stage,'redeemDraw:prove-restored');
assert.equal(r.traces.length,14);assert.equal(r.negativeChecks.length,3);assert.equal(r.cacheControls.length,3);
assert.equal(r.abruptExits.length,18);assert.equal(r.generatedRecoveryControls.length,12);assert.equal(r.coordinatorProcessInvocations,85);assert.equal(r.generatedPrerequisiteWorkerInvocations,63);
assert.equal(r.retainedClaims.olderQuoteSelectedAfterNewerQuote,true);assert.equal(r.retainedClaims.olderNoteRedeemedAfterNewerDraw,true);
assert(r.negativeChecks.every(c=>c.decodableProofCorruption&&c.rejectedByNativeCryptographicVerifier));
assert(r.cacheControls.every(c=>c.activeProverInterrupted&&c.ownedProcessesStopped&&c.abruptPublicationRecovery&&c.identicalTransactionRetry&&c.wrongPublicPredecessorRejected));
assert(r.abruptExits.every(c=>c.exitCode===23||c.stage==='during-native-prove-after-key-load'&&c.ownedProcessesStopped));
for(const field of ['financialCheckpointDurable','completeExecutionWorkerRestart','syntheticLedger','syntheticTime','proofWorkerContainmentRequired'])assert.equal(r[field],true);
for(const field of ['coordinatorWitnessesReturnedToHarness','feeBalancingEnabled','networkSubmitted','authenticAssetSettlement','independentAdministrativeCustody','fullHistoryPrivacyPassed','allTwelveCircuitsCoveredByThisReport'])assert.equal(r[field],false);
assert.equal(r.sourceSha256,sha(readFileSync('contracts/experimental/line-private-offer.compact')));
assert.equal(r.keyManifestSha256,sha(readFileSync(join(dirname(keys),'key-generation.json'))));
for(const [path,hash]of Object.entries(r.scriptFingerprints))assert.equal(sha(readFileSync(path==='scripts/private-coordinator-proof.mjs'?driver:path)),hash,'Original execution helper differs.');
for(const [path,hash]of Object.entries(r.artifacts)){const b=readFileSync(join(keys,path));assert.equal(sha(b),hash.sha256);assert.equal(b.length,hash.bytes);}
const suffix=process.platform==='win32'?'.exe':'',executables={verifier:resolve('.compact-keys/native-proof-target/debug/line-native-proof-verifier'+suffix),
 checker:resolve('.compact-keys/native-proof-target/debug/line-native-preimage-checker'+suffix),prover:resolve('.compact-keys/native-proof-target/release/line-native-local-prover'+suffix),guardian:resolve('.compact-keys/worker-guardian-target/debug/line-private-worker-guardian'+suffix)};
for(const [name,path]of Object.entries(executables))assert.equal(sha(readFileSync(path)),r.nativeExecutables[name]);
let local=L.LedgerState.blank('preview');const checks=[];
for(const [i,trace]of r.traces.entries()){
 const statePath=join(run,`${i}-${trace.circuit}.public-state.bin`),txPath=join(run,`${i}-${trace.circuit}.proven-public-tx.bin`),stateBytes=readFileSync(statePath),txBytes=readFileSync(txPath);
 assert.deepEqual(Buffer.from(local.serialize()),stateBytes,'Saved pre-states must form one continuous chain.');assert.equal(sha(txBytes),trace.transactionSha256);
 const tx=L.Transaction.deserialize('signature','proof','binding',txBytes);assert.deepEqual(Buffer.from(tx.serialize()),txBytes);
 const deadlines=[...(tx.intents?.values()??[])].map(intent=>intent.ttl.getTime()/1000);assert(deadlines.length>0&&deadlines.every(x=>x===deadlines[0]));
 const seconds=deadlines[0]-3600;assert(Number.isSafeInteger(seconds)&&seconds>0);
 const verified=spawnSync(executables.verifier,[statePath,txPath,String(seconds)],{encoding:'utf8',timeout:60_000,maxBuffer:100_000});
 assert.equal(verified.status,0);assert.match(verified.stdout,/CRYPTOGRAPHIC_VERIFICATION_PASSED/);
 const strict=new L.WellFormedStrictness();strict.enforceBalancing=false;strict.verifyNativeProofs=true;strict.verifyContractProofs=true;strict.verifySignatures=true;strict.enforceLimits=true;
 const t=BigInt(seconds),formed=tx.wellFormed(local,strict,new Date(seconds*1000)),[next,result]=local.apply(formed,new L.TransactionContext(local,{secondsSinceEpoch:t,secondsSinceEpochErr:0,parentBlockHash:'0'.repeat(64),lastBlockTime:t-1n}));
 assert.equal(result.type,'success');local=next;checks.push({circuit:trace.circuit,publicPreStateSha256:sha(stateBytes),transactionSha256:sha(txBytes),seconds,reverifiedInSeparateRustProcess:true,continuousReplayPassed:true});
 console.log(JSON.stringify({reverifiedTransactions:checks.length,circuit:trace.circuit}));
}
assert.equal(sha(readFileSync(originalPath)),sha(originalBytes),'Original failed report changed.');
for(const [path,hash]of Object.entries(r.scriptFingerprints))assert.equal(sha(readFileSync(path==='scripts/private-coordinator-proof.mjs'?driver:path)),hash,'Original helper changed during replay.');
const report={...r,schema:'line-private-coordinator-native-proof/revalidated-repeat-supplier/v1',complete:true,createdAt:new Date().toISOString(),
 originalRun:{reportSha256:sha(originalBytes),executionRevision:'d8e1acda547cb5118d816d6792d686a6af702239',complete:false,failure:r.failure,driverSha256:sha(readFileSync(driver)),retainedUnmodified:true},
 revalidation:{scriptSha256:sha(readFileSync(new URL(import.meta.url))),transactions:checks,finalSyntheticLedgerSha256:sha(local.serialize()),newProofsGenerated:false,
  correctedCount:'63 generated invocations + 13 successful per-call proofs + 9 additional draw interruptions/retries = 85'},
 evidenceScope:'All fourteen saved public transactions from the count-guard failure are freshly Rust-verified and replayed as one continuous synthetic chain. Thirteen contract calls, original recovery/corruption controls and original source/key/helper fingerprints are retained. Original run remains incomplete; this separate revalidation completes artifact verification, without new proving, network, assets, compensation or full-history privacy.'};
delete report.failure;writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({complete:true,contractCalls:13,publicTransactionsReverified:14,originalRunRemainsIncomplete:true,report:out}));
