import '@midnight-ntwrk/wallet-sdk-node-client';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mnemonicToSeed} from '@scure/bip39';
import {HDWallet,Roles,ShieldedWallet,UnshieldedWallet,DustWallet,createKeystore,PublicKey,WalletFacade,WalletEntrySchema,InMemoryTransactionHistoryStorage} from '@midnight-ntwrk/wallet-sdk';
import * as L from '@midnight-ntwrk/ledger-v8';
import * as C from '@midnight-ntwrk/compact-runtime';
import {ApiPromise,HttpProvider} from '@polkadot/api';
import {setNetworkId} from '@midnight-ntwrk/midnight-js-network-id';
import {CompiledContract} from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import {deployContract,findDeployedContract,submitInsertVerifierKeyTx} from '@midnight-ntwrk/midnight-js-contracts';
import {indexerPublicDataProvider} from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {httpClientProofProvider} from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import {NodeZkConfigProvider} from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {levelPrivateStateProvider} from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import {Contract,ledger} from '../contracts/managed/line/contract/index.js';
import {issuerPublicKey,merchantPublicKey,agentId,quoteCommit,drawNoteCommit,toHex,canonicalInvoiceIdBytes,canonicalPaymentReferenceBytes} from '../src/lib/line/encoding.ts';
import {resolveMidnightEndpoints,sanitizeServiceError} from '../src/lib/runtime/endpoints.ts';
import {resolveContractRelease,validateContractArtifacts} from '../scripts/contract-artifacts.mjs';
import {createFinalizedReceiptReader} from '../scripts/finalized-contract-receipt.mjs';
import {assertFundedFeeTransaction} from './preprod-fees.mjs';
import {NativeOperationJournal} from './native-operation-journal.mjs';

const BYTE_NAMES=['callerSecret','agentSecret','salt','newSalt','invoiceId','quoteNonce','receiptNonce','paymentRef','noteNonce','noteSalt','noteIdentity','noteQuoteCommit','quoteMerchantPk'];
const UINT_NAMES=['lineLimit','lineOutstanding','lineEpoch','quoteAmount','drawAmount','redeemAmount','repayAmount'];
const CIRCUITS=['registerMerchant','disableMerchant','fundReserve','withdrawUnencumberedReserve','withdrawFees','openLine','postQuote','draw','redeemDraw','cancelOrExpireNote','acknowledgeRepayment','setStatus'];
const DIR='.midnight-cache/live-checkout';
const bytes=()=>new Uint8Array(randomBytes(32));
const now=()=>Math.floor(Date.now()/1000);
const copy=value=>structuredClone(value);

export class PreprodLive extends NativeOperationJournal {
 static async create(env=process.env){
  if(!env.MIDNIGHT_DEPLOYER_MNEMONIC||!env.MIDNIGHT_STORAGE_PASSWORD)throw Error('Configure the local Preprod signer first.');
  const runtime=new PreprodLive();try{await runtime.initialize(env);return runtime;}catch(error){await runtime.close().catch(()=>{});throw error;}
 }
 async initialize(env){
  mkdirSync(DIR,{recursive:true});this.release=validateContractArtifacts({artifactDir:resolveContractRelease()});
  this.endpoints=resolveMidnightEndpoints({networkId:'preprod',blockfrostProjectId:env.MIDNIGHT_BLOCKFROST_PROJECT_ID});setNetworkId('preprod');
  const mnemonic=env.MIDNIGHT_DEPLOYER_MNEMONIC,hd=HDWallet.fromSeed(await mnemonicToSeed(mnemonic));if(hd.type!=='seedOk')throw Error('Wallet derivation failed.');
  const account=hd.hdWallet.selectAccount(0);
  this.shieldedKeys=L.ZswapSecretKeys.fromSeed(account.selectRole(Roles.Zswap).deriveKeyAt(0).key);
  this.dustKey=L.DustSecretKey.fromSeed(account.selectRole(Roles.Dust).deriveKeyAt(0).key);
  this.keystore=createKeystore(account.selectRole(Roles.NightExternal).deriveKeyAt(0).key,'preprod');
  this.keys=Object.fromEntries(Object.entries({issuer:':line:issuer',merchantA:':line:initial_merchant',merchantB:':line:merchant_b',agent:':line:agent_1'}).map(([name,suffix])=>[name,new Uint8Array(createHash('sha256').update(mnemonic+suffix).digest())]));
  const privateOptions={midnightDbName:`${DIR}/private-db`,accountId:PublicKey.fromKeyStore(this.keystore).address,privateStoragePasswordProvider:()=>env.MIDNIGHT_STORAGE_PASSWORD};
  this.privateStorageOptions=privateOptions;
  this.control=levelPrivateStateProvider({...privateOptions,privateStateStoreName:'controller',signingKeyStoreName:'controller-signing'});this.control.setContractAddress('00'.repeat(32));
  this.privateProvider=levelPrivateStateProvider({...privateOptions,privateStateStoreName:'sdk-states',signingKeyStoreName:'sdk-signing'});
  this.state=await this.control.get('application');
  if(!this.state){this.state={version:1,sourceSha256:this.release.inputs.source.sha256,instanceNonce:bytes(),maintenanceKey:C.sampleSigningKey(),contractAddress:null,limit:60n,outstanding:0n,epoch:0n,salt:bytes(),receipts:[],orders:[],phase:'not-deployed',pending:null};await this.save();}
  if(this.state.sourceSha256!==this.release.inputs.source.sha256)throw Error('The retained private state belongs to another Compact source.');
  const dustSnapshot=readFileSync('.midnight-cache/dust-state.json','utf8'),dustCache=JSON.parse(dustSnapshot);
  if(dustCache.networkId!=='preprod'||BigInt(dustCache.publicKey.publicKey)!==this.dustKey.publicKey)throw Error('Wallet cache identity mismatch.');
  const configuration={networkId:'preprod',txHistoryStorage:new InMemoryTransactionHistoryStorage(WalletEntrySchema),indexerClientConnection:{indexerHttpUrl:this.endpoints.indexerUri,indexerWsUrl:this.endpoints.indexerWsUri},relayURL:new URL(this.endpoints.nodeUri.replace(/^http/,'ws')),provingServerUrl:new URL(this.endpoints.proofServerUri),batchUpdates:{size:5000,timeout:50,spacing:0},costParameters:{feeBlocksMargin:5,additionalFeeOverhead:1n}};
  this.walletConfiguration=configuration;
  this.facade=await WalletFacade.init({configuration,submissionService:()=>({submitTransaction:async()=>{throw Error('Use journaled submission.');},close:async()=>{}}),shielded:c=>ShieldedWallet(c).startWithSecretKeys(this.shieldedKeys),unshielded:c=>UnshieldedWallet(c).restore(readFileSync('.midnight-cache/unshielded-state.json','utf8')),dust:c=>DustWallet(c).restore(dustSnapshot)});
  await this.facade.start(this.shieldedKeys,this.dustKey);await this.facade.shielded.stop();await this.facade.dust.waitForSyncedState(5n);
  this.api=await ApiPromise.create({provider:new HttpProvider(this.endpoints.nodeUri),noInitWarn:true});
  this.publicProvider=indexerPublicDataProvider(this.endpoints.indexerUri,this.endpoints.indexerWsUri);this.reader=createFinalizedReceiptReader({endpoints:this.endpoints});
  const witnesses=Object.fromEntries(BYTE_NAMES.map(name=>[name,ctx=>[ctx.privateState,this.input?.[name]??new Uint8Array(32)]]));for(const name of UINT_NAMES)witnesses[name]=ctx=>[ctx.privateState,this.input?.[name]??0n];
  this.compiled=CompiledContract.make('line',Contract).pipe(CompiledContract.withWitnesses(witnesses),CompiledContract.withCompiledFileAssets(this.release.artifactDir));
  const zkp=new NodeZkConfigProvider(this.release.artifactDir),proof=httpClientProofProvider(this.endpoints.proofServerUri,zkp);
  this.providers={publicDataProvider:this.publicProvider,privateStateProvider:this.privateProvider,zkConfigProvider:zkp,
   proofProvider:{proveTx:async tx=>{this.progress='Generating Compact proof';const result=await proof.proveTx(tx);this.progress='Proof generated';return result;}},
   walletProvider:{getCoinPublicKey:()=>this.shieldedKeys.coinPublicKey,getEncryptionPublicKey:()=>this.shieldedKeys.encryptionPublicKey,balanceTx:async(tx,ttl)=>{this.progress='Synchronizing the fee wallet';await this.facade.dust.waitForSyncedState(0n);this.progress='Balancing DUST transaction fees';const recipe=await this.facade.balanceUnboundTransaction(tx,{shieldedSecretKeys:this.shieldedKeys,dustSecretKey:this.dustKey},{ttl:ttl??new Date(Date.now()+30*60*1000),tokenKindsToBalance:['dust']});return assertFundedFeeTransaction(await this.facade.finalizeRecipe(recipe));}},
   midnightProvider:{submitTx:tx=>this.journalAndSubmit(tx)}};
  await this.recoverPending();
 }
 async bind(){
  if(!this.state.contractAddress)throw Error('Deploy the demo instance first.');
  const address=this.state.contractAddress,id=`line-state:${address}`;this.privateProvider.setContractAddress(address);
  if(await this.privateProvider.get(id)==null)await this.privateProvider.set(id,{});
  await this.privateProvider.setSigningKey(address,this.state.maintenanceKey);
  return findDeployedContract(this.providers,{compiledContract:this.compiled,contractAddress:address,privateStateId:id});
 }
 async call(id,name,args,input,after){try{const bound=await this.bind();return await this.operation(id,'call',name,input,after,()=>bound.callTx[name](...args));}catch(error){throw Error(name==='draw'?'Clearance could not be proven.':sanitizeServiceError(error.message));}}
 async setup(){
  await this.recoverPending();
  if(!this.state.contractAddress){
   const ContractType=this.contractType??Contract;
   class ShellContract extends ContractType{constructor(w){super(w);this.circuits={registerMerchant:this.circuits.registerMerchant};this.provableCircuits={registerMerchant:this.circuits.registerMerchant};}initialState(...args){const result=super.initialState(...args),shell=new C.ContractState();shell.data=result.currentContractState.data;shell.setOperation('registerMerchant',result.currentContractState.operation('registerMerchant'));return {...result,currentContractState:shell};}}
   const shell=CompiledContract.make('line',ShellContract).pipe(CompiledContract.withWitnesses(Object.fromEntries([...BYTE_NAMES.map(n=>[n,ctx=>[ctx.privateState,new Uint8Array(32)]]),...UINT_NAMES.map(n=>[n,ctx=>[ctx.privateState,0n]])])),CompiledContract.withCompiledFileAssets(this.release.artifactDir));
   const constructorArgs=this.constructorArgs??[issuerPublicKey(this.keys.issuer),merchantPublicKey(this.keys.merchantA),this.state.instanceNonce];
   await this.operation('deploy','deploy','deploy',{}, {...this.state,phase:'registering'},()=>deployContract(this.providers,{compiledContract:shell,args:constructorArgs,signingKey:this.state.maintenanceKey}));
  }
  this.privateProvider.setContractAddress(this.state.contractAddress);await this.privateProvider.setSigningKey(this.state.contractAddress,this.state.maintenanceKey);
  for(const name of CIRCUITS.filter(n=>n!=='registerMerchant'))await this.operation(`key-${name.toLowerCase()}`,'key-registration',name,{}, {...this.state},()=>submitInsertVerifierKeyTx(this.providers,this.compiled,this.state.contractAddress,name,new Uint8Array(readFileSync(`${this.release.artifactDir}/keys/${name}.verifier`))));
  await this.call('setup-fund','fundReserve',[200n],{callerSecret:this.keys.issuer},{...this.state});
  await this.call('setup-merchant-b','registerMerchant',this.merchantRegistrationArgs??[merchantPublicKey(this.keys.merchantB)],{callerSecret:this.keys.issuer},{...this.state});
  await this.call('setup-open','openLine',[BigInt(now()+7*86400),0n,0n],{callerSecret:this.keys.issuer,agentSecret:this.keys.agent,lineLimit:this.state.limit,salt:this.state.salt},{...this.state,phase:'ready',lineExpiry:now()+7*86400});
  return this.summary();
 }
 async purchase(requestId,document){
  await this.recoverPending();
  if(!/^[a-f0-9-]{36}$/.test(requestId))throw Error('A stable request ID is required.');
  if(this.state.phase!=='ready')throw Error('Finish Preprod setup first.');
  if(typeof document!=='string'||!document.trim()||document.length>5000)throw Error('Enter a document of up to 5000 characters.');
  const contracts=await this.publicProvider.queryContractState(this.state.contractAddress),domain=(this.decodeLedger??ledger)(contracts.data).contractDomain;
  for(const [index,service,amount,key]of [[0,'text-analysis',25n,this.keys.merchantA],[1,'cost-report',20n,this.keys.merchantB]]){
   const orderId=`${requestId}-${index}`;let order=this.state.orders.find(o=>o.id===orderId);
   if(!order){const expiry=now()+86400;order={id:orderId,service,document,amount,invoiceId:canonicalInvoiceIdBytes(requestId.replaceAll('-','')),quoteNonce:bytes(),noteNonce:bytes(),noteSalt:bytes(),quoteExpiry:expiry,noteExpiry:expiry,status:'created'};this.state.orders.push(order);await this.save();}
   if(order.document!==document)throw Error('This request ID belongs to another document.');
   const merchantPk=merchantPublicKey(key);
   const q=quoteCommit({merchantPk,invoiceId:order.invoiceId,amount,expiry:BigInt(order.quoteExpiry),nonce:order.quoteNonce,generation:1n,domain,feeFlat:0n,feeBps:0n});
   const d=drawNoteCommit({merchantPk,quoteCommit:q,identity:agentId(this.keys.agent),amount,expiry:BigInt(order.noteExpiry),noteNonce:order.noteNonce,lineGeneration:1n,domain,fee:0n},order.noteSalt);
   const change=(status,extra={})=>({...this.state,...extra,orders:this.state.orders.map(o=>o.id===orderId?{...o,status,Q:toHex(q),D:toHex(d)}:o)});
   await this.call(`${orderId}-quote`,'postQuote',[BigInt(order.quoteExpiry)],{callerSecret:key,invoiceId:order.invoiceId,quoteNonce:order.quoteNonce,quoteAmount:amount},change('quoted'));
   if(!this.state.receipts.some(r=>r.id===`${orderId}-draw`)){
    if(this.state.outstanding+amount>this.state.limit)throw Error('Clearance could not be proven.');const nextSalt=bytes();
    await this.call(`${orderId}-draw`,'draw',[q,BigInt(order.noteExpiry),0n],{callerSecret:this.keys.agent,agentSecret:this.keys.agent,lineLimit:this.state.limit,lineOutstanding:this.state.outstanding,lineEpoch:this.state.epoch,salt:this.state.salt,newSalt:nextSalt,quoteMerchantPk:merchantPk,invoiceId:order.invoiceId,quoteAmount:amount,drawAmount:amount,quoteNonce:order.quoteNonce,noteNonce:order.noteNonce,noteSalt:order.noteSalt},change('authorized',{outstanding:this.state.outstanding+amount,epoch:this.state.epoch+1n,salt:nextSalt}));
   }
   await this.call(`${orderId}-redeem`,'redeemDraw',[d,BigInt(order.noteExpiry)],{callerSecret:key,noteIdentity:agentId(this.keys.agent),noteQuoteCommit:q,noteNonce:order.noteNonce,noteSalt:order.noteSalt,redeemAmount:amount},change('redeemed'));
   const words=document.trim().split(/\s+/);const result=service==='text-analysis'?{wordCount:words.length,characterCount:document.length,summary:words.slice(0,24).join(' ')}:{totalServiceUnits:45,services:[{merchant:'Merchant A',units:25},{merchant:'Merchant B',units:20}]};
   this.state.orders=this.state.orders.map(o=>o.id===orderId?{...o,status:'delivered',result}:o);await this.save();
  }
  return this.summary();
 }
 async acknowledge(requestId){
  await this.recoverPending();
  if(!/^[a-f0-9-]{36}$/.test(requestId))throw Error('A stable request ID is required.');
  const id=`${requestId}-repay`;if(this.state.receipts.some(r=>r.id===id)){await this.reconcile();return this.summary();}
  const amount=this.state.outstanding;if(amount===0n)throw Error('There is no outstanding debt to acknowledge.');const nextSalt=bytes();
  await this.call(id,'acknowledgeRepayment',[BigInt(now()+86400)],{callerSecret:this.keys.issuer,agentSecret:this.keys.agent,lineLimit:this.state.limit,lineOutstanding:amount,lineEpoch:this.state.epoch,salt:this.state.salt,newSalt:nextSalt,repayAmount:amount,paymentRef:canonicalPaymentReferenceBytes(`reported-test-payment:${requestId}`),receiptNonce:bytes()}, {...this.state,outstanding:0n,epoch:this.state.epoch+1n,salt:nextSalt});
  return this.summary();
 }
 summary(){return {network:'preprod',contractAddress:this.state.contractAddress,phase:this.state.phase,progress:this.progress??'Ready',busy:this.busy??false,pending:this.state.pending?.id??null,privateBook:{limit:Number(this.state.limit),outstanding:Number(this.state.outstanding),remaining:Number(this.state.limit-this.state.outstanding)},orders:this.state.orders.map(o=>({id:o.id,service:o.service,status:o.status,amount:Number(o.amount),document:o.document,result:o.result??null})),receipts:this.state.receipts,settlement:'test accounting; no token payout; repayment acknowledgement is issuer-reported',custody:'local operator controls all role keys'};}
 async persistWallet(){await this.facade.dust.serializeState().then(s=>writeFileSync('.midnight-cache/dust-state.json',s));await this.facade.unshielded.serializeState().then(s=>writeFileSync('.midnight-cache/unshielded-state.json',s));}
 async close(){if(this.facade){await this.persistWallet();await this.facade.stop();}await this.api?.disconnect();}
}
