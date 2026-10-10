import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { bech32m } from "@scure/base";
import { ContractState, ContractOperation } from "@midnight-ntwrk/compact-runtime";
import { ZswapChainState, LedgerParameters } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import * as directLedger from "@midnight-ntwrk/ledger-v8";
import { MidnightNetworkRuntime } from "../src/lib/runtime/network.ts";
import { createWalletProviders, decodeWalletPublicKey, getWalletConfiguration } from "../src/lib/runtime/wallet.ts";
import { boot, blankPrivate, call, firstQuote, notesOf, readLedger, Status } from "../src/lib/line/compact-harness.ts";
import { agentId, canonicalPaymentReferenceBytes, pad32, merchantPublicKey, toHex } from "../src/lib/line/encoding.ts";
import { unlockVaultSession, lockVaultSession } from "../src/lib/security/vault.ts";

const ADDRESS = "ab".repeat(32);
const issuer = new Uint8Array(32).fill(41);
const merchant = new Uint8Array(32).fill(42);
const fixture = JSON.parse(readFileSync(new URL("./fixtures/line-public-verifiers.json", import.meta.url), "utf8"));
const keys = Object.fromEntries(Object.entries(fixture.keys).map(([id, key]) => [id, new Uint8Array(Buffer.from(key as string, "base64"))]));

async function compensationFixture(repaid = 0, historical = false) {
  let now = 0;
  const agent = new Uint8Array(32).fill(73), salt = pad32("sdk-comp-book"), drawSalt = pad32("sdk-comp-draw"), repaySalt = pad32("sdk-comp-repay"), refundSalt = pad32("sdk-comp-refund");
  const ps = blankPrivate({ callerSecret: issuer, agentSecret: agent, lineLimit: 100n, salt, newSalt: drawSalt,
    invoiceId: pad32("sdk-comp-invoice"), quoteNonce: pad32("sdk-comp-quote"), quoteAmount: 40n, drawAmount: 40n,
    quoteMerchantPk: merchantPublicKey(merchant), noteNonce: pad32("sdk-comp-note"), noteSalt: pad32("sdk-comp-note-salt") });
  let session = await boot(issuer, merchant, new Uint8Array(32).fill(43), ps, () => now);
  const apply = async (privateState: typeof ps, op: Parameters<typeof call>[2]) => {
    const r = await call(session, privateState, op); assert.equal(r.ok, true, r.ok ? "" : r.error); session = r.session;
  };
  await apply(ps, { name: "fundReserve", args: [200n] });
  await apply(ps, { name: "openLine", args: [10_000n, 5n, 0n] });
  await apply({ ...ps, callerSecret: merchant }, { name: "postQuote", args: [1n] });
  const Q = firstQuote(readLedger(session))!.Q;
  await apply({ ...ps, callerSecret: agent }, { name: "draw", args: [Q, 1n, 5n] });
  const D = notesOf(readLedger(session))[0].D;
  const paid = historical ? 45 : repaid;
  let book = { limit: 100, outstanding: 45, epoch: 1, salt: toHex(drawSalt) };
  if (paid) {
    await apply({ ...ps, callerSecret: issuer, lineOutstanding: 45n, lineEpoch: 1n, salt: drawSalt, newSalt: repaySalt,
      repayAmount: BigInt(paid), receiptNonce: pad32("sdk-comp-payment"), paymentRef: canonicalPaymentReferenceBytes("wire-sdk-comp-prepayment") },
      { name: "acknowledgeRepayment", args: [10_000n] });
    book = { limit: 100, outstanding: 45 - paid, epoch: 2, salt: toHex(repaySalt) };
  }
  if (historical) {
    await apply({ ...ps, callerSecret: issuer, lineOutstanding: 0n, lineEpoch: 2n, salt: repaySalt }, { name: "setStatus", args: [Status.CLOSED] });
    await apply({ ...ps, callerSecret: issuer, agentSecret: new Uint8Array(32).fill(74), salt: pad32("new-owner-book") }, { name: "openLine", args: [10_000n, 0n, 0n] });
  }
  now = 2;
  await apply(ps, { name: "cancelOrExpireNote", args: [D, 0n, 0n] });
  const compensation = { note: { identity: toHex(agentId(agent)), quoteCommit: toHex(Q), merchantPk: toHex(merchantPublicKey(merchant)), amount: 40, fee: 5,
    noteNonce: toHex(ps.noteNonce!), expiry: 1, lineGeneration: 1 }, noteSalt: toHex(ps.noteSalt!), newSalt: toHex(refundSalt),
    ...(historical ? {} : { book }) };
  return { ps, session: () => session, apply, D, Q, agent, book, refundSalt, compensation };
}

// Inject provider I/O only. Actual CompiledContract, findDeployedContract,
// circuit execution and unproven transaction construction remain the real SDK.
async function setup(existingState: object | null = null, mismatch = false, suppliedSession?: Awaited<ReturnType<typeof boot>>) {
  const session = await boot(issuer, merchant, new Uint8Array(32).fill(43));
  const state = ContractState.deserialize((session.state as any).serialize());
  if (suppliedSession) state.data = (suppliedSession.state as any).data ?? suppliedSession.state;
  for (const [id, key] of Object.entries(keys)) {
    const operation = new ContractOperation(); operation.verifierKey = key;
    state.setOperation(id, operation);
  }
  const stored = new Map<string, object>();
  if (existingState) stored.set(`line-state:${ADDRESS}`, existingState);
  let signingKey: string | null = null;
  let stateWrites = 0, proofCalls = 0, balanceCalls = 0, submitCalls = 0;
  const checked: string[] = [];
  const providers = {
    privateStateProvider: {
      setContractAddress: () => {}, get: async (id: string) => stored.get(id) ?? null,
      set: async (id: string, value: object) => { stateWrites++; stored.set(id, value); },
      getSigningKey: async () => signingKey, setSigningKey: async (_: string, value: string) => { signingKey = value; },
    },
    publicDataProvider: {
      watchForDeployTxData: async () => ({ status: "SucceedEntirely", blockHeight: 1, txHash: "cd".repeat(32) }),
      queryDeployContractState: async () => state, queryContractState: async () => state,
      queryZSwapAndContractState: async () => [new ZswapChainState(), state, LedgerParameters.initialParameters()],
    },
    zkConfigProvider: {
      getVerifierKeys: async (ids: string[]) => { checked.push(...ids); return ids.map(id => [id, mismatch && id === "draw" ? new Uint8Array([1]) : keys[id]]); },
      getVerifierKey: async (id: string) => keys[id],
    },
    proofProvider: { proveTx: async () => { proofCalls++; throw new Error("TEST_PROOF_BOUNDARY"); } },
    walletProvider: { getCoinPublicKey: () => "00".repeat(32), getEncryptionPublicKey: () => "00".repeat(32), balanceTx: async () => { balanceCalls++; throw new Error("must not balance"); } },
    midnightProvider: { submitTx: async () => { submitCalls++; throw new Error("must not submit"); } },
  };
  const net = new MidnightNetworkRuntime({ networkId: "preview", contractAddress: ADDRESS });
  (net as any).connectedWallet = {};
  (net as any).cachedProviders = providers;
  return { net, stored, checked, counters: () => ({ stateWrites, proofCalls, balanceCalls, submitCalls, signingKey }) };
}

describe("actual Midnight.js contract binding and construction", () => {
  it("uses one native ledger class identity across SDK and direct wallet integration", () => {
    assert.equal(ZswapChainState, directLedger.ZswapChainState);
    assert.equal(LedgerParameters, directLedger.LedgerParameters);
    const source = readFileSync(new URL("../contracts/line.compact", import.meta.url));
    assert.equal(fixture.sourceSha256, createHash("sha256").update(source).digest("hex"), "Regenerate the public verifier fixture after a Compact source change.");
  });
  it("binds exactly twelve circuits, seeds absent SDK state and preserves recovered state", async () => {
    const a = await setup();
    const bound = await (a.net as any).getBoundContract();
    assert.deepEqual(Object.keys(bound.callTx).sort(), Object.keys(keys).sort());
    assert.deepEqual(a.checked.sort(), Object.keys(keys).sort());
    assert.deepEqual(a.stored.get(`line-state:${ADDRESS}`), {});
    assert.equal(a.counters().stateWrites, 1);
    assert.ok(a.counters().signingKey);
    const recovered = { lineOutstanding: 17n, salt: new Uint8Array(32).fill(55) };
    const b = await setup(recovered);
    await (b.net as any).getBoundContract();
    assert.equal(b.counters().stateWrites, 0);
    assert.equal(b.stored.get(`line-state:${ADDRESS}`), recovered);
  });
  it("rejects a deployed verifier mismatch before circuit use", async () => {
    const a = await setup(null, true);
    await assert.rejects(() => (a.net as any).getBoundContract(), /draw|type/i);
    assert.equal(a.counters().proofCalls, 0);
  });
  it("constructs an actual issuer fund transaction up to proving, but rejects a forged issuer before proving", async () => {
    const a = await setup();
    const result = await a.net.fundReserve(100, Buffer.from(issuer).toString("hex"));
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /TEST_PROOF_BOUNDARY/);
    assert.equal(a.counters().proofCalls, 1);
    assert.equal(a.counters().balanceCalls, 0);
    assert.equal(a.counters().submitCalls, 0);
    const b = await setup();
    const forged = await b.net.fundReserve(100, "ff".repeat(32));
    assert.equal(forged.ok, false);
    assert.equal(b.counters().proofCalls, 0);
  });
  it("actual SDK execution accepts future Unix seconds and rejects historical action-count deadlines before proving", async () => {
    const params = { limit: 100, callerSk: toHex(issuer), agentSecret: "49".repeat(32), salt: "47".repeat(32) };
    const elapsed = await setup();
    const old = await elapsed.net.openLine({ ...params, expiry: 10_000 });
    assert.equal(old.ok, false);
    assert.match(old.error ?? "", /expiry/);
    assert.equal(elapsed.counters().proofCalls, 0);
    assert.equal(elapsed.counters().submitCalls, 0);
    const future = await setup();
    const current = await future.net.openLine({ ...params, expiry: Math.floor(Date.now() / 1000) + 10_000, feeFlat: 3, feeBps: 250 });
    assert.equal(current.ok, false);
    assert.match(current.error ?? "", /TEST_PROOF_BOUNDARY/);
    assert.equal(future.counters().proofCalls, 1);
    assert.equal(future.counters().submitCalls, 0);
    const invalidPolicy = await setup();
    const invalid = await invalidPolicy.net.openLine({ ...params, expiry: Math.floor(Date.now() / 1000) + 10_000, feeFlat: 3, feeBps: 10_001 });
    assert.equal(invalid.ok, false);
    assert.equal(invalidPolicy.counters().proofCalls, 0, "invalid issuer policy must not reach proving");
    assert.equal(invalidPolicy.counters().submitCalls, 0);
  });
  it("actual SDK draw enforces merchant deadline and exact issuer-approved flat plus rounded basis-point fee", async () => {
    const agent = new Uint8Array(32).fill(73), salt = pad32("sdk-expiry-book");
    const expiry = Math.floor(Date.now() / 1000) + 5_000;
    const ps = blankPrivate({ callerSecret: issuer, agentSecret: agent, salt, newSalt: pad32("sdk-next-book"), lineLimit: 100n,
      quoteAmount: 41n, drawAmount: 41n, invoiceId: pad32("sdk-expiry-invoice"), quoteNonce: pad32("sdk-expiry-quote"), quoteMerchantPk: merchantPublicKey(merchant),
      noteNonce: pad32("sdk-expiry-note"), noteSalt: pad32("sdk-expiry-note-salt") });
    let session = await boot(issuer, merchant, new Uint8Array(32).fill(43), ps);
    const apply = async (privateState: typeof ps, op: Parameters<typeof call>[2]) => {
      const r = await call(session, privateState, op); assert.equal(r.ok, true, r.ok ? "" : r.error); session = r.session;
    };
    await apply(ps, { name: "fundReserve", args: [100n] });
    await apply(ps, { name: "openLine", args: [BigInt(expiry + 100), 3n, 250n] });
    assert.equal(readLedger(session).feeFlat, 3n);
    assert.equal(readLedger(session).feeBps, 250n);
    await apply({ ...ps, callerSecret: merchant }, { name: "postQuote", args: [BigInt(expiry)] });
    const quote = firstQuote(readLedger(session))!;
    const params = { quoteCommit: toHex(quote.Q), limit: 100, outstanding: 0, epoch: 0, amount: 41, expiry, fee: 5, callerSk: toHex(agent), agentSecret: toHex(agent),
      salt: toHex(salt), newSalt: toHex(ps.newSalt!), invoiceId: toHex(ps.invoiceId!), quoteNonce: toHex(ps.quoteNonce!), noteNonce: toHex(ps.noteNonce!), noteSalt: toHex(ps.noteSalt!), merchantPk: toHex(merchantPublicKey(merchant)) };
    const changed = await setup(null, false, session);
    const rejected = await changed.net.draw({ ...params, noteExpiry: expiry + 1 });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, "Clearance could not be proven.");
    assert.equal(changed.counters().proofCalls, 0);
    for (const fee of [0, 4, 6]) {
      const altered = await setup(null, false, session);
      const badFee = await altered.net.draw({ ...params, noteExpiry: expiry, fee });
      assert.equal(badFee.ok, false);
      assert.equal(badFee.error, "Clearance could not be proven.");
      assert.equal(altered.counters().proofCalls, 0, `fee ${fee} must fail before proving; ceil(41*250/10000)+3 is exactly 5`);
      assert.equal(altered.counters().submitCalls, 0);
    }
    const valid = await setup(null, false, session);
    const accepted = await valid.net.draw({ ...params, noteExpiry: expiry });
    assert.equal(accepted.ok, false);
    assert.equal(accepted.error, "Clearance could not be proven.");
    assert.equal(valid.counters().proofCalls, 1, "an authenticated deadline passed actual circuit execution and reached the sentinel prover");
    assert.equal(valid.counters().submitCalls, 0);
  });
  it("passes the private closing opening through actual SDK execution and rejects absent or forged openings before proving", async () => {
    const initial = await boot(issuer, merchant, new Uint8Array(32).fill(43));
    const salt = new Uint8Array(32).fill(71);
    const privateState = blankPrivate({ callerSecret: issuer, agentSecret: new Uint8Array(32).fill(72), salt, lineLimit: 100n });
    const opened = await call(initial, privateState, { name: "openLine", args: [BigInt(Math.floor(Date.now() / 1000) + 10_000)] });
    assert.equal(opened.ok, true);
    const closingBook = { limit: 100, outstanding: 0, epoch: 0, salt: Buffer.from(salt).toString("hex") };
    const a = await setup(null, false, opened.session);
    const close = await a.net.setStatus("closed", Buffer.from(issuer).toString("hex"), { closingBook });
    assert.equal(close.ok, false);
    assert.match(close.error ?? "", /TEST_PROOF_BOUNDARY/);
    assert.equal(a.counters().proofCalls, 1);
    assert.equal(a.counters().submitCalls, 0);
    const b = await setup(null, false, opened.session);
    const absent = await b.net.setStatus("closed", Buffer.from(issuer).toString("hex"));
    assert.equal(absent.code, "CLOSING_BOOK_REQUIRED");
    const forged = await b.net.setStatus("closed", Buffer.from(issuer).toString("hex"), { closingBook: { ...closingBook, outstanding: 1 } });
    assert.equal(forged.ok, false);
    assert.match(forged.error ?? "", /stale closing book/);
    assert.equal(b.counters().proofCalls, 0);
  });
  it("actual SDK compensation allocates an already expired note once and rejects forged current books or authority", async () => {
    const f = await compensationFixture(20);
    const valid = await setup(null, false, f.session());
    const result = await valid.net.cancelOrExpireNote(toHex(f.D), toHex(issuer), { compensation: f.compensation });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /TEST_PROOF_BOUNDARY/);
    assert.equal(valid.counters().proofCalls, 1);
    assert.equal(valid.counters().submitCalls, 0);
    const forged = await setup(null, false, f.session());
    const bad = await forged.net.cancelOrExpireNote(toHex(f.D), toHex(issuer), { compensation: { ...f.compensation, book: { ...f.book, outstanding: 24 } } });
    assert.equal(bad.ok, false);
    assert.equal(forged.counters().proofCalls, 0);
    const unauthorized = await setup(null, false, f.session());
    assert.equal((await unauthorized.net.cancelOrExpireNote(toHex(f.D), toHex(merchant), { compensation: f.compensation })).ok, false);
    assert.equal(unauthorized.counters().proofCalls, 0);
  });
  it("actual SDK compensates historical notes for their original owner without opening the replacement borrower's book", async () => {
    const f = await compensationFixture(0, true);
    const original = await setup(null, false, f.session());
    const result = await original.net.cancelOrExpireNote(toHex(f.D), toHex(f.agent), { compensation: f.compensation });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /TEST_PROOF_BOUNDARY/);
    assert.equal(original.counters().proofCalls, 1);
    assert.equal(original.counters().submitCalls, 0);
  });
  it("actual SDK reported-refund acknowledgement opens the private amount and rejects prior repayment references", async () => {
    const f = await compensationFixture(20);
    await f.apply({ ...f.ps, callerSecret: issuer, lineOutstanding: 25n, lineEpoch: 2n, salt: pad32("sdk-comp-repay"), newSalt: f.refundSalt,
      noteIdentity: agentId(f.agent), noteQuoteCommit: f.Q }, { name: "cancelOrExpireNote", args: [f.D, 1n, 0n] });
    const refundAck = { identity: toHex(agentId(f.agent)), amount: 20, salt: toHex(f.refundSalt), paymentRef: "wire-sdk-comp-refund", receiptExpiry: Math.floor(Date.now() / 1000) + 600 };
    const valid = await setup(null, false, f.session());
    const result = await valid.net.cancelOrExpireNote(toHex(f.D), toHex(issuer), { refundAck });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /TEST_PROOF_BOUNDARY/);
    assert.equal(valid.counters().proofCalls, 1);
    assert.equal(valid.counters().submitCalls, 0);
    for (const changed of [{ amount: 19 }, { paymentRef: "wire-sdk-comp-prepayment" }, { receiptExpiry: 1 }]) {
      const invalid = await setup(null, false, f.session());
      assert.equal((await invalid.net.cancelOrExpireNote(toHex(f.D), toHex(issuer), { refundAck: { ...refundAck, ...changed } })).ok, false);
      assert.equal(invalid.counters().proofCalls, 0);
      assert.equal(invalid.counters().submitCalls, 0);
    }
  });
});

describe("connector v4 wallet adapter", () => {
  const coin = new Uint8Array(32).fill(11), enc = new Uint8Array(32).fill(12);
  const encode = (type: string, bytes: Uint8Array) => bech32m.encodeFromBytes(`mn_${type}_preview`, bytes);
  const api = {
    getConfiguration: async () => ({ networkId: "preview" }),
    getShieldedAddresses: async () => ({ shieldedCoinPublicKey: encode("shield-cpk", coin), shieldedEncryptionPublicKey: encode("shield-epk", enc) }),
    balanceUnsealedTransaction: async () => ({ tx: "invalid" }), submitTransaction: async () => {},
  };
  it("decodes network/type-bound public keys and exposes synchronous SDK getters without Buffer", async () => {
    const original = globalThis.Buffer;
    try {
      (globalThis as any).Buffer = undefined;
      const providers = await createWalletProviders(api as any, "preview");
      assert.equal(providers.walletProvider.getCoinPublicKey(), "0b".repeat(32));
      assert.equal(providers.walletProvider.getEncryptionPublicKey(), "0c".repeat(32));
      assert.throws(() => decodeWalletPublicKey(encode("shield-epk", enc), "shield-cpk", "preview"), /incompatible/);
      assert.throws(() => decodeWalletPublicKey(encode("shield-cpk", coin), "shield-cpk", "preprod"), /incompatible/);
      assert.throws(() => decodeWalletPublicKey(encode("shield-cpk", coin.slice(1)), "shield-cpk", "preview"), /incompatible/);
    } finally { globalThis.Buffer = original; }
  });
  it("refuses wrong networks and missing connector methods", async () => {
    await assert.rejects(() => getWalletConfiguration(api as any, "preprod"), /does not match/);
    await assert.rejects(() => getWalletConfiguration({ getConfiguration: api.getConfiguration } as any, "preview"), /capability/);
  });
  it("rejects malformed balancing output and submits only the finalized encoding", async () => {
    let serialized: string | undefined;
    const providers = await createWalletProviders({ ...api, submitTransaction: async (value: string) => { serialized = value; } } as any, "preview");
    await assert.rejects(() => providers.walletProvider.balanceTx({ serialize: () => new Uint8Array([1, 2]) } as any), /invalid finalized/);
    const id = await providers.midnightProvider.submitTx({ identifiers: () => ["01", "02"], serialize: () => new Uint8Array([3, 4]) } as any);
    assert.equal(serialized, "0304"); assert.equal(id, "02");
  });
});

describe("runtime wallet-scoped private storage", () => {
  it("uses actual connector identity to isolate two accounts at the same contract", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const wallet = (byte: number) => ({
      getConfiguration: async () => ({ networkId: "preview", indexerUri: "http://localhost:18080/graphql",
        indexerWsUri: "ws://localhost:18080/graphql/ws", substrateNodeUri: "http://localhost:19944", proverServerUri: "http://localhost:16300" }),
      getShieldedAddresses: async () => ({
        shieldedCoinPublicKey: bech32m.encode("mn_shield-cpk_preview", bech32m.toWords(new Uint8Array(32).fill(byte))),
        shieldedEncryptionPublicKey: bech32m.encode("mn_shield-epk_preview", bech32m.toWords(new Uint8Array(32).fill(12))),
      }), balanceUnsealedTransaction: async () => { throw new Error("No balancing permitted"); },
      submitTransaction: async () => { throw new Error("No submission permitted"); },
    });
    const restoreWindow = () => {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    };
    const create = async (byte: number) => {
      Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "http://localhost:5173" } } });
      try {
        const runtime = new MidnightNetworkRuntime({ networkId: "preview", contractAddress: ADDRESS });
        (runtime as any).connectedWallet = wallet(byte);
        return { runtime, providers: await runtime.getProviders() };
      } finally { restoreWindow(); }
    };
    unlockVaultSession("runtime-account-test");
    try {
      const a = await create(11), b = await create(13);
      // Real encrypted provider, Node encrypted test store; no network I/O occurs.
      await a.providers.privateStateProvider.set("account-regression", { lineOutstanding: 7n });
      assert.equal(await b.providers.privateStateProvider.get("account-regression"), null);
      const aReloaded = await create(11);
      assert.deepEqual(await aReloaded.providers.privateStateProvider.get("account-regression"), { lineOutstanding: 7n });
      a.runtime.setContractAddress(null);
      await assert.rejects(a.providers.privateStateProvider.get("account-regression"), /disposed|locked/i);
      assert.deepEqual(await aReloaded.providers.privateStateProvider.get("account-regression"), { lineOutstanding: 7n });
      b.runtime.setContractAddress(null);
      aReloaded.runtime.setContractAddress(null);
    } finally { restoreWindow(); lockVaultSession(); }
  });
});
