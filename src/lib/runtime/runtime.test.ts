import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MidnightNetworkRuntime,
  LocalDevelopmentRuntime,
  InMemoryTestRuntime,
  getRuntime,
} from "./index.ts";
import { ISSUER_SK, MERCHANT_A_SK, MERCHANT_A_PK, AGENT_SK } from "../../test/fixtures/keys.ts";

describe("runtime architecture: MidnightNetworkRuntime, LocalDevelopmentRuntime, InMemoryTestRuntime", () => {
  it("MidnightNetworkRuntime defaults to unconfigured in test environment and fails clearly", async () => {
    const net = new MidnightNetworkRuntime({ networkId: "midnight-preprod" });
    assert.equal(net.mode, "network");
    assert.equal(net.networkId, "preprod");
    assert.equal(net.isConnected(), false);
    assert.equal(net.getContractAddress(), null);

    const status = await net.getStatus();
    assert.equal(status.runtime, "network");
    assert.equal(status.status, "none");
    assert.equal(status.totalReserve, 0);

    await assert.rejects(
      () => net.fundReserve(100, ISSUER_SK),
      /WalletNotConnectedError|No Midnight wallet connection detected/
    );
  });

  it("LocalDevelopmentRuntime executes valid flow and updates public reserve accounting", async () => {
    const local = new LocalDevelopmentRuntime(undefined, { clock: () => 0 });
    assert.equal(local.mode, "local");
    assert.equal(local.isConnected(), true);

    const fundRes = await local.fundReserve(500, ISSUER_SK);
    assert.equal(fundRes.ok, true);
    assert.ok(fundRes.txHash?.startsWith("0xdev_tx_"));

    const reserve = await local.getReserveStatus();
    assert.equal(reserve.totalReserve, 500);
    assert.equal(reserve.withdrawableReserve, 500);

    const openRes = await local.openLine({
      limit: 150,
      expiry: 10_000,
      callerSk: ISSUER_SK,
      agentSecret: AGENT_SK,
      salt: "salt-0",
    });
    assert.equal(openRes.ok, true);

    const status = await local.getStatus();
    assert.equal(status.status, "open");
    assert.equal(status.lineGeneration, 1);
  });

  it("InMemoryTestRuntime is isolated and reports mode test", async () => {
    const mem = new InMemoryTestRuntime();
    assert.equal(mem.mode, "test");
    assert.equal(mem.getContractAddress(), "0xtest_contract_in_memory");

    const status = await mem.getStatus();
    assert.equal(status.runtime, "test");
  });

  it("default local and memory runtimes reject an already elapsed Unix deadline", async () => {
    for (const runtime of [new LocalDevelopmentRuntime(), new InMemoryTestRuntime()]) {
      const result = await runtime.openLine({ limit: 150, expiry: 10_000, callerSk: ISSUER_SK, agentSecret: AGENT_SK, salt: "old-deadline" });
      assert.equal(result.ok, false);
      assert.equal(result.code, "EXPIRY");
      assert.equal((await runtime.getStatus()).actionClock, 0);
    }
  });

  it("activity cannot expire a claim; time without activity expires it at the merchant deadline", async () => {
    let now = 0;
    const runtime = new InMemoryTestRuntime(undefined, { clock: () => now });
    await runtime.fundReserve(100, ISSUER_SK);
    await runtime.registerMerchant(MERCHANT_A_PK, ISSUER_SK);
    assert.equal((await runtime.openLine({ limit: 100, expiry: 100, callerSk: ISSUER_SK, agentSecret: AGENT_SK, salt: "clock-book" })).ok, true);
    const quoted = await runtime.postQuote({ amount: 10, expiry: 2, invoiceId: "clock-invoice", nonce: "clock-quote", merchantSk: MERCHANT_A_SK });
    assert.equal(quoted.ok, true);
    const quoteCommit = quoted.output?.Q as string;
    assert.ok((await runtime.getStatus()).actionClock > 2, "successful actions exceeded the deadline value while Unix time remained zero");
    const params = { quoteCommit, limit: 100, outstanding: 0, epoch: 0, amount: 10, expiry: 2, callerSk: AGENT_SK, agentSecret: AGENT_SK,
      salt: "clock-book", newSalt: "clock-book-next", invoiceId: "clock-invoice", quoteNonce: "clock-quote", noteNonce: "clock-note", noteSalt: "clock-note-salt", merchantPk: MERCHANT_A_PK };
    const changedDeadline = await runtime.draw({ ...params, noteExpiry: 3 });
    assert.equal(changedDeadline.ok, false);
    assert.equal(changedDeadline.code, "NOTE_EXPIRY");
    const drawn = await runtime.draw({ ...params, noteExpiry: 2 });
    assert.equal(drawn.ok, true);
    const noteCommit = drawn.output?.noteCommitment as string;
    assert.equal((await runtime.cancelOrExpireNote(noteCommit, ISSUER_SK)).code, "NOTE_NOT_EXPIRED");
    const before = await runtime.getStatus();
    now = 2;
    assert.equal((await runtime.getStatus()).actionClock, before.actionClock, "time advanced without a protocol action");
    const redeemed = await runtime.redeemDraw({ noteCommit, amount: 10, noteExpiry: 2, merchantSk: MERCHANT_A_SK, noteIdentity: before.identityCommitment!, noteQuoteCommit: quoteCommit, noteNonce: "clock-note", noteSalt: "clock-note-salt" });
    assert.equal(redeemed.ok, false);
    assert.equal(redeemed.code, "NOTE_EXPIRED");
    assert.equal((await runtime.cancelOrExpireNote(noteCommit, ISSUER_SK)).ok, true);
    assert.equal((await runtime.getReserveStatus()).encumberedReserve, 0);
    assert.equal((await runtime.getReserveStatus()).refundReserve, 10, "expiry holds the cost pending compensation allocation");
  });

  it("getRuntime factory selects preferred runtime properly", () => {
    const testRuntime = getRuntime("test");
    assert.equal(testRuntime.mode, "test");
    const localRuntime = getRuntime("local");
    assert.equal(localRuntime.mode, "local");
    const netRuntime = getRuntime("network");
    assert.equal(netRuntime.mode, "network");
  });

  it("local runtime applies issuer policy with ceiling rounding and refuses caller-selected fees", async () => {
    const runtime = new InMemoryTestRuntime(undefined, { clock: () => 0 });
    await runtime.fundReserve(500, ISSUER_SK);
    await runtime.registerMerchant(MERCHANT_A_PK, ISSUER_SK);
    assert.equal((await runtime.openLine({ limit: 100, expiry: 100, feeFlat: 3, feeBps: 250, callerSk: ISSUER_SK, agentSecret: AGENT_SK, salt: "fee-book" })).ok, true);
    const quote = await runtime.postQuote({ amount: 41, expiry: 50, invoiceId: "fee-round-invoice", nonce: "fee-round-quote", merchantSk: MERCHANT_A_SK });
    assert.equal(quote.ok, true);
    const quoteCommit = quote.output?.Q as string;
    const params = { quoteCommit, limit: 100, outstanding: 0, epoch: 0, amount: 41, expiry: 50, callerSk: AGENT_SK, agentSecret: AGENT_SK,
      salt: "fee-book", newSalt: "fee-book-next", invoiceId: "fee-round-invoice", quoteNonce: "fee-round-quote", noteNonce: "fee-round-note", noteSalt: "fee-round-note-salt", merchantPk: MERCHANT_A_PK };
    for (const fee of [0, 4, 6]) {
      const rejected = await runtime.draw({ ...params, fee });
      assert.equal(rejected.ok, false);
      assert.equal(rejected.error, "Clearance could not be proven.");
      assert.equal((await runtime.getStatus()).feeReserve, 0);
    }
    const drawn = await runtime.draw({ ...params, fee: 5 });
    assert.equal(drawn.ok, true);
    const status = await runtime.getStatus();
    assert.equal(status.feeFlat, 3);
    assert.equal(status.feeBps, 250);
    assert.equal(status.feeReserve, 0);
    assert.equal(status.pendingFeeReserve, 5);
    assert.equal(status.encumberedReserve, 41, "merchant claim contains principal, not issuer fee");
    assert.equal(status.withdrawableReserve, 454);
    assert.equal((await runtime.withdrawFees(ISSUER_SK)).ok, false, "unredeemed purchase fees are not earned");
    assert.equal((await runtime.redeemDraw({ noteCommit: drawn.output?.noteCommitment as string, amount: 41, noteExpiry: 50,
      merchantSk: MERCHANT_A_SK, noteIdentity: status.identityCommitment!, noteQuoteCommit: quoteCommit,
      noteNonce: "fee-round-note", noteSalt: "fee-round-note-salt" })).ok, true);
    const earned = await runtime.getStatus();
    assert.equal(earned.pendingFeeReserve, 0);
    assert.equal(earned.feeReserve, 5);
    assert.equal((await runtime.withdrawFees(ISSUER_SK)).ok, true);
  });

  it("permissionless expiry, compensation and issuer-reported cash refund preserve reserve holds without duplicate credit", async () => {
    let now = 0;
    const runtime = new InMemoryTestRuntime(undefined, { clock: () => now });
    const salt = "11".repeat(32), drawSalt = "12".repeat(32), repaySalt = "13".repeat(32), refundSalt = "14".repeat(32);
    const quoteNonce = "15".repeat(32), noteNonce = "16".repeat(32), noteSalt = "17".repeat(32);
    await runtime.fundReserve(200, ISSUER_SK);
    await runtime.registerMerchant(MERCHANT_A_PK, ISSUER_SK);
    assert.equal((await runtime.openLine({ limit: 100, expiry: 100, feeFlat: 5, callerSk: ISSUER_SK, agentSecret: AGENT_SK, salt })).ok, true);
    const quoted = await runtime.postQuote({ amount: 40, expiry: 2, invoiceId: "comp-invoice", nonce: quoteNonce, merchantSk: MERCHANT_A_SK });
    const quoteCommit = quoted.output?.Q as string;
    const drawn = await runtime.draw({ quoteCommit, limit: 100, outstanding: 0, epoch: 0, amount: 40, fee: 5, expiry: 2,
      callerSk: AGENT_SK, agentSecret: AGENT_SK, salt, newSalt: drawSalt, invoiceId: "comp-invoice", quoteNonce, noteNonce, noteSalt, merchantPk: MERCHANT_A_PK });
    assert.equal(drawn.ok, true);
    const noteCommit = drawn.output?.noteCommitment as string;
    const identity = (await runtime.getStatus()).identityCommitment!;
    assert.equal((await runtime.acknowledgeRepayment({ limit: 100, outstanding: 45, epoch: 1, amount: 20, receiptExpiry: 100,
      callerSk: ISSUER_SK, agentSecret: AGENT_SK, salt: drawSalt, newSalt: repaySalt, receiptNonce: "18".repeat(32), paymentRef: "wire-comp-prepayment" })).ok, true);
    now = 2;
    assert.equal((await runtime.cancelOrExpireNote(noteCommit, "ff".repeat(32))).ok, true);
    const cancelled = await runtime.getStatus();
    assert.equal(cancelled.pendingFeeReserve, 0);
    assert.equal(cancelled.feeReserve, 0);
    assert.equal(cancelled.refundReserve, 45);
    assert.equal(cancelled.withdrawableReserve, 155);
    const compensation = { note: { identity, quoteCommit, merchantPk: MERCHANT_A_PK, amount: 40, fee: 5, noteNonce, expiry: 2, lineGeneration: 1 },
      noteSalt, newSalt: refundSalt, book: { limit: 100, outstanding: 25, epoch: 2, salt: repaySalt } };
    const allocated = await runtime.cancelOrExpireNote(noteCommit, ISSUER_SK, { compensation });
    assert.equal(allocated.ok, true);
    const evidence = await runtime.getRecoveryEvidence({ noteCommit });
    assert.equal(evidence.note?.compensationAllocated, true);
    assert.equal(evidence.note?.cashRefundOwed, true);
    assert.equal(evidence.note?.refundAcknowledged, false);
    assert.ok(evidence.note?.refundCommitment);
    const after = await runtime.getStatus();
    assert.notEqual(after.lineCommitment, cancelled.lineCommitment);
    assert.equal(after.refundReserve, 45, "private remainder does not change the publicly held full purchase cost");
    assert.equal((await runtime.cancelOrExpireNote(noteCommit, ISSUER_SK, { compensation })).ok, false);
    assert.equal((await runtime.getStatus()).lineCommitment, after.lineCommitment);
    const badOpening = await runtime.cancelOrExpireNote(noteCommit, ISSUER_SK, { refundAck: { identity, amount: 19, salt: refundSalt, paymentRef: "wire-comp-refund", receiptExpiry: 100 } });
    assert.equal(badOpening.ok, false);
    assert.equal((await runtime.getStatus()).refundReserve, 45);
    const acknowledged = await runtime.cancelOrExpireNote(noteCommit, ISSUER_SK, { refundAck: { identity, amount: 20, salt: refundSalt, paymentRef: "wire-comp-refund", receiptExpiry: 100 } });
    assert.equal(acknowledged.ok, true);
    const reported = await runtime.getStatus();
    assert.equal(reported.refundReserve, 0);
    assert.equal(reported.reportedRefundReserve, 45, "a source-unverified issuer report retains the full hold");
    assert.equal(reported.withdrawableReserve, 155);
    assert.equal((await runtime.getRecoveryEvidence({ noteCommit })).note?.refundAcknowledged, true);
    assert.equal((await runtime.cancelOrExpireNote(noteCommit, ISSUER_SK, { refundAck: { identity, amount: 20, salt: refundSalt, paymentRef: "wire-comp-refund", receiptExpiry: 100 } })).ok, false);
  });

  it("LocalDevelopmentRuntime.draw requires merchantPk and rejects when missing", async () => {
    const local = new LocalDevelopmentRuntime(undefined, { clock: () => 0 });
    await local.fundReserve(500, ISSUER_SK);
    await local.registerMerchant(MERCHANT_A_PK, ISSUER_SK);
    await local.openLine({
      limit: 150,
      expiry: 10_000,
      callerSk: ISSUER_SK,
      agentSecret: AGENT_SK,
      salt: "salt-0",
    });

    const quoteRes = await local.postQuote({
      amount: 40,
      expiry: 10_000,
      invoiceId: "inv-req-pk",
      nonce: "nonce-1",
      merchantSk: MERCHANT_A_SK,
    });
    assert.equal(quoteRes.ok, true);
    const quoteCommit = quoteRes.output?.Q as string;
    assert.ok(quoteCommit);

    // Call draw without merchantPk -> must fail with MISSING_MERCHANT_PK
    const drawNoPk = await local.draw({
      quoteCommit,
      limit: 150,
      outstanding: 0,
      epoch: 0,
      amount: 40,
      expiry: 10_000,
      callerSk: AGENT_SK,
      agentSecret: AGENT_SK,
      salt: "salt-0",
      newSalt: "salt-1",
      invoiceId: "inv-req-pk",
      quoteNonce: "nonce-1",
      noteNonce: "note-nonce-1",
      noteSalt: "note-salt-1",
    });
    assert.equal(drawNoPk.ok, false);
    assert.equal(drawNoPk.code, "MISSING_MERCHANT_PK");

    // Call draw with merchantPk -> must succeed
    const drawWithPk = await local.draw({
      quoteCommit,
      limit: 150,
      outstanding: 0,
      epoch: 0,
      amount: 40,
      expiry: 10_000,
      callerSk: AGENT_SK,
      agentSecret: AGENT_SK,
      salt: "salt-0",
      newSalt: "salt-1",
      invoiceId: "inv-req-pk",
      quoteNonce: "nonce-1",
      noteNonce: "note-nonce-1",
      noteSalt: "note-salt-1",
      merchantPk: MERCHANT_A_PK,
    });
    assert.equal(drawWithPk.ok, true);
  });
});
