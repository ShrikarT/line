/** Fresh Compact integration through owner mTLS APIs, two separate suppliers.
 * Synthetic same-host owner harness. It knows software encryption keys; there
 * is no independent administration, native proof, asset or network claim.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {DurableApprovalSigner} from './durable-approval-signer.mjs';
import {authorize} from './approval-owner-example-policy.mjs';
import {startApprovalOwnerService,approvalOwnerClient} from './approval-owner-service.mjs';
import {tlsFixture} from '../tests/fixtures/approval-service-tls.mjs';
import {hash,tag,roleHash,zero} from './private-offer-signers.mjs';
import {facilityBinding,offerCommit} from './private-offer-encoding.mjs';
import {commit} from './private-pool-spike.mjs';
const SOURCE='contracts/experimental/line-private-offer.compact',sha=b=>createHash('sha256').update(b).digest('hex'),bytes=()=>new Uint8Array(randomBytes(32)),hex=b=>Buffer.from(b).toString('hex');
export async function runApprovalServiceCompact({compiledDir,onInitialize,onAccepted,onComplete}={}){
const NOW=Math.floor(Date.now()/1000),COIN=RT.encodeCoinPublicKey('0'.repeat(64));
mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/approval-service-compact-')),dir=compiledDir?resolve(compiledDir):join(work,'managed');
const files=['scripts/approval-service-compact.mjs','scripts/approval-owner-service.mjs','scripts/approval-service-frame.mjs','scripts/approval-owner-example-policy.mjs',
 'scripts/durable-approval-signer.mjs','scripts/durable-approval-actor.mjs','scripts/signed-pool-signers.mjs','scripts/private-offer-signers.mjs','scripts/private-offer-encoding.mjs',
 'scripts/private-pool-spike.mjs','src/lib/line/encoding.ts','src/lib/security/vault-codec.ts','scripts/compile-compact.mjs','tests/fixtures/approval-service-tls.mjs'];
const fingerprints=Object.fromEntries(files.map(p=>[p,sha(readFileSync(p))])),sourceHash=sha(readFileSync(SOURCE));
const portable=p=>relative(process.cwd(),p).split(sep).join('/');
if(!compiledDir)await new Promise((yes,no)=>{const p=spawn(process.execPath,['scripts/compile-compact.mjs','--skip-zk',SOURCE,portable(dir)],{stdio:'inherit'});p.on('error',no);p.on('close',c=>c===0?yes():no(Error('Fresh Compact compilation failed.')));});
const {Contract,ledger}=await import(pathToFileURL(join(dir,'contract/index.js')).href),info=JSON.parse(readFileSync(join(dir,'compiler/contract-info.json')));
assert.equal(info['compiler-version'],'0.31.1');assert.equal(info['runtime-version'],'0.16.0');
assert.deepEqual(info.circuits.map(x=>x.name).sort(),JSON.parse(readFileSync('contracts/managed/line/compiler/contract-info.json')).circuits.map(x=>x.name).sort());
const tls=tlsFixture(),owners={},ownerOptions={},services={},clients={},traces=[],controls=[];let serviceRestarts=0;
const params={issuer:'issuer',agent:'agent',merchantA:'merchant',merchantB:'merchant'};
try{
 for(const [label,role]of Object.entries(params)){
  ownerOptions[label]={directory:join(work,label),encryptionKey:bytes(),custodyId:label+'-owner',role,authorize,approvalABI:'line-private-offer/v1'};
  owners[label]=new DurableApprovalSigner({...ownerOptions[label],create:true});
 }
 const issuerPk=roleHash('issuer',owners.issuer.publicKey),merchantA=roleHash('merchant',owners.merchantA.publicKey),merchantB=roleHash('merchant',owners.merchantB.publicKey);
 const nonce=bytes(),nullifierKey=bytes(),stableKey=hash([tag('line:signed:nk'),nullifierKey]),domain=hash([tag('line:private:offer:domain'),issuerPk,merchantA,nonce,stableKey]);
 const identity=roleHash('agent',owners.agent.publicKey,domain),terms=bytes(),expiry=BigInt(NOW+3600),book0={domain,identity,limit:100n,outstanding:0n,epoch:0n,generation:1n,expiry,flatFee:1n,basisPoints:0n,status:1};
 const bindingSalt=bytes(),binding=facilityBinding(book0,bindingSalt),common={domain,maxAuthorizedCost:500n,validBefore:BigInt(NOW+7200)};
 owners.issuer.bindPolicy({...common,maxReserveAction:200n,maxLineLimit:100n,maxFee:1n,maxBasisPoints:0n,agentIdentity:identity,acceptedTerms:terms,allowedMerchants:[merchantA,merchantB]});
 owners.agent.bindPolicy({...common,maxAuthorizedCost:50n,maxLineLimit:100n,maxFee:1n,maxBasisPoints:0n,maxDrawAmount:30n,acceptedTerms:terms,allowedMerchants:[merchantA,merchantB]});
 for(const label of ['merchantA','merchantB'])owners[label].bindPolicy({...common,facilityBinding:binding,maxQuoteAmount:15n});
 for(const [label,role]of Object.entries(params)){
  services[label]=await startApprovalOwnerService({signer:owners[label],role,approvalABI:'line-private-offer/v1',domain,...tls.material('server'),allowedClients:[tls.fingerprint('caller')]});
  clients[label]=approvalOwnerClient({url:'https://127.0.0.1:'+services[label].port+'/',...tls.material('caller'),expectedServerFingerprint:tls.fingerprint('server'),expectedRole:role,expectedPublicKey:owners[label].publicKey,expectedDomain:domain});
 }
 let active={},privateState,context;
 const witnesses=Object.fromEntries(info.witnesses.map(({name})=>[name,(ctx,...args)=>{
  if(name==='rememberReserve')return [{...ctx.privateState,reserve:{book:args[0],salt:args[1]}},[]];
  if(name==='rememberNote')return [{...ctx.privateState,notes:{...ctx.privateState.notes,[hex(args[0])]:{meta:args[1],salt:args[2]}}},[]];
  if(name==='rememberQuote')return [{...ctx.privateState,quotes:{...ctx.privateState.quotes,[hex(args[0])]:{meta:args[1],salt:args[2]}}},[]];
  assert(Object.hasOwn(active,name),'Missing integration witness.');assert(!['callerSecret','agentSecret'].includes(name));return [ctx.privateState,active[name]];
 }]));
 const contract=new Contract(witnesses);active={reserveSalt:bytes()};const initial=contract.initialState(RT.createConstructorContext({notes:{},quotes:{}},COIN),issuerPk,merchantA,nonce,stableKey);
 let state=initial.currentContractState.data;privateState=initial.currentPrivateState;
 const execution=await onInitialize?.({dir,info,initial,sourceHash,now:NOW});
 const address=execution?.contractAddress??RT.dummyContractAddress();
 const stateBytes=data=>{const s=new RT.ContractState();s.data=data instanceof RT.ChargedState?data:new RT.ChargedState(data);return s.serialize();};
 const view=()=>ledger(state);assert.deepEqual(view().contractDomain,domain);
 async function execute(label,name,args,values,operationId){
  const full={nullifierKey,reserveOpening:privateState.reserve.book,reserveSalt:privateState.reserve.salt,newReserveSalt:bytes(),newQuoteMetaSalt:bytes(),newNoteMetaSalt:bytes(),currentBookRoot:view().books.root(),...values};
  const allowed=name==='openLine'?['enrollmentIdentity','acceptedTerms','hasPreviousBook','lineLimit','newSalt','bookOpening','salt']:
   name==='draw'?['bookOpening','salt','newSalt','quoteMerchantPk','drawAmount','noteNonce','noteSalt']:
   name==='postQuote'?['quoteFacilityBinding','invoiceId','quoteAmount','quoteNonce']:name==='redeemDraw'?['redeemAmount']:[];
  const descriptor={name,args,domain,privateFinance:true,values:Object.fromEntries(allowed.filter(k=>Object.hasOwn(full,k)).map(k=>[k,full[k]])),...(name==='fundReserve'?{reserveCommit:view().reserveCommit}:{})};
  const approval=await clients[label].approve({operationId,descriptor});active={...full,...approval};let circuitArgs=args;
  if(name==='fundReserve'){active.reserveAmount=args[0];circuitArgs=[];}
  if(name==='openLine'){active.lineFlatFee=args[2];active.lineBasisPoints=args[3];circuitArgs=args.slice(0,2);}
  if(name==='draw'){active.drawFee=args[2];circuitArgs=args.slice(0,2);}
  context=RT.createCircuitContext(address,COIN,state,structuredClone(privateState),undefined,undefined,NOW);
  const input=stateBytes(state),initialQueryContext=context.currentQueryContext,result=contract.circuits[name](context,...circuitArgs);
  await onAccepted?.({role:label,name,seconds:NOW,input,nextState:stateBytes(result.context.currentQueryContext.state),result,initialQueryContext,descriptor,approval});
  state=result.context.currentQueryContext.state;privateState=result.context.currentPrivateState;
  traces.push({actor:label,circuit:name,approvalOverMutualTls:true,signingScalarWitnesses:0});return {descriptor,approval};
 }
 await execute('issuer','registerMerchant',[merchantB],{},'merchant:B');await execute('issuer','fundReserve',[200n],{},'fund:1');
 const openingSalt=bytes(),emptyPath={leaf:zero,path:Array.from({length:20},()=>({sibling:{field:0n},goes_left:false}))};
 const opening={enrollmentIdentity:identity,acceptedTerms:terms,hasPreviousBook:false,lineLimit:100n,newSalt:openingSalt,bookOpening:{...book0,generation:0n},salt:bytes(),bookPath:emptyPath};
 const consent=await execute('agent','openLine',[0n,expiry,1n,0n],opening,'consent:1');
 // Restart each owned service/store independently; caller clients receive no
 // storage key. This same-process owner harness is not independent operators.
 for(const [label,role]of Object.entries(params)){
  const oldPk=owners[label].publicKey;await services[label].close();owners[label].close();
  owners[label]=new DurableApprovalSigner({...ownerOptions[label],create:false});assert.deepEqual(owners[label].publicKey,oldPk);
  services[label]=await startApprovalOwnerService({signer:owners[label],role,approvalABI:'line-private-offer/v1',domain,...tls.material('server'),allowedClients:[tls.fingerprint('caller')]});
  clients[label]=approvalOwnerClient({url:'https://127.0.0.1:'+services[label].port+'/',...tls.material('caller'),expectedServerFingerprint:tls.fingerprint('server'),expectedRole:role,expectedPublicKey:oldPk,expectedDomain:domain});serviceRestarts++;
 }
 assert.deepEqual(await clients.agent.approve({operationId:'consent:1',descriptor:consent.descriptor}),consent.approval);
 await execute('issuer','openLine',[1n,expiry,1n,0n],opening,'accept:1');
 let book=book0,salt=openingSalt;
 for(const [label,merchant]of [['merchantA',merchantA],['merchantB',merchantB]]){
  const invoice=bytes(),quoteNonce=bytes(),noteExpiry=BigInt(NOW+900),Q=offerCommit({merchant,binding,invoice,amount:15n,expiry:noteExpiry,nonce:quoteNonce,domain});
  await execute(label,'postQuote',[noteExpiry],{quoteFacilityBinding:binding,invoiceId:invoice,quoteAmount:15n,quoteNonce,quoteBindingSalt:bindingSalt,enabledMerchantPath:view().enabledMerchantTree.findPathForLeaf(merchant)},label+':quote');
  const quote=privateState.quotes[hex(Q)],newSalt=bytes(),noteNonce=bytes(),noteSalt=bytes();
  const drawValues={bookOpening:book,salt,newSalt,bookPath:view().books.findPathForLeaf(commit(book,salt)),invoiceId:invoice,quoteNonce,quoteBindingSalt:bindingSalt,
   drawAmount:15n,quoteMerchantPk:merchant,noteNonce,noteSalt,quoteMetaOpening:quote.meta,quoteMetaSalt:quote.salt,registeredMerchantPath:view().registeredMerchantTree.findPathForLeaf(merchant)};
  await execute('agent','draw',[Q,noteExpiry,1n],drawValues,label+':draw');
  const D=[...view().notes].find(([d])=>!privateState.notes[hex(d)].meta.redeemed)[0],note=privateState.notes[hex(D)];
  const redemption={noteMetaOpening:note.meta,noteMetaSalt:note.salt,noteGeneration:1n,noteIdentity:identity,noteQuoteCommit:Q,quoteMerchantPk:merchant,redeemAmount:15n,noteNonce,noteSalt};
  const other=label==='merchantA'?'merchantB':'merchantA',frozen=structuredClone(state.state.encode());
  await assert.rejects(execute(other,'redeemDraw',[D,noteExpiry],redemption,label+':foreign-claim'));
  assert.deepEqual(state.state.encode(),frozen);controls.push({check:'foreign-merchant-claim',rejectedByGeneratedCompact:true});
  await execute(label,'redeemDraw',[D,noteExpiry],redemption,label+':redeem');
  const afterRedeem=structuredClone(state.state.encode());await assert.rejects(execute('agent','draw',[Q,noteExpiry,1n],drawValues,label+':draw'));
  assert.deepEqual(state.state.encode(),afterRedeem);controls.push({check:'exact-approval-replay',rejectedByGeneratedCompact:true});
  book={...book,outstanding:book.outstanding+16n,epoch:book.epoch+1n};salt=newSalt;assert(view().books.findPathForLeaf(commit(book,salt)));
 }
 assert.equal(traces.length,10);assert.equal(controls.length,4);assert.equal(privateState.reserve.book.redeemedReserve,30n);
 for(const [p,h]of Object.entries(fingerprints))assert.equal(sha(readFileSync(p)),h);assert.equal(sha(readFileSync(SOURCE)),sourceHash);
 const report={schema:'line-owner-approval-service-compact/v1',createdAt:new Date().toISOString(),sourceSha256:sourceHash,scriptFingerprints:fingerprints,
  artifacts:Object.fromEntries(['contract/index.js','compiler/contract-info.json'].map(p=>[p,sha(readFileSync(join(dir,p)))])),freshCompilation:!compiledDir,cachedGeneratedBindings:Boolean(compiledDir),traces,controls,
  owners:4,merchants:2,serviceRestarts,requestApplicationBytes:128*1024,responseApplicationBytes:8*1024,signingScalarWitnesses:0,
  compiler:info['compiler-version'],runtime:info['runtime-version'],exportedCircuits:info.circuits.map(x=>x.name),
  cryptographicProofsGenerated:false,networkSubmitted:false,authenticAssetSettlement:false,independentAdministrativeCustody:false,fullHistoryPrivacyPassed:false,
  evidenceScope:'Fresh generated Compact through four mTLS owner services and two suppliers. Same-host synthetic owner harness knows encryption keys; financial state is volatile. No native proofs, separate operators, assets or complete privacy certification.'};
 writeFileSync(join(work,'evidence.json'),JSON.stringify(report,null,2)+'\n');await onComplete?.(report);console.log(JSON.stringify({acceptedCalls:10,ownerServices:4,report:join(work,'evidence.json')}));return report;
}finally{for(const service of Object.values(services))await service.close();for(const signer of Object.values(owners))signer.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runApprovalServiceCompact().catch(()=>{console.error('Owner-service Compact integration failed.');process.exitCode=1;});
