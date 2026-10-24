import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as L from '@midnight-ntwrk/ledger-v8';
import { bech32m } from '@scure/base';
import {
  agentId,
  lineStateCommit,
  quoteCommit,
  toHex,
  hexToBytes,
} from '../src/lib/line/encoding.ts';
import { encodeQuote, encodeNote, decodeNote } from '../src/lib/organization/transfers.ts';
import { AgentStore } from '../server/agent-store.mjs';
import {
  AgentRunner,
  AgentRunnerError,
  validateAgentResult,
} from '../server/agent-runner.mjs';
import {
  agentGrantMessage,
  agentGrantDigest,
  agentInputDigest,
  requireAgentBudget,
} from '../server/agent-authorization.mjs';
import { decodeAgentDraw } from '../server/agent-midnight.mjs';
import { organizationSigningBytes } from '../server/organization-auth.mjs';

function createHex(fillByte = 0x11): string {
  return Buffer.alloc(32, fillByte).toString('hex');
}

const PASSWORD = 'test-storage-password-16chars';
const BINDING = createHex(0xaa);
const SOURCE_FINGERPRINT = createHex(0xbb);

// Historical proven public draw transaction fixture
const rawHistoricalDraw = readFileSync(
  new URL('../tests/fixtures/private-offer-public-pairs/6-draw.proven-public-tx.bin', import.meta.url),
);
const historicalTx = L.Transaction.deserialize('signature', 'proof', 'binding', rawHistoricalDraw);
const FIXTURE_FACILITY_ADDRESS = [...historicalTx.intents.values()].flatMap(i => i.actions)[0].address;
const HISTORICAL_DRAW_TX_HEX = rawHistoricalDraw.toString('hex');
const HISTORICAL_DRAW_IDENTIFIER = historicalTx.identifiers().at(-1)!;
const HISTORICAL_DRAW_TX_HASH = historicalTx.transactionHash();

function createSignedHistoricalDraw(facilityAddress: string, sourceFingerprint: string) {
  return {
    circuit: 'draw' as const,
    facilityAddress,
    sourceFingerprint,
    identifier: HISTORICAL_DRAW_IDENTIFIER,
    transaction: HISTORICAL_DRAW_TX_HEX,
    transactionHash: HISTORICAL_DRAW_TX_HASH,
  };
}

function createTestQuote(options: {
  facilityAddress: string;
  domain: string;
  merchantPk: string;
  amount: bigint;
  generation: bigint;
  feeFlat?: bigint;
  feeBps?: bigint;
  expiry?: bigint;
}) {
  const invoiceId = createHex(0x22);
  const quoteNonce = createHex(0x33);
  const expiry = options.expiry ?? 2_000_000_000n;
  const feeFlat = options.feeFlat ?? 500n;
  const feeBps = options.feeBps ?? 100n;

  const commitment = toHex(
    quoteCommit({
      merchantPk: hexToBytes(options.merchantPk),
      invoiceId: hexToBytes(invoiceId),
      nonce: hexToBytes(quoteNonce),
      amount: options.amount,
      expiry,
      generation: options.generation,
      domain: hexToBytes(options.domain),
      feeFlat,
      feeBps,
    }),
  );

  return {
    contractAddress: options.facilityAddress,
    domain: options.domain,
    merchantPk: options.merchantPk,
    invoiceId,
    quoteNonce,
    amount: options.amount,
    expiry,
    generation: options.generation,
    feeFlat,
    feeBps,
    quoteCommitment: commitment,
  };
}

async function setupTestEnvironment(overrides?: {
  writerFence?: (scope: any) => Promise<void>;
  customAdapter?: Partial<any>;
  customSupplier?: Partial<any>;
  now?: () => number;
}) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-runner-test-'));
  const store = await AgentStore.open({
    directory: dir,
    password: PASSWORD,
    binding: BINDING,
    sourceFingerprint: SOURCE_FINGERPRINT,
  });

  const ownerSigningKey = L.sampleSigningKey();
  const ownerVerifyingKey = L.signatureVerifyingKey(ownerSigningKey);
  const ownerAddress = bech32m.encodeFromBytes(
    'mn_addr_preprod',
    Buffer.from(L.addressFromKey(ownerVerifyingKey), 'hex'),
  );

  const facilityAddress = FIXTURE_FACILITY_ADDRESS;
  const domain = createHex(0x12);
  const agentSecret = createHex(0x13);
  const agentPk = toHex(agentId(hexToBytes(agentSecret)));
  const merchantPk = createHex(0x14);
  const runnerPublicKey = createHex(0x15);
  const runnerSigningPublicKey = createHex(0x1a);
  const returnPublicKey = createHex(0x1b);
  const sourceFingerprint = SOURCE_FINGERPRINT;

  const initialSalt = createHex(0x16);
  const book = {
    facilityAddress,
    domain,
    agentSecret,
    agentPk,
    salt: initialSalt,
    limit: 500_000n,
    outstanding: 0n,
    epoch: 0n,
    generation: 2n,
  };

  const bookCommitment = toHex(
    lineStateCommit(
      {
        domain: hexToBytes(domain),
        identity: hexToBytes(agentPk),
        limit: book.limit,
        outstanding: book.outstanding,
        epoch: book.epoch,
      },
      hexToBytes(book.salt),
    ),
  );

  const grantId = randomUUID();
  const scope = {
    schema: 'line:agent-grant/v1',
    grantId,
    networkId: 'preprod',
    facilityAddress,
    domain,
    sourceFingerprint,
    ownerAddress,
    runnerOrigin: 'http://127.0.0.1:8765',
    runnerPublicKey,
    runnerSigningPublicKey,
    returnPublicKey,
    agentPk,
    generation: '2',
    bookCommitment,
    nonce: createHex(0x17),
    issuedAt: 1_000,
    expiresAt: 1_000 + 86400_000,
    maxSpend: '100000',
    maxFee: '5000',
    allowedServices: ['line-doc-extract-v1'],
    allowedMerchants: [merchantPk],
  };

  const proof = {
    verifyingKey: ownerVerifyingKey,
    signature: L.signData(ownerSigningKey, organizationSigningBytes(agentGrantMessage(scope))),
  };

  const pairing = {
    networkId: 'preprod',
    facilityAddress,
    domain,
    sourceFingerprint,
    ownerAddress,
    runnerOrigin: 'http://127.0.0.1:8765',
    runnerPublicKey,
    runnerSigningPublicKey,
    returnPublicKey,
    agentPk,
    generation: '2',
    bookCommitment,
  };

  const defaultAdapter = {
    inspect: async () => {},
    prepareDraw: async () => createSignedHistoricalDraw(facilityAddress, sourceFingerprint),
    submitOriginal: async (pending: any) => pending.identifier,
    reconcile: async (pending: any) => ({
      circuit: 'draw',
      contractAddress: pending.facilityAddress,
      identifier: pending.identifier,
      txHash: createHex(0x20),
      blockHeight: 3_100_050,
      blockHash: createHex(0x21),
      sourceFingerprint,
      outcome: 'success',
      finalizedHead: 3_100_055,
    }),
    verifyRedemption: async (order: any, note: any) => ({
      circuit: 'redeemDraw',
      contractAddress: note.contractAddress,
      txHash: createHex(0x22),
      blockHeight: 3_100_060,
      blockHash: createHex(0x23),
      sourceFingerprint,
      outcome: 'success',
      finalizedHead: 3_100_065,
      recipient: createHex(0x24),
      assetColor: createHex(0x00),
      amount: note.amount.toString(),
      noteCommitment: note.noteCommitment,
    }),
  };

  const adapter = { ...defaultAdapter, ...overrides?.customAdapter };

  const defaultSupplier = {
    createOrder: async ({ id, contractAddress, service, document, objective }: any) => {
      const quote = createTestQuote({
        facilityAddress: contractAddress,
        domain,
        merchantPk,
        amount: 25_000n,
        generation: 2n,
        feeFlat: 500n,
        feeBps: 100n,
      });
      return {
        id,
        contractAddress,
        service,
        inputDigest: createHash('sha256').update(document).digest('hex'),
        objectiveDigest: createHash('sha256').update(objective).digest('hex'),
        quotePackage: encodeQuote(quote),
      };
    },
    submitClaim: async ({ id }: any) => ({ id }),
    getOrder: async (id: string) => {
      return {
        id,
        contractAddress: facilityAddress,
        service: 'line-doc-extract-v1',
        deliveryStatus: 'delivered',
        receipts: [
          {
            circuit: 'redeemDraw',
            contractAddress: facilityAddress,
            txHash: createHex(0x22),
            blockHeight: 3_100_060,
          },
        ],
        result: {
          service: 'line-doc-extract-v1',
          version: 1,
          inputDigest: createHash('sha256').update('Test document text').digest('hex'),
          objectiveDigest: createHash('sha256').update('Extract key facts').digest('hex'),
          outcome: 'evidence_found',
          passages: [
            {
              start: 0,
              end: 18,
              text: 'Test document text',
              headingPath: ['Heading 1'],
            },
          ],
        },
      };
    },
  };

  const supplier = { ...defaultSupplier, ...overrides?.customSupplier };

  const assertWriterFence = overrides?.writerFence ?? (async () => {});
  const now = overrides?.now ?? (() => 10_000);

  const runner = await AgentRunner.create({
    store,
    adapter,
    supplier,
    pairing,
    assertWriterFence,
    now,
  });

  return {
    dir,
    store,
    runner,
    adapter,
    supplier,
    book,
    scope,
    proof,
    pairing,
    ownerSigningKey,
    facilityAddress,
    domain,
    merchantPk,
    now,
    cleanup: async () => {
      await runner.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// ============================================================================
// Scenario 1: Unauthorized / missing browser fence refuses activation
// ============================================================================
test('1. Unauthorized or missing browser fence refuses activation', async () => {
  // A. Missing writer fence throws
  const envNoFence = await setupTestEnvironment({
    writerFence: async () => {
      throw new AgentRunnerError('The browser delegation fence has not been verified.');
    },
  });
  try {
    await assert.rejects(
      envNoFence.runner.activateDelegation({
        scope: envNoFence.scope,
        proof: envNoFence.proof,
        book: envNoFence.book,
      }),
      /browser delegation fence has not been verified/,
    );
    // Verify store has no grants or books committed
    assert.equal(envNoFence.store.listGrants().length, 0);
    assert.equal(envNoFence.store.listBooks().length, 0);
  } finally {
    await envNoFence.cleanup();
  }

  // B. Invalid owner signature throws
  const env = await setupTestEnvironment();
  try {
    const alienKey = L.sampleSigningKey();
    const alienProof = {
      verifyingKey: L.signatureVerifyingKey(alienKey),
      signature: L.signData(alienKey, organizationSigningBytes(agentGrantMessage(env.scope))),
    };
    await assert.rejects(
      env.runner.activateDelegation({
        scope: env.scope,
        proof: alienProof,
        book: env.book,
      }),
      /signature is invalid/,
    );
    assert.equal(env.store.listGrants().length, 0);
    assert.equal(env.store.listBooks().length, 0);

    // C. Valid activation succeeds and commits delegation
    const activated = await env.runner.activateDelegation({
      scope: env.scope,
      proof: env.proof,
      book: env.book,
    });
    assert.equal(activated.grantId, env.scope.grantId);
    assert.match(activated.digest, /^[0-9a-f]{64}$/);
    assert.equal(env.store.listGrants().length, 1);
    assert.equal(env.store.listBooks().length, 1);
  } finally {
    await env.cleanup();
  }
});

// ============================================================================
// Scenario 2: Concurrent duplicate idempotency sends exactly one draw
// ============================================================================
test('2. Concurrent duplicate idempotency sends exactly one draw', async () => {
  let createOrderCalls = 0;
  let prepareDrawCalls = 0;

  const env = await setupTestEnvironment({
    customSupplier: {
      createOrder: async ({ id, contractAddress, service, document, objective }: any) => {
        createOrderCalls++;
        const quote = createTestQuote({
          facilityAddress: contractAddress,
          domain: env.domain,
          merchantPk: env.merchantPk,
          amount: 25_000n,
          generation: 2n,
        });
        return {
          id,
          contractAddress,
          service,
          inputDigest: createHash('sha256').update(document).digest('hex'),
          objectiveDigest: createHash('sha256').update(objective).digest('hex'),
          quotePackage: encodeQuote(quote),
        };
      },
    },
    customAdapter: {
      prepareDraw: async () => {
        prepareDrawCalls++;
        return createSignedHistoricalDraw(env.facilityAddress, SOURCE_FINGERPRINT);
      },
    },
  });

  try {
    await env.runner.activateDelegation({
      scope: env.scope,
      proof: env.proof,
      book: env.book,
    });

    const orderId = randomUUID();
    const taskRequest = {
      orderId,
      grantId: env.scope.grantId,
      facilityAddress: env.facilityAddress,
      serviceId: 'line-doc-extract-v1',
      document: 'Test document text',
      objective: 'Extract key facts',
    };

    // Dispatch two concurrent submitTask requests with the exact same orderId
    const [task1, task2] = await Promise.all([
      env.runner.submitTask(taskRequest),
      env.runner.submitTask(taskRequest),
    ]);

    assert.equal(task1?.id, orderId);
    assert.equal(task2?.id, orderId);
    assert.equal(createOrderCalls, 1);
    assert.equal(prepareDrawCalls, 1);
    assert.equal(env.store.listTasks().length, 1);
  } finally {
    await env.cleanup();
  }
});

// ============================================================================
// Scenario 3: Changed grant or task input rejected for same order ID
// ============================================================================
test('3. Changed grant or task input rejected for same order ID', async () => {
  const env = await setupTestEnvironment();
  try {
    await env.runner.activateDelegation({
      scope: env.scope,
      proof: env.proof,
      book: env.book,
    });

    const orderId = randomUUID();
    await env.runner.submitTask({
      orderId,
      grantId: env.scope.grantId,
      facilityAddress: env.facilityAddress,
      serviceId: 'line-doc-extract-v1',
      document: 'Original document text',
      objective: 'Original objective',
    });

    // Same orderId but changed document text
    await assert.rejects(
      env.runner.submitTask({
        orderId,
        grantId: env.scope.grantId,
        facilityAddress: env.facilityAddress,
        serviceId: 'line-doc-extract-v1',
        document: 'Changed document text',
        objective: 'Original objective',
      }),
      /This order ID is already bound to different terms/,
    );

    // Same orderId but changed objective
    await assert.rejects(
      env.runner.submitTask({
        orderId,
        grantId: env.scope.grantId,
        facilityAddress: env.facilityAddress,
        serviceId: 'line-doc-extract-v1',
        document: 'Original document text',
        objective: 'Changed objective',
      }),
      /This order ID is already bound to different terms/,
    );

    // Same orderId but changed facilityAddress
    await assert.rejects(
      env.runner.submitTask({
        orderId,
        grantId: env.scope.grantId,
        facilityAddress: createHex(0x99),
        serviceId: 'line-doc-extract-v1',
        document: 'Original document text',
        objective: 'Original objective',
      }),
      /This order ID is already bound to different terms/,
    );
  } finally {
    await env.cleanup();
  }
});

// ============================================================================
// Scenario 4: Pending signed exact bytes + candidate + task + budget reservation
// survive restart and never resubmit
// ============================================================================
test('4. Pending signed exact bytes, candidate, and budget reservation survive restart and never resubmit', async () => {
  let submitOriginalCalls = 0;

  const env = await setupTestEnvironment({
    customAdapter: {
      submitOriginal: async (pending: any) => {
        submitOriginalCalls++;
        // Simulate network disconnect / uncertain submission
        throw new Error('Network timeout during submit');
      },
    },
  });

  try {
    await env.runner.activateDelegation({
      scope: env.scope,
      proof: env.proof,
      book: env.book,
    });

    const orderId = randomUUID();
    const task = await env.runner.submitTask({
      orderId,
      grantId: env.scope.grantId,
      facilityAddress: env.facilityAddress,
      serviceId: 'line-doc-extract-v1',
      document: 'Restart test doc',
      objective: 'Verify durability',
    });

    assert.equal(task?.status, 'payment_uncertain');
    assert.equal(submitOriginalCalls, 1);

    // Check store state before closing
    const pendingBefore = env.store.getPending();
    assert.notEqual(pendingBefore, null);
    assert.equal(pendingBefore?.identifier, HISTORICAL_DRAW_IDENTIFIER);
    assert.equal(pendingBefore?.transaction, HISTORICAL_DRAW_TX_HEX);
    assert.equal(pendingBefore?.disposition, 'submission-attempted');
    const grantBefore = env.store.getGrant(env.scope.grantId);
    assert.equal(grantBefore?.reserved, pendingBefore?.charge);

    // Close runner and store
    await env.runner.close();

    // Reopen store from disk (process restart)
    const reopenedStore = await AgentStore.open({
      directory: env.dir,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });

    // Reopened runner runs validateRestore() during initialization
    const restartedRunner = await AgentRunner.create({
      store: reopenedStore,
      adapter: {
        ...env.adapter,
        submitOriginal: async () => {
          submitOriginalCalls++;
          throw new Error('Should not resubmit on restart');
        },
      },
      supplier: env.supplier,
      pairing: env.pairing,
      assertWriterFence: async () => {},
      now: env.now,
    });

    // Continue task: should reconcile the retained pending draw without resubmitting
    const continued = await restartedRunner.continueTask(orderId);
    assert.equal(submitOriginalCalls, 1); // was NOT called again!
    assert.equal(continued?.paymentStatus, 'paid');
    assert.equal(reopenedStore.getPending(), null);

    await restartedRunner.close();
  } finally {
    await rm(env.dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Scenario 5: Unrelated identifier, circuit, release, or partial receipt cannot promote
// ============================================================================
test('5. Unrelated identifier, circuit, release, or partial receipt cannot promote', async () => {
  let receiptToReturn: any;

  const env = await setupTestEnvironment({
    customAdapter: {
      submitOriginal: async () => {
        throw new Error('Simulate uncertain submission to halt before auto-reconcile');
      },
      reconcile: async () => receiptToReturn,
    },
  });

  try {
    await env.runner.activateDelegation({
      scope: env.scope,
      proof: env.proof,
      book: env.book,
    });

    const orderId = randomUUID();
    await env.runner.submitTask({
      orderId,
      grantId: env.scope.grantId,
      facilityAddress: env.facilityAddress,
      serviceId: 'line-doc-extract-v1',
      document: 'Testing reconciliation invariants',
      objective: 'Reject bad receipts',
    });

    const pending = env.store.getPending()!;
    assert.notEqual(pending, null);

    // A. Mismatched identifier rejected
    receiptToReturn = {
      circuit: 'draw',
      contractAddress: env.facilityAddress,
      identifier: '00' + createHex(0x99), // wrong identifier
      txHash: createHex(0x30),
      blockHeight: 3_100_050,
      sourceFingerprint: SOURCE_FINGERPRINT,
      outcome: 'success',
    };
    await assert.rejects(
      env.runner.continueTask(orderId),
      /exact finalized draw outcome has not been verified/,
    );
    assert.notEqual(env.store.getPending(), null);
    assert.equal(env.store.getGrant(env.scope.grantId)?.spent, 0n);

    // B. Mismatched circuit rejected
    receiptToReturn = {
      circuit: 'redeemDraw', // wrong circuit
      contractAddress: env.facilityAddress,
      identifier: pending.identifier,
      txHash: createHex(0x30),
      blockHeight: 3_100_050,
      sourceFingerprint: SOURCE_FINGERPRINT,
      outcome: 'success',
    };
    await assert.rejects(
      env.runner.continueTask(orderId),
      /exact finalized draw outcome has not been verified/,
    );

    // C. Mismatched release / sourceFingerprint rejected
    receiptToReturn = {
      circuit: 'draw',
      contractAddress: env.facilityAddress,
      identifier: pending.identifier,
      txHash: createHex(0x30),
      blockHeight: 3_100_050,
      sourceFingerprint: createHex(0x99), // wrong fingerprint
      outcome: 'success',
    };
    await assert.rejects(
      env.runner.continueTask(orderId),
      /exact finalized draw outcome has not been verified/,
    );

    // D. Partial / invalid receipt (non-positive blockHeight) rejected
    receiptToReturn = {
      circuit: 'draw',
      contractAddress: env.facilityAddress,
      identifier: pending.identifier,
      txHash: createHex(0x30),
      blockHeight: 0, // invalid blockHeight
      sourceFingerprint: SOURCE_FINGERPRINT,
      outcome: 'success',
    };
    await assert.rejects(
      env.runner.continueTask(orderId),
      /exact finalized draw outcome has not been verified/,
    );

    // E. Invalid outcome rejected
    receiptToReturn = {
      circuit: 'draw',
      contractAddress: env.facilityAddress,
      identifier: pending.identifier,
      txHash: createHex(0x30),
      blockHeight: 3_100_050,
      sourceFingerprint: SOURCE_FINGERPRINT,
      outcome: 'unconfirmed', // invalid outcome
    };
    await assert.rejects(
      env.runner.continueTask(orderId),
      /exact finalized draw outcome has not been verified/,
    );
  } finally {
    await env.cleanup();
  }
});

// ============================================================================
// Scenario 6: Exact success promotes atomic book/grant/claim transition and
// claim_authorized is NOT marked paid
// ============================================================================
test('6. Exact success promotes atomic book, grant, and claim transition, and claim_authorized is NOT marked paid', async () => {
  let deliveryHalted = false;

  const env = await setupTestEnvironment({
    customSupplier: {
      submitClaim: async () => {
        deliveryHalted = true;
        // Halt right after draw reconciliation so we can inspect intermediate claim_authorized state
        throw new Error('Halt at claim submission for state inspection');
      },
    },
  });

  try {
    await env.runner.activateDelegation({
      scope: env.scope,
      proof: env.proof,
      book: env.book,
    });

    const orderId = randomUUID();
    const task = await env.runner.submitTask({
      orderId,
      grantId: env.scope.grantId,
      facilityAddress: env.facilityAddress,
      serviceId: 'line-doc-extract-v1',
      document: 'Intermediate state verification document',
      objective: 'Check claim_authorized',
    });

    assert.equal(deliveryHalted, true);
    // Task status after claim handoff error is redemption_uncertain, but task in store has claimPackage
    const storedTask = env.store.getTask(orderId)!;
    assert.notEqual(storedTask.claimPackage, null);
    assert.equal(storedTask.paymentStatus, 'authorized'); // NOT 'paid'!
    assert.notEqual(storedTask.paymentStatus, 'paid');

    // Grant reserved was decremented and spent was incremented
    const grant = env.store.getGrant(env.scope.grantId)!;
    assert.equal(grant.reserved, 0n);
    assert.ok(grant.spent > 0n);

    // Book was atomically updated to candidate book
    const book = env.store.getBook(env.facilityAddress)!;
    assert.equal(book.epoch, 1n);
    assert.ok(book.outstanding > 0n);

    // Pending draw was cleared
    assert.equal(env.store.getPending(), null);
  } finally {
    await env.cleanup();
  }
});

// ============================================================================
// Scenario 7: Exact total failure releases reservation but preserves original draw evidence
// ============================================================================
test('7. Exact total failure releases reservation but preserves original draw evidence', async () => {
  const env = await setupTestEnvironment({
    customAdapter: {
      reconcile: async (pending: any) => ({
        circuit: 'draw',
        contractAddress: pending.facilityAddress,
        identifier: pending.identifier,
        txHash: createHex(0x40),
        blockHeight: 3_100_050,
        blockHash: createHex(0x41),
        sourceFingerprint: SOURCE_FINGERPRINT,
        outcome: 'failure', // Exact on-chain failure
        finalizedHead: 3_100_055,
      }),
    },
  });

  try {
    await env.runner.activateDelegation({
      scope: env.scope,
      proof: env.proof,
      book: env.book,
    });

    const orderId = randomUUID();
    const task = await env.runner.submitTask({
      orderId,
      grantId: env.scope.grantId,
      facilityAddress: env.facilityAddress,
      serviceId: 'line-doc-extract-v1',
      document: 'Testing on-chain draw failure',
      objective: 'Verify reservation release',
    });

    assert.equal(task?.status, 'failed');
    assert.equal(task?.paymentStatus, 'failed');
    assert.match(task?.error!, /original draw failed in a finalized block/);

    // Reservation is released
    const grant = env.store.getGrant(env.scope.grantId)!;
    assert.equal(grant.reserved, 0n);
    assert.equal(grant.spent, 0n); // Nothing spent

    // Book remains unchanged (not advanced)
    const book = env.store.getBook(env.facilityAddress)!;
    assert.equal(book.epoch, 0n);
    assert.equal(book.outstanding, 0n);

    // Original draw evidence is preserved on the task in encrypted storage
    const storedTask = env.store.getTask(orderId) as any;
    assert.notEqual(storedTask.originalDraw, null);
    assert.equal(storedTask.originalDraw.identifier, HISTORICAL_DRAW_IDENTIFIER);
    assert.equal(env.store.getPending(), null);
  } finally {
    await env.cleanup();
  }
});

// ============================================================================
// Scenario 8: Payout not verified cannot complete task
// ============================================================================
test('8. Payout not verified cannot complete task', async () => {
  const env = await setupTestEnvironment({
    customAdapter: {
      verifyRedemption: async () => null, // Payout not verified
    },
  });

  try {
    await env.runner.activateDelegation({
      scope: env.scope,
      proof: env.proof,
      book: env.book,
    });

    const orderId = randomUUID();
    const task = await env.runner.submitTask({
      orderId,
      grantId: env.scope.grantId,
      facilityAddress: env.facilityAddress,
      serviceId: 'line-doc-extract-v1',
      document: 'Payout unverified test doc',
      objective: 'Do not mark completed',
    });

    assert.equal(task?.status, 'redemption_uncertain');
    assert.equal(task?.paymentStatus, 'authorized');
    assert.notEqual(task?.paymentStatus, 'paid');
    assert.match(task?.error!, /Supplier payout has not been verified/);

    const storedTask = env.store.getTask(orderId)!;
    assert.notEqual(storedTask.status, 'completed');
  } finally {
    await env.cleanup();
  }
});

// ============================================================================
// Scenario 9: Verified payout + invalid delivery remains paid_undelivered with no second draw
// ============================================================================
test('9. Verified payout with invalid delivery remains paid_undelivered with no second draw', async () => {
  let drawCount = 0;

  const env = await setupTestEnvironment({
    customAdapter: {
      prepareDraw: async () => {
        drawCount++;
        return createSignedHistoricalDraw(env.facilityAddress, SOURCE_FINGERPRINT);
      },
    },
    customSupplier: {
      getOrder: async (id: string) => ({
        id,
        contractAddress: env.facilityAddress,
        service: 'line-doc-extract-v1',
        deliveryStatus: 'delivered',
        receipts: [
          {
            circuit: 'redeemDraw',
            contractAddress: env.facilityAddress,
            txHash: createHex(0x22),
            blockHeight: 3_100_060,
          },
        ],
        // Malformed result: offsets out of bounds, failing validateAgentResult
        result: {
          service: 'line-doc-extract-v1',
          version: 1,
          inputDigest: createHash('sha256').update('Valid doc').digest('hex'),
          objectiveDigest: createHash('sha256').update('Valid obj').digest('hex'),
          outcome: 'evidence_found',
          passages: [
            {
              start: 999, // out of bounds
              end: 1200,
              text: 'Bogus text',
              headingPath: ['Bogus'],
            },
          ],
        },
      }),
    },
  });

  try {
    await env.runner.activateDelegation({
      scope: env.scope,
      proof: env.proof,
      book: env.book,
    });

    const orderId = randomUUID();
    const task = await env.runner.submitTask({
      orderId,
      grantId: env.scope.grantId,
      facilityAddress: env.facilityAddress,
      serviceId: 'line-doc-extract-v1',
      document: 'Valid doc',
      objective: 'Valid obj',
    });

    assert.equal(task?.status, 'paid_undelivered');
    assert.equal(task?.paymentStatus, 'paid');
    assert.equal(task?.deliveryStatus, 'undelivered');
    assert.equal(task?.result, null);
    assert.equal(drawCount, 1);

    // Continuing task re-attempts delivery but NEVER issues a second draw
    const continued = await env.runner.continueTask(orderId);
    assert.equal(continued?.status, 'paid_undelivered');
    assert.equal(drawCount, 1); // Draw count did not increase
  } finally {
    await env.cleanup();
  }
});

// ============================================================================
// Scenario 10: Actual extraction passages result in result_ready, completed only by external agent brief with valid citations
// ============================================================================
test('10. Extraction passages result in result_ready, completed only by agent brief with valid citations', async () => {
  const docText = 'Line protocol document extraction provides verifiable evidence.';
  const objText = 'Extract citations';

  const env = await setupTestEnvironment({
    customSupplier: {
      getOrder: async (id: string) => ({
        id,
        contractAddress: env.facilityAddress,
        service: 'line-doc-extract-v1',
        deliveryStatus: 'delivered',
        receipts: [
          {
            circuit: 'redeemDraw',
            contractAddress: env.facilityAddress,
            txHash: createHex(0x22),
            blockHeight: 3_100_060,
          },
        ],
        result: {
          service: 'line-doc-extract-v1',
          version: 1,
          inputDigest: createHash('sha256').update(docText).digest('hex'),
          objectiveDigest: createHash('sha256').update(objText).digest('hex'),
          outcome: 'evidence_found',
          passages: [
            {
              start: 0,
              end: 22,
              text: 'Line protocol document',
              headingPath: ['Overview'],
            },
            {
              start: 43,
              end: 62,
              text: 'verifiable evidence',
              headingPath: ['Evidence'],
            },
          ],
        },
      }),
    },
  });

  try {
    await env.runner.activateDelegation({
      scope: env.scope,
      proof: env.proof,
      book: env.book,
    });

    const orderId = randomUUID();
    const task = await env.runner.submitTask({
      orderId,
      grantId: env.scope.grantId,
      facilityAddress: env.facilityAddress,
      serviceId: 'line-doc-extract-v1',
      document: docText,
      objective: objText,
    });

    assert.equal(task?.status, 'result_ready');
    assert.equal(task?.paymentStatus, 'paid');
    assert.equal(task?.deliveryStatus, 'delivered');
    assert.notEqual(task?.result, null);
    assert.equal(task?.result?.passages?.length, 2);

    // 1. Brief with invalid citations (not matching returned passages) is rejected
    await assert.rejects(
      env.runner.recordBrief(orderId, {
        text: 'Summary of findings',
        citations: [{ start: 5, end: 15 }], // Does not match any passage start/end
      }),
      /An agent-written brief must cite returned source passages/,
    );

    // 2. Brief with empty citations when outcome is evidence_found is rejected
    await assert.rejects(
      env.runner.recordBrief(orderId, {
        text: 'Summary without citations',
        citations: [],
      }),
      /An agent-written brief must cite returned source passages/,
    );

    // 3. Valid brief completes the task
    const validBrief = {
      text: 'Verified extracted evidence from protocol document.',
      citations: [{ start: 0, end: 22 }],
    };
    const completed = await env.runner.recordBrief(orderId, validBrief);
    assert.equal(completed?.status, 'completed');
    assert.deepEqual(completed?.brief, validBrief);

    // 4. Duplicate recordBrief with identical brief is idempotent
    const duplicate = await env.runner.recordBrief(orderId, validBrief);
    assert.equal(duplicate?.status, 'completed');
  } finally {
    await env.cleanup();
  }
});

test('10b. no_matching_evidence result allows empty citations in recordBrief', async () => {
  const docText = 'Short text with no matching information.';
  const objText = 'Find rare facts';

  const env = await setupTestEnvironment({
    customSupplier: {
      getOrder: async (id: string) => ({
        id,
        contractAddress: env.facilityAddress,
        service: 'line-doc-extract-v1',
        deliveryStatus: 'delivered',
        receipts: [
          {
            circuit: 'redeemDraw',
            contractAddress: env.facilityAddress,
            txHash: createHex(0x22),
            blockHeight: 3_100_060,
          },
        ],
        result: {
          service: 'line-doc-extract-v1',
          version: 1,
          inputDigest: createHash('sha256').update(docText).digest('hex'),
          objectiveDigest: createHash('sha256').update(objText).digest('hex'),
          outcome: 'no_matching_evidence',
          passages: [],
        },
      }),
    },
  });

  try {
    await env.runner.activateDelegation({
      scope: env.scope,
      proof: env.proof,
      book: env.book,
    });

    const orderId = randomUUID();
    const task = await env.runner.submitTask({
      orderId,
      grantId: env.scope.grantId,
      facilityAddress: env.facilityAddress,
      serviceId: 'line-doc-extract-v1',
      document: docText,
      objective: objText,
    });

    assert.equal(task?.status, 'result_ready');
    assert.equal(task?.result?.outcome, 'no_matching_evidence');

    // Empty citations allowed for no_matching_evidence
    const brief = {
      text: 'No evidence found in source text.',
      citations: [],
    };
    const completed = await env.runner.recordBrief(orderId, brief);
    assert.equal(completed?.status, 'completed');
    assert.deepEqual(completed?.brief, brief);
  } finally {
    await env.cleanup();
  }
});

// ============================================================================
// Scenario 11: Revocation/expiry before draw halts purchase, and cumulative lifetime spent includes uncertain reservations
// ============================================================================
test('11. Revocation or expiry halts purchase, and lifetime spent includes uncertain reservations', async () => {
  let currentTime = 5_000;
  const env = await setupTestEnvironment({
    now: () => currentTime,
  });

  try {
    await env.runner.activateDelegation({
      scope: env.scope,
      proof: env.proof,
      book: env.book,
    });

    // A. Expired grant halts purchase
    currentTime = env.scope.expiresAt + 1;
    await assert.rejects(
      env.runner.submitTask({
        orderId: randomUUID(),
        grantId: env.scope.grantId,
        facilityAddress: env.facilityAddress,
        serviceId: 'line-doc-extract-v1',
        document: 'Expired grant document',
        objective: 'Test expiry',
      }),
      /Agent grant is not currently valid|inactive/,
    );

    // Reset time back to valid range
    currentTime = 5_000;

    // B. Revoked grant halts purchase
    await env.store.commit(draft => {
      draft.grants[env.scope.grantId].revoked = true;
    });
    await assert.rejects(
      env.runner.submitTask({
        orderId: randomUUID(),
        grantId: env.scope.grantId,
        facilityAddress: env.facilityAddress,
        serviceId: 'line-doc-extract-v1',
        document: 'Revoked grant document',
        objective: 'Test revocation',
      }),
      /Agent authorization is revoked|inactive/,
    );

    // Un-revoke for spending limit test
    await env.store.commit(draft => {
      draft.grants[env.scope.grantId].revoked = false;
    });

    // C. Cumulative lifetime spend includes uncertain reservations
    // Grant maxSpend is 100,000.
    // Simulate an existing uncertain reservation of 80,000.
    await env.store.commit(draft => {
      draft.grants[env.scope.grantId].reserved = 80_000n;
    });

    // New task with amount 25,000 + fee 750 = 25,750 exceeds remaining budget (20,000)
    let preparations = 0;
    env.adapter.prepareDraw = async () => { preparations++; throw Error('Must not prepare an over-budget purchase'); };
    const deniedOrder = randomUUID();
    const deniedRequest = {
        orderId: deniedOrder,
        grantId: env.scope.grantId,
        facilityAddress: env.facilityAddress,
        serviceId: 'line-doc-extract-v1',
        document: 'Over-budget document',
        objective: 'Test budget exhaustion',
    };
    const denied = await env.runner.submitTask(deniedRequest);
    assert.equal(denied.status, 'denied');
    assert.equal(denied.denialReason, 'budget_exceeded');
    assert.equal(denied.error, 'Clearance could not be proven.');
    assert.equal(denied.paymentStatus, 'unpaid');
    assert.equal(denied.cost.totalAllowanceCharge, '25750');
    const retainedQuote = env.store.getTask(deniedOrder).quotePackage;
    assert.equal((await env.runner.continueTask(deniedOrder)).status, 'denied');
    assert.equal((await env.runner.submitTask(deniedRequest)).status, 'denied');
    assert.equal(env.store.getTask(deniedOrder).quotePackage, retainedQuote);
    assert.equal(preparations, 0);
    assert.equal(env.store.getPending(), null);
    assert.equal(env.store.getGrant(env.scope.grantId).reserved, 80_000n);
  } finally {
    await env.cleanup();
  }
});

test('authorization revoked during proving retains signed bytes and makes no submission attempt', async () => {
  const env = await setupTestEnvironment();
  let sends = 0;
  env.adapter.prepareDraw = async () => {
    await env.store.commit(state => { state.grants[env.scope.grantId].revoked = true; });
    return createSignedHistoricalDraw(env.facilityAddress, SOURCE_FINGERPRINT);
  };
  env.adapter.submitOriginal = async () => { sends++; throw Error('Must not submit'); };
  try {
    await env.runner.activateDelegation({ scope: env.scope, proof: env.proof, book: env.book });
    const task = await env.runner.submitTask({ orderId: randomUUID(), grantId: env.scope.grantId, facilityAddress: env.facilityAddress, serviceId: 'line-doc-extract-v1', document: 'The refund policy allows returns.', objective: 'refund policy' });
    assert.equal(task.status, 'approval_needed');
    assert.equal(sends, 0);
    assert.equal(env.store.getPending().disposition, 'signed');
    assert.equal(env.store.getPending().transaction, HISTORICAL_DRAW_TX_HEX);
    assert.equal(env.store.getGrant(env.scope.grantId).spent, 0n);
    assert(env.store.getGrant(env.scope.grantId).reserved > 0n);
  } finally { await env.cleanup(); }
});
