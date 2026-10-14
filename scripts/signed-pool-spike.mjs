#!/usr/bin/env node
/** Full twelve-circuit signed-role fixture, not deployment or certification.
 * Child processes retain signing scalars; the coordinator executes Compact
 * using signatures and authorized private books. Synthetic fixture signers
 * approve requested actions; institutional consent and policies are untested.
 */
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { BYTES32, UINT64 } from '../src/lib/line/encoding.ts';
import { startSigner, roleHash, ORDER, words } from './signed-pool-signers.mjs';
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

function startActor(role,dir,label){
 const signer=startSigner(label);let contract,ledger,info;
 const ready=signer.ready.then(async ({pid,pk})=>{
  ({Contract:contract,ledger}=await import(pathToFileURL(join(dir,'contract/index.js')).href));
  info=JSON.parse(readFileSync(join(dir,'compiler/contract-info.json'),'utf8'));
  return {pid,pk,publicKey:role==='agent'?undefined:roleHash(role,pk)};
 });
 const prepareApproval=async body=>{
  await ready;const view=ledger(RT.ContractState.deserialize(body.state).data);
  return signer.approve({...body,domain:view.contractDomain,feeReserve:view.feeReserve});
 };
 return {child:signer.child,ready,label,prepareApproval,async request(body){
  const {pk}=await ready;let calls=[];
  try{
   const state=RT.ContractState.deserialize(body.state),view=ledger(state.data);
   const values={...body.values,...await prepareApproval(body),...body.approvalOverride};
   assert(!('callerSecret' in values)&&!('agentSecret' in values),'No scalar may enter circuit witnesses.');
   const witnesses=Object.fromEntries(info.witnesses.map(({name})=>[name,ctx=>{
    calls.push(name);assert(name in values,`Missing signed-pool witness: ${name}`);return [ctx.privateState,values[name]];
   }]));
   const context=RT.createCircuitContext(RT.dummyContractAddress(),COIN,state.data,{},undefined,undefined,body.time);
   const result=new contract(witnesses).circuits[body.name](context,...body.args);
   return {ok:true,state:stateBytes(result.context.currentQueryContext.state),calls,
    publicTranscript:publicJson(result.proofData.publicTranscript),publicInput:publicJson(result.proofData.input),publicOutput:publicJson(result.proofData.output)};
  }catch(error){return {ok:false,error:error.message,calls};}
 }};
}
async function main(){
 mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/signed-pool-spike-'));
 const cachedIndex=process.argv.indexOf('--compiled-dir');
 const dir=cachedIndex<0?join(work,'managed'):resolve(process.argv[cachedIndex+1]);
 const sourceHash=createHash('sha256').update(readFileSync('contracts/experimental/line-signed-pool.compact')).digest('hex');
 const portable=path=>relative(process.cwd(),path).split(sep).join('/');
 const fullCompile=process.argv.includes('--full-compile');
 if(cachedIndex<0)await new Promise((yes,no)=>{const child=spawn(process.execPath,['scripts/compile-compact.mjs',...(fullCompile?[]:['--skip-zk']),'contracts/experimental/line-signed-pool.compact',portable(dir)],{stdio:'inherit'});child.on('error',no);child.on('close',code=>code===0?yes():no(new Error(`Pool compilation failed: ${code}`)));});
 else assert(!fullCompile,'Cached generated execution cannot establish a full compilation.');
 assert.equal(createHash('sha256').update(readFileSync('contracts/experimental/line-signed-pool.compact')).digest('hex'),sourceHash,'Experimental source changed during compilation.');
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
  const nullifierKey=bytes(),stableKeyCommit=(await import('./signed-pool-signers.mjs')).hash([(await import('./signed-pool-signers.mjs')).tag('line:signed:nk'),nullifierKey]);
  const contract=new Contract(forbidden),initial=contract.initialState(RT.createConstructorContext({},COIN),i.publicKey,mA.publicKey,bytes(),stableKeyCommit);
  let state=stateBytes(initial.currentContractState.data),time=NOW,lastTime=NOW;const traces=[],negativeChecks=[],disclosures=[];
  const view=()=>ledger(RT.ContractState.deserialize(state).data);
  const domain=view().contractDomain;aa.publicKey=roleHash('agent',aa.pk,domain);bb.publicKey=roleHash('agent',bb.pk,domain);
  async function invoke(actor,name,args,values={},accepted=true,label=name){
   assert(time>=lastTime,'The main generated lifecycle must not backdate ledger time.');lastTime=time;
   const before=state,result=await actor.request({state,time,name,args,values:{nullifierKey,...values}});
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
   assert(prepared.calls.includes('roleApproval')&&!prepared.calls.includes('agentSecret')&&!prepared.calls.includes('callerSecret'));
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
  await invoke(mb,'postQuote',[BigInt(NOW+1000)],{quoteAmount:1n,invoiceId:bytes(),quoteNonce:bytes(),quoteBuyer:bookB.identity,quoteGeneration:1n,quoteFlatFee:1n,quoteBasisPoints:0n},false,'disabled-merchant-new-quote');
  await invoke(mb,'redeemDraw',[firstB.D,qb.expiry],noteValues(firstB));
  await invoke(ma,'redeemDraw',[newA.D,newQA.expiry],noteValues(newA));
  await invoke(issuer,'withdrawFees',[]);await invoke(issuer,'withdrawUnencumberedReserve',[10n]);
  await invoke(issuer,'withdrawUnencumberedReserve',[128n],{},false,'cannot-withdraw-claim-or-refund-backing');
  paid=await repay(bookA,saltA,11n);bookA=paid.book;saltA=paid.salt;
  await status(bookA,saltA,3);await status(bookB,saltB,3);
  assert.deepEqual([...new Set(traces.map(t=>t.circuit))].sort(),info.circuits.map(c=>c.name).sort());
  const final=view();assert.equal(final.totalReserve,187n);assert.equal(final.redeemedReserve,45n);assert.equal(final.reportedRefundReserve,15n);
  assert.equal(final.encumberedReserve+final.pendingFeeReserve+final.feeReserve+final.refundReserve,0n);
  // Isolated branches from the final state: these do not alter main accounting.
  const signatureChecks=[];
  const funding={state,time,name:'fundReserve',args:[1n],values:{nullifierKey}};
  const approval=await issuer.prepareApproval(funding);
  async function rejectApproval(label,body,override,expected){
   const result=await issuer.request({...body,approvalOverride:override});
   assert.equal(result.ok,false,label);assert(result.calls.includes('roleApproval'),`${label}: signature must reach Compact`);
   if(expected)assert(result.error.includes(expected),`${label}: unexpected rejection boundary`);
   signatureChecks.push({check:label,rejectedByGeneratedCompact:true});
  }
  const acceptedFunding=await issuer.request({...funding,approvalOverride:approval});assert(acceptedFunding.ok);
  await rejectApproval('same-approval-cannot-fund-twice',{...funding,state:acceptedFunding.state},approval,'approval replay');
  await rejectApproval('changed-approved-funding-amount',{...funding,args:[2n]},approval);
  await rejectApproval('changed-approved-operation',{...funding,name:'withdrawUnencumberedReserve'},approval);
  const identity=RT.ecMulGenerator(0n);
  for(const [label,override,expected] of [
   ['identity-announcement',{...approval,roleApproval:{...approval.roleApproval,announcement:identity}},'identity approval'],
   ['small-subgroup-announcement',{...approval,roleApproval:{...approval.roleApproval,announcement:{x:0n,y:RT.MAX_FIELD}}}],
   ['off-curve-announcement',{...approval,roleApproval:{...approval.roleApproval,announcement:{x:0n,y:0n}}}],
   ['response-at-group-order',{...approval,roleApproval:{...approval.roleApproval,response:words(ORDER)}},'approval scalar range'],
   ['challenge-remainder-at-group-order',{...approval,challengeRemainder:words(ORDER)},'approval scalar range'],
   ['wrong-challenge-quotient',{...approval,challengeQuotient:approval.challengeQuotient+1n},'approval low reduction'],
   ['wrong-integer-carry',{...approval,challengeCarry:approval.challengeCarry+1n},'approval low reduction'],
   ['wrong-challenge-words',{...approval,challengeWords:words(0n)},'approval challenge words'],
   ['altered-response',{...approval,roleApproval:{...approval.roleApproval,response:words(1n)}},'approval signature'],
  ])await rejectApproval(label,funding,override,expected);
  const lifted=await issuer.prepareApproval({...funding,challengeLiftForTest:true});
  await rejectApproval('valid-signature-for-noncanonical-field-lift',funding,lifted,'approval canonical challenge');
  const agentPreparation={state,time,name:'openLine',args:[0n,BigInt(time+1000),1n,0n],values:{lineLimit:40n,
   hasPreviousBook:false,acceptedTerms:bytes(),newSalt:bytes()}};
  const agentApproval=await a.prepareApproval(agentPreparation);
  for(const [label,pk]of [['identity-key',identity],['small-subgroup-key',{x:0n,y:RT.MAX_FIELD}],['off-curve-key',{x:0n,y:0n}]]){
   const result=await a.request({...agentPreparation,approvalOverride:{...agentApproval,rolePublicKey:pk}});
   assert(!result.ok,label);assert(result.calls.includes('roleApproval'));
   signatureChecks.push({check:label,rejectedByGeneratedCompact:true});
  }
  const files=['contract/index.js','compiler/contract-info.json',...(fullCompile?info.circuits.flatMap(({name})=>[`keys/${name}.prover`,`keys/${name}.verifier`,`zkir/${name}.bzkir`]):[])];
  const artifactFingerprints=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(join(dir,file))).digest('hex')]));
  const report={schema:'line-signed-pool-feasibility/v1',createdAt:new Date().toISOString(),artifactFingerprints,
   freshCompilation:cachedIndex<0,cachedGeneratedBindings:cachedIndex>=0,sourceBindingVerifiedByThisRun:cachedIndex<0,
   sourceSha256:sourceHash,
   compiler:info['compiler-version'],language:info['language-version'],runtime:info['runtime-version'],
   canonicalModified:false,exportedCircuits:info.circuits.map(c=>c.name),independentKeyProcesses:6,coordinatorTrusted:true,
   privateBooksSharedWithTrustedCoordinator:true,signingScalarsSharedWithCoordinator:false,signingScalarsInCircuitWitnesses:false,syntheticUnrestrictedSignerFixtures:true,canonicalCustodyIntegrated:false,legalBorrowerAuthorityEstablished:false,
   selectedInputLeafNotRedisclosed:true,singletonPublicBookFieldsAbsent:true,historicRootsAndBookNullifiersExercised:true,
   fullHistoryPrivacyPassed:false,syntheticLedgerTime:true,fullProvingArtifactsGenerated:fullCompile,cryptographicProofsGenerated:false,networkSubmitted:false,assetTransfers:false,
   authenticatedCashSettlement:false,lowPopulationCounterexample:singleBorrowerCounterexample,rootAgeCounterexample,
   residualDisclosureRisks:['historic root choice narrows the borrower population','public line expiry narrows candidate books','known-zero low population or all-other-borrower knowledge','unique fees/amounts/merchant/timing and sender/prover metadata','public close/compensation bounds'],
   traces,negativeChecks,signatureChecks,drawDisclosureChecks:disclosures};
  writeFileSync(join(work,'evidence.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({result:'TWELVE-CIRCUIT SIGNED-ROLE FEASIBILITY PASS; COMPLETE PRIVACY UNMET',evidence:join(work,'evidence.json')}));
 }finally{for(const actor of actors)actor.child.kill();}
}
export { BOOK_TYPE, commit, startActor };
if(process.argv[1]&&resolve(process.argv[1])===self)main().catch(error=>{console.error(error.message);process.exitCode=1;});
