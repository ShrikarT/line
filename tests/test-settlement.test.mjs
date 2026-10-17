// Generated Compact execution with explicit synthetic asset balances.
// This verifies contract logic/effects; funded network and wallet checks are separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../.compact-keys/test-settlement/managed/contract/index.js';
import { blankPrivate, WITNESSES } from '../src/lib/line/compact-harness.ts';
import { issuerPublicKey, merchantPublicKey, agentId, quoteCommit, pad32, toHex } from '../src/lib/line/encoding.ts';
import { validateContractArtifacts } from '../scripts/contract-artifacts.mjs';

const issuer = pad32('settlement-test-issuer');
const agent = pad32('settlement-test-agent');
const merchantA = pad32('settlement-test-merchant-a');
const merchantB = pad32('settlement-test-merchant-b');
const issuerAddress = { bytes: pad32('issuer-test-recipient') };
const addressA = { bytes: pad32('merchant-test-recipient-a') };
const addressB = { bytes: pad32('merchant-test-recipient-b') };
const address = R.dummyContractAddress();
const expiry = 10000n;

test('test-token bindings require an explicit release profile and cannot pass canonical validation', () => {
  const options = { artifactDir: '.compact-keys/test-settlement/managed', requireKeys: false, requireRelease: false };
  assert.throws(() => validateContractArtifacts(options), /Wrong public signature for registerMerchant/);
  const release = validateContractArtifacts({ ...options, profile: 'test-settlement' });
  assert.equal(release.inputs.source.path, 'contracts/experimental/line-test-settlement.compact');
  assert.equal(release.compilerInfo.circuits.length, 12);
  assert.throws(() => validateContractArtifacts({ ...options, profile: 'unknown' }), /Unknown contract release profile/);
});

function fixture(fee = 0n) {
  const contract = new Contract(WITNESSES);
  let privateState = blankPrivate({ callerSecret: issuer, agentSecret: agent, salt: pad32('salt-zero'), lineLimit: 100n });
  let state = contract.initialState(R.createConstructorContext(privateState, '0'.repeat(64)), issuerPublicKey(issuer), merchantPublicKey(merchantA), pad32('test-settlement-instance'), issuerAddress, addressA).currentContractState;
  let balance = 0n;
  let serial = 0;
  const read = () => ledger(state.data);
  const execute = (name, args = [], overrides = {}, available = balance) => {
    const ps = { ...privateState, ...overrides };
    const ctx = R.createCircuitContext(address, '0'.repeat(64), state, ps, undefined, undefined, 1000);
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
  call('openLine', [expiry, fee, 0n]);
  const draw = (merchant, amount) => {
    const id = ++serial;
    const merchantPk = merchantPublicKey(merchant);
    const invoiceId = pad32(`invoice-${id}`), quoteNonce = pad32(`quote-${id}`);
    const noteNonce = pad32(`note-${id}`), noteSalt = pad32(`note-salt-${id}`);
    const Q = quoteCommit({ merchantPk, invoiceId, nonce: quoteNonce, amount, expiry, generation: 1n, domain: read().contractDomain, feeFlat: fee, feeBps: 0n });
    const previous = new Set([...read().notes].map(([D]) => toHex(D)));
    call('postQuote', [expiry], { callerSecret: merchant, invoiceId, quoteNonce, quoteAmount: amount });
    const newSalt = pad32(`book-${id}`);
    call('draw', [Q, expiry, fee], { callerSecret: agent, invoiceId, quoteNonce, quoteAmount: amount, drawAmount: amount, quoteMerchantPk: merchantPk, noteNonce, noteSalt, newSalt });
    privateState = { ...privateState, salt: newSalt, lineOutstanding: privateState.lineOutstanding + amount + fee, lineEpoch: privateState.lineEpoch + 1n };
    const D = [...read().notes].find(([D]) => !previous.has(toHex(D)))[0];
    return { args: [D, expiry], ps: { callerSecret: merchant, noteIdentity: agentId(agent), noteQuoteCommit: Q, noteNonce, noteSalt, redeemAmount: amount } };
  };
  return { read, execute, call, draw, balance: () => balance, contract };
}

function payout(effects, recipient, amount) {
  assert.equal(effects.unshieldedOutputs.size, 1);
  assert.equal([...effects.unshieldedOutputs.values()][0], amount);
  const spends = [...effects.claimedUnshieldedSpends];
  assert.equal(spends.length, 1);
  assert.deepEqual(spends[0][0][1], { tag: 'user', address: R.decodeUserAddress(recipient.bytes) });
  assert.equal(spends[0][1], amount);
}

test('test settlement retains exactly twelve canonical circuit names', () => {
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
