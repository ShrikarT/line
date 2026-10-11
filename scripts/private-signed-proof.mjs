#!/usr/bin/env node
/** Real local proofs for the twelve-circuit private-finance candidate.
 * Synthetic ledger/time, fee balancing disabled, no wallet or submission.
 * The trusted coordinator/prover sees financial witnesses and approvals;
 * role signing scalars stay inside the fixture signer child processes.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import * as RT from '@midnight-ntwrk/compact-runtime';
import * as L from '@midnight-ntwrk/ledger-v8';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { runPrivateSignedFixture } from './private-signed-spike.mjs';

const ZERO='0'.repeat(64),endpoint='http://127.0.0.1:6301',source='contracts/experimental/line-private-signed.compact';
const digest=value=>createHash('sha256').update(value).digest('hex');
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const manage=action=>new Promise((yes,no)=>{
 const child=spawn(process.execPath,['scripts/private-pool-provers.mjs',action,'issuer'],{stdio:'inherit'});
 child.on('error',no);child.on('close',code=>code===0?yes():no(Error(`Owned coordinator prover ${action} failed.`)));
});

async function main(){
 const recycleProver=process.argv.includes('--recycle-prover');
 assert(process.argv[2],'Provide the full compiled managed directory.');
 const checkedIndex=process.argv.indexOf('--compiled-check');
 const checkedPath=checkedIndex>=0?process.argv[checkedIndex+1]:process.argv[3];
 assert(checkedPath&&!checkedPath.startsWith('--'),'Provide a source-bound generated fixture directory as the second argument or with --compiled-check.');
 const dir=resolve(process.argv[2]),checkedDir=resolve(checkedPath);
 const info=readJson(join(dir,'compiler/contract-info.json')),checked=readJson(join(dirname(checkedDir),'evidence.json'));
 const sourceSha256=digest(readFileSync(source));
 assert.equal(checked.schema,'line-private-signed-feasibility/v1');
 assert.equal(checked.sourceSha256,sourceSha256);assert.equal(checked.freshCompilation,true);
 assert.equal(checked.sourceBindingVerifiedByThisRun,true);assert.equal(info['compiler-version'],'0.31.1');
 assert.equal(info['runtime-version'],'0.16.0');
 assert.deepEqual(info.circuits.map(c=>c.name).sort(),readJson('contracts/managed/line/compiler/contract-info.json').circuits.map(c=>c.name).sort());
 for(const file of ['contract/index.js','compiler/contract-info.json']){
  const pinned=digest(readFileSync(join(checkedDir,file)));
  assert.equal(pinned,checked.artifactFingerprints[file]);assert.equal(digest(readFileSync(join(dir,file))),pinned);
 }
 const files=['contract/index.js','compiler/contract-info.json',...info.circuits.flatMap(({name})=>[
  `keys/${name}.prover`,`keys/${name}.verifier`,`zkir/${name}.bzkir`])];
 const artifacts=Object.fromEntries(files.map(file=>{
  const data=readFileSync(join(dir,file));assert(data.length>0,`Full key generation incomplete: ${file}`);
  return [file,{sha256:digest(data),bytes:data.length}];
 }));
 const keyManifestPath=join(dirname(dir),'key-generation.json');
 const keyGeneration=existsSync(keyManifestPath)?readJson(keyManifestPath):null;
 if(keyGeneration){
  assert.equal(keyGeneration.sourceSha256,sourceSha256);assert.equal(keyGeneration.complete,true);
  assert.equal(keyGeneration.compiler,'0.31.1');
  assert.deepEqual(keyGeneration.circuits.map(c=>c.name).sort(),info.circuits.map(c=>c.name).sort());
  for(const circuit of keyGeneration.circuits){
   assert.equal(digest(readFileSync(join(dir,'zkir',circuit.name+'.zkir'))),circuit.zkirSha256);
   for(const [file,pinned]of Object.entries(circuit.artifacts))assert.deepEqual(artifacts[file],pinned);
  }
 }
 const native=resolve('.compact-keys/native-proof-target/debug',process.platform==='win32'?'line-native-proof-verifier.exe':'line-native-proof-verifier');
 assert(existsSync(native),'Build the native verifier first.');
 const scriptFingerprints=Object.fromEntries(['scripts/private-signed-proof.mjs','scripts/private-pool-provers.mjs','scripts/private-signed-spike.mjs','scripts/signed-pool-signers.mjs',
  'scripts/private-pool-spike.mjs','src/lib/line/encoding.ts'].map(file=>[file,digest(readFileSync(file))]));
 mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/private-signed-proof-'));
 const traces=[],negativeChecks=[];
 let local=L.LedgerState.blank('preview'),deploy,version,ownedProver=false,complete=false,fixtureReport,failure,stage='initialization',lastProvenCircuit,proverRestarts=0;
 const report=()=>({schema:'line-private-signed-proof/v1',createdAt:new Date().toISOString(),complete,sourceSha256,artifacts,scriptFingerprints,
  nativeVerifierSha256:digest(readFileSync(native)),proofServerVersion:version??null,
  sourceBoundGeneratedExecutable:true,checkedGeneratedDirectory:checkedDir,
  ...(keyGeneration?{keyGeneration}:{}),
  syntheticLedger:true,syntheticTime:true,feeBalancingEnabled:false,networkSubmitted:false,authenticAssetSettlement:false,
  trustedCoordinatorAndProver:true,roleSigningScalarsInProverWitnesses:false,institutionalSignerPolicy:false,
  recycleProverOnCircuitChange:recycleProver,proverRestarts,
  durableInstitutionalCustody:false,fullHistoryPrivacyPassed:false,
  exportedCircuits:info.circuits.map(c=>c.name),provedCircuits:[...new Set(traces.map(t=>t.circuit).filter(n=>n!=='syntheticDeployment'))],
  traces,negativeChecks,...(fixtureReport?{generatedFixtureChecks:fixtureReport.negativeChecks.length}:{}),
  ...(failure?{failure}:{}),evidenceScope:'Native Rust real proof verification against a synthetic public ledger. No network finality, token payouts, custody certification or complete privacy claim.'});
 const checkpoint=()=>writeFileSync(join(work,'verification.json'),JSON.stringify(report(),null,2)+'\n');
 const nativeVerify=(tx,name,seconds)=>{
  const statePath=join(work,`${traces.length}-${name}.public-state.bin`),txPath=join(work,`${traces.length}-${name}.proven-public-tx.bin`);
  writeFileSync(statePath,local.serialize());writeFileSync(txPath,tx.serialize());
  const result=spawnSync(native,[statePath,txPath,String(seconds)],{encoding:'utf8',timeout:60_000});
  if(result.error)throw result.error;return result;
 };
 const strict=new L.WellFormedStrictness();strict.enforceBalancing=false;strict.verifyNativeProofs=true;
 strict.verifyContractProofs=true;strict.enforceLimits=true;strict.verifySignatures=true;
 function apply(tx,name,role,seconds){
  const verified=nativeVerify(tx,name,seconds);assert.equal(verified.status,0,'Independent native proof verification rejected.');
  assert.match(verified.stdout,/CRYPTOGRAPHIC_VERIFICATION_PASSED/);
  const time=BigInt(seconds),wellFormed=tx.wellFormed(local,strict,new Date(seconds*1000));
  const [next,result]=local.apply(wellFormed,new L.TransactionContext(local,{secondsSinceEpoch:time,secondsSinceEpochErr:0,parentBlockHash:ZERO,lastBlockTime:time-1n}));
  assert.equal(result.type,'success','Native-verified synthetic transition must apply.');local=next;
  traces.push({circuit:name,actor:role,syntheticUnixSeconds:seconds,proofVerifiedInSeparateRustProcess:true,
   transactionSha256:digest(tx.serialize()),bytes:tx.serialize().length});checkpoint();
  console.log(JSON.stringify({stage:name,result:'real-proof-and-native-verification-passed',acceptedCalls:traces.length-1}));
 }
 try{
  checkpoint();
  // This run owns its prover lifecycle. Refuse an already-existing container
  // even if labeled correctly, rather than stopping another run's resources.
  const inspected=spawnSync('docker',['inspect','line-pool-proof-issuer'],{encoding:'utf8',timeout:15_000});
  if(inspected.error)throw inspected.error;
  assert(inspected.status!==0,'Coordinator prover already exists; do not take ownership of another run.');
  assert.match(inspected.stderr,/No such (object|container)/i);
  ownedProver=true;await manage('start');
  version=(await (await fetch(`${endpoint}/version`,{signal:AbortSignal.timeout(5000)})).text()).trim().replace(/^"|"$/g,'');
  assert.equal(version,'8.1.3');setNetworkId('preview');
  const zk=new NodeZkConfigProvider(dir),provider=httpClientProofProvider(endpoint,zk,{timeout:600_000});
  await runPrivateSignedFixture({compiledDir:dir,
   async onInitialize({initial,sourceHash,now}){
    assert.equal(sourceHash,sourceSha256);
    const state=initial.currentContractState;
    for(const {name}of info.circuits){const op=new RT.ContractOperation();op.verifierKey=await zk.getVerifierKey(name);state.setOperation(name,op);}
    deploy=new L.ContractDeploy(L.ContractState.deserialize(state.serialize()));
    const tx=L.Transaction.fromParts('preview',undefined,undefined,L.Intent.new(new Date((now+3600)*1000)).addDeploy(deploy));
    apply((await provider.proveTx(tx)).bind(),'syntheticDeployment','fixture',now);
    return {contractAddress:deploy.address};
   },
   async onAccepted({role,name,seconds,input,nextState,result,initialQueryContext}){
    if(recycleProver&&lastProvenCircuit&&lastProvenCircuit!==name){
     stage=`${name}:recycle-prover`;await manage('stop');await manage('start');proverRestarts++;
     const restarted=(await (await fetch(`${endpoint}/version`,{signal:AbortSignal.timeout(5000)})).text()).trim().replace(/^"|"$/g,'');
     assert.equal(restarted,'8.1.3');checkpoint();
    }
    stage=`${name}:construct`;
    const current=local.index(deploy.address),expectedInput=RT.ContractState.deserialize(input);
    assert.deepEqual(current.data.state.encode(),expectedInput.data.state.encode(),'Fixture and verified ledger must start from the same state.');
    const context=new L.QueryContext(new L.ChargedState(L.StateValue.decode(initialQueryContext.state.state.encode())),deploy.address);
    context.block=initialQueryContext.block;context.effects=initialQueryContext.effects;
    let partitionContext=context;
    for(const entry of result.context.currentQueryContext.comIndices)partitionContext=partitionContext.insertCommitment(...entry);
    const data=result.proofData,parts=L.partitionTranscripts([new L.PreTranscript(partitionContext,data.publicTranscript)],local.parameters);
    assert.equal(parts.length,1);
    const prototype=new L.ContractCallPrototype(deploy.address,name,current.operation(name),parts[0][0],parts[0][1],
     data.privateTranscriptOutputs,data.input,data.output,L.communicationCommitmentRandomness(),name);
    const tx=L.Transaction.fromPartsRandomized('preview',undefined,undefined,L.Intent.new(new Date((seconds+3600)*1000)).addCall(prototype));
    console.log(JSON.stringify({stage:name,result:'constructed',next:'real-proof-generation'}));
    stage=`${name}:prove`;
    const provingStarted=Date.now();
    const proven=(await provider.proveTx(tx)).bind();
    const provingDurationMs=Date.now()-provingStarted;
    if(name==='draw'){
     const proof=[...proven.intents.values()].flatMap(i=>i.actions).find(a=>a.entryPoint==='draw').proof.serialize();
     assert(proof.length>64);
     const raw=Buffer.from(proven.serialize()),interior=Buffer.from(proof.slice(Math.floor(proof.length/2),Math.floor(proof.length/2)+32)),offset=raw.indexOf(interior);
     assert(offset>=0&&raw.indexOf(interior,offset+1)<0);raw[offset]^=1;
     const tampered=L.Transaction.deserialize('signature','proof','binding',raw);
     const altered=[...tampered.intents.values()].flatMap(i=>i.actions).find(a=>a.entryPoint==='draw').proof.serialize();
     assert(!Buffer.from(altered).equals(Buffer.from(proof)));
     const bad=nativeVerify(tampered,'corrupted-draw',seconds);assert.equal(bad.status,1);
     assert.match(bad.stderr+bad.stdout,/NATIVE_WELL_FORMED_REJECTED:.*proof/i);
     negativeChecks.push({circuit:name,decodableProofCorruption:true,rejectedByNativeCryptographicVerifier:true});checkpoint();
    }
    const verificationStarted=Date.now();apply(proven,name,role,seconds);
    Object.assign(traces.at(-1),{provingDurationMs,verificationAndApplyDurationMs:Date.now()-verificationStarted});
    lastProvenCircuit=name;checkpoint();
    assert.deepEqual(local.index(deploy.address).data.state.encode(),RT.ContractState.deserialize(nextState).data.state.encode(),'Proven transition must match generated Compact execution.');
   },
   async onComplete(report){fixtureReport=report;}
  });
  assert.deepEqual([...new Set(traces.map(t=>t.circuit).filter(n=>n!=='syntheticDeployment'))].sort(),info.circuits.map(c=>c.name).sort());
  assert(negativeChecks.length>0);assert.equal(digest(readFileSync(source)),sourceSha256);
  for(const [file,pinned]of Object.entries(scriptFingerprints))assert.equal(digest(readFileSync(file)),pinned,'Proof harness changed during execution.');
  complete=true;checkpoint();
  console.log(JSON.stringify({result:'ALL TWELVE PRIVATE-FINANCE CIRCUITS VERIFIED LOCALLY; COMPLETE PRIVACY UNPROVEN',evidence:join(work,'verification.json')}));
 }catch(error){
  const httpStatus=String(error.message).match(/Failed Proof Server response: url="http:\/\/127\.0\.0\.1:6301\/[^"\s]+", code="(\d+)"/);
  failure={stage,errorClass:error.name,...(httpStatus?{loopbackProverHttpStatus:Number(httpStatus[1])}:{}),
   redactedReason:String(error.message).replace(/[0-9a-fA-F]{32,}/g,'[redacted bytes]').replace(/\b\d{8,}\b/g,'[redacted number]').slice(0,300),
   stackFrames:String(error.stack??'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,5)};
  if(ownedProver){
   const diagnostic=spawnSync('docker',['logs','--tail','40','line-pool-proof-issuer'],{encoding:'utf8',timeout:15_000});
   // Only diagnostic categories from this synthetic run; never retain payloads
   // or log raw witness/preimage bytes in the public evidence report.
   const lines=(diagnostic.stdout+'\n'+diagnostic.stderr).split('\n').filter(line=>/panicked|ERROR|check.*failed|invalid|constraint/i.test(line));
   failure.proverDiagnostic=lines.map(line=>line.replace(/[0-9a-fA-F]{32,}/g,'[redacted bytes]').replace(/\b\d{8,}\b/g,'[redacted number]').slice(0,400)).slice(-6);
  }
  checkpoint();throw error;
 }
 finally{
  if(ownedProver){try{await manage('stop');}catch(error){console.error(`Owned prover cleanup failed (${error.name}).`);if(!failure)throw error;}}
 }
}
main().catch(error=>{console.error(`Private-finance proof run failed (${error.name}).`);process.exitCode=1;});
