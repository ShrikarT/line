import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Transaction } from '@midnight-ntwrk/ledger-v8';
import {
  decodeAgentDraw,
  prepareAgentClaim,
  assertSameAgentDrawCall,
  MidnightAgentAdapter,
  redemptionNoteCommitment,
} from './agent-midnight.mjs';
import { agentId, quoteCommit, toHex, hexToBytes } from '../src/lib/line/encoding.ts';

const fp = '12'.repeat(32);

function historicalDraw() {
  // Public historical bytes exercise decoding, not current-release acceptance.
  const transaction = readFileSync(
    new URL('../tests/fixtures/private-offer-public-pairs/6-draw.proven-public-tx.bin', import.meta.url),
  ).toString('hex');
  const tx = Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(transaction, 'hex'));
  const facilityAddress = [...tx.intents.values()].flatMap(intent => intent.actions)[0].address;
  return {
    circuit: 'draw',
    facilityAddress,
    sourceFingerprint: fp,
    identifier: tx.identifiers().at(-1),
    transaction,
    transactionHash: tx.transactionHash(),
  };
}

test('historical original draw is canonical and remains decodable after expiry', () => {
  const pending = historicalDraw();
  assert.equal(Buffer.from(decodeAgentDraw(pending, fp).serialize()).toString('hex'), pending.transaction);
  for (const patch of [
    { identifier: '00' + 'ff'.repeat(32) },
    { facilityAddress: 'ee'.repeat(32) },
    { circuit: 'redeemDraw' },
    { sourceFingerprint: 'ff'.repeat(32) },
    { transactionHash: 'cc'.repeat(32) },
  ]) {
    assert.throws(() => decodeAgentDraw({ ...pending, ...patch }, fp));
  }
  const expiry = Math.min(...[...decodeAgentDraw(pending, fp).intents.values()].map(intent => intent.ttl.getTime()));
  assert.throws(() => decodeAgentDraw(pending, fp, { submit: true, now: expiry }), /expired/);
});

test('decodeAgentDraw rejects altered exact bytes, identifier, release, address, and hash', () => {
  const pending = historicalDraw();
  assert.equal(Buffer.from(decodeAgentDraw(pending, fp).serialize()).toString('hex'), pending.transaction);

  // Altered transaction bytes
  assert.throws(
    () => decodeAgentDraw({ ...pending, transaction: pending.transaction.slice(0, -2) + '00' }, fp),
    /Retained draw transaction hash differs|Unable to deserialize/,
  );
  // Odd hex length
  assert.throws(
    () => decodeAgentDraw({ ...pending, transaction: pending.transaction.slice(0, -1) }, fp),
  );
  // Altered identifier
  assert.throws(
    () => decodeAgentDraw({ ...pending, identifier: '00' + 'ff'.repeat(32) }, fp),
    /Saved transaction bytes differ from the original signed identifier/,
  );
  // Altered facility address
  assert.throws(
    () => decodeAgentDraw({ ...pending, facilityAddress: 'ee'.repeat(32) }, fp),
    /Saved transaction differs from the prepared organization action/,
  );
  // Altered circuit
  assert.throws(
    () => decodeAgentDraw({ ...pending, circuit: 'redeemDraw' }, fp),
    /Recover this draw with its original release/,
  );
  // Altered source fingerprint
  assert.throws(
    () => decodeAgentDraw({ ...pending, sourceFingerprint: 'ff'.repeat(32) }, fp),
    /Recover this draw with its original release/,
  );
  // Altered transaction hash
  assert.throws(
    () => decodeAgentDraw({ ...pending, transactionHash: 'cc'.repeat(32) }, fp),
    /Retained draw transaction hash differs/,
  );
});

test('expired original bytes never reach the node and no wallet is implicitly opened', async t => {
  await assert.rejects(MidnightAgentAdapter.create({ sourceFingerprint: fp }), /dedicated agent fee wallet/);
  const adapter = new MidnightAgentAdapter();
  adapter.sourceFingerprint = fp;
  let calls = 0;
  adapter.owner = {
    assertOpen() {},
    api: {
      tx: {
        midnight: {
          sendMnTransaction() {
            calls++;
            throw Error('Must not reach node');
          },
        },
      },
    },
  };
  const pending = historicalDraw();
  const expiry = Math.min(...[...decodeAgentDraw(pending, fp).intents.values()].map(intent => intent.ttl.getTime()));
  t.mock.method(Date, 'now', () => expiry);
  await assert.rejects(adapter.submitOriginal(pending), /expired/);
  assert.equal(calls, 0);
});

test('claim and next book bind exact quote, fee, agent identity, generation and capacity', () => {
  const book = {
    facilityAddress: '11'.repeat(32),
    domain: '22'.repeat(32),
    agentSecret: '33'.repeat(32),
    agentPk: toHex(agentId(hexToBytes('33'.repeat(32)))),
    salt: '44'.repeat(32),
    limit: 1000000n,
    outstanding: 0n,
    epoch: 0n,
    generation: 2n,
  };
  const quote = {
    contractAddress: book.facilityAddress,
    domain: book.domain,
    merchantPk: '55'.repeat(32),
    invoiceId: '66'.repeat(32),
    quoteNonce: '77'.repeat(32),
    amount: 50000n,
    expiry: 2000000000n,
    generation: 2n,
    feeFlat: 1000n,
    feeBps: 100n,
  };
  quote.quoteCommitment = toHex(
    quoteCommit({
      ...quote,
      merchantPk: hexToBytes(quote.merchantPk),
      invoiceId: hexToBytes(quote.invoiceId),
      domain: hexToBytes(quote.domain),
      nonce: hexToBytes(quote.quoteNonce),
    }),
  );
  const randomness = { noteNonce: '88'.repeat(32), noteSalt: '99'.repeat(32), newSalt: 'aa'.repeat(32) };
  const prepared = prepareAgentClaim(book, quote, randomness);
  assert.equal(prepared.candidateNote.fee, 1500n);
  assert.equal(prepared.candidateBook.outstanding, 51500n);
  assert.equal(prepared.candidateBook.epoch, 1n);
  assert.equal(book.outstanding, 0n);
  assert.notEqual(
    prepareAgentClaim(book, quote, { ...randomness, noteSalt: 'bb'.repeat(32) }).candidateNote.noteCommitment,
    prepared.candidateNote.noteCommitment,
  );
  for (const patch of [{ agentPk: 'cc'.repeat(32) }, { epoch: (1n << 64n) - 1n }, { limit: 51499n }, { generation: 3n }]) {
    assert.throws(() => prepareAgentClaim({ ...book, ...patch }, quote, randomness));
  }
  assert.throws(() => prepareAgentClaim(book, { ...quote, amount: 50001n }, randomness), /commitment/);
});

test('assertSameAgentDrawCall detects changed draw transcript despite same circuit and facility, accepts proof erasure, and rejects other actions', () => {
  const raw6 = readFileSync(new URL('../tests/fixtures/private-offer-public-pairs/6-draw.proven-public-tx.bin', import.meta.url));
  const raw11 = readFileSync(new URL('../tests/fixtures/private-offer-public-pairs/11-draw.proven-public-tx.bin', import.meta.url));
  const raw7 = readFileSync(new URL('../tests/fixtures/private-offer-public-pairs/7-redeemDraw.proven-public-tx.bin', import.meta.url));

  const tx6 = Transaction.deserialize('signature', 'proof', 'binding', raw6);
  const tx11 = Transaction.deserialize('signature', 'proof', 'binding', raw11);
  const tx7 = Transaction.deserialize('signature', 'proof', 'binding', raw7);

  // Both tx6 and tx11 target the exact same facility address and 'draw' circuit
  const facility6 = [...tx6.intents.values()][0].actions[0].address;
  const facility11 = [...tx11.intents.values()][0].actions[0].address;
  assert.equal(facility6, facility11);

  // 1. Detects changed draw call transcript despite same circuit and facility (fixtures 6 vs 11)
  assert.throws(
    () => assertSameAgentDrawCall(tx6, tx11),
    /Fee balancing changed the prepared agent draw/,
  );

  // 2. Accepts proof erasure preserving call public data and transcripts
  const erased = tx6.eraseProofs();
  assert.doesNotThrow(() => assertSameAgentDrawCall(erased, tx6));
  assert.doesNotThrow(() => assertSameAgentDrawCall(tx6, erased));

  // 3. Rejects other action (e.g. redeemDraw)
  assert.throws(
    () => assertSameAgentDrawCall(tx6, tx7),
    /Prepared transaction is not an agent draw/,
  );

  // 4. Rejects transaction with unexpected action counts (e.g. 0 actions)
  const emptyActionTx = { intents: new Map([['intent1', { actions: [] }]]) };
  assert.throws(
    () => assertSameAgentDrawCall(emptyActionTx, tx6),
    /Expected exactly one agent contract call/,
  );
});

test('prepare guard serializes early awaits and always resets preparing and input after failure', async () => {
  const adapter = new MidnightAgentAdapter();
  adapter.sourceFingerprint = fp;
  adapter.preparing = false;
  adapter.input = null;

  let releaseInspect;
  const inspectGate = new Promise(resolve => {
    releaseInspect = resolve;
  });

  const book = {
    facilityAddress: '11'.repeat(32),
    domain: '22'.repeat(32),
    agentSecret: '33'.repeat(32),
    agentPk: toHex(agentId(hexToBytes('33'.repeat(32)))),
    salt: '44'.repeat(32),
    limit: 1000000n,
    outstanding: 0n,
    epoch: 0n,
    generation: 2n,
  };
  const quote = {
    contractAddress: book.facilityAddress,
    domain: book.domain,
    merchantPk: '55'.repeat(32),
    invoiceId: '66'.repeat(32),
    quoteNonce: '77'.repeat(32),
    amount: 50000n,
    expiry: 2000000000n,
    generation: 2n,
    feeFlat: 1000n,
    feeBps: 100n,
  };
  quote.quoteCommitment = toHex(
    quoteCommit({
      ...quote,
      merchantPk: hexToBytes(quote.merchantPk),
      invoiceId: hexToBytes(quote.invoiceId),
      domain: hexToBytes(quote.domain),
      nonce: hexToBytes(quote.quoteNonce),
    }),
  );
  const randomness = { noteNonce: '88'.repeat(32), noteSalt: '99'.repeat(32), newSalt: 'aa'.repeat(32) };
  const prepared = prepareAgentClaim(book, quote, randomness);

  adapter.inspect = async () => {
    await inspectGate;
    throw new Error('Proving simulated failure');
  };

  const intent = {
    book,
    quote,
    candidateBook: prepared.candidateBook,
    candidateNote: prepared.candidateNote,
    ownerAddress: '22'.repeat(32),
  };

  // Launch first call: blocks in inspectGate
  const firstCall = adapter.prepareDraw(intent);
  assert.equal(adapter.preparing, true);

  // Concurrent second call is immediately rejected by early guard
  await assert.rejects(
    adapter.prepareDraw(intent),
    /Agent proving is already active/,
  );

  // Release inspect, which causes first call to fail
  releaseInspect();
  await assert.rejects(firstCall, /Proving simulated failure/);

  // Invariant: preparing flag and input must be cleanly reset in finally block
  assert.equal(adapter.preparing, false);
  assert.equal(adapter.input, null);

  // Subsequent call can now be admitted without being locked out
  let inspectCalled = false;
  adapter.inspect = async () => {
    inspectCalled = true;
    throw new Error('Second call admitted cleanly');
  };
  await assert.rejects(adapter.prepareDraw(intent), /Second call admitted cleanly/);
  assert.equal(inspectCalled, true);
  assert.equal(adapter.preparing, false);
  assert.equal(adapter.input, null);
});

test('verifyRedemption rejects wrong claim metadata or absent fixed recipient amount output using actual redemption fixture', async () => {
  const raw7 = readFileSync(new URL('../tests/fixtures/private-offer-public-pairs/7-redeemDraw.proven-public-tx.bin', import.meta.url));
  const tx7 = Transaction.deserialize('signature', 'proof', 'binding', raw7);

  const adapter = new MidnightAgentAdapter();
  adapter.sourceFingerprint = fp;
  const dummyVk = new Uint8Array([1, 2, 3]);
  adapter.zk = { getVerifierKey: async () => dummyVk };
  const dummyOp = { verifierKey: dummyVk };

  const recipient = '44'.repeat(32);
  const merchantPk = '55'.repeat(32);
  const color = '00'.repeat(32);
  const facilityAddress = [...tx7.intents.values()][0].actions[0].address;

  const note = {
    contractAddress: facilityAddress,
    domain: '22'.repeat(32),
    merchantPk,
    noteCommitment: redemptionNoteCommitment(tx7, facilityAddress),
    amount: 1000n,
    fee: 50n,
    expiry: 2000n,
    generation: 1n,
  };

  const order = {
    receipts: [
      {
        circuit: 'redeemDraw',
        contractAddress: note.contractAddress,
        txHash: tx7.transactionHash(),
        blockHeight: 100,
      },
    ],
  };

  // Controlled ledger state fixture helper
  const createLedgerState = (overrides = {}) => ({
    contractDomain: Buffer.from(note.domain, 'hex'),
    notes: {
      member: () => (overrides.notesMember !== undefined ? overrides.notesMember : true),
      lookup: () => ({
        redeemed: overrides.redeemed !== undefined ? overrides.redeemed : true,
        cancelled: overrides.cancelled !== undefined ? overrides.cancelled : false,
        amount: overrides.amount !== undefined ? overrides.amount : note.amount,
        fee: overrides.fee !== undefined ? overrides.fee : note.fee,
        expiry: overrides.expiry !== undefined ? overrides.expiry : note.expiry,
        lineGeneration: overrides.lineGeneration !== undefined ? overrides.lineGeneration : note.generation,
      }),
    },
    merchantPayoutRecipients: {
      member: () => (overrides.merchantMember !== undefined ? overrides.merchantMember : true),
      lookup: () => ({ bytes: Buffer.from(recipient, 'hex') }),
    },
    settlementTokenColor: Buffer.from(color, 'hex'),
  });

  // 1. Using ACTUAL historical public fixture raw bytes (tx7):
  // Historical public fixture tx7 contains the redeemDraw contract call but does NOT contain
  // an attached unshielded payout offer. verifyRedemption must reject it as unbacked.
  adapter.generated = { ledger: () => createLedgerState() };
  adapter.owner = {
    reader: {
      read: async () => ({
        networkFinalityVerified: true,
        state: { operation: () => dummyOp },
        compactState: { data: {} },
        raw: tx7, // actual public fixture transaction!
        transaction: { hash: tx7.transactionHash(), block: { height: 100 } },
        canonicalHash: 'aa'.repeat(32),
        finalizedHead: { height: 105 },
      }),
    },
  };

  await assert.rejects(
    adapter.verifyRedemption(order, note),
    /Supplier receipt has no matching asset payout/,
  );

  // 2. Reject missing claim from notes map
  adapter.generated = { ledger: () => createLedgerState({ notesMember: false }) };
  await assert.rejects(
    adapter.verifyRedemption(order, note),
    /Supplier receipt does not contain this claim/,
  );

  // 3. Reject unredeemed or cancelled claim
  adapter.generated = { ledger: () => createLedgerState({ redeemed: false }) };
  await assert.rejects(
    adapter.verifyRedemption(order, note),
    /Supplier receipt does not settle this exact claim/,
  );
  adapter.generated = { ledger: () => createLedgerState({ cancelled: true }) };
  await assert.rejects(
    adapter.verifyRedemption(order, note),
    /Supplier receipt does not settle this exact claim/,
  );

  // 4. Reject amount, fee, expiry, or generation mismatch
  adapter.generated = { ledger: () => createLedgerState({ amount: note.amount + 1n }) };
  await assert.rejects(adapter.verifyRedemption(order, note), /Supplier receipt does not settle this exact claim/);
  adapter.generated = { ledger: () => createLedgerState({ fee: note.fee + 1n }) };
  await assert.rejects(adapter.verifyRedemption(order, note), /Supplier receipt does not settle this exact claim/);
  adapter.generated = { ledger: () => createLedgerState({ expiry: note.expiry + 1n }) };
  await assert.rejects(adapter.verifyRedemption(order, note), /Supplier receipt does not settle this exact claim/);
  adapter.generated = { ledger: () => createLedgerState({ lineGeneration: note.generation + 1n }) };
  await assert.rejects(adapter.verifyRedemption(order, note), /Supplier receipt does not settle this exact claim/);

  // 5. Reject missing merchant payout recipient
  adapter.generated = { ledger: () => createLedgerState({ merchantMember: false }) };
  await assert.rejects(adapter.verifyRedemption(order, note), /Supplier payment recipient is missing/);

  // 6. Controlled provider with valid state and matching unshielded payout offer output succeeds
  const controlledRaw = {
    intents: new Map([
      [
        'payoutIntent',
        {
          actions: [...tx7.intents.values()].flatMap(intent => intent.actions),
          guaranteedUnshieldedOffer: {
            outputs: [{ owner: recipient, type: color, value: note.amount }],
          },
        },
      ],
    ]),
  };

  adapter.generated = { ledger: () => createLedgerState() };
  adapter.owner = {
    reader: {
      read: async () => ({
        networkFinalityVerified: true,
        state: { operation: () => dummyOp },
        compactState: { data: {} },
        raw: controlledRaw,
        transaction: { hash: tx7.transactionHash(), block: { height: 100 } },
        canonicalHash: 'aa'.repeat(32),
        finalizedHead: { height: 105 },
      }),
    },
  };

  const verified = await adapter.verifyRedemption(order, note);
  assert.notEqual(verified, null);
  assert.equal(verified.circuit, 'redeemDraw');
  assert.equal(verified.contractAddress, note.contractAddress);
  assert.equal(verified.recipient, recipient);
  assert.equal(verified.assetColor, color);
  assert.equal(verified.amount, note.amount.toString());
  assert.equal(verified.noteCommitment, note.noteCommitment);
  assert.equal(verified.outcome, 'success');
  // Same amount/payee and already-redeemed state cannot authenticate a later
  // redemption of a different note.
  const tx12 = Transaction.deserialize('signature', 'proof', 'binding', readFileSync(new URL('../tests/fixtures/private-offer-public-pairs/12-redeemDraw.proven-public-tx.bin', import.meta.url)));
  controlledRaw.intents.get('payoutIntent').actions = [...tx12.intents.values()].flatMap(intent => intent.actions);
  await assert.rejects(adapter.verifyRedemption(order, note), /settles another claim|unique redemption call/);
});

test('reconcile uses explicit readOutcome with exact identifier, canonical finality, and verifier check on success', async () => {
  const pending = historicalDraw();
  const rawTx = decodeAgentDraw(pending, fp);

  const adapter = new MidnightAgentAdapter();
  adapter.sourceFingerprint = fp;
  const dummyVk = new Uint8Array([1, 2, 3]);
  adapter.zk = { getVerifierKey: async () => dummyVk };
  const matchingOp = { verifierKey: dummyVk };

  // 1. Total on-chain failure returns failure outcome without querying state verifier keys
  adapter.owner = {
    reader: {
      readOutcome: async ({ kind, name, identifier }, target) => {
        assert.equal(kind, 'call');
        assert.equal(name, 'draw');
        assert.equal(identifier, pending.identifier);
        assert.equal(target, pending.facilityAddress);
        return {
          networkFinalityVerified: true,
          outcome: 'failure',
          raw: rawTx,
          state: null, // failed transactions have null state
          transaction: { hash: pending.transactionHash, block: { height: 500 } },
          canonicalHash: 'bb'.repeat(32),
          finalizedHead: { height: 505 },
        };
      },
    },
  };

  const failureReceipt = await adapter.reconcile(pending);
  assert.equal(failureReceipt.outcome, 'failure');
  assert.equal(failureReceipt.circuit, 'draw');
  assert.equal(failureReceipt.identifier, pending.identifier);
  assert.equal(failureReceipt.contractAddress, pending.facilityAddress);
  assert.equal(failureReceipt.blockHeight, 500);

  // 2. Successful reconciliation verifies network finality and circuit verifier keys
  adapter.owner = {
    reader: {
      readOutcome: async () => ({
        networkFinalityVerified: true,
        outcome: 'success',
        raw: rawTx,
        state: { operation: () => matchingOp },
        transaction: { hash: pending.transactionHash, block: { height: 500 } },
        canonicalHash: 'bb'.repeat(32),
        finalizedHead: { height: 505 },
      }),
    },
  };

  const successReceipt = await adapter.reconcile(pending);
  assert.equal(successReceipt.outcome, 'success');
  assert.equal(successReceipt.identifier, pending.identifier);

  // 3. Verifier key mismatch on success throws
  adapter.zk = { getVerifierKey: async () => new Uint8Array([9, 9, 9]) };
  await assert.rejects(adapter.reconcile(pending), /Finalized draw release differs/);
  adapter.zk = { getVerifierKey: async () => dummyVk };

  // 4. Missing network finality rejected
  adapter.owner = {
    reader: {
      readOutcome: async () => ({
        networkFinalityVerified: false,
        outcome: 'success',
        raw: rawTx,
        state: { operation: () => matchingOp },
        transaction: { hash: pending.transactionHash, block: { height: 500 } },
      }),
    },
  };
  await assert.rejects(adapter.reconcile(pending), /The original draw has not been finalized/);

  // 5. Unresolved / partial outcome rejected
  adapter.owner = {
    reader: {
      readOutcome: async () => ({
        networkFinalityVerified: true,
        outcome: 'partial_success',
        raw: rawTx,
        state: { operation: () => matchingOp },
        transaction: { hash: pending.transactionHash, block: { height: 500 } },
      }),
    },
  };
  await assert.rejects(adapter.reconcile(pending), /The original draw outcome is unresolved/);

  // 6. Raw transaction missing pending identifier rejected
  const alienTx = { identifiers: () => ['00' + 'ee'.repeat(32)] };
  adapter.owner = {
    reader: {
      readOutcome: async () => ({
        networkFinalityVerified: true,
        outcome: 'success',
        raw: alienTx,
        state: { operation: () => matchingOp },
        transaction: { hash: pending.transactionHash, block: { height: 500 } },
      }),
    },
  };
  await assert.rejects(adapter.reconcile(pending), /The original draw has not been finalized/);
});
