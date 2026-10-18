import test from 'node:test';
import assert from 'node:assert/strict';
import { bech32m } from '@scure/base';
import * as L from '@midnight-ntwrk/ledger-v8';
import { OrganizationAuth, organizationSigningBytes } from './organization-auth.mjs';

function wallet() {
  const key = L.sampleSigningKey(), verifyingKey = L.signatureVerifyingKey(key);
  const address = bech32m.encodeFromBytes('mn_addr_preprod', Buffer.from(L.addressFromKey(verifyingKey), 'hex'));
  return { key, verifyingKey, address, sign: message => ({ verifyingKey, signature: L.signData(key, organizationSigningBytes(message)) }) };
}

test('actual ledger signatures authenticate one origin-bound wallet challenge exactly once', () => {
  const auth = new OrganizationAuth('https://line.example'), owner = wallet();
  const challenge = auth.challenge(owner.address, "aa".repeat(32)), proof = owner.sign(challenge.message);
  const session = auth.finish({ nonce: challenge.nonce, proof });
  const cookie = auth.cookie(session.token, session.expiresAt);
  assert(cookie.includes('HttpOnly')); assert(cookie.includes('Secure')); assert(cookie.includes('SameSite=Strict')); assert(cookie.startsWith('__Host-'));
  assert.equal(auth.require(cookie).recipient, L.addressFromKey(owner.verifyingKey));
  assert.throws(() => auth.finish({ nonce: challenge.nonce, proof }), /expired/);
  assert.throws(() => auth.require(cookie.split(';')[0] + '; ' + cookie.split(';')[0]), /Sign in/);
  auth.revoke(cookie); assert.throws(() => auth.require(cookie), /Sign in/);
});

test('sign-in rejects another key, raw-message signatures, changed domains, unsupported schemes and expired state', () => {
  let now = 1_000_000;
  const auth = new OrganizationAuth('https://line.example', () => now), owner = wallet(), other = wallet();
  for (const makeProof of [
    challenge => other.sign(challenge.message),
    challenge => ({ verifyingKey: owner.verifyingKey, signature: L.signData(owner.key, Buffer.from(challenge.message)) }),
    challenge => owner.sign(challenge.message.replace('https://line.example', 'https://another.example')),
    challenge => ({ ...owner.sign(challenge.message), scheme: 'ecdsa_secp256k1_sha256' }),
  ]) { const challenge = auth.challenge(owner.address, "aa".repeat(32)); assert.throws(() => auth.finish({ nonce: challenge.nonce, proof: makeProof(challenge) }), /signature/); }
  const challenge = auth.challenge(owner.address, "aa".repeat(32)); now += 120_001;
  assert.throws(() => auth.finish({ nonce: challenge.nonce, proof: owner.sign(challenge.message) }), /expired/);
  const fresh = auth.challenge(owner.address, "aa".repeat(32)), session = auth.finish({ nonce: fresh.nonce, proof: { ...owner.sign(fresh.message), scheme: 'schnorr_bip340' } });
  now += 30 * 60_000 + 1; assert.throws(() => auth.require(auth.cookie(session.token, session.expiresAt)), /Sign in/);
  assert.throws(() => new OrganizationAuth('http://public.example'), /HTTPS/);
  assert.throws(() => auth.challenge(bech32m.encodeFromBytes('mn_addr', new Uint8Array(32))), /Preprod/);
  assert.equal(organizationSigningBytes('💜').toString(), 'midnight_signed_message:4:💜');
});

test('browser contexts isolate challenge quotas while verified sessions remain bounded per principal',()=>{
  const auth=new OrganizationAuth('https://line.example'),owner=wallet(),other=wallet();
  const attacker=auth.requester(undefined,'shared-proxy'),legitimateBrowser=auth.requester(undefined,'shared-proxy');
  assert.notEqual(attacker.key,legitimateBrowser.key);assert.equal(auth.requester(attacker.cookie,'shared-proxy').key,attacker.key);
  const legitimate=auth.challenge(other.address, "aa".repeat(32)),otherSession=auth.finish({nonce:legitimate.nonce,proof:other.sign(legitimate.message)});
  const pending=[];for(let i=0;i<4;i++)pending.push(auth.challenge(owner.address,attacker.key));
  assert.throws(()=>auth.challenge(owner.address,attacker.key),/Too many outstanding/);assert.equal(auth.challenges.size,4);
  const separateBrowser=auth.challenge(owner.address,legitimateBrowser.key);auth.finish({nonce:separateBrowser.nonce,proof:owner.sign(separateBrowser.message)});
  for(const challenge of pending)auth.finish({nonce:challenge.nonce,proof:owner.sign(challenge.message)});
  for(let i=0;i<12;i++){const challenge=auth.challenge(owner.address, "aa".repeat(32));auth.finish({nonce:challenge.nonce,proof:owner.sign(challenge.message)});}
  assert.equal(auth.sessions.size,5);assert.equal(auth.require(auth.cookie(otherSession.token,otherSession.expiresAt)).recipient,L.addressFromKey(other.verifyingKey));
});

test('idle session observers are notified on logout, expiry, principal eviction and shutdown',()=>{
  let now=Date.now();const auth=new OrganizationAuth('https://line.example',()=>now),owner=wallet(),invalidated=[];
  const remove=auth.onSessionInvalidated(session=>invalidated.push(session));
  const signIn=()=>{const challenge=auth.challenge(owner.address,'aa'.repeat(32));return auth.finish({nonce:challenge.nonce,proof:owner.sign(challenge.message)});};
  const first=signIn(),firstSession=auth.require(auth.cookie(first.token,first.expiresAt));auth.revoke(auth.cookie(first.token,first.expiresAt));assert.deepEqual(invalidated,[firstSession]);
  const expired=signIn(),expiredSession=auth.require(auth.cookie(expired.token,expired.expiresAt));now+=30*60_000+1;auth.prune();assert.equal(invalidated.at(-1),expiredSession);
  const evicted=signIn(),evictedSession=auth.require(auth.cookie(evicted.token,evicted.expiresAt));for(let i=0;i<4;i++)signIn();assert.equal(invalidated.at(-1),evictedSession);
  const before=invalidated.length;auth.close();assert.equal(invalidated.length,before+4);remove();auth.close();
});
