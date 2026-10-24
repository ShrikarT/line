import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as L from '@midnight-ntwrk/ledger-v8';
import { bech32m } from '@scure/base';
import {
  generateX25519KeyPair,
  importX25519PublicKey,
  importX25519PrivateKey,
  encryptBookOpening,
  decryptBookOpening,
  verifyPairingOffer,
  createPairingPackage,
  verifyPairingPackageStructure,
  validateBookOpeningPayload,
  createCanonicalAad,
  toHex,
  hexToBytes,
} from '../src/lib/agent/pairing.ts';
import {
  agentGrantMessage,
  agentGrantDigest,
  verifyAgentGrant,
} from '../server/agent-authorization.mjs';
import { organizationSigningBytes } from '../server/organization-auth.mjs';
import type {
  AgentBookOpeningPayload,
  AgentGrantScope,
  AgentGrantProof,
} from '../src/lib/agent/types.ts';

function createHex(fillByte = 0x11): string {
  return Buffer.alloc(32, fillByte).toString('hex');
}

async function createPairingFixture() {
  const ownerSigningKey = L.sampleSigningKey();
  const ownerVerifyingKey = L.signatureVerifyingKey(ownerSigningKey);
  const ownerAddress = bech32m.encodeFromBytes(
    'mn_addr_preprod',
    Buffer.from(L.addressFromKey(ownerVerifyingKey), 'hex'),
  );

  const runnerKeys = await generateX25519KeyPair();
  const runnerSigningKey = L.sampleSigningKey();
  const runnerSigningPublicKey = L.signatureVerifyingKey(runnerSigningKey);

  const returnKeys = await generateX25519KeyPair();

  const facilityAddress = createHex(0x11);
  const domain = createHex(0x22);
  const sourceFingerprint = createHex(0x33);
  const agentPk = createHex(0x44);
  const bookCommitment = createHex(0x55);
  const offerNonce = createHex(0x66);
  const grantId = randomUUID();

  const scope: AgentGrantScope = {
    schema: 'line:agent-grant/v1',
    grantId,
    networkId: 'preprod',
    facilityAddress,
    domain,
    sourceFingerprint,
    ownerAddress,
    runnerOrigin: 'http://127.0.0.1:8765',
    runnerPublicKey: runnerKeys.publicKeyHex,
    runnerSigningPublicKey,
    returnPublicKey: returnKeys.publicKeyHex,
    agentPk,
    generation: '2',
    bookCommitment,
    nonce: offerNonce,
    issuedAt: 1_000,
    expiresAt: 1_000 + 86_400_000,
    maxSpend: '100000',
    maxFee: '5000',
    allowedServices: ['line-doc-extract-v1'],
    allowedMerchants: [createHex(0x77)],
  };

  const message = agentGrantMessage(scope);
  const proof: AgentGrantProof = {
    scheme: 'schnorr_bip340',
    verifyingKey: ownerVerifyingKey,
    signature: L.signData(ownerSigningKey, organizationSigningBytes(message)),
  };

  const grantDigest = agentGrantDigest(scope);

  const bookOpening: AgentBookOpeningPayload = {
    agentSecret: createHex(0x88),
    salt: createHex(0x89),
    limit: '500000',
    outstanding: '0',
    epoch: '0',
    generation: '2',
  };

  return {
    ownerSigningKey,
    ownerVerifyingKey,
    runnerKeys,
    runnerSigningKey,
    runnerSigningPublicKey,
    returnKeys,
    scope,
    proof,
    grantDigest,
    bookOpening,
    offerNonce,
  };
}

test('X25519 key generation, raw 32-byte export/import, and ECDH agreement round-trip', async () => {
  const alice = await generateX25519KeyPair();
  const bob = await generateX25519KeyPair();

  assert.match(alice.publicKeyHex, /^[0-9a-f]{64}$/);
  assert.match(alice.privateKeyHex, /^[0-9a-f]{64}$/);
  assert.match(bob.publicKeyHex, /^[0-9a-f]{64}$/);
  assert.match(bob.privateKeyHex, /^[0-9a-f]{64}$/);
  assert.notEqual(alice.publicKeyHex, alice.privateKeyHex);

  const alicePrivKey = await importX25519PrivateKey(alice.privateKeyHex);
  const bobPubKey = await importX25519PublicKey(bob.publicKeyHex);
  const bobPrivKey = await importX25519PrivateKey(bob.privateKeyHex);
  const alicePubKey = await importX25519PublicKey(alice.publicKeyHex);

  const subtle = globalThis.crypto.subtle;
  const bitsA = await subtle.deriveBits({ name: 'X25519', public: bobPubKey }, alicePrivKey, 256);
  const bitsB = await subtle.deriveBits({ name: 'X25519', public: alicePubKey }, bobPrivKey, 256);

  assert.equal(toHex(new Uint8Array(bitsA)), toHex(new Uint8Array(bitsB)));
});

test('browser-to-runner pairing encryption round-trip with canonical AAD and grant digest binding', async () => {
  const f = await createPairingFixture();

  const envelope = await encryptBookOpening({
    purpose: 'line:agent-pairing/v1',
    recipientPublicKeyHex: f.runnerKeys.publicKeyHex,
    grantDigest: f.grantDigest,
    nonce: f.offerNonce,
    payload: f.bookOpening,
  });

  assert.equal(envelope.version, 1);
  assert.equal(envelope.purpose, 'line:agent-pairing/v1');
  assert.equal(envelope.nonce, f.offerNonce);
  assert.match(envelope.ephemeralPublicKey, /^[0-9a-f]{64}$/);
  assert.match(envelope.iv, /^[0-9a-f]{24}$/);
  assert.match(envelope.ciphertext, /^[0-9a-f]+$/);

  const recovered = await decryptBookOpening({
    envelope,
    expectedPurpose: 'line:agent-pairing/v1',
    expectedGrantDigest: f.grantDigest,
    expectedNonce: f.offerNonce,
    recipientPrivateKeyHex: f.runnerKeys.privateKeyHex,
  });

  assert.deepEqual(recovered, f.bookOpening);
});

test('runner-to-browser encrypted handback round-trip with browser return key', async () => {
  const f = await createPairingFixture();
  const checkpointNonce = createHex(0x99);

  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.bookOpening.agentSecret,
    salt: createHex(0x9a),
    limit: '500000',
    outstanding: '45000',
    epoch: '1',
    generation: '2',
  };

  const handbackEnvelope = await encryptBookOpening({
    purpose: 'line:agent-handback/v1',
    recipientPublicKeyHex: f.returnKeys.publicKeyHex,
    grantDigest: f.grantDigest,
    nonce: checkpointNonce,
    payload: finalBook,
  });

  assert.equal(handbackEnvelope.purpose, 'line:agent-handback/v1');
  assert.equal(handbackEnvelope.nonce, checkpointNonce);

  const recovered = await decryptBookOpening({
    envelope: handbackEnvelope,
    expectedPurpose: 'line:agent-handback/v1',
    expectedGrantDigest: f.grantDigest,
    expectedNonce: checkpointNonce,
    recipientPrivateKeyHex: f.returnKeys.privateKeyHex,
  });

  assert.deepEqual(recovered, finalBook);
});

test('tampering with ciphertext, IV, nonce, purpose, or ephemeral key fails closed', async () => {
  const f = await createPairingFixture();

  const envelope = await encryptBookOpening({
    purpose: 'line:agent-pairing/v1',
    recipientPublicKeyHex: f.runnerKeys.publicKeyHex,
    grantDigest: f.grantDigest,
    nonce: f.offerNonce,
    payload: f.bookOpening,
  });

  // 1. Flip byte in ciphertext
  const tamperedCt = envelope.ciphertext.slice(0, -2) + (envelope.ciphertext.slice(-2) === 'aa' ? 'bb' : 'aa');
  await assert.rejects(
    decryptBookOpening({
      envelope: { ...envelope, ciphertext: tamperedCt },
      expectedPurpose: 'line:agent-pairing/v1',
      expectedGrantDigest: f.grantDigest,
      expectedNonce: f.offerNonce,
      recipientPrivateKeyHex: f.runnerKeys.privateKeyHex,
    }),
    /corrupted or tampered/,
  );

  // 2. Flip byte in IV
  const tamperedIv = '00' + envelope.iv.slice(2);
  await assert.rejects(
    decryptBookOpening({
      envelope: { ...envelope, iv: tamperedIv },
      expectedPurpose: 'line:agent-pairing/v1',
      expectedGrantDigest: f.grantDigest,
      expectedNonce: f.offerNonce,
      recipientPrivateKeyHex: f.runnerKeys.privateKeyHex,
    }),
    /corrupted or tampered/,
  );

  // 3. Ephemeral public key altered
  const otherEph = createHex(0x99);
  await assert.rejects(
    decryptBookOpening({
      envelope: { ...envelope, ephemeralPublicKey: otherEph },
      expectedPurpose: 'line:agent-pairing/v1',
      expectedGrantDigest: f.grantDigest,
      expectedNonce: f.offerNonce,
      recipientPrivateKeyHex: f.runnerKeys.privateKeyHex,
    }),
    /corrupted or tampered/,
  );

  // 4. Mismatched nonce
  await assert.rejects(
    decryptBookOpening({
      envelope,
      expectedPurpose: 'line:agent-pairing/v1',
      expectedGrantDigest: f.grantDigest,
      expectedNonce: createHex(0x99),
      recipientPrivateKeyHex: f.runnerKeys.privateKeyHex,
    }),
    /nonce mismatch/,
  );

  // 5. Mismatched purpose (trying to use handback on pairing envelope)
  await assert.rejects(
    decryptBookOpening({
      envelope,
      expectedPurpose: 'line:agent-handback/v1',
      expectedGrantDigest: f.grantDigest,
      expectedNonce: f.offerNonce,
      recipientPrivateKeyHex: f.runnerKeys.privateKeyHex,
    }),
    /purpose mismatch/,
  );
});

test('tampering with any grant field changes grantDigest and causes decryption to fail', async () => {
  const f = await createPairingFixture();

  const envelope = await encryptBookOpening({
    purpose: 'line:agent-pairing/v1',
    recipientPublicKeyHex: f.runnerKeys.publicKeyHex,
    grantDigest: f.grantDigest,
    nonce: f.offerNonce,
    payload: f.bookOpening,
  });

  // Tamper with facility address
  const tamperedScope1 = { ...f.scope, facilityAddress: createHex(0x99) };
  const tamperedDigest1 = agentGrantDigest(tamperedScope1);
  assert.notEqual(tamperedDigest1, f.grantDigest);

  await assert.rejects(
    decryptBookOpening({
      envelope,
      expectedPurpose: 'line:agent-pairing/v1',
      expectedGrantDigest: tamperedDigest1,
      expectedNonce: f.offerNonce,
      recipientPrivateKeyHex: f.runnerKeys.privateKeyHex,
    }),
    /corrupted or tampered/,
  );

  // Tamper with returnPublicKey
  const tamperedScope2 = { ...f.scope, returnPublicKey: createHex(0x99) };
  const tamperedDigest2 = agentGrantDigest(tamperedScope2);
  assert.notEqual(tamperedDigest2, f.grantDigest);

  await assert.rejects(
    decryptBookOpening({
      envelope,
      expectedPurpose: 'line:agent-pairing/v1',
      expectedGrantDigest: tamperedDigest2,
      expectedNonce: f.offerNonce,
      recipientPrivateKeyHex: f.runnerKeys.privateKeyHex,
    }),
    /corrupted or tampered/,
  );

  // Tamper with domain
  const tamperedScope3 = { ...f.scope, domain: createHex(0x99) };
  const tamperedDigest3 = agentGrantDigest(tamperedScope3);
  assert.notEqual(tamperedDigest3, f.grantDigest);

  await assert.rejects(
    decryptBookOpening({
      envelope,
      expectedPurpose: 'line:agent-pairing/v1',
      expectedGrantDigest: tamperedDigest3,
      expectedNonce: f.offerNonce,
      recipientPrivateKeyHex: f.runnerKeys.privateKeyHex,
    }),
    /corrupted or tampered/,
  );
});

test('invalid keys (all-zero, wrong length, non-hex) fail closed', async () => {
  const f = await createPairingFixture();
  const allZeros = '0'.repeat(64);

  await assert.rejects(
    encryptBookOpening({
      purpose: 'line:agent-pairing/v1',
      recipientPublicKeyHex: allZeros,
      grantDigest: f.grantDigest,
      nonce: f.offerNonce,
      payload: f.bookOpening,
    }),
    /non-zero/,
  );

  await assert.rejects(
    encryptBookOpening({
      purpose: 'line:agent-pairing/v1',
      recipientPublicKeyHex: '1234',
      grantDigest: f.grantDigest,
      nonce: f.offerNonce,
      payload: f.bookOpening,
    }),
    /32-byte hexadecimal/,
  );

  await assert.rejects(
    importX25519PrivateKey(allZeros),
    /non-zero/,
  );
});

test('book opening payload schema validation strictly enforces allowlist and decimal uint64', () => {
  const valid: AgentBookOpeningPayload = {
    agentSecret: createHex(0x11),
    salt: createHex(0x22),
    limit: '500000',
    outstanding: '0',
    epoch: '0',
    generation: '2',
  };

  assert.deepEqual(validateBookOpeningPayload(valid), valid);

  // Extra field forbidden
  assert.throws(() => validateBookOpeningPayload({ ...valid, extraField: 'dangerous' }), /disallowed or missing/);

  // Missing field forbidden
  const { salt, ...missing } = valid;
  assert.throws(() => validateBookOpeningPayload(missing), /disallowed or missing/);

  // Non-decimal or negative amount
  assert.throws(() => validateBookOpeningPayload({ ...valid, limit: '-10' }), /uint64 decimal/);
  assert.throws(() => validateBookOpeningPayload({ ...valid, limit: '0100' }), /uint64 decimal/);
  assert.throws(() => validateBookOpeningPayload({ ...valid, limit: '18446744073709551616' }), /uint64 decimal/);

  // All-zero agentSecret forbidden
  assert.throws(() => validateBookOpeningPayload({ ...valid, agentSecret: '0'.repeat(64) }), /Invalid agentSecret/);
});

test('pairing offer verification enforces pinned identity, key rotation refusal, nonces, and timestamp bounds', async () => {
  const f = await createPairingFixture();
  const pinned = {
    runnerOrigin: f.scope.runnerOrigin,
    runnerPublicKey: f.runnerKeys.publicKeyHex,
    runnerSigningPublicKey: f.runnerSigningPublicKey,
  };

  const validOffer = {
    schema: 'line:agent-pairing-offer/v1' as const,
    runnerOrigin: pinned.runnerOrigin,
    runnerPublicKey: pinned.runnerPublicKey,
    runnerSigningPublicKey: pinned.runnerSigningPublicKey,
    offerNonce: f.offerNonce,
    timestamp: 10_000,
  };

  const seenNonces = new Set<string>();
  const verified = verifyPairingOffer(validOffer, pinned, seenNonces, 10_000);
  assert.equal(verified.offerNonce, f.offerNonce);
  seenNonces.add(f.offerNonce);

  // Replay of same nonce is rejected
  assert.throws(() => verifyPairingOffer(validOffer, pinned, seenNonces, 10_000), /replay/);

  // Key rotation refusal: runner changed public key
  const rotatedKeyOffer = { ...validOffer, runnerPublicKey: createHex(0x99), offerNonce: createHex(0x9a) };
  assert.throws(() => verifyPairingOffer(rotatedKeyOffer, pinned, seenNonces, 10_000), /key rotation refused/);

  // Key rotation refusal: runner changed signing key
  const rotatedSigningOffer = { ...validOffer, runnerSigningPublicKey: createHex(0x99), offerNonce: createHex(0x9b) };
  assert.throws(() => verifyPairingOffer(rotatedSigningOffer, pinned, seenNonces, 10_000), /key rotation refused/);

  // Encryption key equals signing key is refused
  const sameKeyOffer = { ...validOffer, runnerSigningPublicKey: validOffer.runnerPublicKey, offerNonce: createHex(0x9c) };
  assert.throws(() => verifyPairingOffer(sameKeyOffer, { ...pinned, runnerSigningPublicKey: validOffer.runnerPublicKey }, seenNonces, 10_000), /distinct/);

  // Origin mismatch refused
  const wrongOriginOffer = { ...validOffer, runnerOrigin: 'http://127.0.0.1:9999', offerNonce: createHex(0x9d) };
  assert.throws(() => verifyPairingOffer(wrongOriginOffer, pinned, seenNonces, 10_000), /runnerOrigin does not match/);

  // Expired offer rejected
  const expiredOffer = { ...validOffer, timestamp: 10_000 - 301_000, offerNonce: createHex(0x9e) };
  assert.throws(() => verifyPairingOffer(expiredOffer, pinned, seenNonces, 10_000), /expired/);

  // Origin > 200 bytes rejected
  const longOriginOffer = { ...validOffer, runnerOrigin: 'http://127.0.0.1:' + '9'.repeat(250), offerNonce: createHex(0x9f) };
  assert.throws(() => verifyPairingOffer(longOriginOffer, pinned, seenNonces, 10_000), /200 bytes/);
});

test('pairing package correctly binds packageId to grantId and offerNonce to scope.nonce', async () => {
  const f = await createPairingFixture();

  const envelope = await encryptBookOpening({
    purpose: 'line:agent-pairing/v1',
    recipientPublicKeyHex: f.runnerKeys.publicKeyHex,
    grantDigest: f.grantDigest,
    nonce: f.offerNonce,
    payload: f.bookOpening,
  });

  const pkg = createPairingPackage(f.scope, f.proof, envelope);
  assert.equal(pkg.packageId, f.scope.grantId);
  assert.equal(pkg.offerNonce, f.scope.nonce);
  assert.equal(pkg.encryptedOpening.nonce, f.scope.nonce);

  const verified = verifyPairingPackageStructure(pkg);
  assert.equal(verified.packageId, f.scope.grantId);

  // Mismatched nonce between scope and envelope throws
  const badScope = { ...f.scope, nonce: createHex(0x99) };
  assert.throws(() => createPairingPackage(badScope, f.proof, envelope), /offerNonce/);
});

test('canonical AAD is deterministic and rejects invalid fields', () => {
  const aad1 = createCanonicalAad('line:agent-pairing/v1', createHex(0x11), createHex(0x22), createHex(0x33));
  const aad2 = createCanonicalAad('line:agent-pairing/v1', createHex(0x11), createHex(0x22), createHex(0x33));
  assert.deepEqual(aad1, aad2);

  // Delimiter ambiguity test: structured JSON cannot be spoofed by field concatenation
  const parsed = JSON.parse(new TextDecoder().decode(aad1));
  assert.equal(parsed.purpose, 'line:agent-pairing/v1');
  assert.equal(parsed.grantDigest, createHex(0x11));
  assert.equal(parsed.ephemeralPublicKey, createHex(0x22));
  assert.equal(parsed.nonce, createHex(0x33));
});

test('encryption snapshots only validated fields before yielding and decryption snapshots its envelope', async () => {
  const f = await createPairingFixture();
  const payload = {...f.bookOpening};
  const original = {...payload};
  const encrypting = encryptBookOpening({purpose:'line:agent-pairing/v1',recipientPublicKeyHex:f.runnerKeys.publicKeyHex,grantDigest:f.grantDigest,nonce:f.offerNonce,payload});
  Object.assign(payload,{issuerSecret:'must-never-leave',agentSecret:createHex(0xff)});
  const envelope = await encrypting;
  const decrypting = decryptBookOpening({envelope,expectedPurpose:'line:agent-pairing/v1',expectedGrantDigest:f.grantDigest,expectedNonce:f.offerNonce,recipientPrivateKeyHex:f.runnerKeys.privateKeyHex});
  envelope.ciphertext='ff'.repeat(32);
  assert.deepEqual(await decrypting,original);
});

test('authenticated envelopes reject wrong keys, cross-purpose ciphertext, extra fields and odd hex', async () => {
  const f = await createPairingFixture();
  const envelope = await encryptBookOpening({purpose:'line:agent-pairing/v1',recipientPublicKeyHex:f.runnerKeys.publicKeyHex,grantDigest:f.grantDigest,nonce:f.offerNonce,payload:f.bookOpening});
  const options = {envelope,expectedPurpose:'line:agent-pairing/v1' as const,expectedGrantDigest:f.grantDigest,expectedNonce:f.offerNonce,recipientPrivateKeyHex:f.runnerKeys.privateKeyHex};
  await assert.rejects(decryptBookOpening({...options,recipientPrivateKeyHex:f.returnKeys.privateKeyHex}),/Decryption failed/);
  await assert.rejects(decryptBookOpening({...options,expectedPurpose:'line:agent-handback/v1',envelope:{...envelope,purpose:'line:agent-handback/v1'}}),/Decryption failed/);
  await assert.rejects(decryptBookOpening({...options,envelope:{...envelope,ciphertext:envelope.ciphertext+'a'}}),/Invalid authenticated envelope/);
  await assert.rejects(decryptBookOpening({...options,envelope:{...envelope,issuerSecret:'forbidden'} as any}),/disallowed/);
  const pkg = createPairingPackage(f.scope,f.proof,envelope);
  assert.throws(()=>verifyPairingPackageStructure({...pkg,scope:{...f.scope,ownerAddress:{issuerSecret:'forbidden'}}}),/provenance/);
  assert.throws(()=>verifyPairingPackageStructure({...pkg,scope:{...f.scope,issuerSecret:'forbidden'}}),/disallowed/);
});
