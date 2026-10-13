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
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {DurableApprovalSigner} from './durable-approval-signer.mjs';
import {authorize} from './approval-owner-example-policy.mjs';
import {authorize as authorizePerOffer} from './approval-owner-per-offer-policy.mjs';
import {authorize as authorizeGovernance} from './approval-owner-governance-policy.mjs';
import {authorize as authorizeLifecycle} from './approval-owner-lifecycle-policy.mjs';
import {createCompensationPolicy} from './approval-owner-compensation-policy.mjs';
import {OwnerReceiptRegistry} from './owner-receipt-registry.mjs';
import {startApprovalOwnerService} from './approval-owner-service.mjs';
import {coordinatorCommand} from './private-owner-coordinator.mjs';
import {tlsFixture} from '../tests/fixtures/approval-service-tls.mjs';
import {roleHash} from './private-offer-signers.mjs';
const SOURCE='contracts/experimental/line-private-offer.compact',sha=b=>createHash('sha256').update(b).digest('hex'),bytes=()=>new Uint8Array(randomBytes(32));
export async function runRecoverableOwnerCoordinator({compiledDir,localProof,repeatSupplier=false,governance=false,lifecycle=false,compensation=false,onInitialized=async()=>{},onBeforeConfirm=async()=>{},onComplete=async()=>{}}={}){
assert(!governance||!repeatSupplier&&!localProof,'Governance has a separate generated-only fixture.');
assert(!lifecycle||!repeatSupplier&&!localProof&&!governance,'Lifecycle has a separate generated-only fixture.');
assert(!compensation||!repeatSupplier&&!governance&&!lifecycle,'Compensation has a separate fixture.');
mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/recoverable-owner-coordinator-')),managedDir=compiledDir?resolve(compiledDir):join(work,'managed');
const portable=p=>relative(process.cwd(),p).split(sep).join('/');
if(!compiledDir)
await new Promise((yes,no)=>{const p=spawn(process.execPath,['scripts/compile-compact.mjs','--skip-zk',SOURCE,portable(managedDir)],{stdio:'inherit'});p.on('error',no);p.on('close',c=>c===0?yes():no(Error('Coordinator fixture compilation failed.')));});
const files=['scripts/recoverable-owner-coordinator.mjs','scripts/private-owner-coordinator.mjs','scripts/private-finance-journal.mjs','server/checkout-storage.ts',
 'scripts/approval-owner-service.mjs','scripts/approval-service-frame.mjs','scripts/approval-owner-example-policy.mjs','scripts/durable-approval-signer.mjs','scripts/durable-approval-actor.mjs',
 'scripts/private-offer-signers.mjs','scripts/signed-pool-signers.mjs','scripts/private-offer-encoding.mjs','scripts/private-pool-spike.mjs','src/lib/security/vault-codec.ts','src/lib/line/encoding.ts','tests/fixtures/approval-service-tls.mjs',
 'scripts/private-coordinator-proving.mjs','scripts/native-local-proving-provider.mjs','scripts/private-worker-guardian.mjs',
 'scripts/private-finance-network.mjs','scripts/finalized-contract-receipt.mjs','src/lib/runtime/endpoints.ts','scripts/approval-owner-per-offer-policy.mjs','scripts/approval-owner-governance-policy.mjs','scripts/approval-owner-lifecycle-policy.mjs',
 'scripts/owner-receipt-registry.mjs','scripts/approval-owner-compensation-policy.mjs'];
const fingerprints=Object.fromEntries(files.map(p=>[p,sha(readFileSync(p))])),sourceHash=sha(readFileSync(SOURCE)),tls=tlsFixture();
const {ledger}=await import(pathToFileURL(join(managedDir,'contract/index.js')).href),quoteIds=[],noteIds=[],seenQuotes=new Set(),seenNotes=new Set();
const observePublic=state=>{const view=ledger(RT.ContractState.deserialize(state).data);
 for(const [keys,seen,ids]of [[view.quotes,seenQuotes,quoteIds],[view.notes,seenNotes,noteIds]])for(const [key]of keys){const id=Buffer.from(key).toString('hex');if(!seen.has(id)){seen.add(id);ids.push(id);}}
 return view;};
const owners={},services={},labels={issuer:'issuer',agent:'agent',merchantA:'merchant',merchantB:'merchant'},traces=[],controls=[],processes=[],crashes=[];
const config={managedDir,sourceSha256:sourceHash,executableSha256:sha(readFileSync(join(managedDir,'contract/index.js'))),directory:join(work,'private-financial-state'),password:Buffer.from(bytes()).toString('hex')};
if(localProof)config.localProof=localProof;
const command=async(action,payload)=>{const response=await coordinatorCommand(config,action,payload);processes.push(response.pid);return response;};
let receiptRegistry,receiptOptions,syntheticNow;
const receiptAuthority={get binding(){return receiptRegistry.binding;},get:ref=>receiptRegistry.get(ref)};
try{
 const now=Math.floor(Date.now()/1000);
 syntheticNow=now;if(compensation)config.allowSyntheticTimeAdvance=true;
 for(const [label,role]of Object.entries(labels))owners[label]=new DurableApprovalSigner({directory:join(work,label),encryptionKey:bytes(),custodyId:label+'-owner',role,authorize:role==='merchant'?authorizePerOffer:compensation?createCompensationPolicy(role==='issuer'?receiptAuthority:undefined):lifecycle?authorizeLifecycle:governance&&role==='issuer'?authorizeGovernance:authorize,create:true,approvalABI:'line-private-offer/v1',...(lifecycle||compensation?{clock:()=>syntheticNow}:{})});
 const points=Object.fromEntries(Object.entries(owners).map(([label,s])=>[label,s.publicKey])),terms=bytes(),newTerms=bytes(),receiptA=bytes(),receiptB=bytes();
 const initialized=await command('initialize',{points,instanceNonce:bytes(),terms,limit:100n,flatFee:1n,basisPoints:100n,unixSeconds:now});
 const {scope,domain,identity,binding}=initialized.value;config.scope=scope;config.clients={};
 if(compensation){receiptOptions={directory:join(work,'issuer-receipts'),password:Buffer.from(bytes()).toString('hex'),scope:{custodyId:'issuer-owner-receipts',domain,beneficiaryIdentity:identity,denomination:'synthetic-units'}};receiptRegistry=await OwnerReceiptRegistry.open({...receiptOptions,create:true});}
 assert.deepEqual(Object.keys(initialized.value).sort(),['scope','domain','identity','binding','expiry',...(localProof?['proofGenesis']:[])].sort());
 await onInitialized({scope,now,proofGenesis:initialized.value.proofGenesis});
 const merchantA=roleHash('merchant',points.merchantA),merchantB=roleHash('merchant',points.merchantB),common={domain,maxAuthorizedCost:500n,validBefore:BigInt(now+7200)};
 const lifecycleConfig=lifecycle||compensation?{lifecycleMode:'owner-records',acceptedTermsCatalog:[terms,newTerms],denomination:'synthetic-units',receipts:compensation?[]:[
  {paymentRef:receiptA,amount:17n,domain,beneficiaryIdentity:identity,denomination:'synthetic-units'},
  {paymentRef:receiptB,amount:16n,domain,beneficiaryIdentity:identity,denomination:'synthetic-units'}]}:{};
 owners.issuer.bindPolicy({...common,maxReserveAction:200n,maxLineLimit:100n,maxFee:2n,maxBasisPoints:100n,agentIdentity:identity,acceptedTerms:terms,allowedMerchants:[merchantA,merchantB],...(governance||lifecycle||compensation?{governanceMode:'bounded',maxReserveWithdrawal:20n,maxFeeWithdrawal:5n,allowedStatuses:[1,2,3]}:{}),...lifecycleConfig,...(compensation?{compensationMode:'bounded',compensationModes:[0n,1n,2n],receiptAuthority:receiptRegistry.binding}:{})});
 owners.agent.bindPolicy({...common,maxAuthorizedCost:compensation?70n:50n,maxLineLimit:100n,maxFee:2n,maxBasisPoints:100n,maxDrawAmount:30n,acceptedTerms:terms,allowedMerchants:[merchantA,merchantB],...(lifecycle||compensation?{...lifecycleConfig,agentIdentity:identity}:{}),...(compensation?{compensationMode:'bounded',compensationModes:[1n]}:{})});
 for(const label of ['merchantA','merchantB'])owners[label].bindPolicy({...common,facilityBindingMode:'per-offer',maxQuoteAmount:15n});
 for(const [label,role]of Object.entries(labels)){
  services[label]=await startApprovalOwnerService({signer:owners[label],role,approvalABI:'line-private-offer/v1',domain,...tls.material('server'),allowedClients:[tls.fingerprint('caller')]});
  config.clients[label]={url:'https://127.0.0.1:'+services[label].port+'/',...tls.material('caller'),expectedServerFingerprint:tls.fingerprint('server'),expectedRole:role,expectedPublicKey:points[label],expectedDomain:domain};
 }
 const setup=[{actor:'issuer',circuit:'registerMerchant',merchant:'merchantB'},{actor:'issuer',circuit:'fundReserve',amount:200n},
  {actor:'agent',circuit:'openLine'},{actor:'issuer',circuit:'openLine'}];
 const newFacility={limit:80n,expiry:BigInt(now+5000),flatFee:0n,basisPoints:100n,terms:newTerms},receiptExpiry=BigInt(now+6000);
 const refundA=bytes(),refundB=bytes(),refundZero=bytes();
 const comp=(actor,merchant,noteIndex,mode,paymentRef)=>()=>({actor,circuit:'cancelOrExpireNote',merchant,noteCommit:noteIds[noteIndex],mode,receiptExpiry:mode===2n?receiptExpiry:0n,...(mode===2n?{paymentRef}:{})});
 const admit=(purpose,paymentRef,amount,noteIndex,reopen=false)=>()=>({kind:'receipt',record:{purpose,paymentRef,amount,domain,beneficiaryIdentity:identity,denomination:'synthetic-units',evidenceClass:'synthetic-fixture',...(purpose==='refund'?{noteCommit:new Uint8Array(Buffer.from(noteIds[noteIndex],'hex'))}:{})},reopen});
 const itinerary=compensation?[...setup,{actor:'merchantA',circuit:'postQuote',amount:15n},{actor:'agent',circuit:'draw',merchant:'merchantA'},
  admit('repayment',receiptA,7n),{actor:'issuer',circuit:'acknowledgeRepayment',amount:7n,paymentRef:receiptA,receiptExpiry},
  {kind:'clock',to:now+901},comp('issuer','merchantA',0,0n),comp('agent','merchantA',0,1n),
  {actor:'merchantB',circuit:'postQuote',amount:15n},{actor:'agent',circuit:'draw',merchant:'merchantB'},
  admit('refund',refundA,7n,0,true),comp('issuer','merchantA',0,2n,refundA),
  admit('repayment',receiptB,17n),{actor:'issuer',circuit:'acknowledgeRepayment',amount:17n,paymentRef:receiptB,receiptExpiry},
  {actor:'issuer',circuit:'setStatus',status:3},{actor:'agent',circuit:'openLine',facility:newFacility},{actor:'issuer',circuit:'openLine',facility:newFacility},
  {kind:'clock',to:now+1802},{actor:'merchantA',circuit:'postQuote',amount:10n},{actor:'agent',circuit:'draw',merchant:'merchantA'},
  comp('issuer','merchantB',1,1n),admit('refund',refundB,17n,1),comp('issuer','merchantB',1,2n,refundB),
  {kind:'clock',to:now+2703},comp('agent','merchantA',2,1n),
  {actor:'merchantB',circuit:'postQuote',amount:10n},{actor:'agent',circuit:'draw',merchant:'merchantB'},{actor:'merchantB',circuit:'redeemDraw'},
  admit('refund',refundZero,0n,2),comp('issuer','merchantA',2,2n,refundZero),
  {actor:'issuer',circuit:'withdrawFees'},{actor:'issuer',circuit:'withdrawUnencumberedReserve',amount:10n},{actor:'issuer',circuit:'disableMerchant',merchant:'merchantA'},
  {actor:'issuer',circuit:'setStatus',status:2},{actor:'issuer',circuit:'setStatus',status:1}]:lifecycle?[...setup,
  {actor:'merchantA',circuit:'postQuote',amount:10n},{actor:'merchantA',circuit:'postQuote',amount:15n},{actor:'agent',circuit:'draw',merchant:'merchantA'},
  {actor:'issuer',circuit:'setStatus',status:2},{actor:'issuer',circuit:'acknowledgeRepayment',amount:17n,paymentRef:receiptA,receiptExpiry},
  {actor:'issuer',circuit:'setStatus',status:3},{actor:'agent',circuit:'openLine',facility:newFacility},{actor:'issuer',circuit:'openLine',facility:newFacility},
  {actor:'merchantA',circuit:'redeemDraw'},
  {actor:'merchantB',circuit:'postQuote',amount:15n},{actor:'agent',circuit:'draw',merchant:'merchantB'},{actor:'merchantB',circuit:'redeemDraw'},
  {actor:'issuer',circuit:'acknowledgeRepayment',amount:16n,paymentRef:receiptB,receiptExpiry},{actor:'issuer',circuit:'withdrawFees'},
  {actor:'issuer',circuit:'withdrawUnencumberedReserve',amount:10n},{actor:'issuer',circuit:'disableMerchant',merchant:'merchantA'},
  {actor:'merchantB',circuit:'postQuote',amount:10n},{actor:'agent',circuit:'draw',merchant:'merchantB'},{actor:'merchantB',circuit:'redeemDraw'}]:governance?[...setup,
  {actor:'merchantA',circuit:'postQuote',amount:15n},{actor:'agent',circuit:'draw',merchant:'merchantA'},
  {actor:'issuer',circuit:'setStatus',status:2},{actor:'issuer',circuit:'setStatus',status:1},
  {actor:'issuer',circuit:'withdrawUnencumberedReserve',amount:10n},{actor:'issuer',circuit:'disableMerchant',merchant:'merchantA'},
  {actor:'merchantA',circuit:'redeemDraw'},
  {actor:'merchantB',circuit:'postQuote',amount:15n},{actor:'agent',circuit:'draw',merchant:'merchantB'},{actor:'merchantB',circuit:'redeemDraw'},
  {actor:'issuer',circuit:'withdrawFees'}]:repeatSupplier?[...setup,
  {actor:'merchantA',circuit:'postQuote',amount:10n},{actor:'merchantA',circuit:'postQuote',amount:10n},
  ()=>({actor:'agent',circuit:'draw',merchant:'merchantA',quoteCommit:quoteIds[0]}),
  {actor:'agent',circuit:'draw',merchant:'merchantA'},
  ()=>({actor:'merchantA',circuit:'redeemDraw',noteCommit:noteIds[0]}),
  {actor:'merchantA',circuit:'redeemDraw'},
  {actor:'merchantB',circuit:'postQuote',amount:15n},{actor:'agent',circuit:'draw',merchant:'merchantB'},{actor:'merchantB',circuit:'redeemDraw'}]:[{actor:'issuer',circuit:'registerMerchant',merchant:'merchantB'},{actor:'issuer',circuit:'fundReserve',amount:200n},
  {actor:'agent',circuit:'openLine'},{actor:'issuer',circuit:'openLine'},
  {actor:'merchantA',circuit:'postQuote',amount:15n},{actor:'agent',circuit:'draw',merchant:'merchantA'},{actor:'merchantA',circuit:'redeemDraw'},
  {actor:'merchantB',circuit:'postQuote',amount:15n},{actor:'agent',circuit:'draw',merchant:'merchantB'},{actor:'merchantB',circuit:'redeemDraw'}];
 let finalPublic;
 for(const [i,entry]of itinerary.entries()){
  const request=typeof entry==='function'?entry():entry;
  if(request.kind==='clock'){
   const from=syntheticNow,advanced=await command('advanceSyntheticTime',{from,to:request.to});assert.equal(advanced.value.syntheticTime,true);assert.equal(advanced.value.networkFinalityVerified,false);
   const retry=await command('advanceSyntheticTime',{from,to:request.to});assert.deepEqual(retry.value,advanced.value);syntheticNow=advanced.value.unixSeconds;continue;
  }
  if(request.kind==='receipt'){
   await receiptRegistry.admit(request.record);if(request.reopen){const pin=receiptRegistry.binding;await receiptRegistry.close();receiptRegistry=await OwnerReceiptRegistry.open(receiptOptions);assert.equal(receiptRegistry.binding,pin);assert.deepEqual(receiptRegistry.get(request.record.paymentRef),request.record);}continue;
  }
  if(compensation&&request.circuit==='cancelOrExpireNote'&&request.mode===2n&&request.paymentRef===refundZero){
   await assert.rejects(command('prepare',{operationId:'comp-cross-mode',...request,paymentRef:receiptA}));
   const idle=await command('status',{});assert.equal(idle.value.authorizationOperation,null);assert.equal(idle.value.pendingOperation,null);controls.push({check:'repayment-reference-cannot-acknowledge-zero-refund',rejected:true});
  }
  const operationId='coordinator:'+i;let prepared;
  const recovery=request.circuit==='draw'||(governance||lifecycle||compensation)&&['setStatus','withdrawUnencumberedReserve','withdrawFees','disableMerchant'].includes(request.circuit)||(lifecycle||compensation)&&['acknowledgeRepayment','openLine','cancelOrExpireNote'].includes(request.circuit);
  if(recovery){
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
  observePublic(restored.value.publicState);finalPublic=restored.value.publicState;
  assert.deepEqual(Object.keys(restored.value).sort(),['operationId','circuit','fingerprint','publicState','sourceBound','restoredFromEncryptedJournal','networkFinalityVerified'].sort());
  assert.equal(restored.value.networkFinalityVerified,false);
  if(recovery){
   await assert.rejects(command('prepare',{operationId:'replacement:'+i,...request}));controls.push({check:'pending-blocks-replacement-draw',rejected:true});
   const changed=new Uint8Array(restored.value.publicState);changed[changed.length-1]^=1;
   await assert.rejects(command('confirm',{operationId,observedPublicState:changed}));controls.push({check:'unobserved-candidate-retained',rejected:true});
   if(compensation&&request.circuit==='draw'){await assert.rejects(command('advanceSyntheticTime',{from:syntheticNow,to:syntheticNow+1}));controls.push({check:'pending-candidate-blocks-synthetic-time-change',rejected:true});}
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
  if(recovery){
   config.testCrashAfterConfirm=true;
   try{await command('confirm',{operationId,observedPublicState:restored.value.publicState});assert.fail('Expected confirmed-publication process exit.');}
   catch(error){assert.equal(error.exitCode,23);crashes.push({stage:'after-confirm-publication',workerPid:error.workerPid,exitCode:23});}
   finally{delete config.testCrashAfterConfirm;}
   const status=await command('status',{});assert.equal(status.value.authorizationOperation,null);assert.equal(status.value.pendingOperation,null);assert(status.value.completedOperations.includes(operationId));
   const repeated=await command('prepare',{operationId,...request});assert.deepEqual(repeated.value,{operationId,alreadyConfirmed:true});
   const substituted=request.circuit==='cancelOrExpireNote'?{...request,receiptExpiry:request.receiptExpiry+1n}:request.circuit==='setStatus'?{...request,status:request.status===1?2:1}:request.circuit==='openLine'?{...request,facility:{...newFacility,limit:99n}}:Object.hasOwn(request,'amount')?{...request,amount:request.amount+1n}:
    request.circuit==='withdrawFees'?{...request,actor:'agent'}:{...request,merchant:request.merchant==='merchantA'?'merchantB':'merchantA'};
   await assert.rejects(command('prepare',{operationId,...substituted}));
   controls.push({check:'completed-request-retry-and-substitution',exactRetryConfirmed:true,changedRequestRejected:true});
  }else await command('confirm',{operationId,observedPublicState:restored.value.publicState});
  traces.push({circuit:request.circuit,actor:request.actor,wholeExecutionWorkerReconstructed:true,exactPreparedPacketRestored:true,signingScalarWitnesses:0});
 }
 const expectedCalls=compensation?30:lifecycle?23:governance?15:repeatSupplier?13:10,expectedRecovery=compensation?23:lifecycle?14:governance?7:repeatSupplier?3:2;
 const status=await command('status',{});assert.equal(status.value.authorizationOperation,null);assert.equal(status.value.pendingOperation,null);assert.equal(status.value.completedOperations.length,expectedCalls);
 assert.equal(traces.length,expectedCalls);assert.equal(controls.length,expectedRecovery*3+(compensation?5:0));assert.equal(crashes.length,expectedRecovery*4+(localProof?traces.filter(t=>t.circuit==='draw').length*2:0));
 if(compensation){
  for(const request of [comp('issuer','merchantA',0,0n)(),comp('agent','merchantA',0,1n)(),comp('issuer','merchantA',0,2n,bytes())(),
   comp('issuer','merchantB',3,0n)(),comp('issuer','merchantB',0,0n)(),
   {actor:'issuer',circuit:'acknowledgeRepayment',amount:1n,paymentRef:refundA,receiptExpiry},
   {actor:'issuer',circuit:'acknowledgeRepayment',amount:1n,paymentRef:refundZero,receiptExpiry},
   {actor:'merchantA',circuit:'redeemDraw',noteCommit:noteIds[0]}]){
   await assert.rejects(command('prepare',{operationId:'comp-denial:'+controls.length,...request}));const idle=await command('status',{});assert.equal(idle.value.authorizationOperation,null);assert.equal(idle.value.pendingOperation,null);
   controls.push({check:'spent-or-foreign-claim-and-cross-mode-reference',circuit:request.circuit,rejected:true});
  }
  assert.equal(new Set(traces.map(t=>t.circuit)).size,12);
 }
 if(lifecycle){
  for(const request of [{actor:'agent',circuit:'draw',merchant:'merchantA',quoteCommit:quoteIds[0]},
   {actor:'issuer',circuit:'acknowledgeRepayment',amount:1n,paymentRef:receiptA,receiptExpiry},
   {actor:'issuer',circuit:'acknowledgeRepayment',amount:1n,paymentRef:receiptB,receiptExpiry},
   {actor:'issuer',circuit:'acknowledgeRepayment',amount:12n,paymentRef:bytes(),receiptExpiry},
   {actor:'issuer',circuit:'acknowledgeRepayment',amount:1n,paymentRef:new Uint8Array(32),receiptExpiry},
   {actor:'agent',circuit:'acknowledgeRepayment',amount:1n,paymentRef:bytes(),receiptExpiry},{actor:'agent',circuit:'openLine',facility:newFacility}]){
   await assert.rejects(command('prepare',{operationId:'lifecycle-denial:'+controls.length,...request}));
   controls.push({check:'invalid-payment-or-generation-rejected-before-authorization',circuit:request.circuit,rejected:true});
   const after=await command('status',{});assert.equal(after.value.authorizationOperation,null);assert.equal(after.value.pendingOperation,null);assert.equal(after.value.completedOperations.length,expectedCalls);
  }
  assert.equal(new Set(traces.map(t=>t.circuit)).size,11);
 }
 if(governance){
  for(const request of [{actor:'merchantA',circuit:'postQuote',amount:15n},{actor:'issuer',circuit:'setStatus',status:3},
   {actor:'issuer',circuit:'withdrawUnencumberedReserve',amount:161n},{actor:'issuer',circuit:'withdrawFees'},
   {actor:'agent',circuit:'setStatus',status:2},{actor:'agent',circuit:'disableMerchant',merchant:'merchantB'}]){
   await assert.rejects(command('prepare',{operationId:'governance-denial:'+controls.length,...request}));
   controls.push({check:'invalid-governance-or-disabled-quote-rejected-before-authorization',circuit:request.circuit,rejected:true});
   const after=await command('status',{});assert.equal(after.value.authorizationOperation,null);assert.equal(after.value.pendingOperation,null);assert.equal(after.value.completedOperations.length,expectedCalls);
  }
  assert.equal(new Set(traces.map(t=>t.circuit)).size,10);
 }
 let retainedClaims;
 if(repeatSupplier){
  const view=observePublic(finalPublic);assert.equal(quoteIds.length,3);assert.equal(noteIds.length,3);
  for(const id of noteIds)assert.equal(view.notes.member(new Uint8Array(Buffer.from(id,'hex'))),true);
  for(const request of [{actor:'merchantA',circuit:'redeemDraw',noteCommit:noteIds[0]},
   {actor:'merchantB',circuit:'redeemDraw',noteCommit:noteIds[0]},
   {actor:'agent',circuit:'draw',merchant:'merchantB',quoteCommit:quoteIds[0]}]){
   await assert.rejects(command('prepare',{operationId:'archive-denial:'+controls.length,...request}));
   controls.push({check:'spent-or-foreign-archive-selector',rejected:true});
  }
  const after=await command('status',{});assert.equal(after.value.authorizationOperation,null);assert.equal(after.value.pendingOperation,null);assert.equal(after.value.completedOperations.length,13);
  retainedClaims={sameSupplierQuotes:2,sameSupplierDraws:2,olderQuoteSelectedAfterNewerQuote:true,olderNoteRedeemedAfterNewerDraw:true,
   explicitSelectorsVerifiedByCompact:true,spentAndForeignSelectorsRejectedBeforeAuthorization:true,fullHistoryPrivacyPassed:false};
 }
 for(const [p,h]of Object.entries(fingerprints))assert.equal(sha(readFileSync(p)),h);assert.equal(sha(readFileSync(SOURCE)),sourceHash);
 const report={schema:compensation?(localProof?'line-recoverable-owner-coordinator/compensation-native-fixture/v1':'line-recoverable-owner-coordinator/compensation/v1'):lifecycle?'line-recoverable-owner-coordinator/lifecycle/v1':governance?'line-recoverable-owner-coordinator/governance/v1':repeatSupplier?(localProof?'line-recoverable-owner-coordinator/repeat-supplier-native-fixture/v1':'line-recoverable-owner-coordinator/repeat-supplier/v1'):localProof?'line-recoverable-owner-coordinator/native-fixture/v1':'line-recoverable-owner-coordinator/v1',createdAt:new Date().toISOString(),sourceSha256:sourceHash,scriptFingerprints:fingerprints,...(retainedClaims?{retainedClaims}:{}),
  artifacts:Object.fromEntries(['contract/index.js','compiler/contract-info.json'].map(p=>[p,sha(readFileSync(join(managedDir,p)))])),freshCompilation:!compiledDir,
  traces,controls,crashes:crashes.map(({workerPid,...metadata})=>metadata),coordinatorProcessInvocations:processes.length+crashes.length,wholeExecutionWorkerReconstructed:true,coordinatorWitnessesReturnedToHarness:false,
  owners:4,merchants:2,nonzeroBasisPointPolicyExercised:true,financialCheckpointDurable:true,authorizationIntentPersistedBeforeOwnerRPC:true,preparedCandidatePersistedBeforeResponse:true,preparedPacketReloadedWithoutFreshApproval:true,
  networkSubmitted:false,authenticAssetSettlement:false,cryptographicProofsGenerated:Boolean(localProof),nativeProofVerificationPerformed:Boolean(localProof),independentAdministrativeCustody:false,fullHistoryPrivacyPassed:false,
  evidenceScope:compensation?'Thirty generated calls across all twelve names and three compensation modes, partial/earlier-generation/zero-cash obligations, both allocation roles, saved refund salt after later draws, receipt-registry reopen and cross-mode reference rejection; ninety-two exits. Explicit synthetic clock advances and owner receipt admission; no native proof, finalized network, real payout, independent custody or full-history privacy claim.':lifecycle?'Twenty-three generated calls across eleven names, synthetic owner-record repayment in default/open states, zero-debt closure and bilateral reopening with changed terms, original-generation claim redemption and stale quote/payment controls; fifty-six exits. Same-host synthetic owners/time and caller-trusted observation; no compensation, authentic payment, native proof, network or full-history privacy claim.':governance?'Fifteen generated calls across ten names, default/resume with debt, bounded reserve/fee withdrawals and merchant disable before redemption; twenty-eight exits and exact recovery/retries. Synthetic same-host owners and caller-trusted observation; no repayment/compensation/reopening, native proof, network or payout claim.':repeatSupplier?'Thirteen restored Compact calls with two quotes and draws at Merchant A, selection/redemption of older archived claims after newer purchases, Merchant B separation and twelve generated publication/approval exits. Native proving, when selected, adds its separately recorded interruption/proof controls. Synthetic same-host configuration; no network or asset claim.':'Ten generated Compact calls in separate execution-worker processes, restoring write-ahead authorization intents and private prepared packets through four mTLS services, with eight abrupt publication/approval exits and exact completed retries. Same-host synthetic owner harness and caller-trusted candidate observations; no network receipt/proof/asset/independent-administration claim.'};
 writeFileSync(join(work,'evidence.json'),JSON.stringify(report,null,2)+'\n');await onComplete(report);console.log(JSON.stringify({calls:traces.length,controls:controls.length,abruptExits:crashes.length,workerInvocations:processes.length+crashes.length,report:join(work,'evidence.json')}));return report;
}finally{for(const service of Object.values(services))await service.close();for(const signer of Object.values(owners))signer.close();if(receiptRegistry)await receiptRegistry.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runRecoverableOwnerCoordinator({repeatSupplier:process.argv.includes('--repeat-supplier'),governance:process.argv.includes('--governance'),lifecycle:process.argv.includes('--lifecycle'),compensation:process.argv.includes('--compensation')});
