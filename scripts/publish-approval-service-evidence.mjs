/** Publish only fresh, current-source metadata; no TLS keys or witness bodies. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex'),path=process.argv[2];assert(path,'Provide fresh Compact evidence.');
const r=JSON.parse(readFileSync(path,'utf8'));
assert.equal(r.schema,'line-owner-approval-service-compact/v1');assert.equal(r.freshCompilation,true);assert.equal(r.traces.length,10);
assert.equal(r.controls.length,4);assert(r.controls.every(x=>x.rejectedByGeneratedCompact));assert.equal(r.owners,4);assert.equal(r.merchants,2);assert.equal(r.serviceRestarts,4);
assert.equal(r.sourceSha256,sha(readFileSync('contracts/experimental/line-private-offer.compact')));assert.equal(r.signingScalarWitnesses,0);
assert.equal(r.cryptographicProofsGenerated,false);assert.equal(r.networkSubmitted,false);assert.equal(r.fullHistoryPrivacyPassed,false);
for(const [p,h]of Object.entries(r.scriptFingerprints))assert.equal(sha(readFileSync(p)),h,'Owner API helper changed.');
for(const [p,h]of Object.entries(r.artifacts))assert.equal(sha(readFileSync(join(dirname(path),'managed',p))),h);
r.gitNormalizedScriptFingerprints=Object.fromEntries(Object.keys(r.scriptFingerprints).map(p=>[p,sha(readFileSync(p,'utf8').replaceAll('\r\n','\n'))]));
r.fingerprintScope='Runtime hashes identify exact files executed. LF-normalized hashes correlate Git source and do not establish another run.';
writeFileSync('docs/private-signed-2026-10-11-evidence/owner-api-compact.json',JSON.stringify(r,null,2)+'\n');
console.log(JSON.stringify({publishedCalls:10,ownerServices:4,controls:4,nativeProofs:false}));
