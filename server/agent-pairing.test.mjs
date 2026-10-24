import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import * as L from '@midnight-ntwrk/ledger-v8';
import { bech32m } from '@scure/base';
import { createPrivateAgentDirectory } from '../tests/fixtures/private-agent-directory.ts';
import { AgentStore } from './agent-store.mjs';
import { AgentRunner } from './agent-runner.mjs';
import { AgentPairingInbox, pairingPackageDigest } from './agent-pairing.mjs';
import { agentGrantDigest, agentGrantMessage } from './agent-authorization.mjs';
import { organizationSigningBytes } from './organization-auth.mjs';
import { agentId, hexToBytes, toHex, lineStateCommit } from '../src/lib/line/encoding.ts';
import { browserPairingPackageDigest, createPairingPackage, encryptBookOpening, generateX25519KeyPair } from '../src/lib/agent/pairing.ts';
import { verifyPairingAcknowledgement } from '../src/lib/agent/pairing-ack.ts';

const hex=()=>randomBytes(32).toString('hex');
async function fixture(t,{initialize=true}={}) {
  const parent=await mkdtemp(join(tmpdir(),'agent-pairing-test-')),directory=await createPrivateAgentDirectory(parent);
  const password='controlled-pairing-fixture-password',binding=hex(),sourceFingerprint=hex();
  const ownerKey=L.sampleSigningKey(),ownerPublic=L.signatureVerifyingKey(ownerKey);
  const ownerAddress=bech32m.encode('mn_addr_preprod',bech32m.toWords(hexToBytes(L.addressFromKey(ownerPublic))),120);
  const opening={agentSecret:hex(),salt:hex(),limit:'1000000',outstanding:'0',epoch:'0',generation:'2'};
  const pins={networkId:'preprod',facilityAddress:hex(),domain:hex(),sourceFingerprint,ownerAddress,runnerOrigin:'http://127.0.0.1:6789',agentPk:toHex(agentId(hexToBytes(opening.agentSecret))),generation:'2',bookCommitment:''};
  pins.bookCommitment=toHex(lineStateCommit({domain:hexToBytes(pins.domain),identity:hexToBytes(pins.agentPk),limit:1000000n,outstanding:0n,epoch:0n},hexToBytes(opening.salt)));
  let store=await AgentStore.open({directory,password,binding,sourceFingerprint}),inspections=0,now=Date.now();
  const adapter={sourceFingerprint,inspect:async(book,owner)=>{inspections++;assert.equal(owner,ownerAddress);assert.equal(book.facilityAddress,pins.facilityAddress);assert.equal(book.agentPk,pins.agentPk);}};
  const inbox=initialize?await AgentPairingInbox.create({store,pins,adapter,now:()=>now}):null;
  t.after(async()=>{await store.close();assert(resolve(parent).startsWith(resolve(tmpdir())+sep+'agent-pairing-test-'));await rm(parent,{recursive:true,force:true});});
  return {directory,password,binding,sourceFingerprint,pins,opening,ownerKey,ownerPublic,adapter,inbox,get store(){return store;},get inspections(){return inspections;},get now(){return now;},clock:delta=>{now+=delta;},
    async reopen(){await store.close();store=await AgentStore.open({directory,password,binding,sourceFingerprint});return AgentPairingInbox.create({store,pins,adapter,now:()=>now});},
    async packet(offer,changes={},payload=opening,key=ownerKey){
      const scope={schema:'line:agent-grant/v1',grantId:randomUUID(),...pins,...inbox.identity(),returnPublicKey:(await generateX25519KeyPair()).publicKeyHex,nonce:offer.offerNonce,issuedAt:now,expiresAt:now+3600000,maxSpend:'1000000',maxFee:'5000',allowedServices:['line-doc-extract-v1'],allowedMerchants:[hex()],...changes};
      const proof={verifyingKey:L.signatureVerifyingKey(key),signature:L.signData(key,organizationSigningBytes(agentGrantMessage(scope)))};
      return createPairingPackage(scope,proof,await encryptBookOpening({purpose:'line:agent-pairing/v1',recipientPublicKeyHex:scope.runnerPublicKey,grantDigest:agentGrantDigest(scope),nonce:scope.nonce,payload}));
    }};
}

test('one durable import retains identity, consumed offer, grant, book and signed exact-retry acknowledgement',async t=>{
  const f=await fixture(t),offer=await f.inbox.issueOffer(),pkg=await f.packet(offer);
  await assert.rejects(AgentPairingInbox.create({store:f.store,pins:f.pins,adapter:{...f.adapter,sourceFingerprint:hex()}}),/matching store, release/);
  const before=f.store.revision,ack=await f.inbox.importPackage(pkg),snapshot=f.store.snapshot();
  assert.equal(snapshot.revision,before+1);assert.equal(snapshot.pairing.phase,'active');assert.equal(snapshot.pairing.offers.length,0);
  assert.equal(snapshot.grants[pkg.scope.grantId].reserved,0n);assert.equal(snapshot.books[f.pins.facilityAddress].agentSecret,f.opening.agentSecret);
  assert.deepEqual(await verifyPairingAcknowledgement(ack,pkg.scope,pairingPackageDigest(pkg)),ack);
  assert.equal(await browserPairingPackageDigest(pkg),pairingPackageDigest(pkg));
  f.inbox.assertWriterFence(pkg.scope);
  const runner=await AgentRunner.create({store:f.store,adapter:f.adapter,supplier:{},pairing:f.inbox.pairing(),assertWriterFence:scope=>f.inbox.assertWriterFence(scope)});
  assert.deepEqual(runner.listTasks(),[]);
  assert(!JSON.stringify(f.inbox.identity()).includes(f.opening.agentSecret));assert(!JSON.stringify(ack).includes(f.opening.agentSecret));
  const previousIdentity=f.inbox.identity(),reopened=await f.reopen(),identity=reopened.identity(),revision=f.store.revision;
  assert.deepEqual(identity,previousIdentity);
  f.clock(7200000); // Lost acknowledgement recovery stays readable after expiry.
  const inspections=f.inspections;
  assert.deepEqual(await reopened.importPackage(pkg),ack);assert.equal(f.store.revision,revision);assert.equal(f.inspections,inspections);
  await assert.rejects(reopened.issueOffer(),/already retains/);
});

test('owner, opening, ciphertext and independently configured pins fail before offer consumption',async t=>{
  const f=await fixture(t),offer=await f.inbox.issueOffer();
  const valid=await f.packet(offer),revision=f.store.revision;
  const forged=await f.packet(offer,{},f.opening,L.sampleSigningKey());
  await assert.rejects(f.inbox.importPackage(forged),/owner signature/);
  const wrongFacility=await f.packet(offer,{facilityAddress:hex()});
  await assert.rejects(f.inbox.importPackage(wrongFacility),/pinned pairing/);
  const wrongBook=await f.packet(offer,{}, {...f.opening,salt:hex()});
  await assert.rejects(f.inbox.importPackage(wrongBook),/signed checkpoint/);
  const damaged=structuredClone(valid);damaged.encryptedOpening.ciphertext='00'+damaged.encryptedOpening.ciphertext.slice(2);
  await assert.rejects(f.inbox.importPackage(damaged),/Decryption failed/);
  assert.equal(f.store.revision,revision);assert.equal(f.store.snapshot().pairing.offers.length,1);assert.equal(f.store.listGrants().length,0);
  await f.inbox.importPackage(valid);
  const different=await f.packet(offer);
  await assert.rejects(f.inbox.importPackage(different),/another exact package/);
  const tamperedAck=structuredClone(f.store.snapshot().pairing.accepted.acknowledgement);tamperedAck.payload.storeRevision++;
  await assert.rejects(verifyPairingAcknowledgement(tamperedAck,valid.scope,pairingPackageDigest(valid)),/signature/);
});

test('unknown or stale offers are refused; offer bounds and identity survive reopen',async t=>{
  const f=await fixture(t),offer=await f.inbox.issueOffer(),pkg=await f.packet(offer);
  const fake=await f.packet({...offer,offerNonce:hex()});
  await assert.rejects(f.inbox.importPackage(fake),/not durably issued/);
  f.clock(300001);
  await assert.rejects(f.inbox.importPackage(pkg),/timestamp expired/);
  const reopened=await f.reopen();
  await assert.rejects(AgentPairingInbox.create({store:f.store,pins:{...f.pins,ownerAddress:bech32m.encode('mn_addr_preprod',bech32m.toWords(randomBytes(32)),120)},adapter:f.adapter}),/pins differ/);
  for(let i=0;i<16;i++)await reopened.issueOffer();
  await assert.rejects(reopened.issueOffer(),/outstanding pairing offers/);
  assert.equal(f.store.snapshot().pairing.offers.length,16);
});

test('concurrent exact imports never reset counters or create a second authority',async t=>{
  const f=await fixture(t),offer=await f.inbox.issueOffer(),pkg=await f.packet(offer);
  const revision=f.store.revision;
  const [one,two]=await Promise.all([f.inbox.importPackage(pkg),f.inbox.importPackage(structuredClone(pkg))]);
  assert.deepEqual(one,two);assert.equal(f.store.listGrants().length,1);assert.equal(f.store.listBooks().length,1);
  assert.equal(f.store.revision,revision+1,'concurrent exact retry writes only the first accepted checkpoint');
  await f.store.commit(state=>{state.grants[pkg.scope.grantId].spent=100n;});
  assert.deepEqual(await f.inbox.importPackage(pkg),one);assert.equal(f.store.getGrant(pkg.scope.grantId).spent,100n);
  await assert.rejects(f.store.commit(state=>{delete state.pairing;}),/cannot be removed/);
  await assert.rejects(f.store.commit(state=>{state.pairing.phase='unpaired';state.pairing.accepted=null;}),/cannot be removed/);
  await assert.rejects(f.store.commit(state=>{delete state.books[f.pins.facilityAddress];}),/retain its grant, book/);
});

test('concurrent fresh inbox initialization retains one identity and one checkpoint',async t=>{
  const f=await fixture(t,{initialize:false}),revision=f.store.revision;
  const [one,two]=await Promise.all([AgentPairingInbox.create({store:f.store,pins:f.pins,adapter:f.adapter}),AgentPairingInbox.create({store:f.store,pins:f.pins,adapter:f.adapter})]);
  assert.deepEqual(one.identity(),two.identity());assert.equal(f.store.revision,revision+1);
});

test('owner-selected return keys reject zero, key reuse and low-order points before consuming an offer',async t=>{
  const f=await fixture(t),offer=await f.inbox.issueOffer(),revision=f.store.revision;
  for(const key of ['00'.repeat(32),f.inbox.identity().runnerPublicKey,f.inbox.identity().runnerSigningPublicKey])await assert.rejects(f.packet(offer,{returnPublicKey:key}),/non-zero and distinct/);
  const lowOrder=await f.packet(offer,{returnPublicKey:'01'+'00'.repeat(31)});
  await assert.rejects(f.inbox.importPackage(lowOrder),/return encryption key is unusable/);
  assert.equal(f.store.revision,revision);assert.equal(f.store.snapshot().pairing.offers.length,1);
});

test('incoming caller mutation during inspection cannot replace captured owner scope or add vault material',async t=>{
  const f=await fixture(t),offer=await f.inbox.issueOffer(),pkg=await f.packet(offer),original=structuredClone(pkg);
  let release,entered;const waiting=new Promise(resolve=>{entered=resolve;});
  f.adapter.inspect=async()=>{entered();await new Promise(resolve=>{release=resolve;});};
  const work=f.inbox.importPackage(pkg);await waiting;
  pkg.scope.maxSpend='2000000';pkg.encryptedOpening.ciphertext='ff'.repeat(32);pkg.issuerSecret='must-not-be-retained';
  release();const ack=await work;
  assert.deepEqual(f.store.snapshot().pairing.accepted.package,original);
  assert.equal(f.store.getGrant(original.scope.grantId).maxSpend,1000000n);
  await verifyPairingAcknowledgement(ack,original.scope,pairingPackageDigest(original));
});

test('failed import persistence returns no acknowledgement and poisons writes; reopen retains unconsumed offer',async t=>{
  const f=await fixture(t),offer=await f.inbox.issueOffer(),pkg=await f.packet(offer),revision=f.store.revision;
  const save=f.store.store.save.bind(f.store.store);let attempted=0;
  f.store.store.save=async(_id,state)=>{attempted++;assert.equal(state.pairing.phase,'active');assert.equal(Object.keys(state.grants).length,1);assert.equal(Object.keys(state.books).length,1);assert.equal(state.pairing.offers.length,0);throw Error('Controlled import storage failure');};
  await assert.rejects(f.inbox.importPackage(pkg),/Controlled import storage failure/);
  assert.equal(attempted,1);assert.equal(f.store.revision,revision);assert.equal(f.store.snapshot().pairing.phase,'unpaired');
  assert.throws(()=>f.inbox.assertWriterFence(pkg.scope),/poisoned/);
  f.store.store.save=save;
  const reopened=await f.reopen();
  assert.equal(f.store.snapshot().pairing.phase,'unpaired');assert.equal(f.store.snapshot().pairing.offers.length,1);
  await reopened.importPackage(pkg);
});

test('chain rejection and expiry during inspection retain the original unconsumed offer',async t=>{
  const f=await fixture(t),offer=await f.inbox.issueOffer(),pkg=await f.packet(offer,{expiresAt:f.now+60000});
  const revision=f.store.revision;
  f.adapter.inspect=async()=>{throw Error('Controlled chain owner or verifier mismatch');};
  await assert.rejects(f.inbox.importPackage(pkg),/chain owner or verifier mismatch/);
  assert.equal(f.store.revision,revision);
  f.adapter.inspect=async()=>{f.clock(60001);};
  await assert.rejects(f.inbox.importPackage(pkg),/not currently valid/);
  assert.equal(f.store.revision,revision);assert.equal(f.store.snapshot().pairing.offers.length,1);assert.equal(f.store.listBooks().length,0);
});
