import { mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { OrganizationTransactions } from '../src/lib/organization/transactions.ts';
import { ORGANIZATION_SERVICES, fulfillOrganizationService } from './organization-services.mjs';
import { NativeOperationJournal } from './native-operation-journal.mjs';
// Keep this new product profile independent of the legacy operator module cache.
import { resolveContractRelease, validateContractArtifacts } from '../scripts/contract-artifacts.mjs?organization=v1';
import { canonicalInvoiceIdBytes, merchantPublicKey, quoteCommit, drawNoteCommit, requiredDrawFee, toHex, hexToBytes } from '../src/lib/line/encoding.ts';
import { decodeNote, encodeQuote } from '../src/lib/organization/transfers.ts';
import { withinDeadline } from '../src/lib/organization/finality.ts';

const CIRCUITS=['registerMerchant','disableMerchant','fundReserve','withdrawUnencumberedReserve','withdrawFees','openLine','postQuote','draw','redeemDraw','cancelOrExpireNote','acknowledgeRepayment','setStatus'];
const ASSET='00'.repeat(32);
const bytes=()=>new Uint8Array(randomBytes(32));
const equal=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&Buffer.from(a).equals(Buffer.from(b));
const digest=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
/** Line's two first-party API suppliers. They never receive organization role keys. */
export class OrganizationMerchants extends NativeOperationJournal {
 #fulfill;
 constructor({fulfill=fulfillOrganizationService}={}){
  super();
  if(typeof fulfill!=='function')throw Error('A supplier fulfillment function is required.');
  this.#fulfill=fulfill;
 }
 static async create(parent,recipients){
  const service=new OrganizationMerchants();
  const release=validateContractArtifacts({artifactDir:resolveContractRelease({profile:'organization'}),profile:'organization'});
  await service.initializeRecords(parent,recipients,release);
  const generated=await import(pathToFileURL(join(service.release.artifactDir,'contract/index.js')).href);service.decodeLedger=generated.ledger;
  const witnesses=Object.fromEntries(service.release.compilerInfo.witnesses.map(witness=>[witness.name,ctx=>{
   const value=service.input?.[witness.name];if(value===undefined)throw Error(`Merchant witness is missing: ${witness.name}`);return [ctx.privateState,value];
  }]));
  service.compiled=CompiledContract.make('line-organization',generated.Contract).pipe(CompiledContract.withWitnesses(witnesses),CompiledContract.withCompiledFileAssets(service.release.artifactDir));
  service.zk=new NodeZkConfigProvider(service.release.artifactDir);
  service.providers={...parent.providers,privateStateProvider:service.privateProvider,zkConfigProvider:service.zk,proofProvider:httpClientProofProvider(service.endpoints.proofServerUri,service.zk),
   midnightProvider:{submitTx:tx=>service.journalAndSubmit(tx)}};
  service.transactions=new OrganizationTransactions(service.providers,()=>service.compiled);
  return service;
 }
 async initializeRecords(parent,recipients,release){
  this.parent=parent;this.release=release;this.directory=parent.dataDirectory?join(parent.dataDirectory,'organization-merchants'):'.midnight-cache/organization-merchants';mkdirSync(this.directory,{recursive:true});
  for(const name of ['endpoints','facade','shieldedKeys','dustKey','keystore','api','publicProvider','reader'])this[name]=parent[name];
  this.merchantKeys={A:parent.keys.merchantA,B:parent.keys.merchantB};this.recipients=recipients;
  const options={...parent.privateStorageOptions,midnightDbName:`${this.directory}/private-db`};
  this.control=levelPrivateStateProvider({...options,privateStateStoreName:'controller',signingKeyStoreName:'controller-signing'});this.control.setContractAddress('00'.repeat(32));
  this.privateProvider=levelPrivateStateProvider({...options,privateStateStoreName:'sdk-states',signingKeyStoreName:'sdk-signing'});
  this.state=await this.control.get('application');
  if(!this.state){this.state={version:1,profile:'organization-merchants',sourceSha256:this.release.inputs.source.sha256,contractAddress:null,orders:[],receipts:[],pending:null};await this.save();}
  if(this.state.profile!=='organization-merchants'||this.state.sourceSha256!==this.release.inputs.source.sha256)throw Error('Merchant records require their original organization contract release.');
 }
 catalog(){return {network:'preprod',assetColor:ASSET,decimals:6,sourceFingerprint:this.release.inputs.source.sha256,services:ORGANIZATION_SERVICES.map(service=>({...service,profile:{name:`Line / ${service.name}`,publicKey:toHex(merchantPublicKey(this.merchantKeys[service.merchant])),address:this.recipients[service.merchant].address}}))};}
 async inspectContract(address){
  if(!/^[0-9a-f]{64}$/.test(address))throw Error('A deployed organization contract address is required.');
  const state=await withinDeadline(this.publicProvider.queryContractState(address),25000,'Organization state lookup is unavailable. Retry without replacing a pending payment.');if(!state)throw Error('Organization facility was not found.');
  const names=state.operations().map(value=>typeof value==='string'?value:Buffer.from(value).toString()).sort();
  if(JSON.stringify(names)!==JSON.stringify([...CIRCUITS].sort()))throw Error('Organization verifier setup is incomplete.');
  for(const name of CIRCUITS)if(!equal(state.operation(name).verifierKey,await this.zk.getVerifierKey(name)))throw Error('Organization verifier keys differ from the supported release.');
  const book=this.decodeLedger(state.data);
  if(toHex(book.settlementTokenColor)!==ASSET)throw Error('These API suppliers accept native Preprod tNIGHT only.');
  return book;
 }
 async authorizeOrganization(address,recipient){
  if(!/^[0-9a-f]{64}$/.test(recipient))return false;
  const book=await this.inspectContract(address);
  return toHex(book.issuerPayoutRecipient.bytes)===recipient;
 }
 async inspect(address,merchant){
  const book=await this.inspectContract(address),pk=merchantPublicKey(this.merchantKeys[merchant]);
  if(!book.registeredMerchants.member(pk)||!equal(book.merchantPayoutRecipients.lookup(pk).bytes,hexToBytes(this.recipients[merchant].addressHex)))throw Error('This merchant is not registered with its own receiving wallet.');
  return book;
 }
 async bindOrganization(address){
  return {callTx:{
   postQuote:expiry=>this.transactions.call(address,'postQuote',[expiry]).then(receipt=>({public:receipt})),
   redeemDraw:(commitment,expiry)=>this.transactions.call(address,'redeemDraw',[commitment,expiry]).then(receipt=>({public:receipt})),
  }};
 }
 async reconcile(){const receipt=await super.reconcile();if(receipt?.txId)this.transactions.finality.forget(receipt.txId);return receipt;}
 order(id){
  this.assertJournalWritable();
  const order=this.state.orders.find(order=>order.id===id);if(!order)return null;
  const paymentStatus=order.paymentStatus??(order.status==='delivered'?'redeemed':order.status==='created'?'unpaid':'quoted');
  const deliveryStatus=order.deliveryStatus??(order.status==='delivered'?'delivered':'pending');
  return {
   id:order.id,contractAddress:order.address,service:order.service,status:order.status,
   paymentStatus,deliveryStatus,
   quotePackage:order.status==='created'?null:encodeQuote(order.quote),
   result:deliveryStatus==='delivered'?order.result:null,
   deliveryError:deliveryStatus==='undelivered'?(order.deliveryError??'Delivery failed.'):null,
   deliveryTimeoutAt:order.deliveryTimeoutAt??null,
   inputDigest:order.inputDigest,objectiveDigest:order.objectiveDigest??null,
   noteCommitment:order.noteCommitment??null,
   receipts:this.state.receipts.filter(receipt=>receipt.id===`quote-${id}`||receipt.id===`redeem-${id}`).map(({name,contractAddress,txHash,blockHeight})=>({circuit:name,contractAddress,txHash,blockHeight})),
   pending:this.state.pending?.id===`quote-${id}`||this.state.pending?.id===`redeem-${id}`
  };
 }
 runMutation(action){
  if(this.closed)return Promise.reject(Error('The supplier service is closed.'));
  try{this.assertJournalWritable();this.parent.assertOpen?.();}catch(error){return Promise.reject(error);}
  if(this.activeMutation)return Promise.reject(Error('The supplier wallet is completing another operation.'));
  const task=Promise.resolve().then(action).finally(()=>{if(this.activeMutation===task)this.activeMutation=null;});
  this.activeMutation=task;return task;
 }
 recoverPending(){return this.runMutation(()=>super.recoverPending());}
 observePending(){return this.runMutation(()=>super.observePending());}
 quote(id,address,serviceId,document,objective=''){return this.runMutation(()=>this.quoteOrder(id,address,serviceId,document,objective));}
 async quoteOrder(id,address,serviceId,document,objective=''){
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('A stable purchase request is required.');
  const service=ORGANIZATION_SERVICES.find(service=>service.id===serviceId);if(!service)throw Error('Unknown merchant service.');
  fulfillOrganizationService(serviceId,document,objective);
  if(this.state.pending)await super.recoverPending();
  const inputDigest=digest(document),objectiveDigest=objective?digest(objective):null;
  let order=this.state.orders.find(order=>order.id===id);
  if(order&&(order.address!==address||order.service!==serviceId||order.inputDigest!==inputDigest||((order.objectiveDigest??null)!==objectiveDigest)))throw Error('The purchase request is already bound to different terms.');
  if(order&&order.status!=='created')return this.order(id);
  const book=await this.inspect(address,service.merchant);
  if(!book.registeredMerchants.lookup(merchantPublicKey(this.merchantKeys[service.merchant])))throw Error('The organization disabled new quotes from this supplier.');
  if(!order){
   if(this.state.orders.length>=1000)throw Error('The merchant order store is full; existing obligations remain recoverable.');
   const createdAt=Date.now(),ownerRecipient=toHex(book.issuerPayoutRecipient.bytes);
   if(this.state.orders.filter(row=>row.ownerRecipient===ownerRecipient&&row.createdAt>createdAt-600000).length>=6)throw Error('Too many new supplier quotes for this organization. Retry after ten minutes; existing orders remain recoverable.');
   const amount=BigInt(service.price),free=book.totalReserve-book.encumberedReserve-book.redeemedReserve-book.feeReserve-book.pendingFeeReserve-book.refundReserve-book.reportedRefundReserve;
   if(free<amount)throw Error('Deposit sufficient assets before requesting a paid API quote.');
   const expiry=BigInt(Math.floor(Date.now()/1000)+3600),nonce=bytes(),invoiceId=canonicalInvoiceIdBytes(digest([this.catalog().network,address,serviceId,id,inputDigest,objectiveDigest??''].join(':'))),pk=merchantPublicKey(this.merchantKeys[service.merchant]);
   const quote={contractAddress:address,domain:toHex(book.contractDomain),merchantPk:toHex(pk),invoiceId:toHex(invoiceId),quoteNonce:toHex(nonce),amount,expiry,generation:book.lineGeneration,feeFlat:book.feeFlat,feeBps:book.feeBps,quoteCommitment:toHex(quoteCommit({merchantPk:pk,invoiceId,nonce,amount,expiry,generation:book.lineGeneration,domain:book.contractDomain,feeFlat:book.feeFlat,feeBps:book.feeBps}))};
   order={id,address,service:serviceId,inputDigest,objectiveDigest,document,objective:objective||null,quote,status:'created',paymentStatus:'unpaid',deliveryStatus:'pending',result:null,createdAt,ownerRecipient,deliveryTimeoutAt:null,deliveryError:null};this.state.orders.push(order);await this.save();
  }
  this.state.contractAddress=address;const after=clone(this.state);
  const target=after.orders.find(order=>order.id===id);target.status='quoted';target.paymentStatus='quoted';target.deliveryStatus='pending';
  await this.operation(`quote-${id}`,'call','postQuote',{callerSecret:this.merchantKeys[service.merchant],invoiceId:hexToBytes(order.quote.invoiceId),quoteNonce:hexToBytes(order.quote.quoteNonce),quoteAmount:order.quote.amount},after,async()=>{const bound=await this.bindOrganization(address);return bound.callTx.postQuote(order.quote.expiry);});
  return this.order(id);
 }
 redeem(id,claim){return this.runMutation(()=>this.redeemOrder(id,claim));}
 async redeemOrder(id,claim){
  if(this.state.pending)await super.recoverPending();
  const order=this.state.orders.find(order=>order.id===id);if(!order)throw Error('Unknown merchant order.');
  const service=ORGANIZATION_SERVICES.find(service=>service.id===order.service);if(!service)throw Error('Unknown merchant service.');
  const note=decodeNote(claim),expectedFee=requiredDrawFee(order.quote.amount,order.quote.feeFlat,order.quote.feeBps);
  if(note.contractAddress!==order.address||note.quoteCommitment!==order.quote.quoteCommitment||note.merchantPk!==order.quote.merchantPk||note.amount!==order.quote.amount||note.expiry!==order.quote.expiry||note.generation!==order.quote.generation||note.domain!==order.quote.domain||note.fee!==expectedFee)throw Error('The claim is not for this exact service order.');
  const commitment=toHex(drawNoteCommit({domain:hexToBytes(note.domain),lineGeneration:note.generation,identity:hexToBytes(note.identity),quoteCommit:hexToBytes(note.quoteCommitment),merchantPk:hexToBytes(note.merchantPk),amount:note.amount,fee:note.fee,noteNonce:hexToBytes(note.noteNonce),expiry:note.expiry},hexToBytes(note.noteSalt)));
  if(commitment!==note.noteCommitment)throw Error('The claim commitment does not match its original opening.');
  if(order.claimIdentity&&order.claimIdentity!==note.identity)throw Error('The purchase request is already bound to a different claim.');
  if(order.noteCommitment&&order.noteCommitment!==note.noteCommitment)throw Error('The purchase request is already bound to a different claim.');
  if((order.paymentStatus==='redeemed'||['redeemed','paid_undelivered','delivered'].includes(order.status))&&!order.noteCommitment)throw Error('The legacy paid order remains available. Its original claim must be reconciled before a redemption retry.');
  if(order.deliveryStatus==='delivered')return this.order(id);
  await this.inspect(order.address,service.merchant);
  if(order.paymentStatus!=='redeemed'&&order.status!=='redeemed'&&order.status!=='paid_undelivered'){
   this.state.contractAddress=order.address;const after=clone(this.state);
   const target=after.orders.find(order=>order.id===id);target.paymentStatus='redeemed';target.status='paid_awaiting_delivery';target.claimIdentity=note.identity;target.noteCommitment=note.noteCommitment;target.deliveryTimeoutAt=Date.now()+60000;
   await this.operation(`redeem-${id}`,'call','redeemDraw',{callerSecret:this.merchantKeys[service.merchant],noteIdentity:hexToBytes(note.identity),noteQuoteCommit:hexToBytes(note.quoteCommitment),noteNonce:hexToBytes(note.noteNonce),noteSalt:hexToBytes(note.noteSalt),redeemAmount:note.amount},after,async()=>{const bound=await this.bindOrganization(order.address);return bound.callTx.redeemDraw(hexToBytes(note.noteCommitment),note.expiry);});
  }
  const delivered=clone(this.state),retained=delivered.orders.find(order=>order.id===id);retained.noteCommitment=note.noteCommitment;
  try{
   if(digest(retained.document)!==retained.inputDigest||(retained.objective?digest(retained.objective):null)!==(retained.objectiveDigest??null))throw Error('The retained supplier input differs from the original order.');
   retained.result=await this.#fulfill(order.service,retained.document,retained.objective??'');
   retained.deliveryStatus='delivered';retained.status='delivered';retained.deliveredAt=Date.now();retained.deliveryError=null;
  }catch(err){
   retained.result=null;retained.deliveryStatus='undelivered';retained.status='paid_undelivered';retained.deliveryError=err instanceof Error?err.message:String(err);
  }
  await this.save(delivered);this.state=delivered;
  return this.order(id);
 }
 async persistWallet(){return this.parent.persistWallet();}
 close(){
  if(this.closeTask)return this.closeTask;
  this.closed=true;
  this.closeTask=(async()=>{
   // An admitted proof/balance/submission retains sole custody until it settles.
   await this.activeMutation?.catch(()=>{});
   if(this.ownsParent)await this.parent.close();
   // Otherwise the local parent owns the shared fee wallet.
  })().catch(error=>{this.closeTask=undefined;throw error;});
  return this.closeTask;
 }
}
