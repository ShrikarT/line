/** Native witness/IR evaluation of the restored financial path, without Docker.
 * The SDK supplies real serialized preimages to a Rust checker over stdin.
 * No mock proof is returned: proving is intentionally stopped after evaluation.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import * as RT from '@midnight-ntwrk/compact-runtime';
import * as L from '@midnight-ntwrk/ledger-v8';
import {NodeZkConfigProvider} from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {setNetworkId} from '@midnight-ntwrk/midnight-js-network-id';
import {runRecoverableOfferCompact} from './recoverable-offer-compact.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const source='contracts/experimental/line-private-offer.compact',sourceHash=hash(readFileSync(source));
assert(process.argv[2]&&process.argv[3],'Provide full managed keys and fresh generated recovery bindings.');
const dir=resolve(process.argv[2]),checkedDir=resolve(process.argv[3]),checked=json(join(dirname(checkedDir),'evidence.json'));
assert.equal(checked.schema,'line-recoverable-offer-compact/v1');assert.equal(checked.freshCompilation,true);assert.equal(checked.sourceBindingVerifiedByThisRun,true);
assert.equal(checked.sourceSha256,sourceHash);assert.equal(checked.storageSubprocessInvocations,20);
for(const p of ['contract/index.js','compiler/contract-info.json']){assert.equal(hash(readFileSync(join(dir,p))),checked.artifactFingerprints[p]);assert.equal(hash(readFileSync(join(checkedDir,p))),checked.artifactFingerprints[p]);}
const native=resolve('.compact-keys/native-proof-target/debug',process.platform==='win32'?'line-native-preimage-checker.exe':'line-native-preimage-checker');
const nativeHash=hash(readFileSync(native)),info=json(join(dir,'compiler/contract-info.json'));
const artifacts=Object.fromEntries(['contract/index.js','compiler/contract-info.json',...info.circuits.flatMap(({name})=>[
 `keys/${name}.verifier`,`zkir/${name}.bzkir`,`zkir/${name}.zkir`])].map(p=>{const b=readFileSync(join(dir,p));return[p,{sha256:hash(b),bytes:b.length}];}));
const manifest=json(join(dirname(dir),'key-generation.json'));
assert.equal(manifest.complete,true);assert.equal(manifest.sourceSha256,sourceHash);assert.equal(manifest.compiler,'0.31.1');
assert.deepEqual(manifest.circuits.map(c=>c.name).sort(),info.circuits.map(c=>c.name).sort());
for(const c of manifest.circuits){assert.equal(artifacts['zkir/'+c.name+'.zkir'].sha256,c.zkirSha256);
 for(const [p,pinned]of Object.entries(c.artifacts))if(artifacts[p])assert.deepEqual(artifacts[p],pinned);}
const files=['scripts/recoverable-offer-preimage-check.mjs','scripts/recoverable-offer-compact.mjs','scripts/private-finance-child.mjs','scripts/private-finance-journal.mjs',
 'scripts/durable-approval-actor.mjs','scripts/durable-approval-signer.mjs','scripts/private-offer-signers.mjs','scripts/private-offer-encoding.mjs','scripts/private-pool-spike.mjs',
 'scripts/signed-pool-signers.mjs','server/checkout-storage.ts','src/lib/security/vault-codec.ts','src/lib/line/encoding.ts',
 'scripts/native-preimage-checker/src/main.rs','scripts/native-preimage-checker/Cargo.toml','scripts/native-preimage-checker/Cargo.lock'];
const scriptFingerprints=Object.fromEntries(files.map(p=>[p,hash(readFileSync(p))]));
mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/recovery-preimage-check-'));
const checks=[],negativeChecks=[];let complete=false,fixture,failure,address,operations;
const checkpoint=()=>writeFileSync(join(work,'verification.json'),JSON.stringify({schema:'line-recoverable-offer-preimage-check/v1',createdAt:new Date().toISOString(),complete,
 sourceSha256:sourceHash,nativeCheckerSha256:nativeHash,scriptFingerprints,artifacts,generatedPrerequisiteSha256:hash(readFileSync(join(dirname(checkedDir),'evidence.json'))),checks,negativeChecks,...(failure?{failure}:{}),
 financialStorageInvocations:fixture?.storageSubprocessInvocations??0,sourceBoundGeneratedBindings:true,
 cryptographicProofsGenerated:false,nativeProofVerificationPerformed:false,networkSubmitted:false,authenticAssetSettlement:false,fullHistoryPrivacyPassed:false,
 evidenceScope:'Native ZKIR witness/constraint evaluation of six restored lifecycle candidates. No proof bytes or witness values retained; no cryptographic proof, network finality, custody or privacy certification.'},null,2)+'\n');
setNetworkId('preview');const zk=new NodeZkConfigProvider(dir),parameters=L.LedgerState.blank('preview').parameters;
function evaluate(preimage,name,corruption){
 const result=spawnSync(native,[join(dir,'zkir',name+'.bzkir'),...(corruption?[corruption]:[])],{input:Buffer.from(preimage),encoding:'utf8',timeout:60_000,maxBuffer:100_000});
 if(result.error)throw Error('Native preimage checker could not execute.');
 if(corruption){assert.equal(result.status,1);const expected=corruption==='--append-private-transcript'?'transcript_length':'communications_commitment';
  assert(result.stderr.includes('PREIMAGE_CHECK_REJECTED:'+expected));negativeChecks.push({circuit:name,corruption:corruption.slice(2),rejected:true,category:expected});return;
 }
 if(result.status!==0){const code=(result.stderr.match(/PREIMAGE_CHECK_REJECTED:([a-z_]+)/)||[])[1]??'unknown';throw Error('Native preimage rejected: '+code);}
 const parsed=JSON.parse(result.stdout);assert.equal(parsed.nativePreimageCheckPassed,true);assert(Array.isArray(parsed.statementSkipPattern));return parsed;
}
try{
 checkpoint();
 await runRecoverableOfferCompact({compiledDir:dir,
  async onInitialize({initial,sourceHash:actual}){
   assert.equal(actual,sourceHash);for(const {name}of info.circuits){const op=new RT.ContractOperation();op.verifierKey=await zk.getVerifierKey(name);initial.currentContractState.setOperation(name,op);}
   operations=L.ContractState.deserialize(initial.currentContractState.serialize());address=new L.ContractDeploy(operations).address;return {contractAddress:address};
  },
  async onAccepted({name,role,seconds,nextState,result,initialQueryContext}){
   const context=new L.QueryContext(new L.ChargedState(L.StateValue.decode(initialQueryContext.state.state.encode())),address);
   context.block=initialQueryContext.block;context.effects=initialQueryContext.effects;
   let partition=context;for(const entry of result.context.currentQueryContext.comIndices)partition=partition.insertCommitment(...entry);
   const data=result.proofData,parts=L.partitionTranscripts([new L.PreTranscript(partition,data.publicTranscript)],parameters);assert.equal(parts.length,1);
   const call=new L.ContractCallPrototype(address,name,operations.operation(name),parts[0][0],parts[0][1],data.privateTranscriptOutputs,data.input,data.output,L.communicationCommitmentRandomness(),name);
   const tx=L.Transaction.fromPartsRandomized('preview',undefined,undefined,L.Intent.new(new Date((seconds+3600)*1000)).addCall(call));
   let captured=false;const marker='CHECK_ONLY_PROVING_STOPPED';
   try{await tx.prove({async check(preimage){const checked=evaluate(preimage,name);return checked.statementSkipPattern.map(x=>x===null?undefined:BigInt(x));},
    async prove(preimage){const checked=evaluate(preimage,name);evaluate(preimage,name,'--corrupt-communications-commitment');evaluate(preimage,name,'--append-private-transcript');
     checks.push({circuit:name,role,passed:true,statementBlocks:checked.statementBlocks,skippedBlocks:checked.skippedBlocks});captured=true;checkpoint();throw Error(marker);}
   },L.CostModel.initialCostModel());assert.fail('Check-only evaluation must never generate a proof.');}
   catch(error){if(!captured||!String(error.message).includes(marker))throw error;}
   console.log(JSON.stringify({circuit:name,result:'native-preimage-evaluation-passed',proofGenerated:false}));return {observedPublicState:nextState};
  },async onComplete(report){fixture=report;}
 });
 assert.equal(checks.length,6);assert.equal(negativeChecks.length,12);assert.equal(fixture.storageSubprocessInvocations,20);
 for(const [p,h]of Object.entries(scriptFingerprints))assert.equal(hash(readFileSync(p)),h,'Checker harness changed.');assert.equal(hash(readFileSync(native)),nativeHash);
 for(const [p,pinned]of Object.entries(artifacts))assert.equal(hash(readFileSync(join(dir,p))),pinned.sha256,'Checker artifact changed.');
 complete=true;checkpoint();console.log(JSON.stringify({complete,checks:checks.length,report:join(work,'verification.json')}));
}catch(error){const code=String(error.message).match(/Native preimage rejected: ([a-z_]+)/)?.[1];
 failure={errorClass:error.name,category:code??'harness_or_encoding_failure'};checkpoint();
 console.error('Native preimage diagnostic failed: '+failure.category);process.exitCode=1;
}
