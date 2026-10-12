/** Experimental financial execution worker, with no role signing/store keys.
 * Each invocation reconstructs generated Compact from the encrypted journal.
 * Optional local proving returns public bytes only; it never submits or
 * authenticates network confirmation.
 */
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {PrivateFinanceJournal} from './private-finance-journal.mjs';
import {approvalOwnerClient} from './approval-owner-service.mjs';
import {encodeVaultJson as wire,decodeVaultJson as unwire} from '../src/lib/security/vault-codec.ts';
import {hash,tag,roleHash,zero} from './private-offer-signers.mjs';
import {facilityBinding,offerCommit} from './private-offer-encoding.mjs';
import {commit} from './private-pool-spike.mjs';
import {initializeCoordinatorProofLedger,proveRestoredCoordinator} from './private-coordinator-proving.mjs';
import {startWorkerGuardian} from './private-worker-guardian.mjs';
const self=fileURLToPath(import.meta.url),SOURCE='contracts/experimental/line-private-offer.compact',sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=()=>new Uint8Array(randomBytes(32)),hex=b=>Buffer.from(b).toString('hex'),COIN=RT.encodeCoinPublicKey('0'.repeat(64));
const stateBytes=data=>{const s=new RT.ContractState();s.data=data instanceof RT.ChargedState?data:new RT.ChargedState(data);return s.serialize();};
const emptyPath=()=>({leaf:zero,path:Array.from({length:20},()=>({sibling:{field:0n},goes_left:false}))});
const SELECTED={openLine:['enrollmentIdentity','acceptedTerms','hasPreviousBook','lineLimit','newSalt','bookOpening','salt'],
 draw:['bookOpening','salt','newSalt','quoteMerchantPk','drawAmount','noteNonce','noteSalt'],postQuote:['quoteFacilityBinding','invoiceId','quoteAmount','quoteNonce'],redeemDraw:['redeemAmount']};
const U64_MAX=(1n<<64n)-1n;
const u64=value=>typeof value==='bigint'&&value>=0n&&value<=U64_MAX;
export function coordinatorDrawFee(amount,flatFee,basisPoints){
 assert(u64(amount)&&amount>0n&&u64(flatFee)&&u64(basisPoints)&&basisPoints<=10000n);
 const fee=flatFee+(amount*basisPoints+9999n)/10000n;
 assert(u64(fee)&&amount+fee<=U64_MAX);return fee;
}
export function coordinatorOfferBinding(book){
 const bindingSalt=bytes();return {bindingSalt,binding:facilityBinding(book,bindingSalt)};
}
// Latest supplier records are convenience selectors, never the only custody copy.
export function coordinatorRetainClaims(financial){
 const next=structuredClone(financial);next.offerRecords??={};next.noteRecords??={};
 for(const [latest,archive,key]of [[next.offers,next.offerRecords,'Q'],[next.notes,next.noteRecords,'D']]){
  for(const record of Object.values(latest??{})){
   assert(record[key] instanceof Uint8Array&&record[key].length===32);const id=hex(record[key]);
   if(Object.hasOwn(archive,id))assert.deepEqual(archive[id],record,'An archived claim opening cannot change.');
   else archive[id]=structuredClone(record);
  }
 }
 return next;
}
export function coordinatorSelectClaim(financial,kind,merchant,selector){
 assert(['offer','note'].includes(kind)&&['merchantA','merchantB'].includes(merchant));
 if(selector!==undefined)assert(typeof selector==='string'&&/^[0-9a-f]{64}$/.test(selector),'Invalid claim selector.');
 const f=coordinatorRetainClaims(financial),key=kind==='offer'?'Q':'D',archive=kind==='offer'?f.offerRecords:f.noteRecords;
 const record=selector===undefined?(kind==='offer'?f.offers:f.notes)[merchant]:archive[selector];assert(record,'Claim opening is unavailable.');
 assert.deepEqual(record.merchant,roleHash('merchant',f.points[merchant]),'Claim belongs to another supplier.');
 assert.deepEqual(record[key],new Uint8Array(Buffer.from(selector??hex(record[key]),'hex')));return structuredClone(record);
}
export function coordinatorCommand(config,action,payload){
 assert(['initialize','prepare','restore','prove','confirm','status'].includes(action));const body=wire({action,payload});assert(Buffer.byteLength(body)<=2*1024*1024);
 const child=fork(self,['--worker'],{execArgv:['--experimental-strip-types'],stdio:['ignore','ignore','pipe','ipc'],detached:process.platform!=='win32',windowsHide:true,
  env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,LINE_COORDINATOR_TEST_CONFIG:wire(config)}});
 return new Promise((yes,no)=>{
  let received=false,result,pendingError,workerReady=false,guardReady=!config.localProof,guard,guardPromise,sent=false,exited=false,interrupted=false;
  const stop=()=>{if(process.platform!=='win32'){try{process.kill(-child.pid,'SIGKILL');}catch{child.kill();}}else child.kill('SIGKILL');};
  const dispatch=()=>{if(workerReady&&guardReady&&!sent&&!exited){sent=true;child.send({body},error=>{if(error){pendingError=Error('Coordinator dispatch is uncertain.');stop();}});}};
  const timer=setTimeout(()=>{pendingError=Error('Coordinator result is uncertain; recover the same operation.');stop();},action==='prove'?2_000_000:60_000);
  child.stderr.resume();child.on('error',error=>{pendingError=error;stop();});
  child.on('message',message=>{
   if(message.ready){workerReady=true;dispatch();return;}
   if(message.nativeStage==='key_material_loaded'&&config.testCrashDuringNativeProve){interrupted=true;stop();return;}
   if(message.body){try{assert(Buffer.byteLength(message.body)<=16*1024*1024);result=unwire(message.body);received=true;}catch{pendingError=Error('Coordinator response rejected.');stop();}}
   if(message.error){pendingError=Error('Coordinator command rejected.');if(['configuration','cache-open','public-predecessor','transcript-construction','native-proving','native-verification','proof-publication'].includes(message.proofStage))pendingError.coordinatorProofStage=message.proofStage;}
  });
  child.on('close',async code=>{
   exited=true;clearTimeout(timer);let contained=false;
   if(guardPromise)try{guard=await guardPromise;await guard.close();contained=true;}catch{pendingError=Error('Worker containment is uncertain; reconcile the saved operation.');}
   if(code===0&&received&&!pendingError)yes({pid:child.pid,value:result,...(guard?{containmentMode:guard.mode,ownedProcessesStopped:true}:{})});else{
    const error=pendingError??Error('Coordinator result is uncertain; recover the same operation.');error.workerPid=child.pid;error.exitCode=code;
    if(interrupted)error.interruptedDuringNativeProve=true;if(guard)error.ownedProcessesStopped=contained;no(error);
   }
  });
  if(config.localProof){
   guardPromise=startWorkerGuardian(child,{path:config.localProof.guardian,sha256:config.localProof.nativeExecutables.guardian});
   guardPromise.then(g=>{guard=g;guardReady=true;g.exit.then(r=>{if(r.code!==0&&!exited){pendingError=Error('Worker containment ended unexpectedly.');stop();}});dispatch();},()=>{pendingError=Error('Worker containment unavailable.');stop();});
  }
 });
}
async function worker(config,action,payload){
 const dir=resolve(config.managedDir),sourceHash=sha(readFileSync(SOURCE)),exeHash=sha(readFileSync(join(dir,'contract/index.js')));
 assert.equal(sourceHash,config.sourceSha256);assert.equal(exeHash,config.executableSha256);
 const {Contract,ledger}=await import(pathToFileURL(join(dir,'contract/index.js')).href),info=JSON.parse(readFileSync(join(dir,'compiler/contract-info.json')));
 assert.equal(info['compiler-version'],'0.31.1');assert.equal(info['runtime-version'],'0.16.0');
 let active={};const witnesses=Object.fromEntries(info.witnesses.map(({name})=>[name,(ctx,...args)=>{
  if(name==='rememberReserve')return [{...ctx.privateState,reserve:{book:args[0],salt:args[1]}},[]];
  if(name==='rememberNote')return [{...ctx.privateState,notes:{...ctx.privateState.notes,[hex(args[0])]:{meta:args[1],salt:args[2]}}},[]];
  if(name==='rememberQuote')return [{...ctx.privateState,quotes:{...ctx.privateState.quotes,[hex(args[0])]:{meta:args[1],salt:args[2]}}},[]];
  assert(!['callerSecret','agentSecret'].includes(name));assert(Object.hasOwn(active,name));return [ctx.privateState,active[name]];
 }]));const contract=new Contract(witnesses);
 let journal;
 try{
  if(action==='initialize'){
   const {points,instanceNonce,terms,limit,flatFee,basisPoints,unixSeconds}=payload;
   assert(Number.isSafeInteger(unixSeconds)&&unixSeconds>=0);assert(u64(limit)&&limit>0n);
   assert(u64(flatFee)&&u64(basisPoints)&&basisPoints<=10000n);assert(terms instanceof Uint8Array&&terms.length===32);const nullifierKey=bytes();
   const issuerPk=roleHash('issuer',points.issuer),merchantA=roleHash('merchant',points.merchantA),stableKey=hash([tag('line:signed:nk'),nullifierKey]);
   active={reserveSalt:bytes()};const initial=contract.initialState(RT.createConstructorContext({notes:{},quotes:{}},COIN),issuerPk,merchantA,instanceNonce,stableKey);
   const domain=ledger(initial.currentContractState.data).contractDomain,identity=roleHash('agent',points.agent,domain);
   const scope={networkId:'synthetic-preview',sourceSha256:sourceHash,executableSha256:exeHash,contractAddress:RT.dummyContractAddress(),contractDomain:hex(domain)};
   let proofGenesis;
   if(config.localProof){assert.equal(resolve(config.localProof.managedDir),dir);proofGenesis=await initializeCoordinatorProofLedger(initial,config.localProof,scope,unixSeconds);scope.contractAddress=proofGenesis.address;}
   const book={domain,identity,limit,outstanding:0n,epoch:0n,generation:1n,expiry:BigInt(unixSeconds+3600),flatFee,basisPoints,status:1};
   const bindingSalt=bytes(),binding=facilityBinding(book,bindingSalt),financial={nullifierKey,unixSeconds,points,terms,book,salt:bytes(),bindingSalt,binding,offers:{},notes:{},requests:{}};
   journal=await PrivateFinanceJournal.open({directory:config.directory,password:config.password,scope,create:true});
   await journal.initialize({publicState:stateBytes(initial.currentContractState.data),privateState:initial.currentPrivateState,financial});
   return {scope,domain,identity,binding,expiry:book.expiry,...(proofGenesis?{proofGenesis}:{})};
  }
  journal=await PrivateFinanceJournal.open({directory:config.directory,password:config.password,scope:config.scope});
  const snapshot=journal.snapshot();
  if(action==='status')return {revision:snapshot.revision,authorizationOperation:snapshot.authorizationIntent?.operationId??null,pendingOperation:snapshot.pending?.operationId??null,completedOperations:snapshot.completed.map(x=>x.operationId)};
  if(action==='confirm'){
   await journal.confirm(payload.operationId,payload.observedPublicState);
   if(config.testCrashAfterConfirm)process.exit(23);
   return {confirmed:true};
  }
  let pending=snapshot.pending;
  if(action==='restore'&&!pending&&snapshot.authorizationIntent){
   assert.equal(snapshot.authorizationIntent.operationId,payload.operationId);payload=snapshot.authorizationIntent.semanticRequest;action='prepare';
  }
  if(action==='prepare'){
   assert(!pending,'Unresolved operation blocks preparation.');
   const {operationId,actor,circuit}=payload,before=snapshot.confirmed,f=before.financial,v=ledger(RT.ContractState.deserialize(before.publicState).data),domain=f.book.domain;
   const allowedKeys=['operationId','actor','circuit',...(['fundReserve','postQuote'].includes(circuit)?['amount']:[]),...(['registerMerchant','draw'].includes(circuit)?['merchant']:[]),
    ...(circuit==='draw'&&Object.hasOwn(payload,'quoteCommit')?['quoteCommit']:[]),...(circuit==='redeemDraw'&&Object.hasOwn(payload,'noteCommit')?['noteCommit']:[])];
   assert.deepEqual(Object.keys(payload).sort(),allowedKeys.sort());
   if(snapshot.completed.some(x=>x.operationId===operationId)){
    assert.deepEqual(f.requests[operationId],payload,'Completed operation cannot change its semantic request.');
    return {operationId,alreadyConfirmed:true};
   }
   assert(config.clients[actor]);assert(['registerMerchant','fundReserve','openLine','postQuote','draw','redeemDraw'].includes(circuit));
   let args=[],values={},selectedOffer;
   if(circuit==='registerMerchant'){assert.equal(actor,'issuer');assert(['merchantA','merchantB'].includes(payload.merchant));args=[roleHash('merchant',f.points[payload.merchant])];}
   if(circuit==='fundReserve'){assert.equal(actor,'issuer');args=[payload.amount];}
   if(circuit==='openLine'){
    assert(['issuer','agent'].includes(actor));args=[actor==='agent'?0n:1n,f.book.expiry,f.book.flatFee,f.book.basisPoints];
    values={enrollmentIdentity:f.book.identity,acceptedTerms:f.terms,hasPreviousBook:false,lineLimit:f.book.limit,newSalt:f.salt,bookOpening:{...f.book,generation:0n},salt:zero,bookPath:emptyPath()};
   }
   if(circuit==='postQuote'){
    assert(['merchantA','merchantB'].includes(actor));const merchant=roleHash('merchant',f.points[actor]);const ttl=config.localProof?2700:900;args=[BigInt(f.unixSeconds+ttl)];
    const offerBinding=coordinatorOfferBinding(f.book);
    values={quoteFacilityBinding:offerBinding.binding,invoiceId:bytes(),quoteAmount:payload.amount,quoteNonce:bytes(),quoteBindingSalt:offerBinding.bindingSalt,enabledMerchantPath:v.enabledMerchantTree.findPathForLeaf(merchant)};
   }
   if(circuit==='draw'){
    assert.equal(actor,'agent');const offer=coordinatorSelectClaim(f,'offer',payload.merchant,payload.quoteCommit);selectedOffer=offer;
    const quote=before.privateState.quotes[hex(offer.Q)];assert(quote&&!quote.meta.used,'Quote is unavailable or already used.');args=[offer.Q,offer.expiry,coordinatorDrawFee(offer.amount,f.book.flatFee,f.book.basisPoints)];
    values={bookOpening:f.book,salt:f.salt,newSalt:bytes(),bookPath:v.books.findPathForLeaf(commit(f.book,f.salt)),invoiceId:offer.invoice,quoteNonce:offer.nonce,quoteBindingSalt:offer.bindingSalt??f.bindingSalt,
     drawAmount:offer.amount,quoteMerchantPk:offer.merchant,noteNonce:bytes(),noteSalt:bytes(),quoteMetaOpening:quote.meta,quoteMetaSalt:quote.salt,registeredMerchantPath:v.registeredMerchantTree.findPathForLeaf(offer.merchant)};
   }
   if(circuit==='redeemDraw'){
    const note=coordinatorSelectClaim(f,'note',actor,payload.noteCommit),opening=before.privateState.notes[hex(note.D)];
    assert(opening&&!opening.meta.redeemed&&!opening.meta.cancelled,'Claim is unavailable or already spent.');args=[note.D,note.expiry];
    values={noteMetaOpening:opening.meta,noteMetaSalt:opening.salt,noteGeneration:note.generation,noteIdentity:note.identity??f.book.identity,noteQuoteCommit:note.Q,quoteMerchantPk:note.merchant,redeemAmount:note.amount,noteNonce:note.nonce,noteSalt:note.salt};
   }
   const full={nullifierKey:f.nullifierKey,reserveOpening:before.privateState.reserve.book,reserveSalt:before.privateState.reserve.salt,newReserveSalt:bytes(),newQuoteMetaSalt:bytes(),newNoteMetaSalt:bytes(),currentBookRoot:v.books.root(),...values};
   const descriptor={name:circuit,args,domain,privateFinance:true,values:Object.fromEntries((SELECTED[circuit]??[]).filter(k=>Object.hasOwn(full,k)).map(k=>[k,full[k]])),...(circuit==='fundReserve'?{reserveCommit:v.reserveCommit}:{})};
   let base=full,selected=descriptor,circuitArgs=args;
   if(circuit==='fundReserve'){base.reserveAmount=args[0];circuitArgs=[];}
   if(circuit==='openLine'){base.lineFlatFee=args[2];base.lineBasisPoints=args[3];circuitArgs=args.slice(0,2);}
   if(circuit==='draw'){base.drawFee=args[2];circuitArgs=args.slice(0,2);}
   if(snapshot.authorizationIntent){
    const intent=snapshot.authorizationIntent;assert.equal(intent.operationId,operationId);assert.deepEqual(intent.semanticRequest,payload);
    base=intent.witnesses;selected=intent.descriptor;circuitArgs=intent.circuitArgs;
   }else await journal.stageAuthorization({operationId,circuit,circuitArgs,witnesses:base,descriptor:selected,semanticRequest:payload,before});
   if(config.testCrashBeforeApproval)process.exit(23);
   const approval=await approvalOwnerClient(config.clients[actor]).approve({operationId,descriptor:selected});
   if(config.testCrashAfterApproval)process.exit(23);
   active={...base,...approval};
   const context=RT.createCircuitContext(config.scope.contractAddress,COIN,RT.ContractState.deserialize(before.publicState).data,structuredClone(before.privateState),undefined,undefined,f.unixSeconds);
   const result=contract.circuits[circuit](context,...circuitArgs),financial=coordinatorRetainClaims(f);
   financial.requests[operationId]=structuredClone(payload);
   if(circuit==='postQuote')financial.offers[actor]={Q:offerCommit({merchant:roleHash('merchant',f.points[actor]),binding:base.quoteFacilityBinding,invoice:base.invoiceId,amount:base.quoteAmount,expiry:selected.args[0],nonce:base.quoteNonce,domain}),binding:base.quoteFacilityBinding,bindingSalt:base.quoteBindingSalt,merchant:roleHash('merchant',f.points[actor]),invoice:base.invoiceId,nonce:base.quoteNonce,amount:base.quoteAmount,expiry:selected.args[0]};
   if(circuit==='draw'){
    const D=[...ledger(result.context.currentQueryContext.state).notes].find(([d])=>!Object.hasOwn(before.privateState.notes,hex(d)))[0],offer=selectedOffer;
    financial.notes[payload.merchant]={D,Q:offer.Q,merchant:offer.merchant,identity:f.book.identity,amount:offer.amount,expiry:offer.expiry,generation:f.book.generation,nonce:base.noteNonce,salt:base.noteSalt};
    financial.book={...f.book,outstanding:f.book.outstanding+base.drawAmount+active.drawFee,epoch:f.book.epoch+1n};financial.salt=base.newSalt;
   }
   const candidate={publicState:stateBytes(result.context.currentQueryContext.state),privateState:result.context.currentPrivateState,financial:coordinatorRetainClaims(financial)};
   await journal.prepare({operationId,circuit,circuitArgs,witnesses:active,before,candidate});
   if(config.testCrashAfterPrepare)process.exit(23);
   pending=journal.snapshot().pending;
  }
  assert.equal(pending?.operationId,payload.operationId,'Restore requires exact pending operation.');active=pending.witnesses;
  const ctx=RT.createCircuitContext(config.scope.contractAddress,COIN,RT.ContractState.deserialize(pending.before.publicState).data,structuredClone(pending.before.privateState),undefined,undefined,pending.before.financial.unixSeconds),initialQueryContext=ctx.currentQueryContext;
  const restored=contract.circuits[pending.circuit](ctx,...pending.circuitArgs),restoredState=stateBytes(restored.context.currentQueryContext.state);
  assert.deepEqual(restoredState,pending.candidate.publicState);assert.deepEqual(restored.context.currentPrivateState,pending.candidate.privateState);
  const root=ledger(restored.context.currentQueryContext.state),book=pending.candidate.financial.book;
  if(book.generation===1n&&book.status===1&&['draw','redeemDraw'].includes(pending.circuit))assert(root.books.findPathForLeaf(commit(book,pending.candidate.financial.salt)));
  if(action==='prove'){
   assert(config.localProof);assert.equal(resolve(config.localProof.managedDir),dir);assert.deepEqual(Object.keys(payload).sort(),['operationId','publicLedgerState'].sort());
   const proof=await proveRestoredCoordinator({config:config.localProof,scope:config.scope,directory:config.directory,password:config.password,pending,restored,initialQueryContext,publicLedgerState:payload.publicLedgerState,
    onNativeStage:stage=>{if(process.connected)process.send({nativeStage:stage});}});
   if(config.testCrashAfterProofPublication)process.exit(23);
   return {operationId:pending.operationId,circuit:pending.circuit,fingerprint:pending.fingerprint,publicState:restoredState,...proof};
  }
  return {operationId:pending.operationId,circuit:pending.circuit,fingerprint:pending.fingerprint,publicState:restoredState,sourceBound:true,restoredFromEncryptedJournal:true,networkFinalityVerified:false};
 }finally{if(journal)await journal.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===self&&process.argv[2]==='--worker'){
 const config=unwire(process.env.LINE_COORDINATOR_TEST_CONFIG);delete process.env.LINE_COORDINATOR_TEST_CONFIG;
 let finishing=false;
 process.once('message',async message=>{try{assert(typeof message.body==='string'&&Buffer.byteLength(message.body)<=2*1024*1024);const {action,payload}=unwire(message.body),value=await worker(config,action,payload);
  process.send({body:wire(value)},()=>{finishing=true;process.disconnect();});
 }catch(error){process.exitCode=1;process.send({error:true,...(error.coordinatorProofStage?{proofStage:error.coordinatorProofStage}:{})},()=>{finishing=true;process.disconnect();});}});
 process.on('disconnect',()=>{if(!finishing&&process.platform!=='win32'){try{process.kill(-process.pid,'SIGKILL');return;}catch{}}process.exit(process.exitCode??0);});process.send({ready:true});
}
