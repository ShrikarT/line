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
import { PreprodLive } from './preprod-live.mjs';
// Keep this new product profile independent of the legacy operator module cache.
import { resolveContractRelease, validateContractArtifacts } from '../scripts/contract-artifacts.mjs?organization=v1';
import { canonicalInvoiceIdBytes, merchantPublicKey, quoteCommit, toHex, hexToBytes } from '../src/lib/line/encoding.ts';
import { decodeNote, encodeQuote } from '../src/lib/organization/transfers.ts';

const CIRCUITS=['registerMerchant','disableMerchant','fundReserve','withdrawUnencumberedReserve','withdrawFees','openLine','postQuote','draw','redeemDraw','cancelOrExpireNote','acknowledgeRepayment','setStatus'];
const ASSET='00'.repeat(32);
const bytes=()=>new Uint8Array(randomBytes(32));
const equal=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&Buffer.from(a).equals(Buffer.from(b));
const digest=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
/** Line's two first-party API suppliers. They never receive organization role keys. */
export class OrganizationMerchants extends PreprodLive {
 static async create(parent,recipients){
  const service=new OrganizationMerchants();service.parent=parent;service.directory='.midnight-cache/organization-merchants';mkdirSync(service.directory,{recursive:true});
  service.release=validateContractArtifacts({artifactDir:resolveContractRelease({profile:'organization'}),profile:'organization'});
  const generated=await import(pathToFileURL(join(service.release.artifactDir,'contract/index.js')).href);service.decodeLedger=generated.ledger;
  for(const name of ['endpoints','facade','shieldedKeys','dustKey','keystore','api','publicProvider','reader'])service[name]=parent[name];
  service.merchantKeys={A:parent.keys.merchantA,B:parent.keys.merchantB};service.recipients=recipients;
  const options={...parent.privateStorageOptions,midnightDbName:`${service.directory}/private-db`};
  service.control=levelPrivateStateProvider({...options,privateStateStoreName:'controller',signingKeyStoreName:'controller-signing'});service.control.setContractAddress('00'.repeat(32));
  service.privateProvider=levelPrivateStateProvider({...options,privateStateStoreName:'sdk-states',signingKeyStoreName:'sdk-signing'});
  service.state=await service.control.get('application');
  if(!service.state){service.state={version:1,profile:'organization-merchants',sourceSha256:service.release.inputs.source.sha256,contractAddress:null,orders:[],receipts:[],pending:null};await service.save();}
  if(service.state.profile!=='organization-merchants'||service.state.sourceSha256!==service.release.inputs.source.sha256)throw Error('Merchant records require their original organization contract release.');
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
 catalog(){return {network:'preprod',assetColor:ASSET,decimals:6,sourceFingerprint:this.release.inputs.source.sha256,services:ORGANIZATION_SERVICES.map(service=>({...service,profile:{name:`Line / ${service.name}`,publicKey:toHex(merchantPublicKey(this.merchantKeys[service.merchant])),address:this.recipients[service.merchant].address}}))};}
 async inspect(address,merchant){
  if(!/^[0-9a-f]{64}$/.test(address))throw Error('A deployed organization contract address is required.');
  const state=await this.publicProvider.queryContractState(address);if(!state)throw Error('Organization facility was not found.');
  const names=state.operations().map(value=>typeof value==='string'?value:Buffer.from(value).toString()).sort();
  if(JSON.stringify(names)!==JSON.stringify([...CIRCUITS].sort()))throw Error('Organization verifier setup is incomplete.');
  for(const name of CIRCUITS)if(!equal(state.operation(name).verifierKey,await this.zk.getVerifierKey(name)))throw Error('Organization verifier keys differ from the supported release.');
  const book=this.decodeLedger(state.data),pk=merchantPublicKey(this.merchantKeys[merchant]);
  if(toHex(book.settlementTokenColor)!==ASSET)throw Error('These API suppliers accept native Preprod tNIGHT only.');
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
  const order=this.state.orders.find(order=>order.id===id);if(!order)return null;
  return {id:order.id,contractAddress:order.address,service:order.service,status:order.status,quotePackage:order.status==='created'?null:encodeQuote(order.quote),result:order.status==='delivered'?order.result:null,receipts:this.state.receipts.filter(receipt=>receipt.id===`quote-${id}`||receipt.id===`redeem-${id}`).map(({name,contractAddress,txHash,blockHeight})=>({circuit:name,contractAddress,txHash,blockHeight})),pending:this.state.pending?.id===`quote-${id}`||this.state.pending?.id===`redeem-${id}`};
 }
 async quote(id,address,serviceId,document){
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('A stable purchase request is required.');
  const service=ORGANIZATION_SERVICES.find(service=>service.id===serviceId);if(!service)throw Error('Unknown merchant service.');
  fulfillOrganizationService(serviceId,document);
  if(this.state.pending)await this.recoverPending();
  let order=this.state.orders.find(order=>order.id===id);
  if(order&&(order.address!==address||order.service!==serviceId||order.inputDigest!==digest(document)))throw Error('The purchase request is already bound to different terms.');
  if(order&&order.status!=='created')return this.order(id);
  const book=await this.inspect(address,service.merchant);
  if(!book.registeredMerchants.lookup(merchantPublicKey(this.merchantKeys[service.merchant])))throw Error('The organization disabled new quotes from this supplier.');
  if(!order){
   if(this.state.orders.length>=1000)throw Error('The merchant order store is full; existing obligations remain recoverable.');
   const amount=BigInt(service.price),free=book.totalReserve-book.encumberedReserve-book.redeemedReserve-book.feeReserve-book.pendingFeeReserve-book.refundReserve-book.reportedRefundReserve;
   if(free<amount)throw Error('Deposit sufficient assets before requesting a paid API quote.');
   const expiry=BigInt(Math.floor(Date.now()/1000)+3600),nonce=bytes(),invoiceId=canonicalInvoiceIdBytes(`line-api:${serviceId}:${id}`),pk=merchantPublicKey(this.merchantKeys[service.merchant]);
   const quote={contractAddress:address,domain:toHex(book.contractDomain),merchantPk:toHex(pk),invoiceId:toHex(invoiceId),quoteNonce:toHex(nonce),amount,expiry,generation:book.lineGeneration,feeFlat:book.feeFlat,feeBps:book.feeBps,quoteCommitment:toHex(quoteCommit({merchantPk:pk,invoiceId,nonce,amount,expiry,generation:book.lineGeneration,domain:book.contractDomain,feeFlat:book.feeFlat,feeBps:book.feeBps}))};
   order={id,address,service:serviceId,inputDigest:digest(document),document,quote,status:'created',result:null};this.state.orders.push(order);await this.save();
  }
  this.state.contractAddress=address;const after=clone(this.state);after.orders.find(order=>order.id===id).status='quoted';
  await this.operation(`quote-${id}`,'call','postQuote',{callerSecret:this.merchantKeys[service.merchant],invoiceId:hexToBytes(order.quote.invoiceId),quoteNonce:hexToBytes(order.quote.quoteNonce),quoteAmount:order.quote.amount},after,async()=>{const bound=await this.bindOrganization(address);return bound.callTx.postQuote(order.quote.expiry);});
  return this.order(id);
 }
 async redeem(id,claim){
  if(this.state.pending)await this.recoverPending();
  const order=this.state.orders.find(order=>order.id===id);if(!order)throw Error('Unknown merchant order.');
  if(order.status==='delivered')return this.order(id);
  const service=ORGANIZATION_SERVICES.find(service=>service.id===order.service),note=decodeNote(claim);
  if(note.contractAddress!==order.address||note.quoteCommitment!==order.quote.quoteCommitment||note.merchantPk!==order.quote.merchantPk||note.amount!==order.quote.amount||note.expiry!==order.quote.expiry||note.generation!==order.quote.generation||note.domain!==order.quote.domain)throw Error('The claim is not for this exact service order.');
  await this.inspect(order.address,service.merchant);
  if(order.status!=='redeemed'){
   this.state.contractAddress=order.address;const after=clone(this.state);after.orders.find(order=>order.id===id).status='redeemed';
   await this.operation(`redeem-${id}`,'call','redeemDraw',{callerSecret:this.merchantKeys[service.merchant],noteIdentity:hexToBytes(note.identity),noteQuoteCommit:hexToBytes(note.quoteCommitment),noteNonce:hexToBytes(note.noteNonce),noteSalt:hexToBytes(note.noteSalt),redeemAmount:note.amount},after,async()=>{const bound=await this.bindOrganization(order.address);return bound.callTx.redeemDraw(hexToBytes(note.noteCommitment),note.expiry);});
  }
  const retained=this.state.orders.find(order=>order.id===id);retained.result=fulfillOrganizationService(order.service,retained.document);retained.status='delivered';await this.save();
  return this.order(id);
 }
 async close(){/* The parent owns the shared merchant fee wallet. */}
}
