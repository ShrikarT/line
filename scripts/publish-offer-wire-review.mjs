/** Validate finite public encoding observations before publication. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex'),[path,binary]=process.argv.slice(2);assert(path);
const r=JSON.parse(readFileSync(path,'utf8')),corpusPath='tests/fixtures/private-offer-public-pairs/manifest.json',corpus=JSON.parse(readFileSync(corpusPath));
assert.equal(r.schema,'line-private-offer-wire-review/v1');assert.equal(r.pairs.length,11);assert.equal(r.allElevenMeasuredDeltasAccountedFor,true);
assert(r.pairs.every(p=>p.allMeasuredFieldDeltasAccountedFor&&Object.values(p.arithmeticResiduals).every(v=>v===0)));
assert.equal(r.sourceBoundArtifactHashesVerified,true);assert.equal(r.newCryptographicVerificationPerformed,false);assert.equal(r.networkSubmitted,false);assert.equal(r.fullHistoryPrivacyPassed,false);
assert.equal(r.controls.length,2);assert(r.controls.every(c=>c.rejected));
assert.equal(r.sourceSha256,sha(readFileSync('contracts/experimental/line-private-offer.compact')));
assert.equal(r.publicCorpusManifestSha256,sha(readFileSync(corpusPath)));assert.equal(r.nativeReportSha256,corpus.originalNativeReportSha256);
assert.equal(r.publicNativeReportSha256,sha(readFileSync(corpus.publicNativeReport)));
assert.deepEqual(Object.keys(r.scriptFingerprints).sort(),['scripts/private-offer-wire-review.mjs','scripts/native-public-components/src/main.rs','scripts/native-public-components/Cargo.toml','scripts/native-public-components/Cargo.lock'].sort());
for(const [p,h]of Object.entries(r.scriptFingerprints))assert.equal(sha(readFileSync(p)),h);
for(const e of corpus.entries)assert.equal(sha(readFileSync(join('tests/fixtures/private-offer-public-pairs',e.file))),e.transactionSha256);
for(const [i,p]of r.pairs.entries()){const left=corpus.entries[2*i],right=corpus.entries[2*i+1];assert.equal(p.leftIndex,left.index);assert.equal(p.rightIndex,right.index);assert.equal(p.leftTransactionSha256,left.transactionSha256);assert.equal(p.rightTransactionSha256,right.transactionSha256);}
assert.equal(r.nativeReaderSha256,sha(readFileSync(resolve(binary??`.compact-keys/native-proof-target/debug/line-native-public-components${process.platform==='win32'?'.exe':''}`))));
r.gitNormalizedScriptFingerprints=Object.fromEntries(Object.keys(r.scriptFingerprints).map(p=>[p,sha(readFileSync(p,'utf8').replaceAll('\r\n','\n'))]));
r.fingerprintScope='Exact runtime files/binary identify this read-only analysis. LF-normalized fingerprints correlate Git source and do not establish another execution.';
writeFileSync('docs/private-signed-2026-10-11-evidence/offer-native-wire.json',JSON.stringify(r,null,2)+'\n');
console.log(JSON.stringify({publishedPairs:11,allMeasuredDeltasAccountedFor:true,newProofs:false,fullHistoryPrivacyPassed:false}));
