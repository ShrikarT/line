/** Publish only complete source-bound public proof metadata. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import * as L from '@midnight-ntwrk/ledger-v8';
const sha=b=>createHash('sha256').update(b).digest('hex'),[path,dir,output]=process.argv.slice(2);assert(path&&dir);
const r=JSON.parse(readFileSync(path,'utf8'));
const repeat=r.schema==='line-private-coordinator-native-proof/repeat-supplier/v1',compensation=r.schema==='line-private-coordinator-native-proof/compensation/v1';assert(compensation||repeat||r.schema==='line-private-coordinator-native-proof/v2');assert.equal(r.complete,true);assert.equal(r.traces.length,compensation?31:repeat?14:11);
assert(r.traces.every(t=>t.proofVerifiedInSeparateRustProcess));assert.equal(r.negativeChecks.length,compensation?4:repeat?3:2);assert(r.negativeChecks.every(x=>x.decodableProofCorruption&&x.rejectedByNativeCryptographicVerifier));
assert.equal(r.cacheControls.length,compensation?4:repeat?3:2);assert(r.cacheControls.every(x=>x.activeProverInterrupted&&x.ownedProcessesStopped&&x.abruptPublicationRecovery&&x.identicalTransactionRetry&&x.wrongPublicPredecessorRejected));
assert.equal(r.abruptExits.length,compensation?100:repeat?18:12);assert(r.abruptExits.every(x=>x.exitCode===23||(x.stage==='during-native-prove-after-key-load'&&x.ownedProcessesStopped===true)));assert.equal(r.proofWorkerContainmentRequired,true);assert(['windows-job','posix-group'].includes(r.containmentMode));assert.equal(r.generatedRecoveryControls.length,compensation?82:repeat?12:6);
if(compensation){
 assert(output,'Compensation proof evidence requires a separate publication path.');assert.equal(r.generatedPrerequisiteWorkerInvocations,268);assert.equal(r.coordinatorProcessInvocations,310);
 assert.equal(r.allTwelveCircuitsCoveredByThisReport,true);assert.equal(new Set(r.traces.slice(1).map(t=>t.circuit)).size,12);
 assert.deepEqual(r.traces.filter(t=>t.circuit==='cancelOrExpireNote').map(t=>t.compensationMode),[0,1,2,1,2,1,2]);
 assert(r.traces.every((t,i)=>Number.isSafeInteger(t.seconds)&&t.seconds>=0&&(i===0||t.seconds>=r.traces[i-1].seconds)));
}
if(repeat){assert.equal(r.retainedClaims.olderNoteRedeemedAfterNewerDraw,true);assert.equal(r.retainedClaims.olderQuoteSelectedAfterNewerQuote,true);assert.equal(r.generatedPrerequisiteWorkerInvocations,63);assert.equal(r.coordinatorProcessInvocations,85);assert(output,'Repeated-supplier evidence requires a separate publication path.');}
else if(!compensation)assert.equal(r.coordinatorProcessInvocations,62);
assert.equal(r.owners,4);assert.equal(r.merchants,2);
for(const key of ['financialCheckpointDurable','completeExecutionWorkerRestart','syntheticLedger','syntheticTime'])assert.equal(r[key],true);
for(const key of ['coordinatorWitnessesReturnedToHarness','feeBalancingEnabled','networkSubmitted','authenticAssetSettlement','independentAdministrativeCustody','fullHistoryPrivacyPassed'])assert.equal(r[key],false);
if(!compensation)assert.equal(r.allTwelveCircuitsCoveredByThisReport,false);
assert.equal(r.sourceSha256,sha(readFileSync('contracts/experimental/line-private-offer.compact')));
assert.equal(r.keyManifestSha256,sha(readFileSync(join(dirname(resolve(dir)),'key-generation.json'))));
for(const [p,h]of Object.entries(r.scriptFingerprints))assert.equal(sha(readFileSync(p)),h,'Coordinator proof helper changed.');
for(const [p,h]of Object.entries(r.artifacts)){const b=readFileSync(join(dir,p));assert.equal(sha(b),h.sha256);assert.equal(b.length,h.bytes);}
for(const [i,t]of r.traces.entries()){
 const bytes=readFileSync(join(dirname(path),`${i}-${t.circuit}.proven-public-tx.bin`));assert.equal(sha(bytes),t.transactionSha256);
 if(compensation){const tx=L.Transaction.deserialize('signature','proof','binding',bytes);assert.deepEqual(Buffer.from(tx.serialize()),bytes);
  const intents=[...tx.intents.values()];assert(intents.length>0&&intents.every(intent=>intent.ttl.getTime()/1000-3600===t.seconds),'Saved time must match the source-defined intent TTL.');
  const actions=intents.flatMap(intent=>intent.actions);assert.equal(actions.length,1);
  if(i===0)assert(actions[0] instanceof L.ContractDeploy);else{assert(actions[0] instanceof L.ContractCall);assert.equal(actions[0].entryPoint,t.circuit);}
 }
}
for(const [name,profile,exe]of [['verifier','debug','line-native-proof-verifier'],['checker','debug','line-native-preimage-checker'],['prover','release','line-native-local-prover']]){
 assert.equal(sha(readFileSync(resolve('.compact-keys/native-proof-target',profile,exe+(process.platform==='win32'?'.exe':'')))),r.nativeExecutables[name]);
}
assert.equal(r.nativeExecutables.guardian,sha(readFileSync(resolve('.compact-keys/worker-guardian-target/debug/line-private-worker-guardian'+(process.platform==='win32'?'.exe':'')))));
r.gitNormalizedScriptFingerprints=Object.fromEntries(Object.keys(r.scriptFingerprints).map(p=>[p,sha(readFileSync(p,'utf8').replaceAll('\r\n','\n'))]));
r.fingerprintScope='Runtime hashes identify exact files executed; LF-normalized hashes correlate Git source and do not establish another run.';
writeFileSync(output??'docs/private-signed-2026-10-11-evidence/owner-coordinator-guarded-native-proof.json',JSON.stringify(r,null,2)+'\n');
console.log(JSON.stringify({publishedContractCalls:r.traces.length-1,abruptExits:r.abruptExits.length,activeProverInterruptions:r.cacheControls.length,identicalProofRecoveries:r.cacheControls.length,nativeCorruptionRejections:r.negativeChecks.length,networkSubmitted:false}));
