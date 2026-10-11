#!/usr/bin/env node
/** Twelve-circuit private merchant-membership compatibility fixture.
 * Trusted coordinator/prover holds private books and reserve openings; signer
 * children retain signing scalars and receive only selected action terms.
 * All bookkeeping candidates come from Compact remember witnesses. They are
 * not durable/finalized records. Fixture signers are not institutional policy.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { BYTES32, UINT64 } from '../src/lib/line/encoding.ts';
import { commit } from './private-pool-spike.mjs';
import { startSigner, roleHash, hash, tag, bytes, words, ORDER } from './signed-pool-signers.mjs';

const COIN='0'.repeat(64),NOW=1_800_000_000,MAX=18446744073709551615n;
const hex=value=>Buffer.from(value).toString('hex');
const fingerprint=value=>createHash('sha256').update(value).digest('hex');
const stateBytes=data=>{const state=new RT.ContractState();state.data=data instanceof RT.ChargedState?data:new RT.ChargedState(data);return state.serialize();};
const structType=fields=>({alignment:()=>fields.flatMap(([,type])=>type.alignment()),toValue:value=>fields.flatMap(([key,type])=>type.toValue(value[key])),
 fromValue:value=>Object.fromEntries(fields.map(([key,type])=>[key,type.fromValue(value)]))});
const reserveFields=['epoch','totalReserve','encumberedReserve','redeemedReserve','feeReserve','pendingFeeReserve','refundReserve','reportedRefundReserve'];
const RESERVE=structType([['domain',BYTES32],...reserveFields.map(key=>[key,UINT64])]);
const BOOLEAN=RT.CompactTypeBoolean;
const NOTE=structType([['amount',UINT64],['fee',UINT64],['redeemed',BOOLEAN],['cancelled',BOOLEAN],['expiry',UINT64],
 ['compensationAllocated',BOOLEAN],['refundCommitment',BYTES32],['cashRefundOwed',BOOLEAN],['refundAcknowledged',BOOLEAN],['refundPaymentNullifier',BYTES32]]);
const QUOTE=structType([['expiry',UINT64],['used',BOOLEAN]]);
const NOTE_STATE=structType([['domain',BYTES32],['noteCommit',BYTES32],['meta',NOTE]]);
const QUOTE_STATE=structType([['domain',BYTES32],['quoteCommit',BYTES32],['meta',QUOTE]]);
const publicJson=value=>JSON.stringify(value,(_key,value)=>typeof value==='bigint'?value.toString():value instanceof Uint8Array?
 hex(value.length<=32?BYTES32.fromValue([value]):value):value);
const locked=r=>r.encumberedReserve+r.redeemedReserve+r.feeReserve+r.pendingFeeReserve+r.refundReserve+r.reportedRefundReserve;

export async function runPrivateMerchantFixture({compiledDir,onInitialize,onAccepted,onComplete}={}){
 mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/private-merchant-spike-'));
 const cachedIndex=process.argv.indexOf('--compiled-dir'),cached=Boolean(compiledDir)||cachedIndex>=0;
 const dir=compiledDir?resolve(compiledDir):cachedIndex<0?join(work,'managed'):resolve(process.argv[cachedIndex+1]);
 const source='contracts/experimental/line-private-merchant.compact',sourceHash=fingerprint(readFileSync(source));
 if(!cached)await new Promise((yes,no)=>{
  const portable=relative(process.cwd(),dir).split(sep).join('/');
  const child=spawn(process.execPath,['scripts/compile-compact.mjs','--skip-zk',source,portable],{stdio:'inherit'});
  child.on('error',no);child.on('close',code=>code===0?yes():no(Error(`Private signed compilation failed: ${code}`)));
 });
 assert.equal(fingerprint(readFileSync(source)),sourceHash,'Source changed during compilation.');
 const info=JSON.parse(readFileSync(join(dir,'compiler/contract-info.json'),'utf8'));
 const canonical=JSON.parse(readFileSync('contracts/managed/line/compiler/contract-info.json','utf8'));
 assert.deepEqual(info.circuits.map(c=>c.name).sort(),canonical.circuits.map(c=>c.name).sort());
 assert(!info.witnesses.some(w=>['callerSecret','agentSecret'].includes(w.name)));
 const {Contract,ledger}=await import(pathToFileURL(join(dir,'contract/index.js')).href);
 const roles=['issuer','agent-a','agent-b','merchant-a','merchant-b','attacker'];
 const signers=roles.map(startSigner),actors=Object.fromEntries(roles.map((role,i)=>[role,signers[i]]));
 const traces=[],negativeChecks=[],disclosureChecks=[];
 try{
  const points=await Promise.all(signers.map(s=>s.ready));assert.equal(new Set(points.map(p=>p.pid)).size,6);
  const issuerPk=roleHash('issuer',points[0].pk),mA=roleHash('merchant',points[3].pk),mB=roleHash('merchant',points[4].pk);
  const nullifierKey=bytes(),initialReserveSalt=bytes(),stableKeyCommit=hash([tag('line:signed:nk'),nullifierKey]);
  const records=new Map();let activeValues={},calls=[];
  const witnesses=Object.fromEntries(info.witnesses.map(({name})=>[name,(ctx,...args)=>{
   calls.push(name);
   if(name==='rememberReserve')return [{...ctx.privateState,reserve:{book:args[0],salt:args[1]}},[]];
   if(name==='rememberNote')return [{...ctx.privateState,notes:{...ctx.privateState.notes,[hex(args[0])]:{meta:args[1],salt:args[2]}}},[]];
   if(name==='rememberQuote')return [{...ctx.privateState,quotes:{...ctx.privateState.quotes,[hex(args[0])]:{meta:args[1],salt:args[2]}}},[]];
   assert(name in activeValues,`Missing private signed witness: ${name}`);return [ctx.privateState,activeValues[name]];
  }]));
  const contract=new Contract(witnesses);activeValues={reserveSalt:initialReserveSalt};
  const initial=contract.initialState(RT.createConstructorContext({notes:{},quotes:{}},COIN),issuerPk,mA,bytes(),stableKeyCommit);
  const execution=await onInitialize?.({dir,info,initial,sourceHash,now:NOW});
  const contractAddress=execution?.contractAddress??RT.dummyContractAddress();
  let state=stateBytes(initial.currentContractState.data),time=NOW;records.set(fingerprint(state),initial.currentPrivateState);
  const view=(s=state)=>ledger(RT.ContractState.deserialize(s).data);
  const privateView=(s=state)=>records.get(fingerprint(s));
  const domain=view().contractDomain,aId=roleHash('agent',points[1].pk,domain),bId=roleHash('agent',points[2].pk,domain);
  const initialEnabledPath=view().enabledMerchantTree.findPathForLeaf(mA);
  const initialRegisteredPath=view().registeredMerchantTree.findPathForLeaf(mA);
  const cachedMerchantPaths=new Map([[hex(mA),initialEnabledPath]]);
  function validate(s,ps){
   const v=view(s),r=ps.reserve.book;assert(locked(r)<=r.totalReserve);
   assert.deepEqual(RT.persistentCommit(RESERVE,r,ps.reserve.salt),v.reserveCommit,'Generated reserve must match independent Compact encoding.');
   for(const [id,record]of Object.entries(ps.notes))assert.deepEqual(RT.persistentCommit(NOTE_STATE,{domain,noteCommit:new Uint8Array(Buffer.from(id,'hex')),meta:record.meta},record.salt),v.notes.lookup(new Uint8Array(Buffer.from(id,'hex'))));
   for(const [id,record]of Object.entries(ps.quotes))assert.deepEqual(RT.persistentCommit(QUOTE_STATE,{domain,quoteCommit:new Uint8Array(Buffer.from(id,'hex')),meta:record.meta},record.salt),v.quotes.lookup(new Uint8Array(Buffer.from(id,'hex'))));
   for(const name of reserveFields)assert(!(name in v),'Public reserve totals/epoch must be absent.');
  }
  validate(state,initial.currentPrivateState);
  async function execute(role,name,args,values={},options={}){
   const input=options.state??state,ps=privateView(input);assert(ps,'Private opening checkpoint required.');
   const v=view(input),selectedId=args[0] instanceof Uint8Array?hex(args[0]):'';
   const noteRecord=ps.notes[selectedId],quoteRecord=ps.quotes[selectedId];
   const full={nullifierKey,reserveOpening:ps.reserve.book,reserveSalt:ps.reserve.salt,newReserveSalt:bytes(),newNoteMetaSalt:bytes(),newQuoteMetaSalt:bytes(),
    ...(noteRecord?{noteMetaOpening:noteRecord.meta,noteMetaSalt:noteRecord.salt}:{}),
    ...(quoteRecord?{quoteMetaOpening:quoteRecord.meta,quoteMetaSalt:quoteRecord.salt}:{}),...values};
   if(name==='postQuote'||name==='draw'){
    const m=name==='postQuote'?roleHash('merchant',points[roles.indexOf(role)].pk):full.quoteMerchantPk;
    const enabled=v.enabledMerchantTree.findPathForLeaf(m);
    if(enabled)cachedMerchantPaths.set(hex(m),enabled);
    full.enabledMerchantPath=enabled??cachedMerchantPaths.get(hex(m))??v.enabledMerchantTree.findPathForLeaf(mA);
    full.registeredMerchantPath=v.registeredMerchantTree.findPathForLeaf(m)??v.registeredMerchantTree.findPathForLeaf(mA);
    Object.assign(full,values);
   }
   let circuitArgs=args;
   if(name==='fundReserve'||name==='withdrawUnencumberedReserve'){full.reserveAmount=args[0];circuitArgs=[];}
   if(name==='draw'){full.drawFee=args[2];circuitArgs=args.slice(0,2);}
   if(name==='openLine'){full.lineFlatFee=args[2];full.lineBasisPoints=args[3];circuitArgs=args.slice(0,2);}
   if(name==='setStatus'){full.requestedStatus=args[0];circuitArgs=[];}
   const {reserveOpening,reserveSalt,newReserveSalt,nullifierKey:ignoredKey,...selected}=full;
   let approval;
   try{approval=await actors[role].approve({name,args,values:selected,domain,privateFinance:true,reserveCommit:v.reserveCommit,
    feeReserve:role==='issuer'?ps.reserve.book.feeReserve:undefined});}
   catch(error){throw Error(`${name}: signer fixture could not construct approval (${error.name})`);}
   activeValues={...full,...approval,...options.approvalOverride};calls=[];
   let completedCircuit=false;
   try{
    const seconds=options.time??time;
    const context=RT.createCircuitContext(contractAddress,COIN,RT.ContractState.deserialize(input).data,structuredClone(ps),undefined,undefined,seconds);
    const initialQueryContext=context.currentQueryContext;
    const result=contract.circuits[name](context,...circuitArgs),nextState=stateBytes(result.context.currentQueryContext.state),nextPrivate=result.context.currentPrivateState;
    completedCircuit=true;
    validate(nextState,nextPrivate);
    const pub={transcript:publicJson(result.proofData.publicTranscript),input:publicJson(result.proofData.input),output:publicJson(result.proofData.output)};
    if(name==='fundReserve'||name==='withdrawUnencumberedReserve'||name==='setStatus')assert.equal(result.proofData.input.value.length,0,'Private values must not remain in exported circuit input.');
    if(name==='draw'||name==='openLine')assert(!pub.input.includes(hex(RT.convertFieldToBytes(32,7n,'private fee'))),'Fee/price policy must be absent from exported input.');
    if(name==='draw'||name==='postQuote'){
     const observed=pub.transcript+pub.input+pub.output;
     for(const m of [mA,mB])assert(!observed.includes(hex(m)),'Selected merchant must be absent from this public call.');
    }
    if(options.expected===false)throw Error(`Unexpected acceptance: ${options.label}`);
    assert(!calls.includes('callerSecret')&&!calls.includes('agentSecret'));
    // Proving/finality hooks must accept the derived public transition before
    // publishing the corresponding private opening checkpoint.
    if(!options.branch)await onAccepted?.({role,name,seconds,input,nextState,result,initialQueryContext,publicData:pub});
    records.set(fingerprint(nextState),nextPrivate);
    if(!options.branch){state=nextState;traces.push({actor:role,circuit:name,signingScalarWitnesses:0,reserveEpoch:nextPrivate.reserve.book.epoch.toString()});}
    return {state:nextState,privateState:nextPrivate,public:pub,approval};
   }catch(error){
    if(options.expected!==false)throw error;
    assert(!completedCircuit,'A parent validation failure must not count as a Compact rejection.');
    assert(!String(error.message).startsWith('Unexpected acceptance:'));
    negativeChecks.push({check:options.label,rejectedByGeneratedCompact:true});return {rejected:true};
   }
  }
  const invoke=(role,name,args,values)=>execute(role,name,args,values);
  const reject=(label,role,name,args,values={},extra={})=>execute(role,name,args,values,{...extra,expected:false,label});
  const bookValues=(book,salt,newSalt=bytes(),path=view().books.findPathForLeaf(commit(book,salt)))=>({bookOpening:book,bookPath:path,salt,newSalt});
  const advance=(book,outstanding,status=book.status)=>({...book,outstanding,status,epoch:book.epoch+1n});
  const fresh=(identity,limit=1500n,generation=1n)=>({domain,identity,limit,outstanding:0n,epoch:0n,generation,expiry:BigInt(NOW+86400),flatFee:7n,basisPoints:0n,status:1});
  async function open(role,identity,book,newSalt,prior,priorSalt){
   const values={enrollmentIdentity:identity,acceptedTerms:bytes(),hasPreviousBook:Boolean(prior),lineLimit:book.limit,newSalt,...(prior?bookValues(prior,priorSalt,newSalt):{})};
   const args=[1n,book.expiry,book.flatFee,book.basisPoints];
   await reject('missing-agent-consent','issuer','openLine',args,values);
   await invoke(role,'openLine',[0n,...args.slice(1)],values);
   await reject('agent-cannot-accept',role,'openLine',args,values);
   await reject('changed-limit-consent','issuer','openLine',args,{...values,lineLimit:book.limit+1n});
   await invoke('issuer','openLine',args,values);assert(view().books.findPathForLeaf(commit(book,newSalt)));
   await reject('enrollment-replay','issuer','openLine',args,values);
  }
  async function quote(role,book,amount,expiry=BigInt(NOW+500)){
   const before=new Set([...view().quotes].map(([key])=>hex(key)));
   const values={quoteAmount:amount,invoiceId:bytes(),quoteNonce:bytes(),quoteBuyer:book.identity,quoteGeneration:book.generation,quoteFlatFee:book.flatFee,quoteBasisPoints:book.basisPoints};
   await invoke(role,'postQuote',[expiry],values);
   return {Q:[...view().quotes].find(([key])=>!before.has(hex(key)))[0],amount,expiry,invoiceId:values.invoiceId,quoteNonce:values.quoteNonce};
  }
  async function draw(role,m,book,salt,q,options={}){
   const values={...bookValues(book,salt),invoiceId:q.invoiceId,quoteNonce:q.quoteNonce,drawAmount:q.amount,quoteMerchantPk:m,noteNonce:bytes(),noteSalt:bytes()};
   const before=new Set([...view().notes].map(([key])=>hex(key)));
   const result=await execute(role,'draw',[q.Q,q.expiry,book.flatFee],values,options);
   const current=view(result.state),D=[...current.notes].find(([key])=>!before.has(hex(key)))[0];
   const next=advance(book,book.outstanding+q.amount+book.flatFee);assert(current.books.findPathForLeaf(commit(next,values.newSalt)));
   const publicData=result.public.transcript+result.public.input+result.public.output;
   for(const selected of [book.identity,commit(book,salt),salt])assert(!publicData.includes(hex(selected)));
   // Distinctive amount words exceed this fixture's public action/count values.
   if(q.amount>100n)assert(!publicData.includes(hex(RT.convertFieldToBytes(32,q.amount,'privacy amount fixture'))));
   disclosureChecks.push({circuit:'draw',selectedIdentityOrInputBookOrSaltRedisclosed:false,publicPrincipalField:false,publicReserveTotals:false,completePrivacyCertified:false});
   return {book:next,salt:values.newSalt,values,D,q,state:result.state};
  }
  const noteValues=drawn=>({noteGeneration:drawn.book.generation,noteIdentity:drawn.book.identity,noteQuoteCommit:drawn.q.Q,
   noteNonce:drawn.values.noteNonce,noteSalt:drawn.values.noteSalt,redeemAmount:drawn.q.amount,quoteMerchantPk:drawn.values.quoteMerchantPk});
  async function repay(book,salt,amount,ref=bytes()){
   const newSalt=bytes();await invoke('issuer','acknowledgeRepayment',[BigInt(NOW+86400)],{...bookValues(book,salt,newSalt),repayAmount:amount,paymentRef:ref,receiptNonce:bytes()});
   return {book:advance(book,book.outstanding-amount),salt:newSalt,ref};
  }
  async function status(book,salt,next){const newSalt=bytes();await invoke('issuer','setStatus',[next],bookValues(book,salt,newSalt));return {book:advance(book,book.outstanding,next),salt:newSalt};}
  await reject('agent-cannot-fund','agent-a','fundReserve',[200000n]);
  await reject('agent-cannot-register-merchant','agent-a','registerMerchant',[mB]);
  await invoke('issuer','registerMerchant',[mB]);
  await reject('duplicate-merchant-registration','issuer','registerMerchant',[mB]);
  const merchantCheck={quoteAmount:31n,invoiceId:bytes(),quoteNonce:bytes(),quoteBuyer:aId,quoteGeneration:1n,quoteFlatFee:7n,quoteBasisPoints:0n};
  await reject('stale-enabled-root','merchant-a','postQuote',[BigInt(NOW+500)],{...merchantCheck,enabledMerchantPath:initialEnabledPath});
  await reject('wrong-enabled-merchant-leaf','merchant-a','postQuote',[BigInt(NOW+500)],{...merchantCheck,enabledMerchantPath:view().enabledMerchantTree.findPathForLeaf(mB)});
  await reject('unregistered-merchant-offer','attacker','postQuote',[BigInt(NOW+500)],merchantCheck);
  await invoke('issuer','fundReserve',[200000n]);
  await reject('reserve-overflow','issuer','fundReserve',[MAX]);
  await reject('forged-reserve-opening','issuer','fundReserve',[1n],{reserveOpening:{...privateView().reserve.book,totalReserve:200001n}});
  let bookA=fresh(aId),saltA=bytes(),bookB=fresh(bId,2000n),saltB=bytes();await open('agent-a',aId,bookA,saltA);
  const singletonPath=view().books.findPathForLeaf(commit(bookA,saltA));
  await open('agent-b',bId,bookB,saltB);
  const qa=await quote('merchant-a',bookA,317n),qb=await quote('merchant-b',bookB,541n),racing=await quote('merchant-a',bookA,113n,BigInt(NOW+100));
  const drawValues={...bookValues(bookA,saltA),invoiceId:qa.invoiceId,quoteNonce:qa.quoteNonce,drawAmount:qa.amount,quoteMerchantPk:mA,noteNonce:bytes(),noteSalt:bytes()};
  await reject('stale-registered-merchant-root','agent-a','draw',[qa.Q,qa.expiry,7n],{...drawValues,registeredMerchantPath:initialRegisteredPath});
  await reject('wrong-registered-merchant-leaf','agent-a','draw',[qa.Q,qa.expiry,7n],{...drawValues,registeredMerchantPath:view().registeredMerchantTree.findPathForLeaf(mB)});
  await reject('historic-singleton-root-rejected','agent-a','draw',[qa.Q,qa.expiry,7n],{...drawValues,bookPath:singletonPath});
  await reject('wrong-agent','agent-b','draw',[qa.Q,qa.expiry,7n],drawValues);
  await reject('forged-private-limit','agent-a','draw',[qa.Q,qa.expiry,7n],{...drawValues,bookOpening:{...bookA,limit:1501n}});
  await reject('altered-quote-state','agent-a','draw',[qa.Q,qa.expiry,7n],{...drawValues,quoteMetaOpening:{expiry:qa.expiry+1n,used:false}});
  const firstA=await draw('agent-a',mA,bookA,saltA,qa);bookA=firstA.book;saltA=firstA.salt;
  await reject('book-double-spend','agent-a','draw',[racing.Q,racing.expiry,7n],{...drawValues,invoiceId:racing.invoiceId,quoteNonce:racing.quoteNonce,drawAmount:racing.amount});
  const firstB=await draw('agent-b',mB,bookB,saltB,qb);bookB=firstB.book;saltB=firstB.salt;
  await reject('wrong-merchant','merchant-b','redeemDraw',[firstA.D,qa.expiry],noteValues(firstA));
  await reject('altered-private-note-state','merchant-a','redeemDraw',[firstA.D,qa.expiry],{...noteValues(firstA),noteMetaOpening:{...privateView().notes[hex(firstA.D)].meta,amount:318n}});
  await invoke('merchant-a','redeemDraw',[firstA.D,qa.expiry],noteValues(firstA));
  await reject('redemption-replay','merchant-a','redeemDraw',[firstA.D,qa.expiry],noteValues(firstA));
  let paid=await repay(bookA,saltA,200n);bookA=paid.book;saltA=paid.salt;
  await reject('payment-reference-replay','issuer','acknowledgeRepayment',[BigInt(NOW+86400)],{...bookValues(bookA,saltA),repayAmount:1n,paymentRef:paid.ref,receiptNonce:bytes()});
  let changed=await status(bookA,saltA,2);bookA=changed.book;saltA=changed.salt;
  await reject('default-blocks-draw','agent-a','draw',[racing.Q,racing.expiry,7n],{...bookValues(bookA,saltA),invoiceId:racing.invoiceId,quoteNonce:racing.quoteNonce,drawAmount:racing.amount,quoteMerchantPk:mA,noteNonce:bytes(),noteSalt:bytes()});
  changed=await status(bookA,saltA,1);bookA=changed.book;saltA=changed.salt;
  await reject('debt-cannot-close','issuer','setStatus',[3],bookValues(bookA,saltA));
  const oldA=await draw('agent-a',mA,bookA,saltA,racing);bookA=oldA.book;saltA=oldA.salt;
  paid=await repay(bookA,saltA,244n);bookA=paid.book;saltA=paid.salt;
  changed=await status(bookA,saltA,3);bookA=changed.book;saltA=changed.salt;
  const reopened=fresh(aId,1500n,2n),reopenSalt=bytes();await open('agent-a',aId,reopened,reopenSalt,bookA,saltA);bookA=reopened;saltA=reopenSalt;
  const newQA=await quote('merchant-a',bookA,89n,BigInt(NOW+86400)),newA=await draw('agent-a',mA,bookA,saltA,newQA);bookA=newA.book;saltA=newA.salt;
  const qc=await quote('merchant-b',bookB,71n,BigInt(NOW+100)),cancelB=await draw('agent-b',mB,bookB,saltB,qc);bookB=cancelB.book;saltB=cancelB.salt;
  await reject('premature-expiry','attacker','cancelOrExpireNote',[cancelB.D,0n,0n]);
  await reject('allocation-owner-or-issuer-only','attacker','cancelOrExpireNote',[cancelB.D,1n,0n],
   {...bookValues(bookB,saltB),...noteValues(cancelB)},{time:Number(qc.expiry)});
  const beforeRepayment=state,zeroCashSalt=bytes();
  const noCash=await execute('agent-b','cancelOrExpireNote',[cancelB.D,1n,0n],{...bookValues(bookB,saltB,zeroCashSalt),...noteValues(cancelB)},{branch:true,time:Number(qc.expiry)});
  assert.equal(noCash.privateState.notes[hex(cancelB.D)].meta.cashRefundOwed,false);
  assert.equal(noCash.privateState.reserve.book.refundReserve,0n);assert.equal(state,beforeRepayment);
  paid=await repay(bookB,saltB,600n);bookB=paid.book;saltB=paid.salt;
  time=Number(qc.expiry);await invoke('attacker','cancelOrExpireNote',[cancelB.D,0n,0n]);
  let refundSalt=bytes();await invoke('issuer','cancelOrExpireNote',[cancelB.D,1n,0n],{...bookValues(bookB,saltB,refundSalt),...noteValues(cancelB)});
  bookB=advance(bookB,0n);saltB=refundSalt;assert(view().books.findPathForLeaf(commit(bookB,saltB)));
  await reject('refund-issuer-only','agent-b','cancelOrExpireNote',[cancelB.D,2n,BigInt(time+1000)],
   {...noteValues(cancelB),salt:refundSalt,repayAmount:52n,paymentRef:bytes()});
  await invoke('issuer','cancelOrExpireNote',[cancelB.D,2n,BigInt(time+1000)],{...noteValues(cancelB),salt:refundSalt,repayAmount:52n,paymentRef:bytes()});
  await reject('compensation-replay','issuer','cancelOrExpireNote',[cancelB.D,1n,0n],{...bookValues(bookB,saltB),...noteValues(cancelB)});
  refundSalt=bytes();await invoke('agent-a','cancelOrExpireNote',[oldA.D,1n,0n],{...bookValues(bookA,saltA,refundSalt),...noteValues(oldA)});
  bookA=advance(bookA,96n);saltA=refundSalt;assert(view().books.findPathForLeaf(commit(bookA,saltA)));
  await invoke('issuer','cancelOrExpireNote',[oldA.D,2n,BigInt(time+1000)],{...noteValues(oldA),salt:refundSalt,repayAmount:120n,paymentRef:bytes()});
  await reject('merchant-cannot-disable-registry','merchant-a','disableMerchant',[mA]);
  await invoke('issuer','disableMerchant',[mB]);
  await reject('disabled-merchant-new-offer','merchant-b','postQuote',[BigInt(NOW+1000)],{quoteAmount:1n,invoiceId:bytes(),quoteNonce:bytes(),quoteBuyer:bId,quoteGeneration:1n,quoteFlatFee:7n,quoteBasisPoints:0n});
  await invoke('merchant-b','redeemDraw',[firstB.D,qb.expiry],noteValues(firstB));
  await invoke('merchant-a','redeemDraw',[newA.D,newQA.expiry],noteValues(newA));
  await invoke('issuer','withdrawFees',[]);await invoke('issuer','withdrawUnencumberedReserve',[1000n]);
  await reject('claim-backing-withdrawal','issuer','withdrawUnencumberedReserve',[198000n]);
  paid=await repay(bookA,saltA,96n);bookA=paid.book;saltA=paid.salt;await status(bookA,saltA,3);await status(bookB,saltB,3);
  assert.deepEqual([...new Set(traces.map(t=>t.circuit))].sort(),info.circuits.map(c=>c.name).sort());
  const r=privateView().reserve.book;assert.equal(r.totalReserve,198979n);assert.equal(r.redeemedReserve,947n);assert.equal(r.reportedRefundReserve,198n);
  assert.equal(r.encumberedReserve+r.pendingFeeReserve+r.feeReserve+r.refundReserve,0n);
  const signatureChecks=[],descriptor={name:'fundReserve',args:[1n],values:{},domain,privateFinance:true,reserveCommit:view().reserveCommit,feeReserve:r.feeReserve};
  const signature=await actors.issuer.approve(descriptor),identity=RT.ecMulGenerator(0n);
  const lifted=await actors.issuer.approve({...descriptor,challengeLiftForTest:true});
  for(const [label,approvalOverride]of [
   ['identity-announcement',{...signature,roleApproval:{...signature.roleApproval,announcement:identity}}],
   ['small-subgroup-announcement',{...signature,roleApproval:{...signature.roleApproval,announcement:{x:0n,y:RT.MAX_FIELD}}}],
   ['off-curve-announcement',{...signature,roleApproval:{...signature.roleApproval,announcement:{x:0n,y:0n}}}],
   ['response-at-order',{...signature,roleApproval:{...signature.roleApproval,response:words(ORDER)}}],
   ['challenge-remainder-at-order',{...signature,challengeRemainder:words(ORDER)}],
   ['wrong-quotient',{...signature,challengeQuotient:signature.challengeQuotient+1n}],
   ['wrong-carry',{...signature,challengeCarry:signature.challengeCarry+1n}],
   ['noncanonical-field-lift',lifted],
  ]){
   await reject(label,'issuer','fundReserve',[1n],{},{approvalOverride});signatureChecks.push({check:label,rejected:true});
  }
  const artifactFingerprints=Object.fromEntries(['contract/index.js','compiler/contract-info.json'].map(file=>[file,fingerprint(readFileSync(join(dir,file)))]));
  const report={schema:'line-private-merchant-feasibility/v1',createdAt:new Date().toISOString(),sourceSha256:sourceHash,artifactFingerprints,
   compiler:info['compiler-version'],runtime:info['runtime-version'],freshCompilation:!cached,cachedGeneratedBindings:cached,sourceBindingVerifiedByThisRun:!cached,
   exportedCircuits:info.circuits.map(c=>c.name),canonicalModified:false,independentSignerProcesses:6,
   signingScalarsInCoordinatorOrCircuitWitnesses:false,reserveOpeningsSentToSigners:false,privateBooksHeldByTrustedCoordinator:true,
   syntheticSignerPolicy:true,durableInstitutionalCustody:false,currentRootOnly:true,publicAmountsAndReserveTotalsAbsent:true,
   fullHistoryPrivacyPassed:false,cryptographicProofsGenerated:false,networkSubmitted:false,authenticAssetSettlement:false,customerDemandValidated:false,
   selectedMerchantAbsentFromQuoteAndDrawView:true,
   residualRisks:['public registry, finite merchant sets and fixed-price catalogs','deadlines, public action shapes and timing','sender, DUST and prover metadata','trusted book/reserve prover and synthetic signer policy','finite population and side information'],
   traces,negativeChecks,signatureChecks,disclosureChecks,syntheticFinalAccounting:{T:r.totalReserve.toString(),R:r.redeemedReserve.toString(),X:r.reportedRefundReserve.toString()}};
  writeFileSync(join(work,'evidence.json'),JSON.stringify(report,null,2)+'\n');
  await onComplete?.(report);
  console.log(JSON.stringify({result:'MERCHANT MEMBERSHIP GENERATED EXECUTION PASS; NATIVE PROOFS AND COMPLETE PRIVACY UNPROVEN',evidence:join(work,'evidence.json')}));
  return report;
 }finally{for(const signer of signers)signer.child.kill();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 runPrivateMerchantFixture().catch(error=>{console.error(error.message);process.exitCode=1;});
