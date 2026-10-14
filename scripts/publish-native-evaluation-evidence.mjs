/** Fail-closed publication of witness-free evaluation and compiler metadata. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const [evaluationPath,probePath,managedDir]=process.argv.slice(2);
assert(evaluationPath&&probePath&&managedDir,'Provide evaluation report, compiler probe report and full managed directory.');
const evaluation=read(evaluationPath),probe=read(probePath);
assert.equal(evaluation.schema,'line-recoverable-offer-preimage-check/v1');assert.equal(evaluation.complete,true);
assert.equal(evaluation.sourceSha256,hash(readFileSync('contracts/experimental/line-private-offer.compact')));
assert.equal(evaluation.cryptographicProofsGenerated,false);assert.equal(evaluation.nativeProofVerificationPerformed,false);
assert.equal(evaluation.networkSubmitted,false);assert.equal(evaluation.checks.length,6);assert.equal(evaluation.negativeChecks.length,12);
assert.equal(evaluation.financialStorageInvocations,20);assert(evaluation.checks.every(c=>c.passed));assert(evaluation.negativeChecks.every(c=>c.rejected));
for(const [p,h]of Object.entries(evaluation.scriptFingerprints))assert.equal(hash(readFileSync(p)),h,'Evaluation harness changed.');
for(const [p,entry]of Object.entries(evaluation.artifacts)){const b=readFileSync(join(managedDir,p));assert.equal(hash(b),entry.sha256);assert.equal(b.length,entry.bytes);}
const native=resolve('.compact-keys/native-proof-target/debug',process.platform==='win32'?'line-native-preimage-checker.exe':'line-native-preimage-checker');
assert.equal(hash(readFileSync(native)),evaluation.nativeCheckerSha256);
assert.equal(probe.schema,'line-compact-cse-range-probe/v1');assert.equal(probe.passed,true);assert.equal(probe.freshCompilation,true);
assert.equal(probe.compiler,read('package.json').compact.compiler);assert.equal(probe.probes.length,3);assert(probe.probes.every(p=>p.unconditionalCountRangeGateRetained));
assert.equal(probe.analysisScriptSha256,hash(readFileSync('scripts/check-compact-cse-range.mjs')));
assert.equal(probe.compilerWrapperSha256,hash(readFileSync('scripts/compile-compact.mjs')));
const base='docs/private-signed-2026-10-11-evidence';
evaluation.gitNormalizedScriptFingerprints=Object.fromEntries(Object.keys(evaluation.scriptFingerprints).map(p=>[p,hash(readFileSync(p,'utf8').replaceAll('\r\n','\n'))]));
evaluation.fingerprintScope='Runtime hashes identify exact local files used. Secondary LF-normalized hashes correlate Git source; they are not a second execution or proof run.';
writeFileSync(join(base,'financial-recovery-native-evaluation.json'),JSON.stringify(evaluation,null,2)+'\n');
writeFileSync(join(base,'compiler-cse-range-probes.json'),JSON.stringify(probe,null,2)+'\n');
console.log(JSON.stringify({publishedEvaluationChecks:6,rejectedCorruptions:12,compilerProbes:3,cryptographicProofsGenerated:false}));
