/** Whole execution-worker restoration against the mTLS owner APIs.
 * The harness owns synthetic role configurations and the financial password,
 * but receives no coordinator book/salt/nullifier-key/witness packet.
 * Generated execution only; confirmation is a trusted fixture observation.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DurableApprovalSigner} from './durable-approval-signer.mjs';
import {authorize} from './approval-owner-example-policy.mjs';
import {startApprovalOwnerService} from './approval-owner-service.mjs';
import {coordinatorCommand} from './private-owner-coordinator.mjs';
import {tlsFixture} from '../tests/fixtures/approval-service-tls.mjs';
import {roleHash} from './private-offer-signers.mjs';
const SOURCE='contracts/experimental/line-private-offer.compact',sha=b=>createHash('sha256').update(b).digest('hex'),bytes=()=>new Uint8Array(randomBytes(32));
export async function runRecoverableOwnerCoordinator({compiledDir,localProof,onInitialized=async()=>{},onBeforeConfirm=async()=>{},onComplete=async()=>{}}={}){
mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/recoverable-owner-coordinator-')),managedDir=compiledDir?resolve(compiledDir):join(work,'managed');
const portable=p=>relative(process.cwd(),p).split(sep).join('/');
if(!compiledDir)
await new Promise((yes,no)=>{const p=spawn(process.execPath,['scripts/compile-compact.mjs','--skip-zk',SOURCE,portable(managedDir)],{stdio:'inherit'});p.on('error',no);p.on('close',c=>c===0?yes():no(Error('Coordinator fixture compilation failed.')));});
const files=['scripts/recoverable-owner-coordinator.mjs','scripts/private-owner-coordinator.mjs','scripts/private-finance-journal.mjs','server/checkout-storage.ts',
 'scripts/approval-owner-service.mjs','scripts/approval-service-frame.mjs','scripts/approval-owner-example-policy.mjs','scripts/durable-approval-signer.mjs','scripts/durable-approval-actor.mjs',
 'scripts/private-offer-signers.mjs','scripts/signed-pool-signers.mjs','scripts/private-offer-encoding.mjs','scripts/private-pool-spike.mjs','src/lib/security/vault-codec.ts','src/lib/line/encoding.ts','tests/fixtures/approval-service-tls.mjs',
 'scripts/private-coordinator-proving.mjs','scripts/native-local-proving-provider.mjs','scripts/private-worker-guardian.mjs',
 'scripts/private-finance-network.mjs','scripts/finalized-contract-receipt.mjs','src/lib/runtime/endpoints.ts'];
const fingerprints=Object.fromEntries(files.map(p=>[p,sha(readFileSync(p))])),sourceHash=sha(readFileSync(SOURCE)),tls=tlsFixture();
const owners={},services={},labels={issuer:'issuer',agent:'agent',merchantA:'merchant',merchantB:'merchant'},traces=[],controls=[],processes=[],crashes=[];
const config={managedDir,sourceSha256:sourceHash,executableSha256:sha(readFileSync(join(managedDir,'contract/index.js'))),directory:join(work,'private-financial-state'),password:Buffer.from(bytes()).toString('hex')};
if(localProof)config.localProof=localProof;
const command=async(action,payload)=>{const response=await coordinatorCommand(config,action,payload);processes.push(response.pid);return response;};
try{
 for(const [label,role]of Object.entries(labels))owners[label]=new DurableApprovalSigner({directory:join(work,label),encryptionKey:bytes(),custodyId:label+'-owner',role,authorize,create:true,approvalABI:'line-private-offer/v1'});
 const points=Object.fromEntries(Object.entries(owners).map(([label,s])=>[label,s.publicKey])),terms=bytes(),now=Math.floor(Date.now()/1000);
 const initialized=await command('initialize',{points,instanceNonce:bytes(),terms,limit:100n,flatFee:1n,basisPoints:100n,unixSeconds:now});
 const {scope,domain,identity,binding}=initialized.value;config.scope=scope;config.clients={};
 assert.deepEqual(Object.keys(initialized.value).sort(),['scope','domain','identity','binding','expiry',...(localProof?['proofGenesis']:[])].sort());
 await onInitialized({scope,now,proofGenesis:initialized.value.proofGenesis});
 const merchantA=roleHash('merchant',points.merchantA),merchantB=roleHash('merchant',points.merchantB),common={domain,maxAuthorizedCost:500n,validBefore:BigInt(now+7200)};
 owners.issuer.bindPolicy({...common,maxReserveAction:200n,maxLineLimit:100n,maxFee:2n,maxBasisPoints:100n,agentIdentity:identity,acceptedTerms:terms,allowedMerchants:[merchantA,merchantB]});
 owners.agent.bindPolicy({...common,maxAuthorizedCost:50n,maxLineLimit:100n,maxFee:2n,maxBasisPoints:100n,maxDrawAmount:30n,acceptedTerms:terms,allowedMerchants:[merchantA,merchantB]});
 for(const label of ['merchantA','merchantB'])owners[label].bindPolicy({...common,facilityBinding:binding,maxQuoteAmount:15n});
 for(const [label,role]of Object.entries(labels)){
  services[label]=await startApprovalOwnerService({signer:owners[label],role,approvalABI:'line-private-offer/v1',domain,...tls.material('server'),allowedClients:[tls.fingerprint('caller')]});
  config.clients[label]={url:'https://127.0.0.1:'+services[label].port+'/',...tls.material('caller'),expectedServerFingerprint:tls.fingerprint('server'),expectedRole:role,expectedPublicKey:points[label],expectedDomain:domain};
 }
 const itinerary=[{actor:'issuer',circuit:'registerMerchant',merchant:'merchantB'},{actor:'issuer',circuit:'fundReserve',amount:200n},
  {actor:'agent',circuit:'openLine'},{actor:'issuer',circuit:'openLine'},
  {actor:'merchantA',circuit:'postQuote',amount:15n},{actor:'agent',circuit:'draw',merchant:'merchantA'},{actor:'merchantA',circuit:'redeemDraw'},
  {actor:'merchantB',circuit:'postQuote',amount:15n},{actor:'agent',circuit:'draw',merchant:'merchantB'},{actor:'merchantB',circuit:'redeemDraw'}];
 for(const [i,request]of itinerary.entries()){
  const operationId='coordinator:'+i;let prepared;
  if(request.circuit==='draw'){
   config.testCrashBeforeApproval=true;
   try{await command('prepare',{operationId,...request});assert.fail('Expected staged-intent process exit.');}
   catch(error){assert.equal(error.exitCode,23);crashes.push({stage:'before-approval-after-intent-publication',workerPid:error.workerPid,exitCode:23});}
   finally{delete config.testCrashBeforeApproval;}
   const staged=await command('status',{});assert.equal(staged.value.authorizationOperation,operationId);assert.equal(staged.value.pendingOperation,null);
   config.testCrashAfterApproval=true;
   try{await command('restore',{operationId});assert.fail('Expected approved-intent process exit.');}
   catch(error){assert.equal(error.exitCode,23);crashes.push({stage:'after-approval-before-candidate',workerPid:error.workerPid,exitCode:23});}
   finally{delete config.testCrashAfterApproval;}
   config.testCrashAfterPrepare=true;
   try{await command('restore',{operationId});assert.fail('Expected prepared-publication process exit.');}
   catch(error){assert.equal(error.exitCode,23);assert(error.workerPid);crashes.push({stage:'after-prepare-publication',workerPid:error.workerPid,exitCode:23});}
   finally{delete config.testCrashAfterPrepare;}
   prepared=await command('restore',{operationId});
  }else prepared=await command('prepare',{operationId,...request});
  const restored=await command('restore',{operationId});assert.notEqual(restored.pid,prepared.pid);assert.equal(restored.value.fingerprint,prepared.value.fingerprint);
  assert.deepEqual(restored.value.publicState,prepared.value.publicState);assert.equal(restored.value.restoredFromEncryptedJournal,true);
  assert.deepEqual(Object.keys(restored.value).sort(),['operationId','circuit','fingerprint','publicState','sourceBound','restoredFromEncryptedJournal','networkFinalityVerified'].sort());
  assert.equal(restored.value.networkFinalityVerified,false);
  if(request.circuit==='draw'){
   await assert.rejects(command('prepare',{operationId:'replacement:'+i,...request}));controls.push({check:'pending-blocks-replacement-draw',rejected:true});
   const changed=new Uint8Array(restored.value.publicState);changed[changed.length-1]^=1;
   await assert.rejects(command('confirm',{operationId,observedPublicState:changed}));controls.push({check:'unobserved-candidate-retained',rejected:true});
   const again=await command('restore',{operationId});assert.equal(again.value.fingerprint,restored.value.fingerprint);
  }
  await onBeforeConfirm({operationId,request,prepared:restored.value,prove:async(publicLedgerState,{crashAfterPublication=false,crashDuringProve=false}={})=>{
   if(crashAfterPublication)config.testCrashAfterProofPublication=true;
   if(crashDuringProve)config.testCrashDuringNativeProve=true;
   try{return await command('prove',{operationId,publicLedgerState});}
   catch(error){if(crashAfterPublication&&error.exitCode===23)crashes.push({stage:'after-proven-transaction-publication',workerPid:error.workerPid,exitCode:23});
    if(crashDuringProve&&error.interruptedDuringNativeProve){assert.equal(error.ownedProcessesStopped,true);crashes.push({stage:'during-native-prove-after-key-load',workerPid:error.workerPid,ownedProcessesStopped:true});}throw error;}
   finally{delete config.testCrashAfterProofPublication;delete config.testCrashDuringNativeProve;}
  }});
  if(request.circuit==='draw'){
   config.testCrashAfterConfirm=true;
   try{await command('confirm',{operationId,observedPublicState:restored.value.publicState});assert.fail('Expected confirmed-publication process exit.');}
   catch(error){assert.equal(error.exitCode,23);crashes.push({stage:'after-confirm-publication',workerPid:error.workerPid,exitCode:23});}
   finally{delete config.testCrashAfterConfirm;}
   const status=await command('status',{});assert.equal(status.value.authorizationOperation,null);assert.equal(status.value.pendingOperation,null);assert(status.value.completedOperations.includes(operationId));
   const repeated=await command('prepare',{operationId,...request});assert.deepEqual(repeated.value,{operationId,alreadyConfirmed:true});
   await assert.rejects(command('prepare',{operationId,...request,merchant:request.merchant==='merchantA'?'merchantB':'merchantA'}));
   controls.push({check:'completed-request-retry-and-substitution',exactRetryConfirmed:true,changedRequestRejected:true});
  }else await command('confirm',{operationId,observedPublicState:restored.value.publicState});
  traces.push({circuit:request.circuit,actor:request.actor,wholeExecutionWorkerReconstructed:true,exactPreparedPacketRestored:true,signingScalarWitnesses:0});
 }
 const status=await command('status',{});assert.equal(status.value.authorizationOperation,null);assert.equal(status.value.pendingOperation,null);assert.equal(status.value.completedOperations.length,10);
 assert.equal(traces.length,10);assert.equal(controls.length,6);assert.equal(crashes.length,localProof?12:8);
 for(const [p,h]of Object.entries(fingerprints))assert.equal(sha(readFileSync(p)),h);assert.equal(sha(readFileSync(SOURCE)),sourceHash);
 const report={schema:localProof?'line-recoverable-owner-coordinator/native-fixture/v1':'line-recoverable-owner-coordinator/v1',createdAt:new Date().toISOString(),sourceSha256:sourceHash,scriptFingerprints:fingerprints,
  artifacts:Object.fromEntries(['contract/index.js','compiler/contract-info.json'].map(p=>[p,sha(readFileSync(join(managedDir,p)))])),freshCompilation:!compiledDir,
  traces,controls,crashes:crashes.map(({workerPid,...metadata})=>metadata),coordinatorProcessInvocations:processes.length+crashes.length,wholeExecutionWorkerReconstructed:true,coordinatorWitnessesReturnedToHarness:false,
  owners:4,merchants:2,nonzeroBasisPointPolicyExercised:true,financialCheckpointDurable:true,authorizationIntentPersistedBeforeOwnerRPC:true,preparedCandidatePersistedBeforeResponse:true,preparedPacketReloadedWithoutFreshApproval:true,
  networkSubmitted:false,authenticAssetSettlement:false,cryptographicProofsGenerated:Boolean(localProof),nativeProofVerificationPerformed:Boolean(localProof),independentAdministrativeCustody:false,fullHistoryPrivacyPassed:false,
  evidenceScope:'Ten generated Compact calls in separate execution-worker processes, restoring write-ahead authorization intents and private prepared packets through four mTLS services, with eight abrupt publication/approval exits and exact completed retries. Same-host synthetic owner harness and caller-trusted candidate observations; no network receipt/proof/asset/independent-administration claim.'};
 writeFileSync(join(work,'evidence.json'),JSON.stringify(report,null,2)+'\n');await onComplete(report);console.log(JSON.stringify({calls:10,controls:6,abruptExits:crashes.length,workerInvocations:processes.length+crashes.length,report:join(work,'evidence.json')}));return report;
}finally{for(const service of Object.values(services))await service.close();for(const signer of Object.values(owners))signer.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runRecoverableOwnerCoordinator();
