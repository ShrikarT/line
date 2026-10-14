#!/usr/bin/env node
/** Full twelve-circuit experimental pool, not a canonical migration or privacy
 * certification. Keys are generated inside six actor processes. Only public
 * query transcripts are inspected; emitted evidence excludes private preimages
 * and signing keys. A configured proof service receives private witnesses.
 * The coordinator remains trusted and handles authorized private book openings.
 */
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { agentId, issuerPublicKey, merchantPublicKey, BYTES32, UINT64 } from '../src/lib/line/encoding.ts';
import { encodeVaultJson, decodeVaultJson } from '../src/lib/security/vault-codec.ts';

const self=fileURLToPath(import.meta.url), COIN='0'.repeat(64), NOW=1_800_000_000;
const bytes=()=>new Uint8Array(randomBytes(32));
const hex=value=>Buffer.from(value).toString('hex');
const wire=encodeVaultJson, unwire=decodeVaultJson;
// Ledger scalar words may omit trailing zero bytes. Normalize only public
// words for absence checks; never inspect or emit the private transcript.
const publicJson=value=>JSON.stringify(value,(_key,value)=>typeof value==='bigint'?value.toString():value instanceof Uint8Array?
 hex(value.length<=32?BYTES32.fromValue([value]):value):value);
const STATUS=new RT.CompactTypeEnum(3,1);
const bookFields=[['domain',BYTES32],['identity',BYTES32],...['limit','outstanding','epoch','generation','expiry','flatFee','basisPoints'].map(key=>[key,UINT64]),['status',STATUS]];
const BOOK_TYPE={alignment:()=>bookFields.flatMap(([,type])=>type.alignment()),
 toValue:value=>bookFields.flatMap(([key,type])=>type.toValue(value[key])),
 fromValue:value=>Object.fromEntries(bookFields.map(([key,type])=>[key,type.fromValue(value)]))};
const commit=(book,salt)=>RT.persistentCommit(BOOK_TYPE,book,salt);
function stateBytes(data){const state=new RT.ContractState();state.data=data instanceof RT.ChargedState?data:new RT.ChargedState(data);return state.serialize();}

async function actorMain(role,dir,proofUri='http://127.0.0.1:6301'){
 const endpoint=new URL(proofUri);assert(endpoint.protocol==='http:'&&endpoint.hostname==='127.0.0.1'&&endpoint.pathname==='/'&&!endpoint.search,'Only a role-local loopback prover is accepted.');
 const key=bytes(); // No coordinator/peer actor receives it; the role prover does.
 const publicKey=role==='issuer'?issuerPublicKey(key):role==='agent'?agentId(key):merchantPublicKey(key);
 const {Contract}=await import(pathToFileURL(join(dir,'contract/index.js')).href);
 const info=JSON.parse(readFileSync(join(dir,'compiler/contract-info.json'),'utf8'));
 let active,calls,proving;
 const witnesses=Object.fromEntries(info.witnesses.map(({name})=>[name,ctx=>{
  calls.push(name);
  if(name==='callerSecret')return [ctx.privateState,key];
  if(name==='agentSecret'){if(role!=='agent')throw new Error('Actor has no agent signing key.');return [ctx.privateState,key];}
  assert(name in active.values,`Missing pool witness: ${name}`);return [ctx.privateState,active.values[name]];
 }]));
 const contract=new Contract(witnesses);
 process.on('message',async message=>{
  try{
   active=unwire(message.body);calls=[];
   assert(!('callerSecret' in active.values)&&!('agentSecret' in active.values),'Signing keys cannot enter IPC.');
   const state=RT.ContractState.deserialize(active.state);
   const context=RT.createCircuitContext(RT.dummyContractAddress(),COIN,state.data,{},undefined,undefined,active.time);
   const result=contract.circuits[active.name](context,...active.args);
   let provenTx;
   if(active.prove){
    if(!proving){
     const [{CompiledContract},{createUnprovenCallTxFromInitialStates},{NodeZkConfigProvider},{httpClientProofProvider},L,{setNetworkId}]=await Promise.all([
      import('@midnight-ntwrk/midnight-js-protocol/compact-js'),import('@midnight-ntwrk/midnight-js-contracts'),
      import('@midnight-ntwrk/midnight-js-node-zk-config-provider'),import('@midnight-ntwrk/midnight-js-http-client-proof-provider'),
      import('@midnight-ntwrk/ledger-v8'),import('@midnight-ntwrk/midnight-js-network-id')]);
     const version=(await (await fetch(`${proofUri}/version`,{signal:AbortSignal.timeout(5000)})).text()).trim().replace(/^"|"$/g,'');
     assert.equal(version,'8.1.3');setNetworkId('preview');
     const zk=new NodeZkConfigProvider(dir),compiled=CompiledContract.make('line-pool',Contract).pipe(CompiledContract.withWitnesses(witnesses),CompiledContract.withCompiledFileAssets(dir));
     proving={L,zk,compiled,createUnprovenCallTxFromInitialStates,provider:httpClientProofProvider(proofUri,zk,{timeout:600_000})};
    }
    const local=proving.L.LedgerState.deserialize(active.nativeState);
    const call=await proving.createUnprovenCallTxFromInitialStates(proving.zk,{compiledContract:proving.compiled,circuitId:active.name,
     contractAddress:active.contractAddress,coinPublicKey:COIN,initialContractState:state,initialZswapChainState:local.zswap,
     ledgerParameters:local.parameters,initialPrivateState:{},args:active.args},COIN);
    provenTx=(await proving.provider.proveTx(call.private.unprovenTx)).bind().serialize();
   }
   process.send({id:message.id,body:wire({ok:true,state:stateBytes(result.context.currentQueryContext.state),calls,
    publicTranscript:publicJson(result.proofData.publicTranscript),publicInput:publicJson(result.proofData.input),publicOutput:publicJson(result.proofData.output),provenTx})});
  }catch(error){process.send({id:message.id,body:wire({ok:false,error:error.message,calls})});}
 });
 process.send({ready:true,pid:process.pid,publicKey:hex(publicKey)});
}
function startActor(role,dir,label,proofUri='http://127.0.0.1:6301'){
 const child=fork(self,['--actor',role,dir,proofUri],{execArgv:['--experimental-strip-types'],stdio:['ignore','ignore','pipe','ipc']});
 const pending=new Map();let next=0,yes,no,stderr='';
 const ready=new Promise((resolve,reject)=>{yes=resolve;no=reject;});
 const timeout=setTimeout(()=>no(new Error('Pool actor startup timed out.')),60_000);
 child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-1500);});
 child.on('error',no);child.on('exit',code=>{
  clearTimeout(timeout);const error=new Error(`Pool actor exited (${code}): ${stderr}`);no(error);
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();
 });
 child.on('message',message=>{
  if(message.ready){clearTimeout(timeout);yes({pid:message.pid,publicKey:new Uint8Array(Buffer.from(message.publicKey,'hex'))});return;}
  const p=pending.get(message.id);if(!p)return;clearTimeout(p.timer);pending.delete(message.id);p.resolve(unwire(message.body));
 });
 return {child,ready,label,request(body){return new Promise((resolve,reject)=>{
  const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Pool actor call timed out.'));},body.prove?660_000:60_000);
  pending.set(id,{resolve,reject,timer});child.send({id,body:wire(body)},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
 });}};
}
async function main(){
 mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/pool-spike-')),dir=join(work,'managed');
 const sourceHash=createHash('sha256').update(readFileSync('contracts/experimental/line-pool.compact')).digest('hex');
 const portable=path=>relative(process.cwd(),path).split(sep).join('/');
 const fullCompile=process.argv.includes('--full-compile');
 await new Promise((yes,no)=>{const child=spawn(process.execPath,['scripts/compile-compact.mjs',...(fullCompile?[]:['--skip-zk']),'contracts/experimental/line-pool.compact',portable(dir)],{stdio:'inherit'});child.on('error',no);child.on('close',code=>code===0?yes():no(new Error(`Pool compilation failed: ${code}`)));});
 assert.equal(createHash('sha256').update(readFileSync('contracts/experimental/line-pool.compact')).digest('hex'),sourceHash,'Experimental source changed during compilation.');
 const info=JSON.parse(readFileSync(join(dir,'compiler/contract-info.json'),'utf8'));
 const canonical=JSON.parse(readFileSync('contracts/managed/line/compiler/contract-info.json','utf8'));
 assert.deepEqual(info.circuits.map(c=>c.name).sort(),canonical.circuits.map(c=>c.name).sort());
 assert.deepEqual(info.circuits.filter(c=>c.name!=='openLine'),canonical.circuits.filter(c=>c.name!=='openLine'));
 const {Contract,ledger}=await import(pathToFileURL(join(dir,'contract/index.js')).href);
 const issuer=startActor('issuer',dir,'issuer'),a=startActor('agent',dir,'agent-a'),b=startActor('agent',dir,'agent-b');
 const ma=startActor('merchant',dir,'merchant-a'),mb=startActor('merchant',dir,'merchant-b'),attacker=startActor('agent',dir,'unauthorized-agent');
 const actors=[issuer,a,b,ma,mb,attacker];
 try{
  const [i,aa,bb,mA,mB]=await Promise.all(actors.map(actor=>actor.ready));
  assert.equal(new Set((await Promise.all(actors.map(actor=>actor.ready))).map(r=>r.pid)).size,6);
  const forbidden=Object.fromEntries(info.witnesses.map(({name})=>[name,()=>{throw new Error('Coordinator cannot execute actor witnesses.');}]));
  const contract=new Contract(forbidden),initial=contract.initialState(RT.createConstructorContext({},COIN),i.publicKey,mA.publicKey,bytes());
  let state=stateBytes(initial.currentContractState.data),time=NOW,lastTime=NOW;const traces=[],negativeChecks=[],disclosures=[];
  const view=()=>ledger(RT.ContractState.deserialize(state).data);
  const domain=view().contractDomain;
  async function invoke(actor,name,args,values={},accepted=true,label=name){
   assert(time>=lastTime,'The main generated lifecycle must not backdate ledger time.');lastTime=time;
   const before=state,result=await actor.request({state,time,name,args,values});
   assert.equal(result.ok,accepted,`${label}: ${result.error??'unexpected acceptance'}`);
   if(!accepted){negativeChecks.push({check:label,rejected:true});assert.deepEqual(state,before);return result;}
   state=result.state;const current=view();
   assert(current.encumberedReserve+current.redeemedReserve+current.feeReserve+current.pendingFeeReserve+current.refundReserve+current.reportedRefundReserve<=current.totalReserve);
   traces.push({actor:actor.label,circuit:name,signingWitnesses:result.calls.filter(n=>n==='callerSecret'||n==='agentSecret'),
    bookLeaves:current.books.firstFree().toString(),spentBooks:current.spentBooks.size().toString(),
    T:current.totalReserve.toString(),E:current.encumberedReserve.toString(),R:current.redeemedReserve.toString(),
    F:current.feeReserve.toString(),P:current.pendingFeeReserve.toString(),U:current.refundReserve.toString(),X:current.reportedRefundReserve.toString()});
   return result;
  }
  const bookValues=(book,salt,newSalt=bytes(),path=view().books.findPathForLeaf(commit(book,salt)))=>({bookOpening:book,bookPath:path,salt,newSalt});
  const advance=(book,outstanding,status=book.status)=>({...book,outstanding,status,epoch:book.epoch+1n});
  const fresh=(identity,limit=40n,generation=1n)=>({domain,identity,limit,outstanding:0n,epoch:0n,generation,expiry:BigInt(NOW+86400),flatFee:1n,basisPoints:0n,status:1});
  async function open(actor,identity,book,newSalt,prior,priorSalt){
   const values={enrollmentIdentity:identity,acceptedTerms:bytes(),hasPreviousBook:Boolean(prior),lineLimit:book.limit,newSalt,
    ...(prior?bookValues(prior,priorSalt,newSalt):{})};
   const args=[1n,book.expiry,book.flatFee,book.basisPoints];
   await invoke(issuer,'openLine',args,values,false,'accept-without-agent-consent');
   const prepared=await invoke(actor,'openLine',[0n,...args.slice(1)],values);
   assert(prepared.calls.includes('agentSecret')&&!prepared.calls.includes('callerSecret'));
   await invoke(actor,'openLine',args,values,false,'agent-cannot-accept-as-issuer');
   await invoke(issuer,'openLine',args,{...values,lineLimit:book.limit+1n},false,'changed-limit-consent');
   await invoke(issuer,'openLine',args,{...values,enrollmentIdentity:bytes()},false,'changed-agent-identity-consent');
   await invoke(issuer,'openLine',[1n,book.expiry,2n,0n],values,false,'changed-fee-consent');
   await invoke(issuer,'openLine',args,{...values,acceptedTerms:bytes()},false,'changed-terms-consent');
   const accepted=await invoke(issuer,'openLine',args,values);assert(!accepted.calls.includes('agentSecret'));
   assert(view().books.findPathForLeaf(commit(book,newSalt)),'Generated pool commitment must equal independent Compact encoding.');
   await invoke(issuer,'openLine',args,values,false,'enrollment-replay');
  }
  async function quote(merchant,book,amount,expiry=BigInt(NOW+500)){
   const before=new Set([...view().quotes].map(([key])=>hex(key))),values={quoteAmount:amount,invoiceId:bytes(),quoteNonce:bytes(),
    quoteBuyer:book.identity,quoteGeneration:book.generation,quoteFlatFee:book.flatFee,quoteBasisPoints:book.basisPoints};
   await invoke(merchant,'postQuote',[expiry],values);
   return {Q:[...view().quotes].find(([key])=>!before.has(hex(key)))[0],amount,expiry,invoiceId:values.invoiceId,quoteNonce:values.quoteNonce};
  }
  async function draw(actor,merchantPk,book,salt,q,newSalt=bytes(),path){
   const values={...bookValues(book,salt,newSalt,path),invoiceId:q.invoiceId,quoteNonce:q.quoteNonce,drawAmount:q.amount,
    quoteMerchantPk:merchantPk,noteNonce:bytes(),noteSalt:bytes()};
   const before=new Set([...view().notes].map(([key])=>hex(key)));
   const result=await invoke(actor,'draw',[q.Q,q.expiry,1n],values);
   const publicData=result.publicTranscript+result.publicInput+result.publicOutput;
   assert(!publicData.includes(hex(book.identity)),'Borrower identity must not be re-disclosed.');
   assert(!publicData.includes(hex(commit(book,salt))),'Selected input commitment must not be re-disclosed.');
   assert(!publicData.includes(hex(salt)),'Input book salt must remain private.');
   disclosures.push({circuit:'draw',borrowerIdentityRedisclosed:false,selectedInputLeafRedisclosed:false,inputSaltDisclosed:false,
    publicPrincipal:q.amount.toString(),publicFee:'1',privacyCertified:false});
   const next=advance(book,book.outstanding+q.amount+1n);
   assert(view().books.findPathForLeaf(commit(next,newSalt)));
   return {book:next,salt:newSalt,values,D:[...view().notes].find(([key])=>!before.has(hex(key)))[0],q};
  }
  const noteValues=drawn=>({noteGeneration:drawn.book.generation,noteIdentity:drawn.book.identity,noteQuoteCommit:drawn.q.Q,
   noteNonce:drawn.values.noteNonce,noteSalt:drawn.values.noteSalt,redeemAmount:drawn.q.amount,quoteMerchantPk:drawn.values.quoteMerchantPk});
  async function repay(book,salt,amount,ref=bytes()){
   const newSalt=bytes();const values={...bookValues(book,salt,newSalt),repayAmount:amount,paymentRef:ref,receiptNonce:bytes()};
   await invoke(issuer,'acknowledgeRepayment',[BigInt(NOW+86400)],values);return {book:advance(book,book.outstanding-amount),salt:newSalt,ref};
  }
  async function status(book,salt,next){const newSalt=bytes();await invoke(issuer,'setStatus',[next],bookValues(book,salt,newSalt));return {book:advance(book,book.outstanding,next),salt:newSalt};}
  await invoke(a,'fundReserve',[200n],{},false,'agent-cannot-fund');
  await invoke(issuer,'registerMerchant',[mB.publicKey]);await invoke(issuer,'fundReserve',[200n]);
  await invoke(issuer,'fundReserve',[18446744073709551615n],{},false,'reserve-overflow');
  let bookA=fresh(aa.publicKey),saltA=bytes(),bookB=fresh(bb.publicKey,60n),saltB=bytes();
  await open(a,aa.publicKey,bookA,saltA);
  const singletonPath=view().books.findPathForLeaf(commit(bookA,saltA)),singletonRoot=view().books.root();
  // Separate generated-execution branch with exactly one enrolled borrower.
  // It does not mutate or backdate the main multi-borrower lifecycle below.
  const soloQuoteValues={quoteAmount:15n,invoiceId:bytes(),quoteNonce:bytes(),quoteBuyer:aa.publicKey,quoteGeneration:1n,quoteFlatFee:1n,quoteBasisPoints:0n};
  const soloQuote=await ma.request({state,time:NOW,name:'postQuote',args:[BigInt(NOW+500)],values:soloQuoteValues});assert(soloQuote.ok);
  const soloView=ledger(RT.ContractState.deserialize(soloQuote.state).data);assert.equal(soloView.initialEnrollments.size(),1n);
  const soloQ=[...soloView.quotes][0][0],soloSalt=bytes();
  const soloDraw=await a.request({state:soloQuote.state,time:NOW,name:'draw',args:[soloQ,BigInt(NOW+500),1n],
   values:{...bookValues(bookA,saltA,soloSalt),invoiceId:soloQuoteValues.invoiceId,quoteNonce:soloQuoteValues.quoteNonce,
    drawAmount:15n,quoteMerchantPk:mA.publicKey,noteNonce:bytes(),noteSalt:bytes()}});assert(soloDraw.ok,soloDraw.error);
  const soloAfter=ledger(RT.ContractState.deserialize(soloDraw.state).data),soloNote=[...soloAfter.notes][0][1];
  const reconstructed=soloNote.amount+soloNote.fee;
  assert(soloAfter.books.findPathForLeaf(commit(advance(bookA,reconstructed),soloSalt)));
  const singleBorrowerCounterexample={separateGeneratedExecution:true,knownZeroSingleBorrower:true,
   publicPrincipal:soloNote.amount.toString(),publicFee:soloNote.fee.toString(),reconstructedDebt:reconstructed.toString()};
  await open(b,bb.publicKey,bookB,saltB);
  const oldRootQuote=await ma.request({state,time:NOW,name:'postQuote',args:[BigInt(NOW+500)],values:soloQuoteValues});assert(oldRootQuote.ok);
  const oldRootLedger=ledger(RT.ContractState.deserialize(oldRootQuote.state).data),oldRootQ=[...oldRootLedger.quotes][0][0];
  const oldRootDraw=await a.request({state:oldRootQuote.state,time:NOW,name:'draw',args:[oldRootQ,BigInt(NOW+500),1n],
   values:{...bookValues(bookA,saltA,bytes(),singletonPath),invoiceId:soloQuoteValues.invoiceId,quoteNonce:soloQuoteValues.quoteNonce,
    drawAmount:15n,quoteMerchantPk:mA.publicKey,noteNonce:bytes(),noteSalt:bytes()}});assert(oldRootDraw.ok,oldRootDraw.error);
  assert.equal(oldRootLedger.initialEnrollments.size(),2n);
  assert(oldRootLedger.books.checkRoot(singletonRoot),'The old one-borrower root remains accepted.');
  const rootEncoding=RT.CompactTypeField.toValue(singletonRoot.field);
  assert(rootEncoding.some(part=>oldRootDraw.publicTranscript.includes(hex(part))),'The old membership root is observable in the public query.');
  const rootAgeCounterexample={separateGeneratedExecution:true,currentBorrowers:'2',chosenRootBorrowers:'1',
   singletonHistoricRootAccepted:true,oldMembershipRootPubliclyRecognizable:true};
  for(const key of ['identityCommit','lineCommit','lineGeneration','status'])assert(!(key in view()),`No public singleton ${key}.`);
  const cachedB=view().books.findPathForLeaf(commit(bookB,saltB));
  const qa=await quote(ma,bookA,15n),qb=await quote(mb,bookB,20n),racing=await quote(ma,bookA,5n,BigInt(NOW+100));
  const bad={...bookValues(bookA,saltA),invoiceId:qa.invoiceId,quoteNonce:qa.quoteNonce,drawAmount:15n,quoteMerchantPk:mA.publicKey,noteNonce:bytes(),noteSalt:bytes()};
  for(const actor of [issuer,ma,attacker,b])await invoke(actor,'draw',[qa.Q,qa.expiry,1n],bad,false,`${actor.label}-cannot-draw-agent-a-book`);
  await invoke(b,'draw',[qa.Q,qa.expiry,1n],{...bad,...bookValues(bookB,saltB)},false,'different-borrower-cannot-steal-quote-into-own-book');
  await invoke(a,'draw',[qa.Q,qa.expiry,1n],{...bad,bookOpening:{...bookA,limit:41n}},false,'forged-private-limit');
  await invoke(a,'draw',[qa.Q,qa.expiry,1n],{...bad,bookPath:cachedB},false,'other-book-path');
  const mutatedPath=structuredClone(bad.bookPath);mutatedPath.path[0].sibling.field+=1n;
  await invoke(a,'draw',[qa.Q,qa.expiry,1n],{...bad,bookPath:mutatedPath},false,'forged-membership-path');
  const firstA=await draw(a,mA.publicKey,bookA,saltA,qa);
  await invoke(a,'draw',[racing.Q,racing.expiry,1n],{...bad,invoiceId:racing.invoiceId,quoteNonce:racing.quoteNonce,drawAmount:5n},false,'same-book-competing-quote-double-spend');
  await invoke(a,'draw',[qa.Q,qa.expiry,1n],firstA.values,false,'draw-replay');
  bookA=firstA.book;saltA=firstA.salt;
  const firstB=await draw(b,mB.publicKey,bookB,saltB,qb,bytes(),cachedB);bookB=firstB.book;saltB=firstB.salt;
  const tooLarge=await quote(ma,bookA,40n);
  await invoke(a,'draw',[tooLarge.Q,tooLarge.expiry,1n],{...bookValues(bookA,saltA),invoiceId:tooLarge.invoiceId,quoteNonce:tooLarge.quoteNonce,
   drawAmount:40n,quoteMerchantPk:mA.publicKey,noteNonce:bytes(),noteSalt:bytes()},false,'over-limit-draw');
  await invoke(mb,'redeemDraw',[firstA.D,qa.expiry],noteValues(firstA),false,'wrong-merchant-redemption');
  await invoke(ma,'redeemDraw',[firstA.D,qa.expiry],noteValues(firstA));
  await invoke(ma,'redeemDraw',[firstA.D,qa.expiry],noteValues(firstA),false,'redemption-replay');
  const payment=bytes(),repaidA=await repay(bookA,saltA,10n,payment);bookA=repaidA.book;saltA=repaidA.salt;
  await invoke(a,'acknowledgeRepayment',[BigInt(NOW+86400)],{...bookValues(bookA,saltA),repayAmount:1n,paymentRef:bytes(),receiptNonce:bytes()},false,'agent-cannot-acknowledge-repayment');
  await invoke(issuer,'acknowledgeRepayment',[BigInt(NOW+86400)],{...bookValues(bookA,saltA),repayAmount:1n,paymentRef:payment,receiptNonce:bytes()},false,'stable-payment-reference-replay');
  let changed=await status(bookA,saltA,2);bookA=changed.book;saltA=changed.salt;
  await invoke(a,'draw',[racing.Q,racing.expiry,1n],{...bookValues(bookA,saltA),...racing,drawAmount:5n,quoteMerchantPk:mA.publicKey,noteNonce:bytes(),noteSalt:bytes()},false,'default-blocks-draw');
  changed=await status(bookA,saltA,1);bookA=changed.book;saltA=changed.salt;assert.equal(bookA.outstanding,6n);
  await invoke(issuer,'setStatus',[3],bookValues(bookA,saltA),false,'debt-cannot-be-closed-away');
  const oldA=await draw(a,mA.publicKey,bookA,saltA,racing);bookA=oldA.book;saltA=oldA.salt;
  let paid=await repay(bookA,saltA,12n);bookA=paid.book;saltA=paid.salt;
  changed=await status(bookA,saltA,3);bookA=changed.book;saltA=changed.salt;
  const reopened=fresh(aa.publicKey,40n,2n),reopenSalt=bytes();await open(a,aa.publicKey,reopened,reopenSalt,bookA,saltA);bookA=reopened;saltA=reopenSalt;
  const newQA=await quote(ma,bookA,10n,BigInt(NOW+86400)),newA=await draw(a,mA.publicKey,bookA,saltA,newQA);bookA=newA.book;saltA=newA.salt;
  const qc=await quote(mb,bookB,8n,BigInt(NOW+100)),cancelB=await draw(b,mB.publicKey,bookB,saltB,qc);bookB=cancelB.book;saltB=cancelB.salt;
  paid=await repay(bookB,saltB,27n);bookB=paid.book;saltB=paid.salt;
  await invoke(issuer,'cancelOrExpireNote',[cancelB.D,0n,0n],{},false,'premature-expiry');
  time=Number(qc.expiry);await invoke(attacker,'cancelOrExpireNote',[cancelB.D,0n,0n]); // Exact cutoff.
  let refundSalt=bytes();
  await invoke(issuer,'cancelOrExpireNote',[cancelB.D,1n,0n],{...bookValues(bookB,saltB,refundSalt),...noteValues(cancelB)});
  bookB=advance(bookB,0n);saltB=refundSalt;assert(view().books.findPathForLeaf(commit(bookB,saltB)));
  await invoke(issuer,'cancelOrExpireNote',[cancelB.D,2n,BigInt(time+1000)],{...noteValues(cancelB),salt:refundSalt,repayAmount:6n,paymentRef:bytes()});
  await invoke(issuer,'cancelOrExpireNote',[cancelB.D,1n,0n],{...bookValues(bookB,saltB),...noteValues(cancelB)},false,'compensation-replay');
  refundSalt=bytes();await invoke(a,'cancelOrExpireNote',[oldA.D,1n,0n],{...bookValues(bookA,saltA,refundSalt),...noteValues(oldA)});
  bookA=advance(bookA,11n);saltA=refundSalt;assert(view().books.findPathForLeaf(commit(bookA,saltA)),'Old note must not erase new-generation debt.');
  await invoke(issuer,'cancelOrExpireNote',[oldA.D,2n,BigInt(time+1000)],{...noteValues(oldA),salt:refundSalt,repayAmount:6n,paymentRef:bytes()});
  // Existing Merchant B claim remains redeemable after disabling new offers.
  await invoke(issuer,'disableMerchant',[mB.publicKey]);
  await invoke(mb,'postQuote',[BigInt(NOW+1000)],{quoteAmount:1n,invoiceId:bytes(),quoteNonce:bytes(),quoteGeneration:1n,quoteFlatFee:1n,quoteBasisPoints:0n},false,'disabled-merchant-new-quote');
  await invoke(mb,'redeemDraw',[firstB.D,qb.expiry],noteValues(firstB));
  await invoke(ma,'redeemDraw',[newA.D,newQA.expiry],noteValues(newA));
  await invoke(issuer,'withdrawFees',[]);await invoke(issuer,'withdrawUnencumberedReserve',[10n]);
  await invoke(issuer,'withdrawUnencumberedReserve',[128n],{},false,'cannot-withdraw-claim-or-refund-backing');
  paid=await repay(bookA,saltA,11n);bookA=paid.book;saltA=paid.salt;
  await status(bookA,saltA,3);await status(bookB,saltB,3);
  assert.deepEqual([...new Set(traces.map(t=>t.circuit))].sort(),info.circuits.map(c=>c.name).sort());
  const final=view();assert.equal(final.totalReserve,187n);assert.equal(final.redeemedReserve,45n);assert.equal(final.reportedRefundReserve,15n);
  assert.equal(final.encumberedReserve+final.pendingFeeReserve+final.feeReserve+final.refundReserve,0n);
  const files=['contract/index.js','compiler/contract-info.json',...(fullCompile?info.circuits.flatMap(({name})=>[`keys/${name}.prover`,`keys/${name}.verifier`,`zkir/${name}.bzkir`]):[])];
  const artifactFingerprints=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(join(dir,file))).digest('hex')]));
  const report={schema:'line-private-pool-feasibility/v1',createdAt:new Date().toISOString(),artifactFingerprints,
   sourceSha256:sourceHash,
   compiler:info['compiler-version'],language:info['language-version'],runtime:info['runtime-version'],
   canonicalModified:false,exportedCircuits:info.circuits.map(c=>c.name),independentKeyProcesses:6,coordinatorTrusted:true,
   privateBooksSharedWithTrustedCoordinator:true,canonicalCustodyIntegrated:false,legalBorrowerAuthorityEstablished:false,
   selectedInputLeafNotRedisclosed:true,singletonPublicBookFieldsAbsent:true,historicRootsAndBookNullifiersExercised:true,
   fullHistoryPrivacyPassed:false,syntheticLedgerTime:true,fullProvingArtifactsGenerated:fullCompile,cryptographicProofsGenerated:false,networkSubmitted:false,assetTransfers:false,
   authenticatedCashSettlement:false,lowPopulationCounterexample:singleBorrowerCounterexample,rootAgeCounterexample,
   residualDisclosureRisks:['historic root choice narrows the borrower population','public line expiry narrows candidate books','known-zero low population or all-other-borrower knowledge','unique fees/amounts/merchant/timing and sender/prover metadata','public close/compensation bounds'],
   traces,negativeChecks,drawDisclosureChecks:disclosures};
  writeFileSync(join(work,'evidence.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({result:'TWELVE-CIRCUIT PRIVATE-BOOK FEASIBILITY PASS; COMPLETE PRIVACY UNMET',evidence:join(work,'evidence.json')}));
 }finally{for(const actor of actors)actor.child.kill();}
}
export { BOOK_TYPE, commit, startActor };
if(process.argv[1]&&resolve(process.argv[1])===self){
 if(process.argv[2]==='--actor')await actorMain(process.argv[3],process.argv[4],process.argv[5]);
 else main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
