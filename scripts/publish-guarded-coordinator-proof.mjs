/** Publish only complete source-bound public proof metadata. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex'),[path,dir]=process.argv.slice(2);assert(path&&dir);
const r=JSON.parse(readFileSync(path,'utf8'));
assert.equal(r.schema,'line-private-coordinator-native-proof/v2');assert.equal(r.complete,true);assert.equal(r.traces.length,11);
assert(r.traces.every(t=>t.proofVerifiedInSeparateRustProcess));assert.equal(r.negativeChecks.length,2);assert(r.negativeChecks.every(x=>x.decodableProofCorruption&&x.rejectedByNativeCryptographicVerifier));
assert.equal(r.cacheControls.length,2);assert(r.cacheControls.every(x=>x.activeProverInterrupted&&x.ownedProcessesStopped&&x.abruptPublicationRecovery&&x.identicalTransactionRetry&&x.wrongPublicPredecessorRejected));
assert.equal(r.abruptExits.length,12);assert(r.abruptExits.every(x=>x.exitCode===23||(x.stage==='during-native-prove-after-key-load'&&x.ownedProcessesStopped===true)));assert.equal(r.proofWorkerContainmentRequired,true);assert(['windows-job','posix-group'].includes(r.containmentMode));assert.equal(r.generatedRecoveryControls.length,6);assert.equal(r.coordinatorProcessInvocations,62);
assert.equal(r.owners,4);assert.equal(r.merchants,2);
for(const key of ['financialCheckpointDurable','completeExecutionWorkerRestart','syntheticLedger','syntheticTime'])assert.equal(r[key],true);
for(const key of ['coordinatorWitnessesReturnedToHarness','feeBalancingEnabled','networkSubmitted','authenticAssetSettlement','independentAdministrativeCustody','fullHistoryPrivacyPassed','allTwelveCircuitsCoveredByThisReport'])assert.equal(r[key],false);
assert.equal(r.sourceSha256,sha(readFileSync('contracts/experimental/line-private-offer.compact')));
assert.equal(r.keyManifestSha256,sha(readFileSync(join(dirname(resolve(dir)),'key-generation.json'))));
for(const [p,h]of Object.entries(r.scriptFingerprints))assert.equal(sha(readFileSync(p)),h,'Coordinator proof helper changed.');
for(const [p,h]of Object.entries(r.artifacts)){const b=readFileSync(join(dir,p));assert.equal(sha(b),h.sha256);assert.equal(b.length,h.bytes);}
for(const [i,t]of r.traces.entries())assert.equal(sha(readFileSync(join(dirname(path),`${i}-${t.circuit}.proven-public-tx.bin`))),t.transactionSha256);
for(const [name,profile,exe]of [['verifier','debug','line-native-proof-verifier'],['checker','debug','line-native-preimage-checker'],['prover','release','line-native-local-prover']]){
 assert.equal(sha(readFileSync(resolve('.compact-keys/native-proof-target',profile,exe+(process.platform==='win32'?'.exe':'')))),r.nativeExecutables[name]);
}
assert.equal(r.nativeExecutables.guardian,sha(readFileSync(resolve('.compact-keys/worker-guardian-target/debug/line-private-worker-guardian'+(process.platform==='win32'?'.exe':'')))));
r.gitNormalizedScriptFingerprints=Object.fromEntries(Object.keys(r.scriptFingerprints).map(p=>[p,sha(readFileSync(p,'utf8').replaceAll('\r\n','\n'))]));
r.fingerprintScope='Runtime hashes identify exact files executed; LF-normalized hashes correlate Git source and do not establish another run.';
writeFileSync('docs/private-signed-2026-10-11-evidence/owner-coordinator-guarded-native-proof.json',JSON.stringify(r,null,2)+'\n');
console.log(JSON.stringify({publishedContractCalls:10,abruptExits:12,activeProverInterruptions:2,identicalProofRecoveries:2,nativeCorruptionRejections:2,networkSubmitted:false}));
