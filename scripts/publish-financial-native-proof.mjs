/** Publish only a complete source-bound, independently verified local run. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
const hash=b=>createHash('sha256').update(b).digest('hex');
const [path,managedDir]=process.argv.slice(2);assert(path&&managedDir,'Provide native report and full managed directory.');
const report=JSON.parse(readFileSync(path,'utf8'));
assert.equal(report.schema,'line-recoverable-offer-native-proof/v1');assert.equal(report.complete,true);
assert.equal(report.sourceSha256,hash(readFileSync('contracts/experimental/line-private-offer.compact')));
assert.equal(report.provingBackend,'pinned-native-rust');assert.equal(report.traces.length,7);
assert(report.traces.every(t=>t.proofVerifiedInSeparateRustProcess));assert.equal(report.negativeChecks.length,1);
assert.equal(report.negativeChecks[0].rejectedByNativeCryptographicVerifier,true);
assert.equal(report.storageSubprocessInvocations,20);assert.equal(report.financialCheckpointDurable,true);
assert.equal(report.preparedCandidatePersistedBeforeProof,true);assert.equal(report.coordinatorMemoryClearedAndReloaded,true);
assert.equal(report.completeCoordinatorRestart,false);assert.equal(report.networkSubmitted,false);assert.equal(report.authenticAssetSettlement,false);
assert.deepEqual([...report.provedCircuits].sort(),['fundReserve','openLine','postQuote','draw','redeemDraw'].sort());
for(const [p,h]of Object.entries(report.scriptFingerprints))assert.equal(hash(readFileSync(p)),h,'Proof helper changed.');
for(const [p,entry]of Object.entries(report.artifacts)){const b=readFileSync(join(managedDir,p));assert.equal(hash(b),entry.sha256);assert.equal(b.length,entry.bytes);}
for(const [i,t]of report.traces.entries())assert.equal(hash(readFileSync(join(dirname(path),`${i}-${t.circuit}.proven-public-tx.bin`))),t.transactionSha256);
for(const [profile,name,pinned]of [['debug','line-native-proof-verifier',report.nativeVerifierSha256],['debug','line-native-preimage-checker',report.nativeCheckerSha256],['release','line-native-local-prover',report.nativeProverSha256]]){
 const file=resolve('.compact-keys/native-proof-target',profile,name+(process.platform==='win32'?'.exe':''));assert.equal(hash(readFileSync(file)),pinned);
}
const {checkedGeneratedDirectory,keyGeneration,...publicReport}=report;
publicReport.gitNormalizedScriptFingerprints=Object.fromEntries(Object.keys(report.scriptFingerprints).map(p=>[p,hash(readFileSync(p,'utf8').replaceAll('\r\n','\n'))]));
publicReport.fingerprintScope='Runtime hashes identify exact local files used. Secondary LF-normalized hashes correlate Git source; they are not a second execution or proof run.';
writeFileSync('docs/private-signed-2026-10-11-evidence/financial-recovery-native-proof.json',JSON.stringify(publicReport,null,2)+'\n');
console.log(JSON.stringify({publishedCalls:6,separateNativeVerification:true,storageInvocations:20,networkSubmitted:false}));
