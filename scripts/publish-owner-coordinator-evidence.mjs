/** Publish bounded generated-execution metadata, never financial openings. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex'),path=process.argv[2];assert(path,'Provide the fresh coordinator evidence path.');
const r=JSON.parse(readFileSync(path,'utf8'));
assert.equal(r.schema,'line-recoverable-owner-coordinator/v1');assert.equal(r.freshCompilation,true);
assert.equal(r.sourceSha256,sha(readFileSync('contracts/experimental/line-private-offer.compact')));
assert.equal(r.traces.length,10);assert.equal(r.controls.length,6);assert.equal(r.crashes.length,8);
assert.equal(r.coordinatorProcessInvocations,46);assert.equal(r.owners,4);assert.equal(r.merchants,2);
for(const key of ['wholeExecutionWorkerReconstructed','nonzeroBasisPointPolicyExercised','financialCheckpointDurable',
 'authorizationIntentPersistedBeforeOwnerRPC','preparedCandidatePersistedBeforeResponse','preparedPacketReloadedWithoutFreshApproval'])assert.equal(r[key],true);
for(const key of ['coordinatorWitnessesReturnedToHarness','networkSubmitted','authenticAssetSettlement','cryptographicProofsGenerated',
 'nativeProofVerificationPerformed','independentAdministrativeCustody','fullHistoryPrivacyPassed'])assert.equal(r[key],false);
const helpers=['scripts/recoverable-owner-coordinator.mjs','scripts/private-owner-coordinator.mjs','scripts/private-finance-journal.mjs','server/checkout-storage.ts',
 'scripts/approval-owner-service.mjs','scripts/approval-service-frame.mjs','scripts/approval-owner-example-policy.mjs','scripts/durable-approval-signer.mjs','scripts/durable-approval-actor.mjs',
 'scripts/private-offer-signers.mjs','scripts/signed-pool-signers.mjs','scripts/private-offer-encoding.mjs','scripts/private-pool-spike.mjs',
 'src/lib/security/vault-codec.ts','src/lib/line/encoding.ts','tests/fixtures/approval-service-tls.mjs',
 'scripts/private-coordinator-proving.mjs','scripts/native-local-proving-provider.mjs','scripts/private-worker-guardian.mjs',
 'scripts/private-finance-network.mjs','scripts/finalized-contract-receipt.mjs','src/lib/runtime/endpoints.ts'];
assert.deepEqual(Object.keys(r.scriptFingerprints).sort(),helpers.sort());
for(const p of helpers)assert.equal(sha(readFileSync(p)),r.scriptFingerprints[p],'Coordinator helper changed since execution.');
assert.deepEqual(Object.keys(r.artifacts).sort(),['contract/index.js','compiler/contract-info.json'].sort());
for(const [p,h]of Object.entries(r.artifacts))assert.equal(sha(readFileSync(join(dirname(path),'managed',p))),h);
assert(r.traces.every(x=>x.wholeExecutionWorkerReconstructed&&x.exactPreparedPacketRestored&&x.signingScalarWitnesses===0));
assert(r.crashes.every(x=>x.exitCode===23));
assert(r.controls.every(x=>x.rejected===true||(x.exactRetryConfirmed===true&&x.changedRequestRejected===true)));
// Explicit fields avoid publishing unrelated raw fixture data if the input grows.
const keys=['schema','createdAt','sourceSha256','scriptFingerprints','artifacts','freshCompilation','traces','controls','crashes',
 'coordinatorProcessInvocations','wholeExecutionWorkerReconstructed','coordinatorWitnessesReturnedToHarness','owners','merchants',
 'nonzeroBasisPointPolicyExercised','financialCheckpointDurable','authorizationIntentPersistedBeforeOwnerRPC',
 'preparedCandidatePersistedBeforeResponse','preparedPacketReloadedWithoutFreshApproval','networkSubmitted','authenticAssetSettlement',
 'cryptographicProofsGenerated','nativeProofVerificationPerformed','independentAdministrativeCustody','fullHistoryPrivacyPassed','evidenceScope'];
assert.deepEqual(Object.keys(r).sort(),keys.sort());
const published=Object.fromEntries(keys.map(k=>[k,r[k]]));
published.gitNormalizedScriptFingerprints=Object.fromEntries(helpers.map(p=>[p,sha(readFileSync(p,'utf8').replaceAll('\r\n','\n'))]));
published.fingerprintScope='Runtime hashes identify exact files executed. LF-normalized hashes correlate Git source and do not establish another run.';
writeFileSync('docs/private-signed-2026-10-11-evidence/owner-coordinator-recovery.json',JSON.stringify(published,null,2)+'\n');
console.log(JSON.stringify({publishedCalls:10,abruptExits:8,executionWorkers:46,nativeProofs:false,networkSubmitted:false}));
