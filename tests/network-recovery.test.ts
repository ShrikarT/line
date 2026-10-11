import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ContractState, ContractOperation } from "@midnight-ntwrk/compact-runtime";
import { ZswapChainState, LedgerParameters } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { MidnightNetworkRuntime } from "../src/lib/runtime/network.ts";
import { unlockVaultSession, lockVaultSession } from "../src/lib/security/vault.ts";
import { InMemoryTestRuntime } from "../src/lib/runtime/memory.ts";
import { blankPrivate, call, firstQuote, notesOf, nullifiersOf, readLedger } from "../src/lib/line/compact-harness.ts";
import { boot } from "../src/test/fixtures/compact.ts";
import { agentId, merchantPublicKey, pad32, toHex } from "../src/lib/line/encoding.ts";

const ADDRESS = "ab".repeat(32), TX_ID = "ad".repeat(32);
const issuer = new Uint8Array(32).fill(61), merchant = new Uint8Array(32).fill(62), agent = new Uint8Array(32).fill(63);
const fixture = JSON.parse(readFileSync(new URL("./fixtures/line-public-verifiers.json", import.meta.url), "utf8"));
const keys = Object.fromEntries(Object.entries(fixture.keys).map(([id, key]) => [id, new Uint8Array(Buffer.from(key as string, "base64"))]));

type Fault = "prove" | "submit" | "confirm" | "persist" | "FailEntirely" | "FailFallible" | "mismatch" | "none";
async function setup(fault: Fault = "none") {
  const session = await boot(issuer, merchant, new Uint8Array(32).fill(64));
  const state = ContractState.deserialize((session.state as any).serialize());
  for (const [id, key] of Object.entries(keys)) { const op = new ContractOperation(); op.verifierKey = key; state.setOperation(id, op); }
  const stored = new Map<string, object>(); let signingKey: string | null = null, writes = 0, submits = 0;
  const receipt = { status: fault === "FailEntirely" || fault === "FailFallible" ? fault : "SucceedEntirely", txId: fault === "mismatch" ? "ef".repeat(32) : TX_ID, txHash: "bc".repeat(32), blockHeight: 7 };
  const net = new MidnightNetworkRuntime({ networkId: "preview", contractAddress: ADDRESS });
  (net as any).connectedWallet = {};
  // Real generated circuit execution and actual SDK binding/construction. Only
  // provider I/O is simulated to exercise recovery boundaries; these receipts
  // and proof/balance responses do NOT establish network or ZK execution.
  (net as any).cachedProviders = {
    privateStateProvider: {
      setContractAddress: () => {}, get: async (id: string) => stored.get(id) ?? null,
      set: async (id: string, value: object) => { writes++; if (fault === "persist" && writes > 1) throw new Error("PERSIST_FAILURE"); stored.set(id, value); },
      getSigningKey: async () => signingKey, setSigningKey: async (_: string, value: string) => { signingKey = value; },
    },
    publicDataProvider: {
      watchForDeployTxData: async () => ({ ...receipt, status: "SucceedEntirely" }),
      queryDeployContractState: async () => state, queryContractState: async () => state,
      queryZSwapAndContractState: async () => [new ZswapChainState(), state, LedgerParameters.initialParameters()],
      watchForTxData: async () => { if (fault === "confirm") throw new Error("CONFIRM_FAILURE"); return receipt; },
    },
    zkConfigProvider: { getVerifierKeys: async (ids: string[]) => ids.map(id => [id, keys[id]]), getVerifierKey: async (id: string) => keys[id] },
    proofProvider: { proveTx: async (tx: unknown) => { if (fault === "prove") throw new Error("PROVE_FAILURE"); return tx; } },
    walletProvider: { getCoinPublicKey: () => "00".repeat(32), getEncryptionPublicKey: () => "00".repeat(32), balanceTx: async () => ({ identifiers: () => [TX_ID] }) },
    midnightProvider: { submitTx: async () => { submits++; if (fault === "submit") throw new Error("SUBMIT_RESPONSE_LOST"); return TX_ID; } },
  };
  return { net, submits: () => submits };
}

describe("bounded recovery of a durably recorded transaction ID", () => {
  it("accepts only the exact finalized successful receipt and never submits during observation", async () => {
    const { net, submits } = await setup();
    const result = await net.getTransactionReceipt(TX_ID);
    assert.equal(result?.disposition, "confirmed-success");
    assert.equal(result?.txId, TX_ID);
    assert.equal(submits(), 0);
  });
  it("distinguishes complete rejection from partial execution while retaining the original ID", async () => {
    const failed = await setup("FailEntirely"), partial = await setup("FailFallible");
    assert.equal((await failed.net.getTransactionReceipt(TX_ID))?.disposition, "definitive-rejection");
    assert.equal((await partial.net.getTransactionReceipt(TX_ID))?.disposition, "unresolved");
    assert.equal((await partial.net.getTransactionReceipt(TX_ID))?.txId, TX_ID);
  });
  it("refuses mismatched receipts and failed observations without treating absence as rejection", async () => {
    const mismatch = await setup("mismatch"), unavailable = await setup("confirm");
    assert.equal(await mismatch.net.getTransactionReceipt(TX_ID), null);
    assert.equal(await unavailable.net.getTransactionReceipt(TX_ID), null);
    await assert.rejects(mismatch.net.getTransactionReceipt("not-a-transaction"));
  });
  it("application observation times out and reuses the same indefinite SDK watcher", async (t) => {
    const { net } = await setup();
    let watches = 0;
    (net as any).cachedProviders.publicDataProvider.watchForTxData = () => { watches++; return new Promise(() => {}); };
    const timer = globalThis.setTimeout;
    t.mock.method(globalThis, "setTimeout", (callback: (...args: any[]) => void) => timer(callback, 0));
    assert.equal(await net.getTransactionReceipt(TX_ID), null);
    assert.equal(await net.getTransactionReceipt(TX_ID), null);
    assert.equal(watches, 1);
  });
});

describe("journal transaction disposition at actual SDK submission boundary", () => {
  it("distinguishes preparation rejection from an ambiguous submitted transaction", async () => {
    const pre = await setup("prove"); let hooks = 0;
    const a = await pre.net.fundReserve(10, toHex(issuer), { beforeSubmit: () => { hooks++; } });
    assert.equal(a.disposition, "definitive-rejection"); assert.equal(a.txId, undefined); assert.equal(pre.submits(), 0); assert.equal(hooks, 0);
    const post = await setup("submit"); let saved: string | undefined;
    const b = await post.net.fundReserve(10, toHex(issuer), { beforeSubmit: ({ txId }) => { saved = txId; assert.equal(post.submits(), 0); } });
    assert.equal(saved, TX_ID); assert.equal(b.txId, TX_ID); assert.equal(b.disposition, "unresolved"); assert.equal(post.submits(), 1);
  });
  it("awaits durable submission metadata and never calls out after persistence rejection", async () => {
    const a = await setup(); let release!: () => void; let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const pending = a.net.fundReserve(10, toHex(issuer), { beforeSubmit: async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); throw new Error("JOURNAL_WRITE_FAILED"); } });
    await ready; assert.equal(a.submits(), 0); release(); const r = await pending;
    assert.equal(r.disposition, "definitive-rejection"); assert.equal(r.txId, TX_ID); assert.equal(a.submits(), 0);
  });
  it("preserves uncertainty on confirmation loss and SDK private-state persistence failure", async () => {
    for (const fault of ["confirm", "persist"] as const) {
      const a = await setup(fault); const r = await a.net.fundReserve(10, toHex(issuer));
      assert.equal(r.ok, false); assert.equal(r.disposition, "unresolved"); assert.equal(r.txId, TX_ID); assert.equal(a.submits(), 1);
    }
  });
  it("classifies actual SDK TxFailedError receipts: partial failure stays unresolved", async () => {
    for (const fault of ["FailEntirely", "FailFallible"] as const) {
      const a = await setup(fault); const r = await a.net.fundReserve(10, toHex(issuer));
      assert.equal(r.ok, false); assert.equal(r.disposition, fault === "FailEntirely" ? "definitive-rejection" : "unresolved"); assert.equal(r.txId, TX_ID);
    }
    const a = await setup(); const r = await a.net.fundReserve(10, toHex(issuer));
    assert.equal(r.ok, true); assert.equal(r.disposition, "confirmed-success"); assert.equal(r.txId, TX_ID);
  });
  it("keeps the original submitted ID when a receipt belongs to a different transaction", async () => {
    const a = await setup("mismatch"); const r = await a.net.fundReserve(10, toHex(issuer));
    assert.equal(r.ok, false); assert.equal(r.disposition, "unresolved"); assert.equal(r.txId, TX_ID);
    assert.equal(r.code, "TRANSACTION_RECEIPT_MISMATCH");
  });
  it("prevents a wallet/contract switch during journal persistence from submitting", async () => {
    const a = await setup();
    const r = await a.net.fundReserve(10, toHex(issuer), { beforeSubmit: () => { a.net.setContractAddress("cd".repeat(32)); } });
    assert.equal(r.disposition, "definitive-rejection"); assert.equal(a.submits(), 0);
  });
  it("prevents browser submission when the vault locks while its ID is being persisted", async () => {
    const a = await setup(); const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    unlockVaultSession("boundary-lock-test");
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    try {
      const r = await a.net.fundReserve(10, toHex(issuer), { beforeSubmit: () => { lockVaultSession(); } });
      assert.equal(r.disposition, "definitive-rejection"); assert.equal(a.submits(), 0); assert.equal(r.txId, TX_ID);
    } finally {
      lockVaultSession(); if (original) Object.defineProperty(globalThis, "window", original); else Reflect.deleteProperty(globalThis, "window");
    }
  });
  it("never borrows another operation's submission state for rejected draw validation", async () => {
    const a = await setup();
    (a.net as any).activeSubmission = { attempted: true, txId: TX_ID };
    const r = await a.net.draw({} as any);
    assert.equal(r.error, "Clearance could not be proven."); assert.equal(r.disposition, "definitive-rejection"); assert.equal(r.txId, undefined);
  });
});

describe("single-observation recovery evidence", () => {
  it("decodes actual Compact state and quote/note/nullifiers with exact u64 values", async () => {
    const max = (1n << 64n) - 1n, amount = 9_007_199_254_740_993n;
    const ps = blankPrivate({ callerSecret: issuer, agentSecret: agent, salt: pad32("old"), newSalt: pad32("new"), lineLimit: max,
      invoiceId: pad32("invoice"), quoteNonce: pad32("quote"), quoteAmount: amount, drawAmount: amount,
      quoteMerchantPk: merchantPublicKey(merchant), noteSalt: pad32("note-salt"), noteNonce: pad32("note-nonce") });
    let session = await boot(issuer, merchant, new Uint8Array(32).fill(64), ps);
    const apply = async (privateState: typeof ps, name: any, args: any[]) => { const r = await call(session, privateState, { name, args } as any); assert.equal(r.ok, true, r.ok ? "" : r.error); session = r.session; };
    await apply(ps, "fundReserve", [max]); await apply(ps, "openLine", [max]);
    await apply({ ...ps, callerSecret: merchant }, "postQuote", [max]);
    const quote = firstQuote(readLedger(session))!;
    await apply({ ...ps, callerSecret: agent }, "draw", [quote.Q, max, 0n]);
    const note = notesOf(readLedger(session))[0], nullifier = nullifiersOf(readLedger(session))[0];
    const net = new MidnightNetworkRuntime({ networkId: "preview", contractAddress: ADDRESS }); let reads = 0;
    (net as any).cachedProviders = { publicDataProvider: { queryContractState: async () => { reads++; return { data: session.state }; } } };
    const evidence = await net.getRecoveryEvidence({ quoteCommit: toHex(quote.Q), noteCommit: toHex(note.D), nullifier: toHex(nullifier) });
    assert.equal(reads, 1); assert.equal(evidence.lineGeneration, "1"); assert.equal(evidence.quote?.used, true);
    assert.equal(evidence.feeFlat, "0"); assert.equal(evidence.feeBps, "0");
    assert.equal(evidence.quote?.expiry, max.toString()); assert.equal(evidence.note?.amount, amount.toString()); assert.equal(evidence.note?.redeemed, false); assert.equal(evidence.nullifier?.present, true);
    assert.equal(evidence.note?.fee, "0");
    assert.equal(evidence.note?.compensationAllocated, false);
    assert.equal(evidence.note?.refundCommitment, "00".repeat(32));
    assert.equal(evidence.note?.cashRefundOwed, false);
    assert.equal(evidence.note?.refundAcknowledged, false);
    assert.equal(evidence.note?.refundPaymentNullifier, "00".repeat(32));
    assert.equal(evidence.identityCommitment, toHex(agentId(agent))); assert.equal(evidence.lineCommitment, toHex(readLedger(session).lineCommit));
    await apply({ ...ps, callerSecret: merchant, redeemAmount: amount, noteIdentity: agentId(agent), noteQuoteCommit: quote.Q }, "redeemDraw", [note.D, max]);
    const redeemed = await net.getRecoveryEvidence({ noteCommit: toHex(note.D) });
    assert.equal(redeemed.note?.redeemed, true); assert.equal(redeemed.note?.cancelled, false);
    const missing = await net.getRecoveryEvidence({ noteCommit: "ff".repeat(32), nullifier: "ff".repeat(32) });
    assert.deepEqual(missing.note, { commitment: "ff".repeat(32), present: false }); assert.equal(missing.nullifier?.present, false);
    assert.equal("disposition" in missing, false, "absent state is not rejection evidence");
  });
  it("local/memory evidence stays labelled and local rejection is definitive", async () => {
    const net = new InMemoryTestRuntime(); const r = await net.withdrawReserve(10, toHex(issuer));
    assert.equal(r.ok, false); assert.equal(r.disposition, "definitive-rejection");
    const evidence = await net.getRecoveryEvidence({ noteCommit: "ff".repeat(32) });
    assert.equal(evidence.runtime, "test"); assert.equal(evidence.note?.present, false); assert.equal(evidence.lineGeneration, "0");
  });
});
