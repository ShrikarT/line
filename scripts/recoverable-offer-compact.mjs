#!/usr/bin/env node
/** Fresh-compiled interoperability of a durable agent with private supplier offers.
 * Synthetic test-owner key/configuration, same host, no institutional claim.
 * Hooks gate public/private advancement; this file itself proves no transaction.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {BYTES32,UINT64} from '../src/lib/line/encoding.ts';
import {commit} from './private-pool-spike.mjs';
import {roleHash,hash,tag,bytes} from './signed-pool-signers.mjs';
import {startSigner} from './private-offer-signers.mjs';
import {facilityBinding,offerCommit} from './private-offer-encoding.mjs';
import {startDurableApprovalActor} from './durable-approval-actor.mjs';
import {financeCommand} from './private-finance-child.mjs';

const SOURCE='contracts/experimental/line-private-offer.compact',NOW=1_800_000_000,COIN='0'.repeat(64);
const fingerprint=value=>createHash('sha256').update(value).digest('hex'),hex=value=>Buffer.from(value).toString('hex');
const stateBytes=data=>{const state=new RT.ContractState();state.data=data instanceof RT.ChargedState?data:new RT.ChargedState(data);return state.serialize();};
const structType=fields=>({alignment:()=>fields.flatMap(([,type])=>type.alignment()),toValue:value=>fields.flatMap(([key,type])=>type.toValue(value[key])),
 fromValue:value=>Object.fromEntries(fields.map(([key,type])=>[key,type.fromValue(value)]))});
const reserveFields=['epoch','totalReserve','encumberedReserve','redeemedReserve','feeReserve','pendingFeeReserve','refundReserve','reportedRefundReserve'];
const RESERVE=structType([['domain',BYTES32],...reserveFields.map(key=>[key,UINT64])]);

export async function runRecoverableOfferCompact({compiledDir,onInitialize,onAccepted,onComplete}={}){
 mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/recoverable-offer-compact-'));
 const index=process.argv.indexOf('--compiled-dir'),cached=Boolean(compiledDir)||index>=0;
 const dir=compiledDir?resolve(compiledDir):index>=0?resolve(process.argv[index+1]):join(work,'managed');
 const sourceHash=fingerprint(readFileSync(SOURCE));
 const scriptFingerprints=Object.fromEntries(['scripts/recoverable-offer-compact.mjs','scripts/durable-approval-actor.mjs','scripts/durable-approval-signer.mjs',
  'scripts/private-finance-child.mjs','scripts/private-finance-journal.mjs','server/checkout-storage.ts','scripts/private-offer-encoding.mjs','scripts/private-offer-signers.mjs','scripts/signed-pool-signers.mjs','scripts/private-pool-spike.mjs','src/lib/line/encoding.ts','src/lib/security/vault-codec.ts'].map(p=>[p,fingerprint(readFileSync(p))]));
 if(!cached)await new Promise((yes,no)=>{
  const child=spawn(process.execPath,['scripts/compile-compact.mjs','--skip-zk',SOURCE,relative(process.cwd(),dir).split(sep).join('/')],{stdio:'inherit'});
  child.on('error',no);child.on('close',code=>code===0?yes():no(Error('Durable actor Compact compilation failed.')));
 });
 assert.equal(fingerprint(readFileSync(SOURCE)),sourceHash);
 const info=JSON.parse(readFileSync(join(dir,'compiler/contract-info.json'),'utf8'));
 assert.deepEqual(info.circuits.map(c=>c.name).sort(),JSON.parse(readFileSync('contracts/managed/line/compiler/contract-info.json','utf8')).circuits.map(c=>c.name).sort());
 assert(!info.witnesses.some(w=>['callerSecret','agentSecret'].includes(w.name)));
 const {Contract,ledger}=await import(pathToFileURL(join(dir,'contract/index.js')).href);
 const issuer=startSigner('issuer'),merchant=startSigner('merchant-a');let agent;
 const traces=[],policyChecks=[],compactChecks=[];
 try{
  const [issuerPoint,merchantPoint]=await Promise.all([issuer.ready,merchant.ready]);
  const issuerPk=roleHash('issuer',issuerPoint.pk),merchantPk=roleHash('merchant',merchantPoint.pk),instanceNonce=bytes(),nullifierKey=bytes();
  const stableKeyCommit=hash([tag('line:signed:nk'),nullifierKey]);
  const domain=hash([tag('line:private:offer:domain'),issuerPk,merchantPk,instanceNonce,stableKeyCommit]);
  const terms=bytes(),owner={directory:join(work,'agent-owner'),encryptionKey:bytes(),custodyId:'compact-offer-agent-evaluation',syntheticUnixSeconds:NOW,approvalABI:'line-private-offer/v1',
   config:{domain,maxAuthorizedCost:50n,maxLineLimit:100n,maxFee:1n,maxBasisPoints:0n,maxDrawAmount:30n,
    validBefore:BigInt(NOW+86400),allowedMerchants:[merchantPk],acceptedTerms:terms}};
  agent=startDurableApprovalActor({...owner,create:true});const agentPoint=await agent.ready;
  assert.equal(new Set([issuerPoint.pid,merchantPoint.pid,agentPoint.pid]).size,3);
  const identity=roleHash('agent',agentPoint.pk,domain);let active={},calls=[];
  const witnesses=Object.fromEntries(info.witnesses.map(({name})=>[name,(ctx,...args)=>{
   calls.push(name);
   if(name==='rememberReserve')return [{...ctx.privateState,reserve:{book:args[0],salt:args[1]}},[]];
   if(name==='rememberNote')return [{...ctx.privateState,notes:{...ctx.privateState.notes,[hex(args[0])]:{meta:args[1],salt:args[2]}}},[]];
   if(name==='rememberQuote')return [{...ctx.privateState,quotes:{...ctx.privateState.quotes,[hex(args[0])]:{meta:args[1],salt:args[2]}}},[]];
   assert(Object.hasOwn(active,name),`Missing fixture witness: ${name}`);return [ctx.privateState,active[name]];
  }]));
  const contract=new Contract(witnesses);active={reserveSalt:bytes()};
  const initial=contract.initialState(RT.createConstructorContext({notes:{},quotes:{}},COIN),issuerPk,merchantPk,instanceNonce,stableKeyCommit);
  let state=stateBytes(initial.currentContractState.data),privateState=initial.currentPrivateState;
  const view=()=>ledger(RT.ContractState.deserialize(state).data);
  assert.deepEqual(view().contractDomain,domain,'Owner domain calculation must match actual Compact constructor.');
  const execution=await onInitialize?.({dir,info,initial,sourceHash,now:NOW});
  const address=execution?.contractAddress??RT.dummyContractAddress();
  const financeOwner={directory:join(work,'financial-owner'),password:hex(bytes()),scope:{networkId:'synthetic-preview',sourceSha256:sourceHash,
   executableSha256:fingerprint(readFileSync(join(dir,'contract/index.js'))),contractAddress:address,contractDomain:hex(domain)}};
  let financial={nullifierKey,lines:{},offerSalts:{},acceptedSequence:0n};
  const storageProcesses=[];
  const finance=async(action,payload)=>{const response=await financeCommand(financeOwner,action,payload);storageProcesses.push(response.pid);return response.value;};
  await finance('initialize',{publicState:state,privateState,financial});
  async function execute(role,name,args,values,operationId,approvalOverride){
   const before=state,v=view(),full={nullifierKey:financial.nullifierKey,reserveOpening:privateState.reserve.book,reserveSalt:privateState.reserve.salt,newReserveSalt:bytes(),
    newNoteMetaSalt:bytes(),newQuoteMetaSalt:bytes(),currentBookRoot:v.books.root(),...values};
   let circuitArgs=args;
   if(name==='fundReserve'){full.reserveAmount=args[0];circuitArgs=[];}
   if(name==='openLine'){full.lineFlatFee=args[2];full.lineBasisPoints=args[3];circuitArgs=args.slice(0,2);}
   if(name==='draw'){full.drawFee=args[2];circuitArgs=args.slice(0,2);}
   const allowed=name==='openLine'?['enrollmentIdentity','acceptedTerms','hasPreviousBook','lineLimit','newSalt','bookOpening','salt']:
    name==='draw'?['bookOpening','salt','newSalt','quoteMerchantPk','drawAmount','noteNonce','noteSalt']:
    name==='postQuote'?['quoteFacilityBinding','invoiceId','quoteAmount','quoteNonce']:
    name==='redeemDraw'?['redeemAmount']:[];
   const descriptor={name,args,domain,privateFinance:true,values:Object.fromEntries(allowed.filter(k=>Object.hasOwn(full,k)).map(k=>[k,full[k]])),
    ...(name==='fundReserve'?{reserveCommit:v.reserveCommit}:{})};
   if(role==='merchant'){
    assert.deepEqual(Object.keys(descriptor.values).sort(),(name==='postQuote'?['quoteFacilityBinding','invoiceId','quoteAmount','quoteNonce']:['redeemAmount']).sort());
    assert.equal(descriptor.reserveCommit,undefined);
   }
   const approval=role==='agent'?await agent.approve({operationId,descriptor}):await(role==='issuer'?issuer:merchant).approve(descriptor);
   active={...full,...approval,...approvalOverride};calls=[];
   const context=RT.createCircuitContext(address,COIN,RT.ContractState.deserialize(state).data,structuredClone(privateState),undefined,undefined,NOW);
   let initialQueryContext=context.currentQueryContext,result=contract.circuits[name](context,...circuitArgs);
   assert(!calls.includes('callerSecret')&&!calls.includes('agentSecret'));
   const nextState=stateBytes(result.context.currentQueryContext.state),nextPrivate=result.context.currentPrivateState;
   const nextView=ledger(RT.ContractState.deserialize(nextState).data);
   assert.deepEqual(RT.persistentCommit(RESERVE,nextPrivate.reserve.book,nextPrivate.reserve.salt),nextView.reserveCommit);
   const nextFinancial=structuredClone(financial);
   nextFinancial.acceptedSequence++;
   if(name==='openLine'&&args[0]===1n){
    const restoredBook={domain,identity:full.enrollmentIdentity,limit:full.lineLimit,outstanding:0n,epoch:0n,generation:full.bookOpening.generation+1n,
     expiry:args[1],flatFee:args[2],basisPoints:args[3],status:1};
    nextFinancial.lines[hex(restoredBook.identity)]={book:restoredBook,salt:full.newSalt};
   }
   if(name==='draw')nextFinancial.lines[hex(full.bookOpening.identity)]={book:{...full.bookOpening,outstanding:full.bookOpening.outstanding+full.drawAmount+args[2],epoch:full.bookOpening.epoch+1n},salt:full.newSalt};
   if(name==='postQuote'){
    const Q=offerCommit({merchant:merchantPk,binding:full.quoteFacilityBinding,invoice:full.invoiceId,amount:full.quoteAmount,expiry:args[0],nonce:full.quoteNonce,domain});
    assert(full.quoteBindingSalt instanceof Uint8Array&&full.quoteBindingSalt.length===32);
    nextFinancial.offerSalts[hex(Q)]=full.quoteBindingSalt;
   }
   for(const line of Object.values(nextFinancial.lines))assert(nextView.books.findPathForLeaf(commit(line.book,line.salt)),'Persisted book must match actual Compact tree.');
   const financeId='finance:'+nextFinancial.acceptedSequence+':'+name;
   const prepared=await finance('prepare',{operationId:financeId,circuit:name,circuitArgs,witnesses:active,
    before:{publicState:state,privateState,financial},candidate:{publicState:nextState,privateState:nextPrivate,financial:nextFinancial}});
   assert.equal(prepared.status,'prepared');
   const preparedProofData=result.proofData;
   const preparedQueryContext=initialQueryContext,preparedCommitmentIndices=[...result.context.currentQueryContext.comIndices];
   // Clear the coordinator's active checkpoint, then restore from a new
   // storage subprocess. This does not restart the whole proof coordinator.
   state=undefined;privateState=undefined;financial=undefined;active={};
   const recovered=await finance('snapshot');assert.equal(recovered.pending.operationId,financeId);
   state=recovered.confirmed.publicState;privateState=recovered.confirmed.privateState;financial=recovered.confirmed.financial;active=recovered.pending.witnesses;
   const restoredContext=RT.createCircuitContext(address,COIN,RT.ContractState.deserialize(state).data,structuredClone(privateState),undefined,undefined,NOW);
   initialQueryContext=restoredContext.currentQueryContext;result=contract.circuits[name](restoredContext,...recovered.pending.circuitArgs);
   assert(isDeepStrictEqual(result.proofData,preparedProofData),'Restoring a financial candidate changed its Compact proof data.');
   assert(isDeepStrictEqual(initialQueryContext.effects,preparedQueryContext.effects),'Restoring a financial candidate changed its query effects.');
   assert(isDeepStrictEqual(initialQueryContext.block,preparedQueryContext.block),'Restoring a financial candidate changed its block context.');
   assert(isDeepStrictEqual([...result.context.currentQueryContext.comIndices],preparedCommitmentIndices),'Restoring a financial candidate changed its commitment openings.');
   assert.deepEqual(stateBytes(result.context.currentQueryContext.state),recovered.pending.candidate.publicState);
   assert.deepEqual(result.context.currentPrivateState,recovered.pending.candidate.privateState);
   const observed=await onAccepted?.({role,name,seconds:NOW,input:before,nextState,result,initialQueryContext,descriptor,approval});
   await finance('confirm',{operationId:financeId,observedPublicState:observed?.observedPublicState??stateBytes(result.context.currentQueryContext.state)});
   state=nextState;privateState=nextPrivate;financial=recovered.pending.candidate.financial;traces.push({actor:role,circuit:name,durableAgent:role==='agent',signingScalarWitnesses:0});
   return {descriptor,approval,result};
  }
  await execute('issuer','fundReserve',[200n],{});
  const book={domain,identity,limit:100n,outstanding:0n,epoch:0n,generation:1n,expiry:BigInt(NOW+3600),flatFee:1n,basisPoints:0n,status:1};
  const openingSalt=bytes(),emptyPath={leaf:new Uint8Array(32),path:Array.from({length:20},()=>({sibling:{field:0n},goes_left:false}))};
  const opening={enrollmentIdentity:identity,acceptedTerms:terms,hasPreviousBook:false,lineLimit:100n,newSalt:openingSalt,
   bookOpening:{...book,generation:0n},salt:bytes(),bookPath:emptyPath};
  const consent=await execute('agent','openLine',[0n,book.expiry,1n,0n],opening,'facility:consent');
  await agent.stop();agent=startDurableApprovalActor({...owner,create:false});const restored=await agent.ready;
  assert.deepEqual(restored.pk,agentPoint.pk);assert.notEqual(restored.pid,agentPoint.pid);
  assert.deepEqual(await agent.approve({operationId:'facility:consent',descriptor:consent.descriptor}),consent.approval);
  await execute('issuer','openLine',[1n,book.expiry,1n,0n],opening);
  assert(view().books.findPathForLeaf(commit(book,openingSalt)));
  const invoice=bytes(),quoteNonce=bytes(),expiry=BigInt(NOW+300),quoteBindingSalt=bytes(),binding=facilityBinding(book,quoteBindingSalt);
  await execute('merchant','postQuote',[expiry],{quoteFacilityBinding:binding,invoiceId:invoice,quoteAmount:15n,quoteNonce,
   quoteBindingSalt,enabledMerchantPath:view().enabledMerchantTree.findPathForLeaf(merchantPk)});
  const Q=[...view().quotes][0][0],quoteRecord=privateState.quotes[hex(Q)],newSalt=bytes();
  assert.deepEqual(Q,offerCommit({merchant:merchantPk,binding,invoice,amount:15n,expiry,nonce:quoteNonce,domain}));
  const drawValues={bookOpening:book,bookPath:view().books.findPathForLeaf(commit(book,openingSalt)),salt:openingSalt,newSalt,
   invoiceId:invoice,quoteNonce,quoteBindingSalt:financial.offerSalts[hex(Q)],drawAmount:15n,quoteMerchantPk:merchantPk,noteNonce:bytes(),noteSalt:bytes(),
   quoteMetaOpening:quoteRecord.meta,quoteMetaSalt:quoteRecord.salt,registeredMerchantPath:view().registeredMerchantTree.findPathForLeaf(merchantPk)};
  for(const mutate of [d=>d.values.drawAmount=31n,d=>d.values.quoteMerchantPk=bytes(),d=>d.domain=bytes(),d=>d.values.bookOpening.identity=bytes()]){
   const descriptor={name:'draw',args:[Q,expiry,1n],domain,privateFinance:true,
    values:Object.fromEntries(['bookOpening','salt','newSalt','drawAmount','quoteMerchantPk','noteNonce','noteSalt'].map(k=>[k,structuredClone(drawValues[k])]))};
   mutate(descriptor);await assert.rejects(agent.approve({operationId:'purchase:denied',descriptor}),/could not be authorized/);
   policyChecks.push({rejectedByActorPolicy:true,reachedCompact:false});
  }
  const drawn=await execute('agent','draw',[Q,expiry,1n],drawValues,'purchase:1');
  assert(view().books.findPathForLeaf(commit({...book,outstanding:16n,epoch:1n},newSalt)));
  await agent.stop();agent=startDurableApprovalActor({...owner,create:false});const postDraw=await agent.ready;
  assert.deepEqual(postDraw.pk,agentPoint.pk);
  assert.deepEqual(await agent.approve({operationId:'purchase:1',descriptor:drawn.descriptor}),drawn.approval);
  const D=[...view().notes][0][0],noteRecord=privateState.notes[hex(D)];
  await execute('merchant','redeemDraw',[D,expiry],{noteMetaOpening:noteRecord.meta,noteMetaSalt:noteRecord.salt,noteGeneration:1n,noteIdentity:identity,
   noteQuoteCommit:Q,quoteMerchantPk:merchantPk,redeemAmount:15n,noteNonce:drawValues.noteNonce,noteSalt:drawValues.noteSalt});
  // Reusing the original approval cannot produce a second debit after restart.
  const frozen=state;
  await assert.rejects(execute('agent','draw',[Q,expiry,1n],drawValues,'purchase:1'));
  assert.equal(state,frozen);compactChecks.push({check:'recovered-approval-cannot-debit-twice',rejectedByGeneratedCompact:true});
  for(const [p,pinned]of Object.entries(scriptFingerprints))assert.equal(fingerprint(readFileSync(p)),pinned);
  assert.equal(fingerprint(readFileSync(SOURCE)),sourceHash);
  assert.equal(traces.length,6);
  const finalCheckpoint=await finance('snapshot');assert.equal(finalCheckpoint.pending,null);assert.equal(finalCheckpoint.completed.length,6);
  assert.deepEqual(finalCheckpoint.confirmed.publicState,state);assert.deepEqual(finalCheckpoint.confirmed.privateState,privateState);
  assert.equal(finalCheckpoint.confirmed.financial.lines[hex(identity)].book.outstanding,16n);
  assert.equal(storageProcesses.length,20);
  const report={schema:'line-recoverable-offer-compact/v1',createdAt:new Date().toISOString(),sourceSha256:sourceHash,scriptFingerprints,
   artifactFingerprints:Object.fromEntries(['contract/index.js','compiler/contract-info.json'].map(p=>[p,fingerprint(readFileSync(join(dir,p)))])),
   freshCompilation:!cached,sourceBindingVerifiedByThisRun:!cached,cachedGeneratedBindings:cached,compiler:info['compiler-version'],runtime:info['runtime-version'],
   exportedCircuits:info.circuits.map(c=>c.name),traces,policyChecks,compactChecks,realAgentProcessRestarts:2,unchangedAgentIdentity:true,
   recoveredConsentAndDrawApprovals:true,signingScalarWitnesses:0,testOwnerKeySuppliedByLauncher:true,sameHost:true,
   independentAdministrativeCustody:false,financialCheckpointDurable:true,preparedCandidatePersistedBeforeProof:true,coordinatorMemoryClearedAndReloaded:true,storageSubprocessInvocations:storageProcesses.length,completeCoordinatorRestart:false,cryptographicProofsGenerated:false,networkSubmitted:false,
   authenticAssetSettlement:false,fullHistoryPrivacyPassed:false,debtInferableIfObserverKnowsAllFees:true,supplierRequestsContainFinancialBook:false,approvalABI:'line-private-offer/v1',
   evidenceScope:'Generated-Compact recovery of source-bound encrypted financial checkpoints and prepared witnesses, with twenty separate storage subprocess invocations, cleared/reloaded coordinator financial memory and two agent restarts. Whole-coordinator crash, operator key recovery and network reconciliation remain unverified. Not a native proof, independent operator or full-history privacy pass.'};
  writeFileSync(join(work,'evidence.json'),JSON.stringify(report,null,2)+'\n');await onComplete?.(report);
  console.log(JSON.stringify({result:'RECOVERABLE PRIVATE-OFFER GENERATED COMPACT PASS; NATIVE AND INDEPENDENT CUSTODY UNPROVEN',evidence:join(work,'evidence.json')}));
  return report;
 }finally{if(agent)await agent.stop();issuer.child.kill();merchant.child.kill();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 runRecoverableOfferCompact().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
