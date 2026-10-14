#!/usr/bin/env node
/** Real local proofs for the experimental pool's custody/membership path.
 * Synthetic ledger, no fee balancing, wallet, submission or assets. Actor
 * signing keys never cross IPC; each configured prover sees private inputs.
 */
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { join, resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as RT from '@midnight-ntwrk/compact-runtime';
import * as L from '@midnight-ntwrk/ledger-v8';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { commit, startActor } from './private-pool-spike.mjs';
import { proverUrls } from './private-pool-provers.mjs';

const ZERO='0'.repeat(64),bytes=()=>new Uint8Array(randomBytes(32));
const digest=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>Buffer.from(value).toString('hex');
async function main(){
 const isolatedProvers=process.argv.includes('--isolated-provers');
 const ephemeralProvers=process.argv.includes('--ephemeral-provers');
 assert(!ephemeralProvers||isolatedProvers,'Ephemeral role provers require --isolated-provers.');
 let runningRole;
 const manage=(action,role)=>new Promise((yes,no)=>{
  const child=spawn(process.execPath,['scripts/private-pool-provers.mjs',action,role],{stdio:'inherit'});
  child.on('error',no);child.on('close',code=>code===0?yes():no(Error(`Role prover ${action} failed: ${code}`)));
 });
 async function activate(role){
  if(!ephemeralProvers||role===runningRole)return;
  // No other proof request remains in flight: every call below is awaited.
  // Discard only a completed previous role's owned prover and its caches.
  if(runningRole)await manage('stop',runningRole);
  await manage('start',role);runningRole=role;
 }
 assert(process.argv[2],'Provide the managed directory from a full pool compile.');
 const dir=resolve(process.argv[2]),feasibility=JSON.parse(readFileSync(join(dirname(dir),'evidence.json'),'utf8'));
 assert(feasibility.fullProvingArtifactsGenerated,'A --skip-zk run cannot supply proving artifacts.');
 assert.equal(feasibility.sourceSha256,digest(readFileSync('contracts/experimental/line-pool.compact')),'Experimental source changed after compilation.');
 const info=JSON.parse(readFileSync(join(dir,'compiler/contract-info.json'),'utf8'));
 assert.equal(info['compiler-version'],'0.31.1');assert.equal(info['runtime-version'],'0.16.0');
 const original=JSON.parse(readFileSync('contracts/managed/line/compiler/contract-info.json','utf8'));
 assert.deepEqual(info.circuits.map(c=>c.name).sort(),original.circuits.map(c=>c.name).sort());
 const native=resolve('.compact-keys/native-proof-target/debug',process.platform==='win32'?'line-native-proof-verifier.exe':'line-native-proof-verifier');
 assert(existsSync(native),'Build the native verifier with npm run proof:native:build.');
 const nativeVerifierSha256=digest(readFileSync(native));
 mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/pool-proof-'));
 // Default: freshly compile. A prior successful generated-execution snapshot
 // is also an explicit source-bound comparison, not a substitute/mock contract.
 const checkFlag=process.argv.indexOf('--compiled-check');let checkedDir;
 if(checkFlag>=0){
  assert(process.argv[checkFlag+1],'Provide a previously tested managed directory.');
  checkedDir=resolve(process.argv[checkFlag+1]);
  const checked=JSON.parse(readFileSync(join(dirname(checkedDir),'evidence.json'),'utf8'));
  assert.equal(checked.schema,'line-private-pool-feasibility/v1');
  assert.equal(checked.sourceSha256,feasibility.sourceSha256,'Checked snapshot source mismatch.');
  assert.equal(checked.compiler,'0.31.1');assert.equal(checked.runtime,'0.16.0');
  for(const file of ['contract/index.js','compiler/contract-info.json'])
   assert.equal(checked.artifactFingerprints?.[file],digest(readFileSync(join(checkedDir,file))),'Checked snapshot artifact drift.');
 }else{
  checkedDir=join(work,'fresh');
  const check=spawnSync(process.execPath,['scripts/compile-compact.mjs','--skip-zk','contracts/experimental/line-pool.compact',checkedDir],{encoding:'utf8',timeout:120_000});
  if(check.error)throw check.error;assert.equal(check.status,0,check.stderr||check.stdout);
 }
 assert.equal(digest(readFileSync(join(dir,'contract/index.js'))),digest(readFileSync(join(checkedDir,'contract/index.js'))),'Managed pool executable drift.');
 assert.equal(digest(readFileSync(join(dir,'compiler/contract-info.json'))),digest(readFileSync(join(checkedDir,'compiler/contract-info.json'))),'Managed pool metadata drift.');
 await activate('issuer');
 const version=(await (await fetch('http://127.0.0.1:6301/version',{signal:AbortSignal.timeout(5000)})).text()).trim().replace(/^"|"$/g,'');assert.equal(version,'8.1.3');
 const files=['contract/index.js','compiler/contract-info.json',...info.circuits.flatMap(({name})=>[`keys/${name}.prover`,`keys/${name}.verifier`,`zkir/${name}.bzkir`])];
 const artifacts=Object.fromEntries(files.map(file=>[file,digest(readFileSync(join(dir,file)))]));
 const {Contract,ledger}=await import(pathToFileURL(join(dir,'contract/index.js')).href);
 const endpoint=role=>isolatedProvers?proverUrls[role]:'http://127.0.0.1:6301';
 const actors=[startActor('issuer',dir,'issuer',endpoint('issuer')),startActor('agent',dir,'agent-a',endpoint('agent-a')),startActor('agent',dir,'agent-b',endpoint('agent-b')),
  startActor('merchant',dir,'merchant-a',endpoint('merchant-a')),startActor('merchant',dir,'merchant-b',endpoint('merchant-b'))];
 const [issuer,a,b,ma,mb]=actors;let runFailed=false;
 try{
  const [i,aa,bb,mA,mB]=await Promise.all(actors.map(actor=>actor.ready));
  assert.equal(new Set((await Promise.all(actors.map(actor=>actor.ready))).map(r=>r.pid)).size,5);
  const forbidden=Object.fromEntries(info.witnesses.map(({name})=>[name,()=>{throw new Error('Coordinator holds no signing-key witness.');}]));
  const contract=new Contract(forbidden);
  const initialized=contract.initialState(RT.createConstructorContext({},ZERO),i.publicKey,mA.publicKey,bytes());
  const zk=new NodeZkConfigProvider(dir),state=initialized.currentContractState;
  for(const {name} of info.circuits){const op=new RT.ContractOperation();op.verifierKey=await zk.getVerifierKey(name);state.setOperation(name,op);}
  const deploy=new L.ContractDeploy(L.ContractState.deserialize(state.serialize()));setNetworkId('preview');
  const provider=httpClientProofProvider(endpoint('issuer'),zk,{timeout:600_000});
  let local=L.LedgerState.blank('preview');const traces=[],negativeChecks=[];
  const strict=new L.WellFormedStrictness();strict.enforceBalancing=false;strict.verifyNativeProofs=true;
  strict.verifyContractProofs=true;strict.enforceLimits=true;strict.verifySignatures=true;
  const currentState=()=>RT.ContractState.deserialize(local.index(deploy.address).serialize());
  const view=()=>ledger(currentState().data);
  const nativeVerify=(tx,label)=>{
   const statePath=join(work,`${label}.public-state.bin`),txPath=join(work,`${label}.proven-tx.bin`);
   writeFileSync(statePath,local.serialize());writeFileSync(txPath,tx.serialize());
   const result=spawnSync(native,[statePath,txPath,String(Math.floor(Date.now()/1000))],{encoding:'utf8',timeout:60_000});
   if(result.error)throw result.error;return {status:result.status,output:result.stdout+result.stderr};
  };
  const writeProgress=()=>writeFileSync(join(work,'progress.json'),JSON.stringify({schema:'line-private-pool-proof-progress/v1',
   complete:false,sourceSha256:feasibility.sourceSha256,proofServerVersion:version,commonProverUsed:!isolatedProvers,
   ephemeralRoleProvers:ephemeralProvers,
   artifacts,nativeVerifierSha256,
   compiledCheck:checkFlag>=0?'previously-source-bound-generated-execution':'fresh-pinned-compilation',
   feeBalancingEnabled:false,networkSubmitted:false,assetTransfers:false,fullHistoryPrivacyPassed:false,traces,negativeChecks},null,2)+'\n');
  const apply=(tx,name)=>{
   const verified=nativeVerify(tx,`${traces.length}-${name}`);assert.equal(verified.status,0,verified.output);
   const seconds=BigInt(Math.floor(Date.now()/1000)),wellFormed=tx.wellFormed(local,strict,new Date());
   const [next,result]=local.apply(wellFormed,new L.TransactionContext(local,{secondsSinceEpoch:seconds,secondsSinceEpochErr:0,parentBlockHash:ZERO,lastBlockTime:seconds-1n}));
   assert.equal(result.type,'success',result.error);local=next;
   traces.push({circuit:name,proofVerifiedInSeparateRustProcess:true,transactionSha256:digest(tx.serialize()),bytes:tx.serialize().length});
   writeProgress();
   console.log(JSON.stringify({stage:name,result:'real-proof-and-native-verification-passed'}));
  };
  const deployTx=L.Transaction.fromParts('preview',undefined,undefined,L.Intent.new(new Date(Date.now()+3_600_000)).addDeploy(deploy));
  apply((await provider.proveTx(deployTx)).bind(),'syntheticDeployment');
  async function invoke(actor,name,args,values={},accepted=true){
   if(accepted)await activate(actor.label);
   const result=await actor.request({state:currentState().serialize(),nativeState:local.serialize(),contractAddress:deploy.address,
    time:Math.floor(Date.now()/1000),name,args,values,prove:accepted});
   assert.equal(result.ok,accepted,result.error??'Unexpected acceptance.');
   if(!accepted){negativeChecks.push({circuit:name,actor:actor.label,rejectedBeforeProving:true});return;}
   assert(result.provenTx,'Actor must return a proven public transaction, never proof preimages.');
   const tx=L.Transaction.deserialize('signature','proof','binding',result.provenTx);
   if(name==='draw'){
    const raw=Buffer.from(result.provenTx),oldC=commit(values.bookOpening,values.salt);
    const publicData=result.publicTranscript+result.publicInput+result.publicOutput;
    assert(!publicData.includes(hex(values.bookOpening.identity)),'Borrower identity must not be re-disclosed in normalized public words.');
    assert(!publicData.includes(hex(values.salt)),'Input salt must not be re-disclosed in normalized public words.');
    assert(!raw.includes(Buffer.from(values.bookOpening.identity)),'Borrower identity must not appear in the proven public draw.');
    assert(!publicData.includes(hex(oldC)),'Selected old leaf must not be re-disclosed by the circuit.');
    assert(!raw.includes(Buffer.from(values.salt)),'Private book salt must not appear in the proven public draw.');
    const proof=[...tx.intents.values()].flatMap(intent=>intent.actions).find(action=>action.entryPoint==='draw').proof.serialize();
    const block=Buffer.from(proof.slice(Math.floor(proof.length/2),Math.floor(proof.length/2)+32)),offset=raw.indexOf(block);
    assert(offset>=0&&raw.indexOf(block,offset+1)<0,'Locate a unique interior proof block.');raw[offset]^=1;
    const tampered=L.Transaction.deserialize('signature','proof','binding',raw);
    const changed=[...tampered.intents.values()].flatMap(intent=>intent.actions).find(action=>action.entryPoint==='draw').proof.serialize();
    assert(!Buffer.from(changed).equals(Buffer.from(proof)),'Alter the actual draw proof.');
    const bad=nativeVerify(tampered,`${traces.length}-corrupted-draw`);
    assert.equal(bad.status,1);assert.match(bad.output,/NATIVE_WELL_FORMED_REJECTED:.*proof/i);
    negativeChecks.push({circuit:'draw',decodableProofCorruption:true,rejectedByNativeCryptographicVerifier:true});
   }
   apply(tx,name);const expected=ledger(RT.ContractState.deserialize(result.state).data),actual=view();
   assert.equal(actual.books.root().field,expected.books.root().field);assert.equal(actual.spentBooks.size(),expected.spentBooks.size());
  }
  const domain=view().contractDomain,expiry=BigInt(Math.floor(Date.now()/1000)+86400);
  const fresh=(identity,limit)=>({domain,identity,limit,outstanding:0n,epoch:0n,generation:1n,expiry,flatFee:1n,basisPoints:0n,status:1});
  const values=(book,salt,newSalt=bytes())=>({bookOpening:book,bookPath:view().books.findPathForLeaf(commit(book,salt)),salt,newSalt});
  let bookA=fresh(aa.publicKey,40n),saltA=bytes(),bookB=fresh(bb.publicKey,60n),saltB=bytes();
  await invoke(issuer,'registerMerchant',[mB.publicKey]);await invoke(issuer,'fundReserve',[100n]);
  for(const [actor,book,salt] of [[a,bookA,saltA],[b,bookB,saltB]]){
   const requested={hasPreviousBook:false,enrollmentIdentity:book.identity,lineLimit:book.limit,newSalt:salt,acceptedTerms:bytes()};
   await invoke(actor,'openLine',[0n,expiry,1n,0n],requested);
   await invoke(actor,'openLine',[1n,expiry,1n,0n],requested,false);
   await invoke(issuer,'openLine',[1n,expiry,1n,0n],requested);
   assert(view().books.findPathForLeaf(commit(book,salt)));
  }
  for(const [actor,merchant,mPk,book,salt,amount] of [[a,ma,mA.publicKey,bookA,saltA,15n],[b,mb,mB.publicKey,bookB,saltB,20n]]){
   const inv=bytes(),nonce=bytes(),before=new Set([...view().quotes].map(([key])=>hex(key)));
   await invoke(merchant,'postQuote',[expiry],{quoteAmount:amount,quoteBuyer:book.identity,invoiceId:inv,quoteNonce:nonce,
    quoteGeneration:1n,quoteFlatFee:1n,quoteBasisPoints:0n});
   const Q=[...view().quotes].find(([key])=>!before.has(hex(key)))[0],newSalt=bytes(),noteNonce=bytes(),noteSalt=bytes();
   const drawn={...values(book,salt,newSalt),drawAmount:amount,invoiceId:inv,quoteNonce:nonce,quoteMerchantPk:mPk,noteNonce,noteSalt};
   await invoke(issuer,'draw',[Q,expiry,1n],drawn,false);await invoke(actor,'draw',[Q,expiry,1n],drawn);
   const next={...book,outstanding:amount+1n,epoch:1n};assert(view().books.findPathForLeaf(commit(next,newSalt)));
   if(actor===a){bookA=next;saltA=newSalt;}else{bookB=next;saltB=newSalt;}
  }
  const repaySalt=bytes();await invoke(issuer,'acknowledgeRepayment',[expiry],{...values(bookA,saltA,repaySalt),repayAmount:16n,paymentRef:bytes(),receiptNonce:bytes()});
  bookA={...bookA,outstanding:0n,epoch:2n};saltA=repaySalt;assert(view().books.findPathForLeaf(commit(bookA,saltA)));
  const closeSalt=bytes();await invoke(issuer,'setStatus',[3],values(bookA,saltA,closeSalt));
  assert(view().books.findPathForLeaf(commit({...bookA,status:3,epoch:3n},closeSalt)));
  assert.equal(view().totalReserve,100n);assert.equal(view().encumberedReserve,35n);assert.equal(view().pendingFeeReserve,2n);
  const proved=new Set(traces.map(t=>t.circuit));
  const report={schema:'line-private-pool-proof/v1',createdAt:new Date().toISOString(),sourceSha256:feasibility.sourceSha256,
   artifacts,nativeVerifierSha256,proofServerVersion:version,
   compiledCheck:checkFlag>=0?'previously-source-bound-generated-execution':'fresh-pinned-compilation',
   privateBookProofsVerified:true,independentKeyProcesses:5,coordinatorHasSigningSecrets:false,coordinatorHasPrivateBooks:true,
   proverReceivesPrivatePreimages:true,commonProverUsed:!isolatedProvers,proverEndpoints:isolatedProvers?proverUrls:undefined,
   sameHostAdministratorTrusted:true,ephemeralRoleProvers:ephemeralProvers,feeBalancingEnabled:false,networkSubmitted:false,assetTransfers:false,
   canonicalIntegrated:false,productionCustodyEstablished:false,fullHistoryPrivacyPassed:false,customerDemandValidated:false,
   circuitsNotProved:info.circuits.map(c=>c.name).filter(name=>!proved.has(name)),traces,negativeChecks};
  writeFileSync(join(work,'evidence.json'),JSON.stringify(report,null,2)+'\n');
 }catch(error){
  runFailed=true;
  // Record only classification, never exception payloads or private witnesses.
  try{const path=join(work,'progress.json');if(existsSync(path)){
   const progress=JSON.parse(readFileSync(path,'utf8'));progress.executionFailed=true;
   progress.failureClass=error.name;writeFileSync(path,JSON.stringify(progress,null,2)+'\n');
  }}catch{console.error('Public failure checkpoint could not be saved; original execution error preserved.');}
  throw error;
 }finally{
  for(const actor of actors)actor.child.kill();
  if(ephemeralProvers&&runningRole){
   try{await manage('stop',runningRole);}catch(cleanupError){
    if(!runFailed)throw cleanupError;
    console.error('Owned role-prover cleanup also failed; original execution error preserved.');
   }
  }
 }
 console.log(JSON.stringify({result:'EXPERIMENTAL PRIVATE-BOOK CORE REAL PROOFS VERIFIED; FULL PRODUCT GATES OPEN',evidence:join(work,'evidence.json')}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
