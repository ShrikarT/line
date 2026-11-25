/**
 * tests/agent-handback.test.ts
 *
 * NOTE: These tests execute under Node.js using universal WebCrypto and pure cryptographic helpers.
 * They verify cross-platform contract logic, strict descriptor capture, and arithmetic invariants,
 * but do NOT constitute actual browser-runtime evidence (which requires a live browser environment/driver).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import * as L from '@midnight-ntwrk/ledger-v8';
import { bech32m } from '@scure/base';
import {
  agentId,
  contractDomain,
  issuerPublicKey,
  merchantPublicKey,
  lineStateCommit,
  drawNoteCommit,
  pad32,
  toHex,
  hexToBytes,
  type DrawNotePreimage,
} from '../src/lib/line/encoding.ts';
import {
  generateX25519KeyPair,
  browserPairingPackageDigest,
  createPairingPackage,
  encryptBookOpening,
  assertWebCrypto,
} from '../src/lib/agent/pairing.ts';
import {
  agentGrantMessage,
  browserAgentGrantDigest,
} from '../src/lib/agent/grant.ts';
import { organizationMessageBytes } from '../src/lib/organization/signing.ts';
import type {
  AgentBookOpeningPayload,
  AgentGrantScope,
  AgentEncryptedEnvelope,
} from '../src/lib/agent/types.ts';
import {
  MAX_HANDBACK_CLAIMS,
  MAX_HANDBACK_PLAINTEXT_BYTES,
  MAX_HANDBACK_CIPHERTEXT_HEX_LEN,
  MAX_HANDBACK_PACKAGE_BYTES,
  createHandbackPackage,
  verifyHandbackPackage,
  validateHandbackPackage,
  validateHandbackClaimOpening,
  validateHandbackPayload,
  canonicalHandbackPayloadMessage,
  handbackPayloadDigest,
  validateHandbackEnvelope,
  canonicalHandbackEnvelopeMessage,
  handbackEnvelopeDigest,
  createHandbackAad,
  handbackSummaryMessage,
  signHandbackSummary,
  encryptHandbackPayload,
  decryptHandbackPayload,
  type AgentHandbackClaimOpening,
  type AgentHandbackPayload,
  type AgentHandbackSummary,
  type AgentHandbackPackage,
} from '../src/lib/agent/handback.ts';

const hex32 = () => randomBytes(32).toString('hex');

function extractSummary(pkg: any): AgentHandbackSummary {
  return {
    agentPk: pkg.agentPk,
    claimsCount: pkg.claimsCount,
    domain: pkg.domain,
    envelopeDigest: pkg.envelopeDigest,
    facilityAddress: pkg.facilityAddress,
    finalBookCommitment: pkg.finalBookCommitment,
    generation: pkg.generation,
    grantDigest: pkg.grantDigest,
    grantId: pkg.grantId,
    handbackId: pkg.handbackId,
    networkId: 'preprod',
    pairingPackageDigest: pkg.pairingPackageDigest,
    payloadDigest: pkg.payloadDigest,
    reserved: '0',
    retiredAt: pkg.retiredAt,
    returnPublicKey: pkg.returnPublicKey,
    runnerSigningPublicKey: pkg.runnerSigningPublicKey,
    sourceFingerprint: pkg.sourceFingerprint,
    spent: pkg.spent,
    storeRevision: pkg.storeRevision,
  };
}

async function testFixture() {
  const issuer = pad32('fixture-issuer');
  const merchant = pad32('fixture-merchant');
  const agentSecretBytes = pad32('fixture-agent-secret');
  const agentSecret = toHex(agentSecretBytes);
  const salt = hex32();
  const nonce = pad32('fixture-instance');

  const ownerKey = L.sampleSigningKey();
  const ownerVerifyingKey = L.signatureVerifyingKey(ownerKey);
  const ownerAddress = bech32m.encode(
    'mn_addr_preprod',
    bech32m.toWords(hexToBytes(L.addressFromKey(ownerVerifyingKey))),
    120,
  );

  const domain = contractDomain(issuerPublicKey(issuer), merchantPublicKey(merchant), nonce);
  const domainHex = toHex(domain);
  const identity = agentId(agentSecretBytes);
  const agentPk = toHex(identity);
  const facilityAddress = hex32();
  const sourceFingerprint = hex32();
  const merchantPk = toHex(merchantPublicKey(merchant));

  const runnerX25519 = await generateX25519KeyPair();
  const returnX25519 = await generateX25519KeyPair();
  const runnerSigningKey = L.sampleSigningKey();
  const runnerSigningPublicKey = L.signatureVerifyingKey(runnerSigningKey);

  const initialBook: AgentBookOpeningPayload = {
    agentSecret,
    salt,
    limit: '1000000',
    outstanding: '10000',
    epoch: '5',
    generation: '2',
  };

  const initialCommitment = toHex(
    lineStateCommit(
      {
        domain,
        identity,
        limit: 1000000n,
        outstanding: 10000n,
        epoch: 5n,
      },
      hexToBytes(salt),
    ),
  );

  const scope: AgentGrantScope = {
    schema: 'line:agent-grant/v1',
    grantId: randomUUID(),
    networkId: 'preprod',
    facilityAddress,
    domain: domainHex,
    sourceFingerprint,
    ownerAddress,
    runnerOrigin: 'http://127.0.0.1:8000',
    runnerPublicKey: runnerX25519.publicKeyHex,
    runnerSigningPublicKey,
    returnPublicKey: returnX25519.publicKeyHex,
    agentPk,
    generation: '2',
    bookCommitment: initialCommitment,
    nonce: hex32(),
    issuedAt: 1000,
    expiresAt: 5000,
    maxSpend: '200000',
    maxFee: '5000',
    allowedServices: ['line-doc-extract-v1'],
    allowedMerchants: [merchantPk],
  };

  const grantDigest = await browserAgentGrantDigest(scope);
  const ownerProof = {
    verifyingKey: ownerVerifyingKey,
    signature: L.signData(ownerKey, organizationMessageBytes(agentGrantMessage(scope))),
  };

  const pairingEnvelope = await encryptBookOpening({
    purpose: 'line:agent-pairing/v1',
    recipientPublicKeyHex: scope.runnerPublicKey,
    grantDigest,
    nonce: scope.nonce,
    payload: initialBook,
  });

  const pairingPackage = createPairingPackage(scope, ownerProof, pairingEnvelope);
  const pairingPackageDigest = await browserPairingPackageDigest(pairingPackage);

  function createValidClaim(options: {
    index: number;
    amount: bigint;
    fee: bigint;
    redeemed: boolean;
    retainedRedemptionIdentifier?: boolean;
  }): AgentHandbackClaimOpening {
    const id = randomUUID();
    const noteNonce = hex32();
    const noteSalt = hex32();
    const quoteCommitment = hex32();
    const drawIdentifier = '00' + hex32();
    const drawTxHash = hex32();

    const preimage: DrawNotePreimage = {
      domain: hexToBytes(domainHex),
      lineGeneration: 2n,
      identity: hexToBytes(agentPk),
      quoteCommit: hexToBytes(quoteCommitment),
      merchantPk: hexToBytes(merchantPk),
      amount: options.amount,
      fee: options.fee,
      noteNonce: hexToBytes(noteNonce),
      expiry: 999999n,
    };
    const noteCommitment = toHex(drawNoteCommit(preimage, hexToBytes(noteSalt)));

    return {
      contractAddress: facilityAddress,
      domain: domainHex,
      identity: agentPk,
      merchantPk,
      quoteCommitment,
      amount: options.amount.toString(),
      fee: options.fee.toString(),
      expiry: '999999',
      generation: '2',
      noteNonce,
      noteSalt,
      noteCommitment,
      redeemed: options.redeemed,
      taskId: id,
      orderId: id,
      drawIdentifier,
      drawReceipt: {
        circuit: 'draw',
        contractAddress: facilityAddress,
        identifier: drawIdentifier,
        txHash: drawTxHash,
        blockHeight: 100 + options.index,
        blockHash: hex32(),
        sourceFingerprint,
        outcome: 'success',
      },
      redemptionReceipt: options.redeemed
        ? {
            circuit: 'redeemDraw',
            contractAddress: facilityAddress,
            txHash: hex32(),
            blockHeight: 200 + options.index,
            blockHash: hex32(),
            sourceFingerprint,
            outcome: 'success',
            noteCommitment,
            amount: options.amount.toString(),
            ...(options.retainedRedemptionIdentifier ? { identifier: '00' + hex32() } : {}),
          }
        : null,
    };
  }

  return {
    scope,
    grantDigest,
    pairingPackageDigest,
    initialBook,
    returnX25519,
    runnerSigningKey,
    facilityAddress,
    domainHex,
    agentPk,
    merchantPk,
    sourceFingerprint,
    createValidClaim,
  };
}

test('1. End-to-end handback package creation, encryption, decryption, and verification', async () => {
  const f = await testFixture();

  const claim1 = f.createValidClaim({ index: 1, amount: 5000n, fee: 100n, redeemed: true, retainedRedemptionIdentifier: true });
  const claim2 = f.createValidClaim({ index: 2, amount: 3000n, fee: 50n, redeemed: false });
  const claims = [claim1, claim2];

  const totalSpent = 5100n + 3050n; // 8150
  const finalOutstanding = 10000n + totalSpent; // 18150
  const finalEpoch = 5n + 2n; // 7

  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: finalOutstanding.toString(),
    epoch: finalEpoch.toString(),
    generation: '2',
  };

  const handbackPackage = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook,
    claims,
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  const verified = await verifyHandbackPackage(handbackPackage, {
    pinnedScope: f.scope,
    expectedGrantDigest: f.grantDigest,
    expectedPairingPackageDigest: f.pairingPackageDigest,
    initialBookOpening: f.initialBook,
    minRevision: 5,
    recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
  });

  assert.equal(verified.claims.length, 2);
  assert.equal(verified.finalBook.outstanding, '18150');
  assert.equal(verified.finalBook.epoch, '7');
  assert.equal(verified.summary.spent, '8150');
  assert.equal(verified.summary.claimsCount, 2);
  assert.equal(verified.summary.reserved, '0');
});

test('2. Full 50-claim worst-case payload sizing boundary and semantically valid 50-claim roundtrip', async () => {
  const f = await testFixture();

  // Semantically valid 50-claim case: each claim is amount=1000, fee=100 -> charge=1100
  // Total spent across 50 claims = 55,000 <= maxSpend (200,000)
  const claims: AgentHandbackClaimOpening[] = [];
  for (let i = 0; i < 50; i++) {
    claims.push(
      f.createValidClaim({
        index: i + 1,
        amount: 1000n,
        fee: 100n,
        redeemed: i % 2 === 0,
        retainedRedemptionIdentifier: i % 4 === 0,
      }),
    );
  }

  const totalSpent = 55000n;
  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: (10000n + totalSpent).toString(),
    epoch: (5n + 50n).toString(),
    generation: '2',
  };

  const validPackage = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 60,
    retiredAt: 3000,
    finalBook,
    claims,
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  const verified = await verifyHandbackPackage(validPackage, {
    pinnedScope: f.scope,
    expectedGrantDigest: f.grantDigest,
    expectedPairingPackageDigest: f.pairingPackageDigest,
    initialBookOpening: f.initialBook,
    minRevision: 5,
    recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
  });
  assert.equal(verified.claims.length, 50);
  assert.equal(verified.summary.spent, '55000');

  // Structural maximal sizing fixture including optional redemption identifier: assert exact 104,942 byte count
  const maximalClaim: AgentHandbackClaimOpening = {
    contractAddress: 'f'.repeat(64),
    domain: 'f'.repeat(64),
    identity: 'f'.repeat(64),
    merchantPk: 'f'.repeat(64),
    quoteCommitment: 'f'.repeat(64),
    amount: '18446744073709551615',
    fee: '18446744073709551615',
    expiry: '18446744073709551615',
    generation: '18446744073709551615',
    noteNonce: 'f'.repeat(64),
    noteSalt: 'f'.repeat(64),
    noteCommitment: 'f'.repeat(64),
    redeemed: true,
    taskId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    orderId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    drawIdentifier: '00' + 'f'.repeat(64),
    drawReceipt: {
      circuit: 'draw',
      contractAddress: 'f'.repeat(64),
      identifier: '00' + 'f'.repeat(64),
      txHash: 'f'.repeat(64),
      blockHeight: 9007199254740991,
      blockHash: 'f'.repeat(64),
      sourceFingerprint: 'f'.repeat(64),
      outcome: 'success',
    },
    redemptionReceipt: {
      circuit: 'redeemDraw',
      contractAddress: 'f'.repeat(64),
      txHash: 'f'.repeat(64),
      blockHeight: 9007199254740991,
      blockHash: 'f'.repeat(64),
      sourceFingerprint: 'f'.repeat(64),
      outcome: 'success',
      noteCommitment: 'f'.repeat(64),
      amount: '18446744073709551615',
      identifier: '00' + 'f'.repeat(64),
    },
  };

  const maximalBook: AgentBookOpeningPayload = {
    agentSecret: 'f'.repeat(64),
    salt: 'f'.repeat(64),
    limit: '18446744073709551615',
    outstanding: '18446744073709551615',
    epoch: '18446744073709551615',
    generation: '18446744073709551615',
  };

  const maximalPayload: AgentHandbackPayload = {
    schema: 'line:agent-handback-payload/v1',
    grantId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    facilityAddress: 'f'.repeat(64),
    finalBook: maximalBook,
    claims: Array.from({ length: 50 }, () => maximalClaim),
  };

  const rawBytes = Buffer.byteLength(JSON.stringify(maximalPayload), 'utf8');
  assert.equal(rawBytes, 104942, 'Maximal 50-claim payload UTF-8 bytes must match executable measured 104,942');
  assert(rawBytes <= MAX_HANDBACK_PLAINTEXT_BYTES, 'Payload must be within MAX_HANDBACK_PLAINTEXT_BYTES');
  const exactCiphertextHex = (rawBytes + 16) * 2;
  assert.equal(exactCiphertextHex, 209916);
  assert(exactCiphertextHex <= MAX_HANDBACK_CIPHERTEXT_HEX_LEN, 'Ciphertext must be within MAX_HANDBACK_CIPHERTEXT_HEX_LEN');

  // Verify rejection of 51 claims (> MAX_HANDBACK_CLAIMS)
  const tooManyClaims = Array.from({ length: 51 }, (_, i) =>
    f.createValidClaim({ index: i + 1, amount: 100n, fee: 10n, redeemed: false }),
  );
  await assert.rejects(
    createHandbackPackage({
      handbackId: randomUUID(),
      scope: f.scope,
      grantDigest: f.grantDigest,
      pairingPackageDigest: f.pairingPackageDigest,
      storeRevision: 10,
      retiredAt: 2500,
      finalBook: { ...finalBook, epoch: (5n + 51n).toString(), outstanding: (10000n + 5610n).toString() },
      claims: tooManyClaims,
      runnerSigningPrivateKey: f.runnerSigningKey,
      nonceHex: hex32(),
    }),
    /capacity/,
  );
});

test('3. Tampering and corruption rejection: ciphertext, IV, nonce, AAD, signature, digests', async () => {
  const f = await testFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 50n, redeemed: false });
  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '11050',
    epoch: '6',
    generation: '2',
  };

  const valid = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  // Corrupted ciphertext
  const tamperedCiphertext = structuredClone(valid);
  const cipherBytes = hexToBytes(tamperedCiphertext.encryptedPayload.ciphertext);
  cipherBytes[0] ^= 0x01;
  tamperedCiphertext.encryptedPayload.ciphertext = toHex(cipherBytes);
  tamperedCiphertext.envelopeDigest = await handbackEnvelopeDigest(tamperedCiphertext.encryptedPayload);
  tamperedCiphertext.runnerSignature = await signHandbackSummary(
    extractSummary(tamperedCiphertext),
    f.runnerSigningKey,
  );
  await assert.rejects(
    verifyHandbackPackage(tamperedCiphertext, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /Decryption failed/,
  );

  // Corrupted IV
  const tamperedIv = structuredClone(valid);
  const ivBytes = hexToBytes(tamperedIv.encryptedPayload.iv);
  ivBytes[0] ^= 0x01;
  tamperedIv.encryptedPayload.iv = toHex(ivBytes);
  tamperedIv.envelopeDigest = await handbackEnvelopeDigest(tamperedIv.encryptedPayload);
  tamperedIv.runnerSignature = await signHandbackSummary(
    extractSummary(tamperedIv),
    f.runnerSigningKey,
  );
  await assert.rejects(
    verifyHandbackPackage(tamperedIv, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /Decryption failed/,
  );

  // Corrupted signature
  const tamperedSig = structuredClone(valid);
  const sigBytes = hexToBytes(tamperedSig.runnerSignature);
  sigBytes[0] ^= 0x01;
  tamperedSig.runnerSignature = toHex(sigBytes);
  await assert.rejects(
    verifyHandbackPackage(tamperedSig, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /runner signature is invalid/,
  );

  // Tampered payloadDigest
  const tamperedDigest = structuredClone(valid);
  tamperedDigest.payloadDigest = hex32();
  await assert.rejects(
    verifyHandbackPackage(tamperedDigest, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /runner signature is invalid/,
  );

  // Tampered envelopeDigest
  const tamperedEnvDigest = structuredClone(valid);
  tamperedEnvDigest.envelopeDigest = hex32();
  await assert.rejects(
    verifyHandbackPackage(tamperedEnvDigest, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /envelopeDigest mismatch/,
  );
});

test('4. Commitment mismatches and arithmetic integrity', async () => {
  const f = await testFixture();
  const claim = f.createValidClaim({ index: 1, amount: 2000n, fee: 100n, redeemed: false });

  // Inconsistent final outstanding: createHandbackPackage must refuse to manufacture when initialBook provided
  const badOutstandingBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '13000', // expected 10000 + 2100 = 12100
    epoch: '6',
    generation: '2',
  };
  await assert.rejects(
    createHandbackPackage({
      handbackId: randomUUID(),
      scope: f.scope,
      grantDigest: f.grantDigest,
      pairingPackageDigest: f.pairingPackageDigest,
      storeRevision: 10,
      retiredAt: 2500,
      finalBook: badOutstandingBook,
      claims: [claim],
      runnerSigningPrivateKey: f.runnerSigningKey,
      nonceHex: hex32(),
      initialBook: f.initialBook,
    }),
    /finalBook outstanding does not equal initialBook.outstanding \+ totalSpent/,
  );

  // When constructed without initialBook or via low-level functions, verifyHandbackPackage must reject
  const badOutstandingPkg = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook: badOutstandingBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });
  await assert.rejects(
    verifyHandbackPackage(badOutstandingPkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /final outstanding does not equal initial \+ spent/,
  );

  // Inconsistent note commitment on claim: verify must reject
  const tamperedClaim = structuredClone(claim);
  tamperedClaim.noteCommitment = hex32();
  const badClaimBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '12100',
    epoch: '6',
    generation: '2',
  };
  const badClaimPkg = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook: badClaimBook,
    claims: [tamperedClaim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });
  await assert.rejects(
    verifyHandbackPackage(badClaimPkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /claim noteCommitment mismatch/,
  );
});

test('5. Receipt provenance integrity and gap handling', async () => {
  const f = await testFixture();
  const claim = f.createValidClaim({ index: 1, amount: 2000n, fee: 100n, redeemed: true });

  // Missing redemptionReceipt when redeemed: true
  const brokenClaim = structuredClone(claim);
  brokenClaim.redemptionReceipt = null;
  assert.throws(() => validateHandbackClaimOpening(brokenClaim), /missing redemptionReceipt/);

  // redemptionReceipt present when redeemed: false
  const unredeemedWithReceipt = f.createValidClaim({ index: 2, amount: 2000n, fee: 100n, redeemed: false });
  (unredeemedWithReceipt as any).redemptionReceipt = claim.redemptionReceipt;
  assert.throws(() => validateHandbackClaimOpening(unredeemedWithReceipt), /null redemptionReceipt/);

  // Non-66-hex drawIdentifier
  const badIdentifierClaim = structuredClone(claim);
  badIdentifierClaim.drawIdentifier = hex32(); // 64 hex, not 66
  assert.throws(() => validateHandbackClaimOpening(badIdentifierClaim), /invalid drawIdentifier/);
});

test('6. Duplicate claims, schema extras, and getter accessor rejection', async () => {
  const f = await testFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 50n, redeemed: false });

  // Duplicate claim in payload
  const duplicatePayload = {
    schema: 'line:agent-handback-payload/v1',
    grantId: f.scope.grantId,
    facilityAddress: f.scope.facilityAddress,
    finalBook: {
      agentSecret: f.initialBook.agentSecret,
      salt: hex32(),
      limit: '1000000',
      outstanding: '12100',
      epoch: '7',
      generation: '2',
    },
    claims: [claim, structuredClone(claim)],
  };
  assert.throws(() => validateHandbackPayload(duplicatePayload), /duplicate/);

  // Extra unknown field in claim
  const extraFieldClaim = { ...claim, extraField: 'disallowed' };
  assert.throws(() => validateHandbackClaimOpening(extraFieldClaim), /disallowed/);

  // Object with getter accessor
  const accessorClaim = { ...claim };
  Object.defineProperty(accessorClaim, 'amount', {
    get() {
      return '1000';
    },
    enumerable: true,
  });
  assert.throws(() => validateHandbackClaimOpening(accessorClaim), /accessors/);
});

test('7. Caller mutation across awaits does not corrupt package', async () => {
  const f = await testFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 50n, redeemed: false });
  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '11050',
    epoch: '6',
    generation: '2',
  };

  const claimsArray = [claim];
  const packagePromise = createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook,
    claims: claimsArray,
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  // Mutate caller array during creation
  claimsArray.push(f.createValidClaim({ index: 2, amount: 500n, fee: 20n, redeemed: false }));
  finalBook.outstanding = '999999';

  const pkg = await packagePromise;
  const verified = await verifyHandbackPackage(pkg, {
    pinnedScope: f.scope,
    expectedGrantDigest: f.grantDigest,
    expectedPairingPackageDigest: f.pairingPackageDigest,
    initialBookOpening: f.initialBook,
    minRevision: 5,
    recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
  });

  assert.equal(verified.claims.length, 1);
  assert.equal(verified.finalBook.outstanding, '11050');
});

test('8. Zero-spend handback and retiredAt after grant expiry', async () => {
  const f = await testFixture();

  // 0 claims, spent: 0, outstanding unchanged, epoch unchanged
  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: f.initialBook.outstanding,
    epoch: f.initialBook.epoch,
    generation: '2',
  };

  // retiredAt = 6000 > scope.expiresAt (5000). Return remains valid after grant expiry
  const pkg = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 6000,
    finalBook,
    claims: [],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  const verified = await verifyHandbackPackage(pkg, {
    pinnedScope: f.scope,
    expectedGrantDigest: f.grantDigest,
    expectedPairingPackageDigest: f.pairingPackageDigest,
    initialBookOpening: f.initialBook,
    minRevision: 5,
    recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
  });

  assert.equal(verified.claims.length, 0);
  assert.equal(verified.summary.spent, '0');
  assert.equal(verified.summary.retiredAt, 6000);
});

test('9. Bounded error messages never leak agent secrets or keys', async () => {
  const f = await testFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 50n, redeemed: false });
  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '11050',
    epoch: '6',
    generation: '2',
  };

  const pkg = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  // Decryption with wrong private key
  const wrongKey = await generateX25519KeyPair();
  try {
    await verifyHandbackPackage(pkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: wrongKey.privateKeyHex,
    });
    assert.fail('Should have thrown');
  } catch (err: any) {
    assert(!err.message.includes(f.initialBook.agentSecret), 'Error must not leak agent secret');
    assert(!err.message.includes(f.returnX25519.privateKeyHex), 'Error must not leak return private key');
    assert(!err.message.includes(pkg.encryptedPayload.ciphertext), 'Error must not leak ciphertext');
  }
});

test('10. Strict descriptor capture: valid-field getter returning valid data rejects with 0 invocations on all entrypoints', async () => {
  const f = await testFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 50n, redeemed: false });
  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '11050',
    epoch: '6',
    generation: '2',
  };

  const validPkg = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  // Helper to construct getter property
  function withGetter<T extends object>(target: T, key: string, value: any, counter: { count: number }): any {
    const clone = { ...target };
    Object.defineProperty(clone, key, {
      get() {
        counter.count++;
        return value;
      },
      enumerable: true,
      configurable: true,
    });
    return clone;
  }

  // 10a. createHandbackPackage: getter on options.handbackId
  let count = { count: 0 };
  const getOpt = withGetter({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  }, 'handbackId', randomUUID(), count);
  await assert.rejects(createHandbackPackage(getOpt), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on options.handbackId');

  // 10b. createHandbackPackage: getter on scope.domain
  count = { count: 0 };
  const getScope = withGetter(f.scope, 'domain', f.scope.domain, count);
  await assert.rejects(createHandbackPackage({
    handbackId: randomUUID(),
    scope: getScope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  }), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on scope.domain');

  // 10c. verifyHandbackPackage: getter on expected.minRevision
  count = { count: 0 };
  const getExpected = withGetter({
    pinnedScope: f.scope,
    expectedGrantDigest: f.grantDigest,
    expectedPairingPackageDigest: f.pairingPackageDigest,
    initialBookOpening: f.initialBook,
    minRevision: 5,
    recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
  }, 'minRevision', 5, count);
  await assert.rejects(verifyHandbackPackage(validPkg, getExpected), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on expected.minRevision');

  // 10d. verifyHandbackPackage: getter on pkgInput.spent
  count = { count: 0 };
  const getPkg = withGetter(validPkg, 'spent', validPkg.spent, count);
  await assert.rejects(verifyHandbackPackage(getPkg, {
    pinnedScope: f.scope,
    expectedGrantDigest: f.grantDigest,
    expectedPairingPackageDigest: f.pairingPackageDigest,
    initialBookOpening: f.initialBook,
    minRevision: 5,
    recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
  }), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on pkgInput.spent');

  // 10e. encryptHandbackPayload: getter on options.nonceHex
  const validSummary = extractSummary(validPkg);
  const aadSummary: Omit<AgentHandbackSummary, 'envelopeDigest'> = { ...validSummary };
  delete (aadSummary as any).envelopeDigest;

  count = { count: 0 };
  const getEncOpt = withGetter({
    summary: aadSummary,
    payload: { schema: 'line:agent-handback-payload/v1', grantId: f.scope.grantId, facilityAddress: f.scope.facilityAddress, finalBook, claims: [claim] },
    recipientPublicKeyHex: f.scope.returnPublicKey,
    nonceHex: hex32(),
  }, 'nonceHex', hex32(), count);
  await assert.rejects(encryptHandbackPayload(getEncOpt), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on encrypt options.nonceHex');

  // 10f. decryptHandbackPayload: getter on options.recipientPrivateKeyHex
  count = { count: 0 };
  const getDecOpt = withGetter({
    envelope: validPkg.encryptedPayload,
    summary: aadSummary,
    recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
  }, 'recipientPrivateKeyHex', f.returnX25519.privateKeyHex, count);
  await assert.rejects(decryptHandbackPayload(getDecOpt), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on decrypt options.recipientPrivateKeyHex');

  // 10g. canonicalHandbackPayloadMessage & handbackPayloadDigest: getter on payload.facilityAddress
  count = { count: 0 };
  const getPayload = withGetter({
    schema: 'line:agent-handback-payload/v1',
    grantId: f.scope.grantId,
    facilityAddress: f.scope.facilityAddress,
    finalBook,
    claims: [claim],
  }, 'facilityAddress', f.scope.facilityAddress, count);
  assert.throws(() => canonicalHandbackPayloadMessage(getPayload), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on canonicalHandbackPayloadMessage');
  await assert.rejects(handbackPayloadDigest(getPayload), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on handbackPayloadDigest');

  // 10h. canonicalHandbackEnvelopeMessage & handbackEnvelopeDigest: getter on envelope.nonce
  count = { count: 0 };
  const getEnv = withGetter(validPkg.encryptedPayload, 'nonce', validPkg.encryptedPayload.nonce, count);
  assert.throws(() => canonicalHandbackEnvelopeMessage(getEnv), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on canonicalHandbackEnvelopeMessage');
  await assert.rejects(handbackEnvelopeDigest(getEnv), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on handbackEnvelopeDigest');

  // 10i. createHandbackAad: getter on summary.spent
  count = { count: 0 };
  const getSummary = withGetter(aadSummary, 'spent', aadSummary.spent, count);
  assert.throws(() => createHandbackAad(getSummary, validPkg.encryptedPayload), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on createHandbackAad');

  // 10j. handbackSummaryMessage: getter on summary.domain
  count = { count: 0 };
  const getSummMsg = withGetter(validSummary, 'domain', validSummary.domain, count);
  assert.throws(() => handbackSummaryMessage(getSummMsg), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on handbackSummaryMessage');

  // 10k. signHandbackSummary: getter on summary.generation
  count = { count: 0 };
  const getSignSumm = withGetter(validSummary, 'generation', validSummary.generation, count);
  await assert.rejects(signHandbackSummary(getSignSumm, f.runnerSigningKey), /accessors/);
  assert.equal(count.count, 0, 'Getter must not be invoked on signHandbackSummary');
});

test('11. Sparse claims and extra array properties cannot be silently omitted', async () => {
  const f = await testFixture();
  const claim1 = f.createValidClaim({ index: 1, amount: 1000n, fee: 50n, redeemed: false });
  const claim2 = f.createValidClaim({ index: 2, amount: 500n, fee: 20n, redeemed: false });

  // 11a. Sparse array with hole: [claim1, <hole>, claim2]
  const sparseClaims: any[] = [claim1];
  sparseClaims[2] = claim2; // index 1 is a hole, length is 3

  assert.throws(
    () => validateHandbackPayload({
      schema: 'line:agent-handback-payload/v1',
      grantId: f.scope.grantId,
      facilityAddress: f.scope.facilityAddress,
      finalBook: {
        agentSecret: f.initialBook.agentSecret,
        salt: hex32(),
        limit: '1000000',
        outstanding: '11570',
        epoch: '7',
        generation: '2',
      },
      claims: sparseClaims,
    }),
    /sparse arrays or extra array properties are not permitted/,
  );

  // 11b. Extra property attached to array: claims.evil = 'injection'
  const extraClaims = [claim1, claim2];
  (extraClaims as any).evil = 'injection';
  assert.throws(
    () => validateHandbackPayload({
      schema: 'line:agent-handback-payload/v1',
      grantId: f.scope.grantId,
      facilityAddress: f.scope.facilityAddress,
      finalBook: {
        agentSecret: f.initialBook.agentSecret,
        salt: hex32(),
        limit: '1000000',
        outstanding: '11570',
        epoch: '7',
        generation: '2',
      },
      claims: extraClaims,
    }),
    /sparse arrays or extra array properties are not permitted/,
  );

  // 11c. Array element defined as getter accessor with 0 invocations
  let arrGetterInvocations = 0;
  const getterClaims: any[] = [];
  Object.defineProperty(getterClaims, '0', {
    get() {
      arrGetterInvocations++;
      return claim1;
    },
    enumerable: true,
    configurable: true,
  });
  getterClaims.length = 1;

  assert.throws(
    () => validateHandbackPayload({
      schema: 'line:agent-handback-payload/v1',
      grantId: f.scope.grantId,
      facilityAddress: f.scope.facilityAddress,
      finalBook: {
        agentSecret: f.initialBook.agentSecret,
        salt: hex32(),
        limit: '1000000',
        outstanding: '11050',
        epoch: '6',
        generation: '2',
      },
      claims: getterClaims,
    }),
    /accessors are not permitted on array index 0/,
  );
  assert.equal(arrGetterInvocations, 0, 'Array element getter must never be invoked');
});

test('12. Unknown fields on options, envelope, package, or expected pins are rejected', async () => {
  const f = await testFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 50n, redeemed: false });
  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '11050',
    epoch: '6',
    generation: '2',
  };

  const validPkg = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  // Unknown field on createHandbackPackage options
  await assert.rejects(
    createHandbackPackage({
      handbackId: randomUUID(),
      scope: f.scope,
      grantDigest: f.grantDigest,
      pairingPackageDigest: f.pairingPackageDigest,
      storeRevision: 10,
      retiredAt: 2500,
      finalBook,
      claims: [claim],
      runnerSigningPrivateKey: f.runnerSigningKey,
      nonceHex: hex32(),
      extraOption: 'evil',
    } as any),
    /disallowed or unknown property extraOption/,
  );

  // Unknown field on verifyHandbackPackage expected pins
  await assert.rejects(
    verifyHandbackPackage(validPkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
      extraExpected: 'evil',
    } as any),
    /disallowed or unknown property extraExpected/,
  );

  // Unknown field on envelope
  const badEnv = { ...validPkg.encryptedPayload, evilField: 'evil' };
  assert.throws(() => validateHandbackEnvelope(badEnv), /disallowed or unknown property evilField/);

  // Unknown field on package
  const badPkg = { ...validPkg, evilPackageField: 'evil' };
  await assert.rejects(
    verifyHandbackPackage(badPkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /disallowed or unknown property evilPackageField/,
  );
});

test('13. Independent validation of minRevision, expected digests, and return key derivation', async () => {
  const f = await testFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 50n, redeemed: false });
  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '11050',
    epoch: '6',
    generation: '2',
  };

  const validPkg = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  // 13a. minRevision negative
  await assert.rejects(
    verifyHandbackPackage(validPkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: -1,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /minRevision must be a safe non-negative integer/,
  );

  // 13b. minRevision non-integer
  await assert.rejects(
    verifyHandbackPackage(validPkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 2.5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /minRevision must be a safe non-negative integer/,
  );

  // 13c. minRevision string
  await assert.rejects(
    verifyHandbackPackage(validPkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: '5' as any,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /minRevision must be a safe non-negative integer/,
  );

  // 13d. expectedGrantDigest mismatch with pinned scope
  await assert.rejects(
    verifyHandbackPackage(validPkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: hex32(), // altered
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /expectedGrantDigest mismatch with pinned scope/,
  );

  // 13e. recipientPrivateKey does not derive expected returnPublicKey
  const unrelatedKey = await generateX25519KeyPair();
  await assert.rejects(
    verifyHandbackPackage(validPkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: unrelatedKey.privateKeyHex,
    }),
    /recipientPrivateKey does not derive expected returnPublicKey/,
  );
});

test('14. Low-order X25519 points rejected on recipient, return, and ephemeral keys', async () => {
  const f = await testFixture();
  const lowOrderPoint = '01' + '00'.repeat(31); // RFC 7748 order 8 point

  const payload: AgentHandbackPayload = {
    schema: 'line:agent-handback-payload/v1',
    grantId: f.scope.grantId,
    facilityAddress: f.scope.facilityAddress,
    finalBook: f.initialBook,
    claims: [],
  };

  const validSummary = {
    agentPk: f.scope.agentPk,
    claimsCount: 0,
    domain: f.scope.domain,
    facilityAddress: f.scope.facilityAddress,
    finalBookCommitment: f.scope.bookCommitment,
    generation: f.scope.generation,
    grantDigest: f.grantDigest,
    grantId: f.scope.grantId,
    handbackId: randomUUID(),
    networkId: 'preprod' as const,
    pairingPackageDigest: f.pairingPackageDigest,
    payloadDigest: hex32(),
    reserved: '0' as const,
    retiredAt: 2500,
    returnPublicKey: f.scope.returnPublicKey,
    runnerSigningPublicKey: f.scope.runnerSigningPublicKey,
    sourceFingerprint: f.scope.sourceFingerprint,
    spent: '0',
    storeRevision: 10,
  };

  // 14a. Low-order point in encryptHandbackPayload recipientPublicKeyHex
  await assert.rejects(
    encryptHandbackPayload({
      summary: validSummary,
      payload,
      recipientPublicKeyHex: lowOrderPoint,
      nonceHex: hex32(),
    }),
    /unusable|zero/,
  );

  // 14b. Low-order point in decryptHandbackPayload ephemeralPublicKey
  await assert.rejects(
    decryptHandbackPayload({
      envelope: {
        version: 1,
        purpose: 'line:agent-handback/v1',
        ephemeralPublicKey: lowOrderPoint,
        nonce: hex32(),
        iv: '00'.repeat(12),
        ciphertext: '00'.repeat(16),
      },
      summary: validSummary,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /unusable|zero/,
  );
});

test('15. Bounded caps enforced BEFORE parse and fatal UTF-8 decoding', async () => {
  const f = await testFixture();

  // Create valid envelope and decrypt
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 50n, redeemed: false });
  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '11050',
    epoch: '6',
    generation: '2',
  };

  const payload: AgentHandbackPayload = {
    schema: 'line:agent-handback-payload/v1',
    grantId: f.scope.grantId,
    facilityAddress: f.scope.facilityAddress,
    finalBook,
    claims: [claim],
  };

  const summary = {
    agentPk: f.scope.agentPk,
    claimsCount: 1,
    domain: f.scope.domain,
    facilityAddress: f.scope.facilityAddress,
    finalBookCommitment: toHex(lineStateCommit({
      domain: hexToBytes(f.scope.domain),
      identity: hexToBytes(f.scope.agentPk),
      limit: BigInt(finalBook.limit),
      outstanding: BigInt(finalBook.outstanding),
      epoch: BigInt(finalBook.epoch),
    }, hexToBytes(finalBook.salt))),
    generation: f.scope.generation,
    grantDigest: f.grantDigest,
    grantId: f.scope.grantId,
    handbackId: randomUUID(),
    networkId: 'preprod' as const,
    pairingPackageDigest: f.pairingPackageDigest,
    payloadDigest: await handbackPayloadDigest(payload),
    reserved: '0' as const,
    retiredAt: 2500,
    returnPublicKey: f.scope.returnPublicKey,
    runnerSigningPublicKey: f.scope.runnerSigningPublicKey,
    sourceFingerprint: f.scope.sourceFingerprint,
    spent: '1050',
    storeRevision: 10,
  };

  // 15a. Bad UTF-8 bytes: encrypt invalid UTF-8 bytes and decrypt
  const subtle = assertWebCrypto();
  const ephemKey = (await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
  const recPub = await subtle.importKey('raw', hexToBytes(f.scope.returnPublicKey), { name: 'X25519' }, false, []);
  const sharedBits = await subtle.deriveBits({ name: 'X25519', public: recPub }, ephemKey.privateKey, 256);
  const nonce = hex32();
  const ikm = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const aesKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: hexToBytes(nonce), info: new TextEncoder().encode('line:agent-handback/v1') },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const badUtf8Bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0x00]); // Invalid UTF-8
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const badEnvelopeObj: AgentEncryptedEnvelope = {
    version: 1,
    purpose: 'line:agent-handback/v1',
    ephemeralPublicKey: toHex(new Uint8Array(await subtle.exportKey('raw', ephemKey.publicKey))),
    nonce,
    iv: toHex(iv),
    ciphertext: '00'.repeat(16),
  };
  const aad = createHandbackAad(summary, badEnvelopeObj);
  const badCipherBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    aesKey,
    badUtf8Bytes,
  );
  badEnvelopeObj.ciphertext = toHex(new Uint8Array(badCipherBuf));

  await assert.rejects(
    decryptHandbackPayload({
      envelope: badEnvelopeObj,
      summary,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /Decrypted payload is not valid UTF-8/,
  );

  // 15b. Plaintext cap checked BEFORE JSON parse
  const oversizeBytes = new Uint8Array(MAX_HANDBACK_PLAINTEXT_BYTES + 100);
  oversizeBytes.fill(0x20); // spaces: valid UTF-8, but length > MAX_HANDBACK_PLAINTEXT_BYTES
  const oversizeIv = crypto.getRandomValues(new Uint8Array(12));
  const oversizeEnvelopeObj: AgentEncryptedEnvelope = {
    version: 1,
    purpose: 'line:agent-handback/v1',
    ephemeralPublicKey: toHex(new Uint8Array(await subtle.exportKey('raw', ephemKey.publicKey))),
    nonce,
    iv: toHex(oversizeIv),
    ciphertext: '00'.repeat(16),
  };
  const oversizeAad = createHandbackAad(summary, oversizeEnvelopeObj);
  const oversizeCipherBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: oversizeIv, additionalData: oversizeAad, tagLength: 128 },
    aesKey,
    oversizeBytes,
  );
  oversizeEnvelopeObj.ciphertext = toHex(new Uint8Array(oversizeCipherBuf));

  await assert.rejects(
    decryptHandbackPayload({
      envelope: oversizeEnvelopeObj,
      summary,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /Invalid handback envelope ciphertext/,
  );
});

test('16. Caller mutation during awaited crypto does not corrupt package or verification', async () => {
  const f = await testFixture();
  const claim = f.createValidClaim({ index: 1, amount: 2000n, fee: 100n, redeemed: false });
  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '12100',
    epoch: '6',
    generation: '2',
  };

  // Test mutation of scope and finalBook during createHandbackPackage
  const mutableScope = { ...f.scope };
  const mutableFinalBook = { ...finalBook };
  const mutableClaims = [claim];

  const promise = createHandbackPackage({
    handbackId: randomUUID(),
    scope: mutableScope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook: mutableFinalBook,
    claims: mutableClaims,
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  // Mutate caller objects during execution
  mutableScope.maxSpend = '999999999';
  mutableFinalBook.outstanding = '55555555';
  mutableClaims.push(f.createValidClaim({ index: 2, amount: 100n, fee: 10n, redeemed: false }));

  const createdPkg = await promise;
  assert.equal(createdPkg.spent, '2100');
  assert.equal(createdPkg.claimsCount, 1);

  // Test mutation of expected pins during verifyHandbackPackage
  const mutableExpected = {
    pinnedScope: { ...f.scope },
    expectedGrantDigest: f.grantDigest,
    expectedPairingPackageDigest: f.pairingPackageDigest,
    initialBookOpening: { ...f.initialBook },
    minRevision: 5,
    recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
  };

  const verifyPromise = verifyHandbackPackage(createdPkg, mutableExpected);
  mutableExpected.minRevision = 999;
  mutableExpected.pinnedScope.maxSpend = '0';

  const verified = await verifyPromise;
  assert.equal(verified.claims.length, 1);
  assert.equal(verified.summary.spent, '2100');
});

test('17. Honest contract: createHandbackPackage rejects wrong signing key or invalid baseline', async () => {
  const f = await testFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 50n, redeemed: false });
  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '11050',
    epoch: '6',
    generation: '2',
  };

  // 17a. Wrong runner signing private key (does not derive scope.runnerSigningPublicKey)
  const wrongSigningKey = L.sampleSigningKey();
  await assert.rejects(
    createHandbackPackage({
      handbackId: randomUUID(),
      scope: f.scope,
      grantDigest: f.grantDigest,
      pairingPackageDigest: f.pairingPackageDigest,
      storeRevision: 10,
      retiredAt: 2500,
      finalBook,
      claims: [claim],
      runnerSigningPrivateKey: wrongSigningKey,
      nonceHex: hex32(),
    }),
    /runnerSigningPrivateKey does not derive scope runnerSigningPublicKey/,
  );

  // 17b. Mismatched finalBook agentSecret
  const wrongAgentBook = { ...finalBook, agentSecret: hex32() };
  await assert.rejects(
    createHandbackPackage({
      handbackId: randomUUID(),
      scope: f.scope,
      grantDigest: f.grantDigest,
      pairingPackageDigest: f.pairingPackageDigest,
      storeRevision: 10,
      retiredAt: 2500,
      finalBook: wrongAgentBook,
      claims: [claim],
      runnerSigningPrivateKey: f.runnerSigningKey,
      nonceHex: hex32(),
    }),
    /finalBook agentSecret does not match scope agentPk/,
  );

  // 17c. Mismatched finalBook generation
  const wrongGenBook = { ...finalBook, generation: '99' };
  await assert.rejects(
    createHandbackPackage({
      handbackId: randomUUID(),
      scope: f.scope,
      grantDigest: f.grantDigest,
      pairingPackageDigest: f.pairingPackageDigest,
      storeRevision: 10,
      retiredAt: 2500,
      finalBook: wrongGenBook,
      claims: [claim],
      runnerSigningPrivateKey: f.runnerSigningKey,
      nonceHex: hex32(),
    }),
    /finalBook generation does not match scope generation/,
  );
});

test('18. Nested toJSON and getter accessors reject with 0 invocations on verify, create, and package entrypoints', async () => {
  const f = await testFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 50n, redeemed: false });
  const finalBook: AgentBookOpeningPayload = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '11050',
    epoch: '6',
    generation: '2',
  };

  const validPkg = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 10,
    retiredAt: 2500,
    finalBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  function makeNestedToJSON<T>(returnValue: T) {
    let count = 0;
    const obj = {
      get toJSON() {
        count++;
        return () => returnValue;
      },
    };
    return { obj, getCount: () => count };
  }

  // 18a. verifyHandbackPackage: nested toJSON on pkgInput.payloadDigest
  const badDigest = makeNestedToJSON(validPkg.payloadDigest);
  const badPkg1 = { ...validPkg, payloadDigest: badDigest.obj };
  await assert.rejects(
    verifyHandbackPackage(badPkg1, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /invalid payloadDigest/,
  );
  assert.equal(badDigest.getCount(), 0, 'Nested toJSON getter must not execute on payloadDigest');

  // 18b. verifyHandbackPackage: nested toJSON on pkgInput.sourceFingerprint
  const badFp = makeNestedToJSON(validPkg.sourceFingerprint);
  const badPkg2 = { ...validPkg, sourceFingerprint: badFp.obj };
  await assert.rejects(
    verifyHandbackPackage(badPkg2, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /invalid sourceFingerprint/,
  );
  assert.equal(badFp.getCount(), 0, 'Nested toJSON getter must not execute on sourceFingerprint');

  // 18c. verifyHandbackPackage: nested toJSON on pkgInput.storeRevision
  const badRev = makeNestedToJSON(validPkg.storeRevision);
  const badPkg3 = { ...validPkg, storeRevision: badRev.obj };
  await assert.rejects(
    verifyHandbackPackage(badPkg3, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /invalid storeRevision/,
  );
  assert.equal(badRev.getCount(), 0, 'Nested toJSON getter must not execute on storeRevision');

  // 18d. verifyHandbackPackage: nested toJSON on pkgInput.encryptedPayload.ciphertext
  const badCipher = makeNestedToJSON(validPkg.encryptedPayload.ciphertext);
  const badPkg4 = {
    ...validPkg,
    encryptedPayload: {
      ...validPkg.encryptedPayload,
      ciphertext: badCipher.obj,
    },
  };
  await assert.rejects(
    verifyHandbackPackage(badPkg4, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /invalid handback envelope ciphertext/i,
  );
  assert.equal(badCipher.getCount(), 0, 'Nested toJSON getter must not execute on envelope ciphertext');

  // 18e. verifyHandbackPackage: nested toJSON on expected.minRevision
  const badExpRev = makeNestedToJSON(5);
  await assert.rejects(
    verifyHandbackPackage(validPkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: badExpRev.obj,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /minRevision must be a safe non-negative integer/,
  );
  assert.equal(badExpRev.getCount(), 0, 'Nested toJSON getter must not execute on expected.minRevision');

  // 18f. verifyHandbackPackage: nested toJSON on expected.expectedGrantDigest
  const badExpGrant = makeNestedToJSON(f.grantDigest);
  await assert.rejects(
    verifyHandbackPackage(validPkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: badExpGrant.obj,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /invalid expectedGrantDigest format/,
  );
  assert.equal(badExpGrant.getCount(), 0, 'Nested toJSON getter must not execute on expected.expectedGrantDigest');

  // 18g. validateHandbackPackage: nested toJSON on envelope nonce and payloadDigest
  const badValDigest = makeNestedToJSON(validPkg.payloadDigest);
  assert.throws(
    () => validateHandbackPackage({ ...validPkg, payloadDigest: badValDigest.obj }),
    /invalid payloadDigest/,
  );
  assert.equal(badValDigest.getCount(), 0, 'Nested toJSON getter must not execute on validateHandbackPackage payloadDigest');

  const badValNonce = makeNestedToJSON(validPkg.encryptedPayload.nonce);
  assert.throws(
    () =>
      validateHandbackPackage({
        ...validPkg,
        encryptedPayload: { ...validPkg.encryptedPayload, nonce: badValNonce.obj },
      }),
    /invalid handback envelope nonce/i,
  );
  assert.equal(badValNonce.getCount(), 0, 'Nested toJSON getter must not execute on validateHandbackPackage envelope nonce');

  // 18h. createHandbackPackage: nested toJSON on options.grantDigest and options.pairingPackageDigest
  const badOptGrant = makeNestedToJSON(f.grantDigest);
  await assert.rejects(
    createHandbackPackage({
      handbackId: randomUUID(),
      scope: f.scope,
      grantDigest: badOptGrant.obj,
      pairingPackageDigest: f.pairingPackageDigest,
      storeRevision: 10,
      retiredAt: 2500,
      finalBook,
      claims: [claim],
      runnerSigningPrivateKey: f.runnerSigningKey,
      nonceHex: hex32(),
    }),
    /invalid grantDigest/i,
  );
  assert.equal(badOptGrant.getCount(), 0, 'Nested toJSON getter must not execute on create options.grantDigest');

  const badOptPairing = makeNestedToJSON(f.pairingPackageDigest);
  await assert.rejects(
    createHandbackPackage({
      handbackId: randomUUID(),
      scope: f.scope,
      grantDigest: f.grantDigest,
      pairingPackageDigest: badOptPairing.obj,
      storeRevision: 10,
      retiredAt: 2500,
      finalBook,
      claims: [claim],
      runnerSigningPrivateKey: f.runnerSigningKey,
      nonceHex: hex32(),
    }),
    /invalid pairingPackageDigest/i,
  );
  assert.equal(badOptPairing.getCount(), 0, 'Nested toJSON getter must not execute on create options.pairingPackageDigest');

  // 18i. createHandbackPackage: nested toJSON in scope and claims
  const badScopeDomain = makeNestedToJSON(f.scope.domain);
  await assert.rejects(
    createHandbackPackage({
      handbackId: randomUUID(),
      scope: { ...f.scope, domain: badScopeDomain.obj },
      grantDigest: f.grantDigest,
      pairingPackageDigest: f.pairingPackageDigest,
      storeRevision: 10,
      retiredAt: 2500,
      finalBook,
      claims: [claim],
      runnerSigningPrivateKey: f.runnerSigningKey,
      nonceHex: hex32(),
    }),
    /invalid agent grant domain/i,
  );
  assert.equal(badScopeDomain.getCount(), 0, 'Nested toJSON getter must not execute on scope domain');

  const badClaimTask = makeNestedToJSON(claim.taskId);
  await assert.rejects(
    createHandbackPackage({
      handbackId: randomUUID(),
      scope: f.scope,
      grantDigest: f.grantDigest,
      pairingPackageDigest: f.pairingPackageDigest,
      storeRevision: 10,
      retiredAt: 2500,
      finalBook,
      claims: [{ ...claim, taskId: badClaimTask.obj }],
      runnerSigningPrivateKey: f.runnerSigningKey,
      nonceHex: hex32(),
    }),
    /invalid taskId/i,
  );
  assert.equal(badClaimTask.getCount(), 0, 'Nested toJSON getter must not execute on claim taskId');
});
