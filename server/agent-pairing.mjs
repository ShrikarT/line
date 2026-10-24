import { createHash, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import * as L from '@midnight-ntwrk/ledger-v8';
import { decryptBookOpening, generateX25519KeyPair, x25519PublicKey, verifyPairingOffer, verifyPairingPackageStructure, pairingPackageCanonicalMessage, assertUsableX25519Recipient } from '../src/lib/agent/pairing.ts';
import { pairingAcknowledgementMessage } from '../src/lib/agent/pairing-ack.ts';
import { grantOwnerRecipient } from '../src/lib/agent/grant.ts';
import { agentId, hexToBytes, lineStateCommit, toHex } from '../src/lib/line/encoding.ts';
import { agentGrantDigest, verifyAgentGrant } from './agent-authorization.mjs';
import { organizationSigningBytes } from './organization-auth.mjs';

const HEX=/^[0-9a-f]{64}$/;
const PIN_FIELDS=['networkId','facilityAddress','domain','sourceFingerprint','ownerAddress','runnerOrigin','agentPk','generation','bookCommitment'];
const need=(condition,message)=>{if(!condition)throw Error(message);};
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
export const pairingPackageDigest=pkg=>createHash('sha256').update(pairingPackageCanonicalMessage(pkg)).digest('hex');

function pinsSnapshot(pins) {
  need(exact(pins,PIN_FIELDS),'Configure the independently reviewed runner facility pins.');
  need(pins.networkId==='preprod'&&['facilityAddress','domain','sourceFingerprint','agentPk','bookCommitment'].every(key=>typeof pins[key]==='string'&&HEX.test(pins[key]))&&typeof pins.generation==='string'&&/^[1-9][0-9]{0,19}$/.test(pins.generation)&&BigInt(pins.generation)<(1n<<64n),'Invalid runner facility pins.');
  grantOwnerRecipient(pins.ownerAddress);
  const origin=new URL(pins.runnerOrigin);
  need(origin.origin===pins.runnerOrigin&&Buffer.byteLength(pins.runnerOrigin)<=200&&(origin.protocol==='https:'||origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)),'Invalid runner pairing origin.');
  return structuredClone(pins);
}
function publicIdentity(state) {
  return {runnerOrigin:state.pins.runnerOrigin,runnerPublicKey:state.identity.encryptionPublicKey,runnerSigningPublicKey:state.identity.signingPublicKey};
}
function expectedScope(state,scope) {
  // Only the return key is chosen dynamically by the authenticated owner. Every
  // other pin predates the incoming package and is checked against chain state.
  return {...state.pins,...publicIdentity(state),returnPublicKey:scope.returnPublicKey};
}

/** Structural + signature checks run on every encrypted checkpoint/reopen.
 * Private/public X25519 consistency is checked asynchronously by create(). */
export function validateRunnerPairingState(value,sourceFingerprint) {
  if(value===undefined)return;
  need(exact(value,['schema','pins','identity','offers','phase','accepted'])&&value.schema==='line:runner-pairing-state/v1','Invalid retained runner pairing state.');
  const pins=pinsSnapshot(value.pins),identity=value.identity;
  need(pins.sourceFingerprint===sourceFingerprint&&exact(identity,['encryptionPublicKey','encryptionPrivateKey','signingPublicKey','signingKey'])&&Object.values(identity).every(key=>typeof key==='string'&&HEX.test(key)&&key!=='00'.repeat(32))&&identity.encryptionPublicKey!==identity.signingPublicKey,'Invalid retained runner identity.');
  need(L.signatureVerifyingKey(identity.signingKey)===identity.signingPublicKey,'Retained runner signing identity differs.');
  need(Array.isArray(value.offers)&&value.offers.length<=16,'Runner offer capacity exceeded.');
  const nonces=new Set();
  for(const offer of value.offers){
    verifyPairingOffer(offer,publicIdentity(value),nonces,offer.timestamp);
    nonces.add(offer.offerNonce);
  }
  need(['unpaired','active'].includes(value.phase),'Invalid runner pairing phase.');
  if(value.phase==='unpaired')need(value.accepted===null,'An unpaired runner cannot contain accepted authority.');
  else {
    const accepted=value.accepted;
    need(exact(accepted,['package','packageDigest','acknowledgement']),'Invalid retained pairing acceptance.');
    const pkg=verifyPairingPackageStructure(accepted.package),scope=pkg.scope;
    const digest=verifyAgentGrant(scope,pkg.ownerSignature,expectedScope(value,scope),scope.issuedAt);
    need(pairingPackageDigest(pkg)===accepted.packageDigest&&!nonces.has(scope.nonce),'Retained package differs or its offer is still outstanding.');
    const ack=accepted.acknowledgement;
    need(exact(ack,['payload','signature'])&&typeof ack.signature==='string'&&/^[0-9a-f]{128}$/.test(ack.signature),'Invalid retained pairing acknowledgement.');
    const message=pairingAcknowledgementMessage(ack.payload),p=ack.payload;
    need(p.grantId===scope.grantId&&p.grantDigest===digest&&p.packageDigest===accepted.packageDigest&&p.offerNonce===scope.nonce&&p.bookCommitment===scope.bookCommitment&&p.acceptedAt>=scope.issuedAt&&p.acceptedAt<scope.expiresAt&&L.verifySignature(identity.signingPublicKey,organizationSigningBytes(message),ack.signature),'Retained acknowledgement differs from the signed import.');
  }
}

export function validateRunnerPairingTransition(before,after) {
  if(before===undefined)return;
  need(after&&isDeepStrictEqual(before.identity,after.identity)&&isDeepStrictEqual(before.pins,after.pins),'Runner identity and reviewed facility pins cannot be removed or replaced.');
  if(before.phase==='active')need(after.phase==='active'&&isDeepStrictEqual(before.accepted,after.accepted),'Accepted runner authority cannot be removed or replaced.');
}

/** Private local import seam. No HTTP route, automatic startup, fee wallet or
 * credential export is installed by constructing this component. */
export class AgentPairingInbox {
  static async create({store,pins,adapter,now=Date.now}) {
    const reviewed=pinsSnapshot(pins);
    need(store.sourceFingerprint===reviewed.sourceFingerprint&&adapter?.sourceFingerprint===reviewed.sourceFingerprint&&typeof adapter.inspect==='function','Configure the matching store, release and actual Midnight inspector.');
    store.assertWritable();
    const existing=store.snapshot().pairing;
    if(!existing){
      const encryption=await generateX25519KeyPair(),signingKey=L.sampleSigningKey();
      await store.commit(state=>{
        if(state.pairing){need(isDeepStrictEqual(state.pairing.pins,reviewed),'A different runner identity was initialized concurrently.');return;}
        need(!state.pairing&&!state.pending&&!Object.keys(state.books).length&&!Object.keys(state.grants).length&&!Object.keys(state.tasks).length&&!state.receipts.length,'An existing runner must be reconciled before initializing a pairing identity.');
        state.pairing={schema:'line:runner-pairing-state/v1',pins:reviewed,identity:{encryptionPublicKey:encryption.publicKeyHex,encryptionPrivateKey:encryption.privateKeyHex,signingPublicKey:L.signatureVerifyingKey(signingKey),signingKey},offers:[],phase:'unpaired',accepted:null};
      },{skipUnchanged:true});
    }
    const retained=store.snapshot().pairing;
    need(isDeepStrictEqual(retained.pins,reviewed),'Retained runner facility pins differ; implicit rotation is refused.');
    // Export a public JWK from the retained private key to catch mismatched keys
    // before issuing offers, including after a crash/reopen.
    need(await x25519PublicKey(retained.identity.encryptionPrivateKey)===retained.identity.encryptionPublicKey,'Retained runner encryption identity differs.');
    return new AgentPairingInbox(store,adapter,now);
  }
  constructor(store,adapter,now){this.store=store;this.adapter=adapter;this.now=now;}
  identity(){return structuredClone(publicIdentity(this.store.snapshot().pairing));}
  pairing(){const p=this.store.snapshot().pairing;need(p.phase==='active','Import a signed owner package first.');return expectedScope(p,p.accepted.package.scope);}
  async issueOffer(){
    let offer;
    await this.store.commit(state=>{
      const p=state.pairing,now=this.now();
      need(p?.phase==='unpaired','This runner already retains a delegation.');
      need(Number.isSafeInteger(now)&&now>0,'Invalid runner clock.');
      p.offers=p.offers.filter(row=>Math.abs(now-row.timestamp)<=300_000);
      need(p.offers.length<16,'Too many outstanding pairing offers.');
      offer={schema:'line:agent-pairing-offer/v1',...publicIdentity(p),offerNonce:randomBytes(32).toString('hex'),timestamp:now};
      p.offers.push(offer);
    });
    return structuredClone(offer);
  }
  async importPackage(input){
    // Snapshot strict allowlisted input before any await. No signer, issuer,
    // merchant, maintenance key or whole organization snapshot is accepted.
    const pkg=verifyPairingPackageStructure(input),packageDigest=pairingPackageDigest(pkg);
    this.store.assertWritable();
    const before=this.store.snapshot().pairing;
    if(before.accepted){
      need(before.accepted.packageDigest===packageDigest,'This runner already retains another exact package.');
      return structuredClone(before.accepted.acknowledgement);
    }
    const offer=before.offers.find(row=>row.offerNonce===pkg.offerNonce);
    need(offer,'Pairing offer was not durably issued by this runner.');
    verifyPairingOffer(offer,publicIdentity(before),undefined,this.now());
    const scope=pkg.scope,digest=verifyAgentGrant(scope,pkg.ownerSignature,expectedScope(before,scope),this.now());
    await assertUsableX25519Recipient(scope.returnPublicKey);
    const opening=await decryptBookOpening({envelope:pkg.encryptedOpening,expectedPurpose:'line:agent-pairing/v1',expectedGrantDigest:digest,expectedNonce:scope.nonce,recipientPrivateKeyHex:before.identity.encryptionPrivateKey});
    const book={facilityAddress:scope.facilityAddress,domain:scope.domain,agentPk:scope.agentPk,agentSecret:opening.agentSecret,salt:opening.salt,limit:BigInt(opening.limit),outstanding:BigInt(opening.outstanding),epoch:BigInt(opening.epoch),generation:BigInt(opening.generation)};
    need(toHex(agentId(hexToBytes(book.agentSecret)))===scope.agentPk&&book.generation===BigInt(scope.generation)&&toHex(lineStateCommit({domain:hexToBytes(book.domain),identity:hexToBytes(book.agentPk),limit:book.limit,outstanding:book.outstanding,epoch:book.epoch},hexToBytes(book.salt)))===scope.bookCommitment,'Imported agent book differs from the signed checkpoint.');
    // The production adapter independently verifies owner, domain, agent,
    // generation, current commitment, native asset, OPEN state and all 12 keys.
    await this.adapter.inspect(structuredClone(book),scope.ownerAddress);
    const committed=await this.store.commit(state=>{
      const p=state.pairing;
      if(p.accepted){need(p.accepted.packageDigest===packageDigest,'A different package was accepted concurrently.');return;}
      need(p.phase==='unpaired'&&!state.pending&&!Object.keys(state.books).length&&!Object.keys(state.grants).length&&!Object.keys(state.tasks).length&&!state.receipts.length,'Existing runner activity blocks a new import.');
      const retainedOffer=p.offers.find(row=>row.offerNonce===scope.nonce);
      need(retainedOffer,'Pairing offer was already consumed.');
      verifyPairingOffer(retainedOffer,publicIdentity(p),undefined,this.now());
      verifyAgentGrant(scope,pkg.ownerSignature,expectedScope(p,scope),this.now());
      const payload={schema:'line:agent-pairing-ack/v1',grantId:scope.grantId,grantDigest:digest,packageDigest,offerNonce:scope.nonce,bookCommitment:scope.bookCommitment,storeRevision:state.revision,acceptedAt:this.now()};
      const acknowledgement={payload,signature:L.signData(p.identity.signingKey,organizationSigningBytes(pairingAcknowledgementMessage(payload)))};
      state.books[book.facilityAddress]=book;
      state.grants[scope.grantId]={grantId:scope.grantId,facilityAddress:scope.facilityAddress,maxSpend:BigInt(scope.maxSpend),maxFee:BigInt(scope.maxFee),allowedServices:[...scope.allowedServices],generation:book.generation,expiresAt:scope.expiresAt,authorization:{scope,proof:pkg.ownerSignature,digest},spent:0n,reserved:0n,revoked:false};
      p.offers=p.offers.filter(row=>row.offerNonce!==scope.nonce);p.phase='active';
      p.accepted={package:pkg,packageDigest,acknowledgement};
    },{skipUnchanged:true});
    return structuredClone(committed.pairing.accepted.acknowledgement);
  }
  assertWriterFence(scope){
    this.store.assertWritable();
    const p=this.store.snapshot().pairing;
    need(p?.phase==='active'&&agentGrantDigest(scope)===p.accepted.acknowledgement.payload.grantDigest,'The retained owner-authorized browser handover does not match this runner.');
    validateRunnerPairingState(p,this.store.sourceFingerprint);
  }
}
