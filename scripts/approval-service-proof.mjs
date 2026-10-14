/** Real proofs for the four-owner, two-merchant mTLS path.
 * Separate Rust verification gates every generated-state advance.
 * Synthetic ledger/time, fee balancing disabled; no wallet or asset transfer.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import * as RT from '@midnight-ntwrk/compact-runtime';
import * as L from '@midnight-ntwrk/ledger-v8';
import {NodeZkConfigProvider} from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {setNetworkId} from '@midnight-ntwrk/midnight-js-network-id';
import {nativeLocalProvingProvider} from './native-local-proving-provider.mjs';
import {runApprovalServiceCompact} from './approval-service-compact.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),json=p=>JSON.parse(readFileSync(p,'utf8')),SOURCE='contracts/experimental/line-private-offer.compact';
assert(process.argv[2]&&process.argv[3],'Provide full keys and fresh owner-service generated bindings.');
const dir=resolve(process.argv[2]),checkedDir=resolve(process.argv[3]),checked=json(join(dirname(checkedDir),'evidence.json')),sourceHash=sha(readFileSync(SOURCE));
assert.equal(checked.schema,'line-owner-approval-service-compact/v1');assert.equal(checked.freshCompilation,true);assert.equal(checked.traces.length,10);assert.equal(checked.controls.length,4);assert.equal(checked.serviceRestarts,4);assert.equal(checked.sourceSha256,sourceHash);
for(const [p,h]of Object.entries(checked.scriptFingerprints))assert.equal(sha(readFileSync(p)),h,'Fresh owner fixture differs from proof driver input.');
for(const [p,h]of Object.entries(checked.artifacts)){assert.equal(sha(readFileSync(join(checkedDir,p))),h);assert.equal(sha(readFileSync(join(dir,p))),h);}
const info=json(join(dir,'compiler/contract-info.json')),manifest=json(join(dirname(dir),'key-generation.json'));
assert.equal(manifest.complete,true);assert.equal(manifest.sourceSha256,sourceHash);assert.equal(manifest.compiler,'0.31.1');
assert.deepEqual(manifest.circuits.map(c=>c.name).sort(),info.circuits.map(c=>c.name).sort());
const artifacts=Object.fromEntries(['contract/index.js','compiler/contract-info.json',...info.circuits.flatMap(({name})=>[`keys/${name}.prover`,`keys/${name}.verifier`,`zkir/${name}.bzkir`])].map(p=>{const b=readFileSync(join(dir,p));return[p,{sha256:sha(b),bytes:b.length}];}));
for(const c of manifest.circuits){assert.equal(sha(readFileSync(join(dir,'zkir',c.name+'.zkir'))),c.zkirSha256);for(const [p,h]of Object.entries(c.artifacts))assert.deepEqual(artifacts[p],h);}
const native=(profile,name)=>resolve('.compact-keys/native-proof-target',profile,name+(process.platform==='win32'?'.exe':''));
const verifier=native('debug','line-native-proof-verifier'),checker=native('debug','line-native-preimage-checker'),prover=native('release','line-native-local-prover');
const executables=Object.fromEntries([['verifier',verifier],['checker',checker],['prover',prover]].map(([name,p])=>{assert(existsSync(p));return[name,sha(readFileSync(p))];}));
const helperFiles=[...Object.keys(checked.scriptFingerprints),'scripts/approval-service-proof.mjs','scripts/native-local-proving-provider.mjs','scripts/native-proof-verifier/src/main.rs','scripts/native-proof-verifier/Cargo.toml','scripts/native-proof-verifier/Cargo.lock',
 'scripts/native-preimage-checker/src/main.rs','scripts/native-preimage-checker/src/bin/line-native-local-prover.rs','scripts/native-preimage-checker/Cargo.toml','scripts/native-preimage-checker/Cargo.lock'];
const scriptFingerprints=Object.fromEntries(helperFiles.map(p=>[p,sha(readFileSync(p))])),work=mkdtempSync(resolve('.compact-keys/owner-service-native-proof-'));
const traces=[],checks=[],negativeChecks=[];let complete=false,stage='initialization',failure,fixture,deploy,local=L.LedgerState.blank('preview');
const report=()=>({schema:'line-owner-approval-service-native-proof/v1',createdAt:new Date().toISOString(),complete,sourceSha256:sourceHash,artifacts,scriptFingerprints,nativeExecutables:executables,
 generatedPrerequisiteSha256:sha(readFileSync(join(dirname(checkedDir),'evidence.json'))),traces,checks,negativeChecks,
 owners:4,merchants:2,serviceRestarts:fixture?.serviceRestarts??0,generatedOwnershipAndReplayControls:fixture?.controls.length??0,
 syntheticLedger:true,syntheticTime:true,feeBalancingEnabled:false,networkSubmitted:false,authenticAssetSettlement:false,fullHistoryPrivacyPassed:false,
 independentAdministrativeCustody:false,signingScalarWitnesses:0,financialCheckpointDurable:false,completeCoordinatorRestart:false,allTwelveCircuitsCoveredByThisReport:false,
 ...(failure?{failure}:{}),evidenceScope:'Real local proofs of ten generated calls through four mTLS owner services and two merchants, verified in separate Rust processes. Same-host synthetic ownership, volatile financial state, no live fees/network/assets or full privacy claim.'});
const checkpoint=()=>writeFileSync(join(work,'verification.json'),JSON.stringify(report(),null,2)+'\n');
setNetworkId('preview');const zk=new NodeZkConfigProvider(dir),strict=new L.WellFormedStrictness();strict.enforceBalancing=false;strict.verifyNativeProofs=true;strict.verifyContractProofs=true;strict.enforceLimits=true;strict.verifySignatures=true;
function verify(tx,name,seconds){
 const statePath=join(work,`${traces.length}-${name}.public-state.bin`),txPath=join(work,`${traces.length}-${name}.proven-public-tx.bin`);
 writeFileSync(statePath,local.serialize());writeFileSync(txPath,tx.serialize());
 return spawnSync(verifier,[statePath,txPath,String(seconds)],{encoding:'utf8',timeout:60_000,maxBuffer:100_000});
}
function apply(tx,name,actor,seconds){
 const result=verify(tx,name,seconds);assert.equal(result.status,0,'Separate native verifier rejected.');assert.match(result.stdout,/CRYPTOGRAPHIC_VERIFICATION_PASSED/);
 const t=BigInt(seconds),formed=tx.wellFormed(local,strict,new Date(seconds*1000));
 const [next,outcome]=local.apply(formed,new L.TransactionContext(local,{secondsSinceEpoch:t,secondsSinceEpochErr:0,parentBlockHash:'0'.repeat(64),lastBlockTime:t-1n}));
 assert.equal(outcome.type,'success');local=next;traces.push({circuit:name,actor,proofVerifiedInSeparateRustProcess:true,transactionSha256:sha(tx.serialize()),bytes:tx.serialize().length});checkpoint();
 console.log(JSON.stringify({circuit:name,acceptedProofs:traces.length-1,nativeVerificationPassed:true}));
}
try{
 checkpoint();const provider=nativeLocalProvingProvider({managedDir:dir,checker,prover,parameterCache:join(work,'public-parameters'),
  onCheck:x=>{checks.push({stage,...x});checkpoint();},onDiagnostic:x=>{checks.push({stage,nativeProcessFailure:x});checkpoint();}});
 await runApprovalServiceCompact({compiledDir:dir,
  async onInitialize({initial,sourceHash:actual,now}){
   assert.equal(actual,sourceHash);for(const {name}of info.circuits){const op=new RT.ContractOperation();op.verifierKey=await zk.getVerifierKey(name);initial.currentContractState.setOperation(name,op);}
   deploy=new L.ContractDeploy(L.ContractState.deserialize(initial.currentContractState.serialize()));
   const tx=L.Transaction.fromParts('preview',undefined,undefined,L.Intent.new(new Date((now+3600)*1000)).addDeploy(deploy));
   apply((await tx.prove(provider,L.CostModel.initialCostModel())).bind(),'syntheticDeployment','fixture',now);return {contractAddress:deploy.address};
  },
  async onAccepted({role,name,seconds,input,nextState,result,initialQueryContext}){
   stage=name+':construct';const current=local.index(deploy.address);assert.deepEqual(current.data.state.encode(),RT.ContractState.deserialize(input).data.state.encode());
   const context=new L.QueryContext(new L.ChargedState(L.StateValue.decode(initialQueryContext.state.state.encode())),deploy.address);context.block=initialQueryContext.block;context.effects=initialQueryContext.effects;
   let partition=context;for(const entry of result.context.currentQueryContext.comIndices)partition=partition.insertCommitment(...entry);
   const data=result.proofData,parts=L.partitionTranscripts([new L.PreTranscript(partition,data.publicTranscript)],local.parameters);assert.equal(parts.length,1);
   const call=new L.ContractCallPrototype(deploy.address,name,current.operation(name),parts[0][0],parts[0][1],data.privateTranscriptOutputs,data.input,data.output,L.communicationCommitmentRandomness(),name);
   const tx=L.Transaction.fromPartsRandomized('preview',undefined,undefined,L.Intent.new(new Date((seconds+3600)*1000)).addCall(call));stage=name+':prove';
   const started=Date.now(),proven=(await tx.prove(provider,L.CostModel.initialCostModel())).bind(),duration=Date.now()-started;
   if(name==='draw'){
    const proof=[...proven.intents.values()].flatMap(i=>i.actions).find(a=>a.entryPoint==='draw').proof.serialize(),raw=Buffer.from(proven.serialize());
    const interior=Buffer.from(proof.slice(Math.floor(proof.length/2),Math.floor(proof.length/2)+32)),offset=raw.indexOf(interior);assert(offset>=0&&raw.indexOf(interior,offset+1)<0);raw[offset]^=1;
    const corrupted=L.Transaction.deserialize('signature','proof','binding',raw),bad=verify(corrupted,'corrupted-draw',seconds);
    assert.equal(bad.status,1);assert.match(bad.stderr+bad.stdout,/NATIVE_WELL_FORMED_REJECTED:.*proof/i);negativeChecks.push({circuit:'draw',decodableProofCorruption:true,rejectedByNativeCryptographicVerifier:true});
   }
   apply(proven,name,role,seconds);traces.at(-1).provingDurationMs=duration;checkpoint();assert.deepEqual(local.index(deploy.address).data.state.encode(),RT.ContractState.deserialize(nextState).data.state.encode());
  },async onComplete(r){fixture=r;}
 });
 assert.equal(traces.length,11);assert.equal(negativeChecks.length,2);assert.equal(fixture.serviceRestarts,4);assert.equal(fixture.controls.length,4);
 for(const [p,h]of Object.entries(scriptFingerprints))assert.equal(sha(readFileSync(p)),h,'Proof helper changed during execution.');
 for(const [p,h]of Object.entries(artifacts))assert.equal(sha(readFileSync(join(dir,p))),h.sha256);
 for(const [name,p]of [['verifier',verifier],['checker',checker],['prover',prover]])assert.equal(sha(readFileSync(p)),executables[name]);
 complete=true;checkpoint();console.log(JSON.stringify({complete:true,contractCalls:10,corruptedDrawRejections:2,report:join(work,'verification.json')}));
}catch(error){failure={stage,errorClass:error.name,category:String(error.message).includes('Native prover rejected')?'native_prover_failure':'driver_or_verification_failure'};checkpoint();console.error('Owner-service native proof run failed: '+failure.category);process.exitCode=1;}
