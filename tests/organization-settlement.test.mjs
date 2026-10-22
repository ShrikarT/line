// Generated Compact execution with explicit synthetic asset balances.
// This verifies contract logic/effects; funded network and wallet checks are separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../contracts/managed/organization/contract/index.js';
import { blankPrivate, WITNESSES } from '../src/lib/line/compact-harness.ts';
import { issuerPublicKey, merchantPublicKey, agentId, quoteCommit, pad32, toHex } from '../src/lib/line/encoding.ts';
import { validateContractArtifacts } from '../scripts/contract-artifacts.mjs';
import { matchesRestoredNotes } from '../src/lib/organization/recovery.ts';
import { inspectMerchantClaim } from '../src/lib/organization/claims.ts';
import { bech32m } from '@scure/base';

const issuer = pad32('settlement-test-issuer');
const agent = pad32('settlement-test-agent');
const merchantA = pad32('settlement-test-merchant-a');
const merchantB = pad32('settlement-test-merchant-b');
const issuerAddress = { bytes: pad32('issuer-test-recipient') };
const addressA = { bytes: pad32('merchant-test-recipient-a') };
const addressB = { bytes: pad32('merchant-test-recipient-b') };
const address = R.dummyContractAddress();
const expiry = 10000n;

test('organization bindings require their explicit release profile', () => {
  const options = { artifactDir: 'contracts/managed/organization', requireKeys: false, requireRelease: false };
  assert.throws(() => validateContractArtifacts(options), /Wrong public signature for registerMerchant/);
  const release = validateContractArtifacts({ ...options, profile: 'organization' });
  assert.equal(release.inputs.source.path, 'contracts/organization/line.compact');
  assert.equal(release.compilerInfo.circuits.length, 12);
  assert.throws(() => validateContractArtifacts({ ...options, profile: 'unknown' }), /Unknown contract release profile/);
});

function fixture(fee = 0n, basisPoints = 0n) {
  const contract = new Contract(WITNESSES);
  let privateState = blankPrivate({ callerSecret: issuer, agentSecret: agent, salt: pad32('salt-zero'), lineLimit: 100n });
  let state = contract.initialState(R.createConstructorContext(privateState, '0'.repeat(64)), issuerPublicKey(issuer), merchantPublicKey(merchantA), pad32('test-settlement-instance'), issuerAddress, addressA, pad32('organization-asset')).currentContractState;
  let balance = 0n;
  let serial = 0;
  let now = 1000;
  const read = () => ledger(state.data);
  const execute = (name, args = [], overrides = {}, available = balance) => {
    const ps = { ...privateState, ...overrides };
    const ctx = R.createCircuitContext(address, '0'.repeat(64), state, ps, undefined, undefined, now);
    ctx.currentQueryContext.block = { ...ctx.currentQueryContext.block, balance: new Map([[{ tag: 'unshielded', raw: toHex(read().settlementTokenColor) }, available]]) };
    return contract.circuits[name](ctx, ...args);
  };
  const call = (name, args = [], overrides = {}) => {
    const result = execute(name, args, overrides);
    const effects = result.context.currentQueryContext.effects;
    for (const [, amount] of effects.unshieldedInputs) balance += amount;
    for (const [, amount] of effects.unshieldedOutputs) balance -= amount;
    assert(balance >= 0n);
    const next = new R.ContractState();
    next.data = result.context.currentQueryContext.state;
    state = next;
    return effects;
  };
  call('fundReserve', [200n]);
  call('registerMerchant', [merchantPublicKey(merchantB), addressB]);
  call('openLine', [expiry, fee, basisPoints]);
  const draw = (merchant, amount) => {
    const id = ++serial;
    const merchantPk = merchantPublicKey(merchant);
    const invoiceId = pad32(`invoice-${id}`), quoteNonce = pad32(`quote-${id}`);
    const noteNonce = pad32(`note-${id}`), noteSalt = pad32(`note-salt-${id}`);
    const Q = quoteCommit({ merchantPk, invoiceId, nonce: quoteNonce, amount, expiry, generation: 1n, domain: read().contractDomain, feeFlat: fee, feeBps: basisPoints });
    const drawFee = fee + (amount * basisPoints + 9999n) / 10000n;
    const previous = new Set([...read().notes].map(([D]) => toHex(D)));
    call('postQuote', [expiry], { callerSecret: merchant, invoiceId, quoteNonce, quoteAmount: amount });
    const newSalt = pad32(`book-${id}`);
    call('draw', [Q, expiry, drawFee], { callerSecret: agent, invoiceId, quoteNonce, quoteAmount: amount, drawAmount: amount, quoteMerchantPk: merchantPk, noteNonce, noteSalt, newSalt });
    privateState = { ...privateState, salt: newSalt, lineOutstanding: privateState.lineOutstanding + amount + drawFee, lineEpoch: privateState.lineEpoch + 1n };
    const D = [...read().notes].find(([D]) => !previous.has(toHex(D)))[0];
    return { args: [D, expiry], ps: { callerSecret: merchant, noteIdentity: agentId(agent), noteQuoteCommit: Q, noteNonce, noteSalt, redeemAmount: amount } };
  };
  function replenish(amount, reference = `deposit-${++serial}`) {
    const newSalt = pad32(`replenish-${serial}`);
    const effects = call('acknowledgeRepayment', [expiry], { callerSecret: issuer, repayAmount: amount, paymentRef: pad32(reference), receiptNonce: pad32(`receipt-${serial}`), newSalt });
    privateState = { ...privateState, salt: newSalt, lineOutstanding: privateState.lineOutstanding - amount, lineEpoch: privateState.lineEpoch + 1n };
    return effects;
  }
  return { read, execute, call, draw, replenish, private: () => privateState, time: value => { now = value; }, balance: () => balance, contract };
}

function payout(effects, recipient, amount) {
  assert.equal(effects.unshieldedOutputs.size, 1);
  assert.equal([...effects.unshieldedOutputs.values()][0], amount);
  const spends = [...effects.claimedUnshieldedSpends];
  assert.equal(spends.length, 1);
  assert.deepEqual(spends[0][0][1], { tag: 'user', address: R.decodeUserAddress(recipient.bytes) });
  assert.equal(spends[0][1], amount);
}

function claimPackage(f, claim) {
  const meta = f.read().notes.lookup(claim.args[0]);
  return { contractAddress: address, domain: toHex(f.read().contractDomain), identity: toHex(claim.ps.noteIdentity), merchantPk: toHex(merchantPublicKey(claim.ps.callerSecret)), quoteCommitment: toHex(claim.ps.noteQuoteCommit), amount: meta.amount, fee: meta.fee, expiry: meta.expiry, generation: meta.lineGeneration, noteNonce: toHex(claim.ps.noteNonce), noteSalt: toHex(claim.ps.noteSalt), noteCommitment: toHex(claim.args[0]), redeemed: false };
}
const receiving = recipient => bech32m.encodeFromBytes('mn_addr_preprod', recipient.bytes);

test('merchant review binds generated claim amounts, fees, settlement asset and exact receiving wallet', () => {
  const f = fixture(2n, 250n), claim = f.draw(merchantA, 25n), note = claimPackage(f, claim);
  const review = inspectMerchantClaim(f.read(), note, note.merchantPk, receiving(addressA));
  assert.deepEqual(review, { contractAddress: address, noteCommitment: note.noteCommitment, assetColor: toHex(f.read().settlementTokenColor), receivingAddress: receiving(addressA), amount: 25n, fee: 3n, expiry, generation: 1n, status: 'unspent' });
  assert.throws(() => inspectMerchantClaim(f.read(), note, note.merchantPk, receiving(addressB)), /another receiving address/);
  assert.throws(() => inspectMerchantClaim(f.read(), note, toHex(merchantPublicKey(merchantB)), receiving(addressA)), /another merchant/);
  assert.throws(() => inspectMerchantClaim(f.read(), { ...note, domain: 'ab'.repeat(32) }, note.merchantPk, receiving(addressA)), /another merchant or facility/);
  for (const patch of [{ amount: 24n }, { fee: 0n }, { generation: 2n }, { expiry: expiry + 1n }, { noteSalt: 'ab'.repeat(32) }, { identity: 'ab'.repeat(32) }, { quoteCommitment: 'ab'.repeat(32) }]) {
    assert.throws(() => inspectMerchantClaim(f.read(), { ...note, ...patch }, note.merchantPk, receiving(addressA)), /opening does not match/);
  }
  assert.equal(f.balance(), 200n);
});

test('merchant review rejects missing claims and disagreement with public note metadata', () => {
  const f = fixture(), claim = f.draw(merchantA, 25n), note = claimPackage(f, claim), book = f.read();
  assert.throws(() => inspectMerchantClaim({ ...book, notes: { member: () => false } }, note, note.merchantPk, receiving(addressA)), /not found/);
  const meta = book.notes.lookup(claim.args[0]);
  for (const patch of [{ amount: 24n }, { fee: 1n }, { expiry: expiry + 1n }, { lineGeneration: 2n }]) {
    assert.throws(() => inspectMerchantClaim({ ...book, notes: { member: () => true, lookup: () => ({ ...meta, ...patch }) } }, note, note.merchantPk, receiving(addressA)), /terms differ/);
  }
  assert.throws(() => inspectMerchantClaim({ ...book, merchantPayoutRecipients: { member: () => false } }, note, note.merchantPk, receiving(addressA)), /another receiving address/);
});

test('merchant review observes redemption and permissionless expiry without trusting package status flags', () => {
  const f = fixture(), a = f.draw(merchantA, 25n), b = f.draw(merchantB, 20n);
  const first = claimPackage(f, a), second = claimPackage(f, b);
  f.call('redeemDraw', a.args, a.ps);
  assert.equal(inspectMerchantClaim(f.read(), first, first.merchantPk, receiving(addressA)).status, 'redeemed');
  f.time(10001); f.call('cancelOrExpireNote', [b.args[0], 0n, 20000n]);
  assert.equal(inspectMerchantClaim(f.read(), second, second.merchantPk, receiving(addressB)).status, 'cancelled');
});

test('merchant review preserves an older valid claim after disabling, closing and reopening the allowance', () => {
  const f = fixture(), claim = f.draw(merchantA, 25n), note = claimPackage(f, claim);
  f.call('disableMerchant', [merchantPublicKey(merchantA)]);
  f.replenish(25n); f.call('setStatus', [3]);
  assert.equal(inspectMerchantClaim(f.read(), note, note.merchantPk, receiving(addressA)).status, 'unspent');
  f.call('openLine', [20000n, 0n, 0n], { salt: pad32('replacement-book') });
  assert.equal(f.read().lineGeneration, 2n);
  assert.equal(inspectMerchantClaim(f.read(), note, note.merchantPk, receiving(addressA)).generation, 1n);
  payout(f.call('redeemDraw', claim.args, claim.ps), addressA, 25n);
});

test('organization spending retains exactly twelve circuit names', () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.contract.circuits).sort(), ['registerMerchant','disableMerchant','fundReserve','withdrawUnencumberedReserve','withdrawFees','openLine','postQuote','draw','redeemDraw','cancelOrExpireNote','acknowledgeRepayment','setStatus'].sort());
});

test('both merchant claims emit exact token payouts to distinct immutable recipients', () => {
  const f = fixture();
  const a = f.draw(merchantA, 25n);
  payout(f.call('redeemDraw', a.args, a.ps), addressA, 25n);
  const b = f.draw(merchantB, 20n);
  payout(f.call('redeemDraw', b.args, b.ps), addressB, 20n);
  assert.equal(f.balance(), 155n);
  assert.equal(f.read().redeemedReserve, 45n);
  assert.equal(f.read().encumberedReserve, 0n);
  payout(f.call('withdrawUnencumberedReserve', [155n]), issuerAddress, 155n);
  assert.equal(f.balance(), 0n);
  assert.equal(f.read().totalReserve, 45n);
});

test('wrong merchant, replay and recipient replacement cannot cause a payout', () => {
  const f = fixture();
  const a = f.draw(merchantA, 25n);
  assert.throws(() => f.execute('redeemDraw', a.args, { ...a.ps, callerSecret: merchantB }), /note opening invalid/);
  assert.throws(() => f.execute('registerMerchant', [merchantPublicKey(merchantA), addressB]), /already registered/);
  assert.equal(f.balance(), 200n);
  f.call('redeemDraw', a.args, a.ps);
  assert.throws(() => f.execute('redeemDraw', a.args, a.ps), /already redeemed/);
  assert.equal(f.balance(), 175n);
});

test('actual asset shortage and locked reserve block payouts and issuer withdrawal', () => {
  const f = fixture();
  const a = f.draw(merchantA, 25n);
  assert.throws(() => f.execute('redeemDraw', a.args, a.ps, 24n), /asset reserve deficit/);
  assert.throws(() => f.execute('withdrawUnencumberedReserve', [176n]), /exceeds unencumbered/);
  assert.throws(() => f.execute('fundReserve', [100n], { callerSecret: agent }), /not issuer/);
  assert.equal(f.balance(), 200n);
  assert.equal(f.read().encumberedReserve, 25n);
});

test('fees are separate actual payouts and cannot be taken before redemption', () => {
  const f = fixture(1n);
  const a = f.draw(merchantA, 25n);
  assert.throws(() => f.execute('withdrawFees'), /no fees/);
  payout(f.call('redeemDraw', a.args, a.ps), addressA, 25n);
  payout(f.call('withdrawFees'), issuerAddress, 1n);
  assert.equal(f.balance(), 174n);
  assert.equal(f.read().totalReserve, 199n);
  assert.equal(f.read().feeReserve, 0n);
});


test('flat and proportional organization fees round upward and pay only finalized fees to the issuer', () => {
  const f = fixture(2n, 250n);
  const claim = f.draw(merchantA, 25n);
  assert.equal(f.read().feeFlat, 2n); assert.equal(f.read().feeBps, 250n);
  assert.equal(f.private().lineOutstanding, 28n);
  assert.equal(f.read().pendingFeeReserve, 3n); assert.equal(f.read().feeReserve, 0n);
  assert.throws(() => f.execute('withdrawFees'), /no fees/);
  payout(f.call('redeemDraw', claim.args, claim.ps), addressA, 25n);
  assert.equal(f.read().pendingFeeReserve, 0n); assert.equal(f.read().feeReserve, 3n);
  assert.throws(() => f.execute('withdrawFees', [], { callerSecret: agent }), /not issuer/);
  payout(f.call('withdrawFees'), issuerAddress, 3n);
  assert.equal(f.balance(), 172n); assert.equal(f.read().totalReserve, 197n);
  assert.equal(f.read().feeReserve, 0n);
  assert.throws(() => f.execute('withdrawFees'), /no fees/);
});

test('reserve funding consumes the selected existing asset and never mints funds', () => {
  const f = fixture();
  const effects = f.call('fundReserve', [50n]);
  assert.equal(effects.unshieldedMints.size, 0);
  assert.deepEqual([...effects.unshieldedInputs].map(([token, value]) => [token.raw, value]), [[toHex(pad32('organization-asset')), 50n]]);
  assert.equal(effects.unshieldedOutputs.size, 0);
  assert.equal(f.read().totalReserve, 250n);
  assert.equal(f.balance(), 250n);
});

test('replenishing capacity requires an equal real deposit and binds the current private book', () => {
  const f = fixture();
  const a = f.draw(merchantA, 25n);
  f.call('redeemDraw', a.args, a.ps);
  assert.equal(f.balance(), 175n);
  const effects = f.replenish(10n, 'real-deposit-one');
  assert.equal([...effects.unshieldedInputs.values()][0], 10n);
  assert.equal(effects.unshieldedMints.size, 0);
  assert.equal(f.balance(), 185n);
  assert.equal(f.read().totalReserve, 210n);
  assert.equal(f.private().lineOutstanding, 15n);
  assert.throws(() => f.execute('acknowledgeRepayment', [expiry], { repayAmount: 1n, paymentRef: pad32('real-deposit-one'), receiptNonce: pad32('different-receipt'), newSalt: pad32('next') }), /payment used/);
  assert.throws(() => f.execute('acknowledgeRepayment', [expiry], { callerSecret: agent }), /not issuer/);
});

test('expired partially replenished claims pay the actual excess back once', () => {
  const f = fixture();
  const a = f.draw(merchantA, 25n);
  f.replenish(10n, 'refund-original-deposit');
  f.time(10001);
  const refundSalt = pad32('refund-opening');
  f.call('cancelOrExpireNote', [a.args[0], 1n, 20000n], { ...a.ps, callerSecret: issuer, quoteMerchantPk: merchantPublicKey(merchantA), newSalt: refundSalt });
  assert.equal(f.read().refundReserve, 25n);
  const refundPs = { callerSecret: issuer, noteIdentity: agentId(agent), repayAmount: 10n, salt: refundSalt, paymentRef: pad32('actual-refund') };
  payout(f.call('cancelOrExpireNote', [a.args[0], 2n, 20000n], refundPs), issuerAddress, 10n);
  assert.equal(f.balance(), 200n);
  assert.equal(f.read().totalReserve, 200n);
  assert.equal(f.read().refundReserve, 0n);
  assert.equal(f.read().reportedRefundReserve, 0n);
  assert.throws(() => f.execute('cancelOrExpireNote', [a.args[0], 2n, 20000n], refundPs), /already acknowledged/);
});

test('restore rejects missing or wrong refund openings even when a prior-generation allocation leaves the current book unchanged', () => {
  const f = fixture(), claim = f.draw(merchantA, 25n);
  const note = { contractAddress: address, domain: toHex(f.read().contractDomain), identity: toHex(agentId(agent)), merchantPk: toHex(merchantPublicKey(merchantA)), quoteCommitment: toHex(claim.ps.noteQuoteCommit), amount: 25n, fee: 0n, expiry, generation: 1n, noteNonce: toHex(claim.ps.noteNonce), noteSalt: toHex(claim.ps.noteSalt), noteCommitment: toHex(claim.args[0]), redeemed: false };
  f.replenish(25n, 'restore-replenishment');
  f.call('setStatus', [3]);
  f.call('openLine', [20000n, 0n, 0n], { salt: pad32('replacement-book') });
  const committedBook = toHex(f.read().lineCommit);
  assert(matchesRestoredNotes(f.read(), [note]));
  f.time(10001);
  const refundSalt = pad32('prior-generation-refund');
  f.call('cancelOrExpireNote', [claim.args[0], 1n, 20000n], { ...claim.ps, callerSecret: issuer, quoteMerchantPk: merchantPublicKey(merchantA), newSalt: refundSalt });
  assert.equal(toHex(f.read().lineCommit), committedBook);
  assert.equal(matchesRestoredNotes(f.read(), [note]), false);
  const allocated = { ...note, refund: { salt: toHex(refundSalt), amount: 25n, paid: false } };
  assert(matchesRestoredNotes(f.read(), [allocated]));
  for (const refund of [{ ...allocated.refund, salt: toHex(pad32('wrong-opening')) }, { ...allocated.refund, amount: 24n }, { ...allocated.refund, paid: true }]) assert.equal(matchesRestoredNotes(f.read(), [{ ...note, refund }]), false);
  assert.equal(matchesRestoredNotes(f.read(), [{ ...allocated, noteSalt: toHex(pad32('wrong-note-opening')) }]), false);
  f.call('cancelOrExpireNote', [claim.args[0], 2n, 20000n], { callerSecret: issuer, noteIdentity: agentId(agent), repayAmount: 25n, salt: refundSalt, paymentRef: pad32('restore-refund-payment') });
  assert.equal(matchesRestoredNotes(f.read(), [allocated]), false);
  assert(matchesRestoredNotes(f.read(), [{ ...allocated, refund: { ...allocated.refund, paid: true } }]));
});
