import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {DurableApprovalSigner} from '../scripts/durable-approval-signer.mjs';
import {roleHash,hash,tag} from '../scripts/private-offer-signers.mjs';
import {startApprovalOwnerService,approvalOwnerClient} from '../scripts/approval-owner-service.mjs';
import {tlsFixture} from './fixtures/approval-service-tls.mjs';

const bytes=()=>new Uint8Array(randomBytes(32));
const managed=process.env.COMPACT_ADDRESS_MANAGED_DIR;
function policy(request,{config}){
 return {allowed:request.name==='registerMerchant'&&Buffer.from(request.args[0]).equals(Buffer.from(config.allowedMerchant)),reservationCost:0n};
}

test('address-bound owner retains exact approvals across restart and rejects another address', {skip:!managed},async()=>{
 const {Contract,ledger}=await import(pathToFileURL(join(resolve(managed),'contract/index.js')).href);
 const info=JSON.parse(readFileSync(join(resolve(managed),'compiler/contract-info.json')));
 const address='11'.repeat(32),otherAddress='22'.repeat(32),newMerchant=bytes();
 const options={directory:mkdtempSync(join(tmpdir(),'addressed-owner-')),encryptionKey:bytes(),custodyId:'synthetic-addressed-issuer',role:'issuer',authorize:policy,approvalABI:'line-private-offer/v2'};
 let signer=new DurableApprovalSigner({...options,create:true});
 try{
  const publicKey=signer.publicKey,issuer=roleHash('issuer',publicKey),merchant=bytes(),nonce=bytes(),stable=hash([tag('line:signed:nk'),bytes()]);
  let active={};
  const witnesses=Object.fromEntries(info.witnesses.map(({name})=>[name,(ctx,...args)=>{
   if(name==='rememberReserve')return [{...ctx.privateState,reserve:{book:args[0],salt:args[1]}},[]];
   assert(Object.hasOwn(active,name));return [ctx.privateState,active[name]];
  }]));
  const contract=new Contract(witnesses);
  const initialize=()=>{active={reserveSalt:bytes()};return contract.initialState(RT.createConstructorContext({},'0'.repeat(64)),issuer,merchant,nonce,stable);};
  const a=initialize(),b=initialize(),domain=ledger(a.currentContractState.data).contractDomain;
  signer.bindPolicy({domain,contractAddress:address,allowedMerchant:newMerchant,maxAuthorizedCost:10n});
  assert.equal(signer.ownerScope.contractAddress,address);
  const request={operationId:'merchant:1',descriptor:{name:'registerMerchant',args:[newMerchant],values:{},domain,contractAddress:address,privateFinance:true}};
  const approval=signer.approve(request);
  const execute=(initial,contractAddress)=>{active=approval;return contract.circuits.registerMerchant(RT.createCircuitContext(contractAddress,'0'.repeat(64),initial.currentContractState.data,structuredClone(initial.currentPrivateState),undefined,undefined,1_800_000_000),newMerchant);};
  const accepted=execute(a,address);
  assert(ledger(accepted.context.currentQueryContext.state).registeredMerchants.member(newMerchant));
  assert.throws(()=>execute(b,otherAddress),/approval challenge words/);
  const changed=structuredClone(request);changed.operationId='merchant:other';changed.descriptor.contractAddress=otherAddress;
  assert.throws(()=>signer.approve(changed),/could not be authorized/);
  signer.close();
  assert.throws(()=>new DurableApprovalSigner({...options,approvalABI:'line-private-offer/v1'}));
  signer=new DurableApprovalSigner(options);
  assert.deepEqual(signer.publicKey,publicKey);
  assert.deepEqual(signer.approve(request),approval);
  assert.throws(()=>signer.bindPolicy({domain,contractAddress:otherAddress,allowedMerchant:newMerchant,maxAuthorizedCost:10n}),/binding cannot change/);
 }finally{signer.close();}
});

test('address-bound TLS owner identity and requests enforce the selected deployed instance',async()=>{
 const tls=tlsFixture(),address='11'.repeat(32),other='22'.repeat(32),domain=bytes(),newMerchant=bytes();
 const signer=new DurableApprovalSigner({directory:mkdtempSync(join(tmpdir(),'addressed-tls-owner-')),encryptionKey:bytes(),custodyId:'synthetic-addressed-tls',role:'issuer',authorize:policy,approvalABI:'line-private-offer/v2',create:true});
 let service;
 try{
  signer.bindPolicy({domain,contractAddress:address,allowedMerchant:newMerchant,maxAuthorizedCost:10n});
  service=await startApprovalOwnerService({signer,role:'issuer',approvalABI:'line-private-offer/v2',domain,...tls.material('server'),allowedClients:[tls.fingerprint('caller')]});
  const settings={url:`https://127.0.0.1:${service.port}/`,...tls.material('caller'),expectedServerFingerprint:tls.fingerprint('server'),expectedRole:'issuer',expectedPublicKey:signer.publicKey,expectedDomain:domain,expectedApprovalABI:'line-private-offer/v2',expectedContractAddress:address};
  const client=approvalOwnerClient(settings),request={operationId:'merchant:tls',descriptor:{name:'registerMerchant',args:[newMerchant],values:{},domain,contractAddress:address,privateFinance:true}};
  assert.equal((await client.identity()).contractAddress,address);
  const approval=await client.approve(request);
  assert.deepEqual(await client.approve(request),approval);
  await assert.rejects(approvalOwnerClient({...settings,expectedContractAddress:other}).identity(),/contract address mismatch/);
  const changed=structuredClone(request);changed.descriptor.contractAddress=other;
  await assert.rejects(client.approve(changed),/contract address mismatch/);
  await assert.rejects(approvalOwnerClient({...settings,expectedApprovalABI:'line-private-offer/v1',expectedContractAddress:undefined}).identity());
 }finally{await service?.close();signer.close();}
});
