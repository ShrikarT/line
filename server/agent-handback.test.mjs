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
} from '../src/lib/line/encoding.ts';
import {
  generateX25519KeyPair,
  browserPairingPackageDigest,
  createPairingPackage,
  encryptBookOpening,
} from '../src/lib/agent/pairing.ts';
import {
  agentGrantMessage,
  browserAgentGrantDigest,
} from '../src/lib/agent/grant.ts';
import { organizationMessageBytes } from '../src/lib/organization/signing.ts';
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
  handbackPackageDigest,
  handbackPackageCanonicalMessage,
  signHandbackSummary,
  handbackPayloadDigest,
  encryptHandbackPayload,
  handbackEnvelopeDigest,
} from './agent-handback.mjs';

const hex32 = () => randomBytes(32).toString('hex');

async function serverFixture() {
  const issuer = pad32('server-fixture-issuer');
  const merchant = pad32('server-fixture-merchant');
  const agentSecretBytes = pad32('server-fixture-agent-secret');
  const agentSecret = toHex(agentSecretBytes);
  const salt = hex32();
  const nonce = pad32('server-fixture-instance');

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

  const initialBook = {
    agentSecret,
    salt,
    limit: '2000000',
    outstanding: '50000',
    epoch: '10',
    generation: '2',
  };

  const initialCommitment = toHex(
    lineStateCommit(
      {
        domain,
        identity,
        limit: 2000000n,
        outstanding: 50000n,
        epoch: 10n,
      },
      hexToBytes(salt),
    ),
  );

  const scope = {
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
    issuedAt: 2000,
    expiresAt: 10000,
    maxSpend: '500000',
    maxFee: '10000',
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

  function createValidClaim(options) {
    const id = randomUUID();
    const noteNonce = hex32();
    const noteSalt = hex32();
    const quoteCommitment = hex32();
    const drawIdentifier = '00' + hex32();
    const drawTxHash = hex32();

    const preimage = {
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

test('server: full handback creation, canonical package digest and verification', async () => {
  const f = await serverFixture();
  const claim1 = f.createValidClaim({ index: 1, amount: 10000n, fee: 200n, redeemed: true, retainedRedemptionIdentifier: true });
  const claim2 = f.createValidClaim({ index: 2, amount: 5000n, fee: 100n, redeemed: false });
  const claims = [claim1, claim2];

  const totalSpent = 10200n + 5100n; // 15300
  const finalBook = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: (50000n + totalSpent).toString(),
    epoch: (10n + 2n).toString(),
    generation: '2',
  };

  const handbackPackage = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 25,
    retiredAt: 5000,
    finalBook,
    claims,
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  // Verify handbackPackageCanonicalMessage and digest
  const canonicalMsg = handbackPackageCanonicalMessage(handbackPackage);
  assert(canonicalMsg.startsWith('line:agent-handback-package/v1\0'));
  const digest = handbackPackageDigest(handbackPackage);
  assert(/^[0-9a-f]{64}$/.test(digest));

  const verified = await verifyHandbackPackage(handbackPackage, {
    pinnedScope: f.scope,
    expectedGrantDigest: f.grantDigest,
    expectedPairingPackageDigest: f.pairingPackageDigest,
    initialBookOpening: f.initialBook,
    minRevision: 10,
    recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
  });

  assert.equal(verified.claims.length, 2);
  assert.equal(verified.summary.spent, '15300');
  assert.equal(verified.finalBook.outstanding, '65300');
  assert.equal(verified.finalBook.epoch, '12');
});

test('server: 50-claim roundtrip and capacity bounds', async () => {
  const f = await serverFixture();
  const claims = [];
  for (let i = 0; i < 50; i++) {
    claims.push(
      f.createValidClaim({
        index: i + 1,
        amount: 2000n,
        fee: 50n,
        redeemed: i % 3 === 0,
        retainedRedemptionIdentifier: i % 6 === 0,
      }),
    );
  }

  const totalSpent = 50n * 2050n; // 102500
  const finalBook = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: (50000n + totalSpent).toString(),
    epoch: (10n + 50n).toString(),
    generation: '2',
  };

  const handbackPackage = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 80,
    retiredAt: 6000,
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
    minRevision: 20,
    recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
  });

  assert.equal(verified.claims.length, 50);
  assert.equal(verified.summary.claimsCount, 50);
  assert.equal(verified.summary.spent, '102500');
  assert(Buffer.byteLength(JSON.stringify(handbackPackage)) <= MAX_HANDBACK_PACKAGE_BYTES);
});

test('server: stale revision rejection and minRevision guard', async () => {
  const f = await serverFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 10n, redeemed: false });
  const finalBook = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '51010',
    epoch: '11',
    generation: '2',
  };

  const handbackPackage = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 15,
    retiredAt: 3000,
    finalBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  // Rejection when storeRevision <= minRevision
  await assert.rejects(
    verifyHandbackPackage(handbackPackage, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 15, // exactly equals storeRevision: must fail
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /storeRevision not strictly greater than minRevision/,
  );

  await assert.rejects(
    verifyHandbackPackage(handbackPackage, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 20, // greater than storeRevision: must fail
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /storeRevision not strictly greater than minRevision/,
  );
});

test('server: initial book mismatch and unauthorized merchant rejection', async () => {
  const f = await serverFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 10n, redeemed: false });
  const finalBook = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '51010',
    epoch: '11',
    generation: '2',
  };

  const handbackPackage = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 25,
    retiredAt: 3000,
    finalBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  // Mismatched initial book opening
  const wrongInitialBook = { ...f.initialBook, salt: hex32() };
  await assert.rejects(
    verifyHandbackPackage(handbackPackage, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: wrongInitialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /initial book does not match pinned scope bookCommitment/,
  );

  // Unauthorized merchant in claim: createHandbackPackage must refuse to manufacture
  const unauthorizedMerchantClaim = f.createValidClaim({ index: 2, amount: 1000n, fee: 10n, redeemed: false });
  unauthorizedMerchantClaim.merchantPk = hex32();
  await assert.rejects(
    createHandbackPackage({
      handbackId: randomUUID(),
      scope: f.scope,
      grantDigest: f.grantDigest,
      pairingPackageDigest: f.pairingPackageDigest,
      storeRevision: 25,
      retiredAt: 3000,
      finalBook,
      claims: [unauthorizedMerchantClaim],
      runnerSigningPrivateKey: f.runnerSigningKey,
      nonceHex: hex32(),
    }),
    /Claim merchant is not authorized in scope/,
  );

  // When constructed via lower-level functions, verifyHandbackPackage must reject unauthorized merchant
  const badHandbackId = randomUUID();
  const unauthorizedPayload = {
    schema: 'line:agent-handback-payload/v1',
    grantId: f.scope.grantId,
    facilityAddress: f.scope.facilityAddress,
    finalBook,
    claims: [unauthorizedMerchantClaim],
  };
  const validatedBadPayload = validateHandbackPayload(unauthorizedPayload);
  const badPayloadDigest = await handbackPayloadDigest(validatedBadPayload);
  const badFinalCommitment = toHex(
    lineStateCommit(
      {
        domain: hexToBytes(f.scope.domain),
        identity: hexToBytes(f.scope.agentPk),
        limit: BigInt(finalBook.limit),
        outstanding: BigInt(finalBook.outstanding),
        epoch: BigInt(finalBook.epoch),
      },
      hexToBytes(finalBook.salt),
    ),
  );
  const badSummary = {
    agentPk: f.scope.agentPk,
    claimsCount: 1,
    domain: f.scope.domain,
    facilityAddress: f.scope.facilityAddress,
    finalBookCommitment: badFinalCommitment,
    generation: f.scope.generation,
    grantDigest: f.grantDigest,
    grantId: f.scope.grantId,
    handbackId: badHandbackId,
    networkId: 'preprod',
    pairingPackageDigest: f.pairingPackageDigest,
    payloadDigest: badPayloadDigest,
    reserved: '0',
    retiredAt: 3000,
    returnPublicKey: f.scope.returnPublicKey,
    runnerSigningPublicKey: f.scope.runnerSigningPublicKey,
    sourceFingerprint: f.scope.sourceFingerprint,
    spent: '1010',
    storeRevision: 25,
  };
  const badNonce = hex32();
  const badEnvelope = await encryptHandbackPayload({
    summary: badSummary,
    payload: validatedBadPayload,
    recipientPublicKeyHex: f.scope.returnPublicKey,
    nonceHex: badNonce,
  });
  const badEnvelopeDigest = await handbackEnvelopeDigest(badEnvelope);
  const fullBadSummary = { ...badSummary, envelopeDigest: badEnvelopeDigest };
  const badRunnerSig = signHandbackSummary(fullBadSummary, f.runnerSigningKey);
  const unauthorizedMerchantPkg = {
    schema: 'line:agent-handback-package/v1',
    ...fullBadSummary,
    encryptedPayload: badEnvelope,
    runnerSignature: badRunnerSig,
  };

  await assert.rejects(
    verifyHandbackPackage(unauthorizedMerchantPkg, {
      pinnedScope: f.scope,
      expectedGrantDigest: f.grantDigest,
      expectedPairingPackageDigest: f.pairingPackageDigest,
      initialBookOpening: f.initialBook,
      minRevision: 5,
      recipientPrivateKeyHex: f.returnX25519.privateKeyHex,
    }),
    /claim merchant not authorized in scope/,
  );
});

test('server: handbackPackageCanonicalMessage descriptor capture rejects accessors with 0 invocations, unknown fields, and oversize packages', async () => {
  const f = await serverFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 10n, redeemed: false });
  const finalBook = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '51010',
    epoch: '11',
    generation: '2',
  };

  const validPkg = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 25,
    retiredAt: 3000,
    finalBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  // Getter accessor on pkg.handbackId must reject with 0 invocations
  let count = 0;
  const getterPkg = { ...validPkg };
  Object.defineProperty(getterPkg, 'handbackId', {
    get() {
      count++;
      return validPkg.handbackId;
    },
    enumerable: true,
    configurable: true,
  });
  assert.throws(() => handbackPackageCanonicalMessage(getterPkg), /accessors/);
  assert.equal(count, 0, 'Getter on handbackPackageCanonicalMessage input must not be invoked');
  assert.throws(() => handbackPackageDigest(getterPkg), /accessors/);
  assert.equal(count, 0, 'Getter on handbackPackageDigest input must not be invoked');

  // Unknown field on pkg
  const unknownFieldPkg = { ...validPkg, evilProperty: 'injected' };
  assert.throws(() => handbackPackageCanonicalMessage(unknownFieldPkg), /disallowed or unknown property/);

  // Symbol property on pkg
  const symbolPkg = { ...validPkg };
  const sym = Symbol('evil');
  symbolPkg[sym] = 'evil';
  assert.throws(() => handbackPackageCanonicalMessage(symbolPkg), /symbol properties are not permitted/);
});

test('server: signHandbackSummary descriptor capture rejects accessors with 0 invocations and invalid signing keys', async () => {
  const f = await serverFixture();
  const validSummary = {
    agentPk: f.scope.agentPk,
    claimsCount: 0,
    domain: f.scope.domain,
    envelopeDigest: hex32(),
    facilityAddress: f.scope.facilityAddress,
    finalBookCommitment: f.scope.bookCommitment,
    generation: f.scope.generation,
    grantDigest: f.grantDigest,
    grantId: f.scope.grantId,
    handbackId: randomUUID(),
    networkId: 'preprod',
    pairingPackageDigest: f.pairingPackageDigest,
    payloadDigest: hex32(),
    reserved: '0',
    retiredAt: 3000,
    returnPublicKey: f.scope.returnPublicKey,
    runnerSigningPublicKey: f.scope.runnerSigningPublicKey,
    sourceFingerprint: f.scope.sourceFingerprint,
    spent: '0',
    storeRevision: 10,
  };

  // Getter accessor on summary.domain must reject with 0 invocations
  let count = 0;
  const getterSummary = { ...validSummary };
  Object.defineProperty(getterSummary, 'domain', {
    get() {
      count++;
      return validSummary.domain;
    },
    enumerable: true,
    configurable: true,
  });
  assert.throws(() => signHandbackSummary(getterSummary, f.runnerSigningKey), /accessors/);
  assert.equal(count, 0, 'Getter on signHandbackSummary input must not be invoked');

  // Invalid runner signing key format
  assert.throws(() => signHandbackSummary(validSummary, 'invalid-key'), /Invalid runnerSigningKey format/);
});

test('server: handbackPackageCanonicalMessage and handbackPackageDigest reject nested toJSON getters with 0 invocations', async () => {
  const f = await serverFixture();
  const claim = f.createValidClaim({ index: 1, amount: 1000n, fee: 10n, redeemed: false });
  const finalBook = {
    agentSecret: f.initialBook.agentSecret,
    salt: hex32(),
    limit: f.initialBook.limit,
    outstanding: '51010',
    epoch: '11',
    generation: '2',
  };

  const validPkg = await createHandbackPackage({
    handbackId: randomUUID(),
    scope: f.scope,
    grantDigest: f.grantDigest,
    pairingPackageDigest: f.pairingPackageDigest,
    storeRevision: 25,
    retiredAt: 3000,
    finalBook,
    claims: [claim],
    runnerSigningPrivateKey: f.runnerSigningKey,
    nonceHex: hex32(),
  });

  function makeNestedToJSON(returnValue) {
    let count = 0;
    const obj = {
      get toJSON() {
        count++;
        return () => returnValue;
      },
    };
    return { obj, getCount: () => count };
  }

  // 1. handbackPackageCanonicalMessage: nested toJSON on payloadDigest
  const badDigest = makeNestedToJSON(validPkg.payloadDigest);
  assert.throws(
    () => handbackPackageCanonicalMessage({ ...validPkg, payloadDigest: badDigest.obj }),
    /invalid payloadDigest/,
  );
  assert.equal(badDigest.getCount(), 0, 'Nested toJSON getter must not execute on canonicalMessage payloadDigest');

  // 2. handbackPackageCanonicalMessage: nested toJSON on encryptedPayload.ciphertext
  const badCipher = makeNestedToJSON(validPkg.encryptedPayload.ciphertext);
  assert.throws(
    () =>
      handbackPackageCanonicalMessage({
        ...validPkg,
        encryptedPayload: { ...validPkg.encryptedPayload, ciphertext: badCipher.obj },
      }),
    /invalid handback envelope ciphertext/i,
  );
  assert.equal(badCipher.getCount(), 0, 'Nested toJSON getter must not execute on canonicalMessage envelope ciphertext');

  // 3. handbackPackageCanonicalMessage: nested toJSON on storeRevision
  const badRev = makeNestedToJSON(validPkg.storeRevision);
  assert.throws(
    () => handbackPackageCanonicalMessage({ ...validPkg, storeRevision: badRev.obj }),
    /invalid storeRevision/,
  );
  assert.equal(badRev.getCount(), 0, 'Nested toJSON getter must not execute on canonicalMessage storeRevision');

  // 4. handbackPackageDigest: nested toJSON on sourceFingerprint
  const badFp = makeNestedToJSON(validPkg.sourceFingerprint);
  assert.throws(
    () => handbackPackageDigest({ ...validPkg, sourceFingerprint: badFp.obj }),
    /invalid sourceFingerprint/,
  );
  assert.equal(badFp.getCount(), 0, 'Nested toJSON getter must not execute on packageDigest sourceFingerprint');

  // 5. handbackPackageDigest: nested toJSON on encryptedPayload.nonce
  const badNonce = makeNestedToJSON(validPkg.encryptedPayload.nonce);
  assert.throws(
    () =>
      handbackPackageDigest({
        ...validPkg,
        encryptedPayload: { ...validPkg.encryptedPayload, nonce: badNonce.obj },
      }),
    /invalid handback envelope nonce/i,
  );
  assert.equal(badNonce.getCount(), 0, 'Nested toJSON getter must not execute on packageDigest envelope nonce');

  // 6. validateHandbackPackage: nested toJSON on generation
  const badGen = makeNestedToJSON(validPkg.generation);
  assert.throws(
    () => validateHandbackPackage({ ...validPkg, generation: badGen.obj }),
    /invalid generation/,
  );
  assert.equal(badGen.getCount(), 0, 'Nested toJSON getter must not execute on validateHandbackPackage generation');
});
