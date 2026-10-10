import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MERCHANT_A_PK } from "../src/test/fixtures/keys.ts";

describe("MCP interface", () => {
  let handleMessage;
  let dir;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "line-mcp-"));
    process.env.LINE_MCP_STATE = join(dir, "state.json");
    ({ handleMessage } = await import("./line-mcp.mjs"));
  });

  it("lists all 13 Line protocol MCP tools", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = res.result.tools.map((t) => t.name);
    assert.ok(names.includes("line.status"));
    assert.ok(names.includes("line.reserve.status"));
    assert.ok(names.includes("line.seed"));
    assert.ok(names.includes("line.quote"));
    assert.ok(names.includes("line.draw"));
    assert.ok(names.includes("line.note.status"));
    assert.ok(names.includes("line.redeem"));
    assert.ok(names.includes("line.expireNote"));
    assert.ok(names.includes("line.withdrawFees"));
    assert.ok(names.includes("line.disableMerchant"));
    assert.ok(names.includes("line.repay"));
    assert.ok(names.includes("line.compensate"));
    assert.ok(names.includes("line.refund.acknowledge"));
    assert.equal(names.length, 13);
  });

  it("status on empty ledger is public-only", async () => {
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "line.status", arguments: {} },
    });
    const body = JSON.parse(res.result.content[0].text);
    assert.equal(body.status, "none");
    assert.equal(JSON.stringify(body).includes("150"), false);
  });

  it("reserve.status on empty ledger returns zeroed reserves", async () => {
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "line.reserve.status", arguments: {} },
    });
    const body = JSON.parse(res.result.content[0].text);
    assert.equal(body.total, 0);
    assert.equal(body.encumbered, 0);
    assert.equal(body.redeemed, 0);
    assert.equal(body.withdrawable, 0);
  });

  it("seed + draw note lifecycle through MCP tools", async () => {
    // Step 5 in reference flow is after draw 40: Note D1 is issued
    const seedRes = await handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "line.seed", arguments: { step: 5 } },
    });
    const seedBody = JSON.parse(seedRes.result.content[0].text);
    assert.equal(seedBody.ok, true);
    assert.equal(seedBody.step, 5);

    // Check status
    const statusRes = await handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "line.status", arguments: {} },
    });
    const pub = JSON.parse(statusRes.result.content[0].text);
    assert.equal(pub.status, "open");
    assert.ok(pub.lineCommitment);
    assert.equal(Object.prototype.hasOwnProperty.call(pub, "limit"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(pub, "balance"), false);

    // Reserve check: 500 total, 40 encumbered, 0 redeemed, 460 withdrawable
    const reserveRes = await handleMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "line.reserve.status", arguments: {} },
    });
    const resv = JSON.parse(reserveRes.result.content[0].text);
    assert.equal(resv.totalReserve, 500);
    assert.equal(resv.encumberedReserve, 40);
    assert.equal(resv.redeemedReserve, 0);
    assert.equal(resv.withdrawableReserve, 460);

    // Check used quote replay rejection
    const usedQ = pub.quotes.find((q) => q.used)?.commitment;
    assert.ok(usedQ);
    const drawReplay = await handleMessage({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "line.draw", arguments: { quoteId: usedQ } },
    });
    const replayBody = JSON.parse(drawReplay.result.content[0].text);
    assert.equal(replayBody.ok, false);
    assert.equal(replayBody.message, "Clearance could not be proven.");

    // Note status check
    const notesRes = await handleMessage({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "line.note.status", arguments: {} },
    });
    const notesList = JSON.parse(notesRes.result.content[0].text);
    assert.equal(notesList.length, 1);
    assert.equal(notesList[0].amount, 40);
    assert.equal(notesList[0].redeemed, false);

    const noteD = notesList[0].commitment;

    // Wrong merchant redemption rejection
    const { MERCHANT_B_SK } = await import("../src/test/fixtures/keys.ts");
    const wrongRedeem = await handleMessage({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "line.redeem",
        arguments: { noteCommitment: noteD, merchantSecret: MERCHANT_B_SK },
      },
    });
    const wrongBody = JSON.parse(wrongRedeem.result.content[0].text);
    assert.equal(wrongBody.ok, false);

    // Legitimate merchant redemption
    const rightRedeem = await handleMessage({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "line.redeem",
        arguments: { noteCommitment: noteD },
      },
    });
    const rightBody = JSON.parse(rightRedeem.result.content[0].text);
    assert.equal(rightBody.ok, true);
    assert.ok(rightBody.nullifier);

    // Reserve check after redeem: total 500, encumbered 0, redeemed 40, withdrawable 460
    const resvAfter = await handleMessage({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "line.reserve.status", arguments: {} },
    });
    const resvAfterBody = JSON.parse(resvAfter.result.content[0].text);
    assert.equal(resvAfterBody.encumberedReserve, 0);
    assert.equal(resvAfterBody.redeemedReserve, 40);
    assert.equal(resvAfterBody.withdrawableReserve, 460);

    // Double-redeem attack rejection
    const doubleRedeem = await handleMessage({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "line.redeem",
        arguments: { noteCommitment: noteD },
      },
    });
    const doubleBody = JSON.parse(doubleRedeem.result.content[0].text);
    assert.equal(doubleBody.ok, false);

    // Issuer repayment
    const repayRes = await handleMessage({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: { name: "line.repay", arguments: { amount: 40 } },
    });
    const repayBody = JSON.parse(repayRes.result.content[0].text);
    assert.equal(repayBody.ok, true);
    assert.equal(repayBody.public.nullifiers.length >= 2, true);
  });

  it("M5 regression: >32-byte invoiceId returns {ok:false} and the server survives", async () => {
    const quoteRes = await handleMessage({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: { name: "line.quote", arguments: { amount: 10, invoiceId: "x".repeat(40) } },
    });
    const body = JSON.parse(quoteRes.result.content[0].text);
    assert.equal(body.ok, false);
    assert.match(body.message, /32 bytes/i);

    // Server must still answer the next request (previously this crashed stdio).
    const statusRes = await handleMessage({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: { name: "line.status", arguments: {} },
    });
    const pub = JSON.parse(statusRes.result.content[0].text);
    assert.equal(pub.status, "open");
  });

  it("L10: notifications get no response; unknown tool/method get spec-correct codes", async () => {
    const notif = await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(notif, undefined);

    const unknownTool = await handleMessage({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: { name: "line.nope", arguments: {} },
    });
    assert.equal(unknownTool.error.code, -32602);

    const unknownMethod = await handleMessage({ jsonrpc: "2.0", id: 23, method: "bogus/method" });
    assert.equal(unknownMethod.error.code, -32601);
  });

  it("L10: line.seed rejects non-numeric/NaN step instead of mislabeled snapshots", async () => {
    for (const bad of ["abc", NaN, 19, -1, 2.5]) {
      const res = await handleMessage({
        jsonrpc: "2.0",
        id: 24,
        method: "tools/call",
        params: { name: "line.seed", arguments: { step: bad } },
      });
      const body = JSON.parse(res.result.content[0].text);
      assert.equal(body.ok, false);
    }
  });

  it("L9: line.expireNote returns clean failures without crashing", async () => {
    const seedRes = await handleMessage({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: { name: "line.seed", arguments: { step: 5 } },
    });
    const seedBody = JSON.parse(seedRes.result.content[0].text);
    assert.equal(seedBody.ok, true);

    // Unknown commitment
    const miss = await handleMessage({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: { name: "line.expireNote", arguments: { noteCommitment: "dead".repeat(16) } },
    });
    assert.equal(JSON.parse(miss.result.content[0].text).ok, false);

    // Real note but not yet expired (demo deadlines use future Unix seconds).
    const noteD = seedBody.public.notes[0].commitment;
    const early = await handleMessage({
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: { name: "line.expireNote", arguments: { noteCommitment: noteD } },
    });
    const earlyBody = JSON.parse(early.result.content[0].text);
    assert.equal(earlyBody.ok, false);
    assert.match(earlyBody.message, /not expired/i);
  });

  it("persists Unix-seconds deadlines and rejects legacy state until an explicit simulator reset", async () => {
    const invoke = (name, args = {}) => handleMessage({ jsonrpc: "2.0", id: 60, method: "tools/call", params: { name, arguments: args } });
    const seeded = await invoke("line.seed", { step: 5 });
    const body = JSON.parse(seeded.result.content[0].text);
    assert.equal(body.ok, true);
    assert.equal(body.public.deadlineUnits, "unix-seconds");
    const path = join(dir, "state.json");
    const state = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(state.deadlineUnits, "unix-seconds");
    assert.ok(state.ledger.lineExpiry > Math.floor(Date.now() / 1000));
    assert.ok(state.ledger.notes[0].expiry > Math.floor(Date.now() / 1000));
    for (const units of [undefined, "action-count"]) {
      const legacy = { ...state, deadlineUnits: units };
      const serialized = JSON.stringify(legacy);
      writeFileSync(path, serialized);
      for (const name of ["line.status", "line.quote", "line.expireNote"]) {
        const rejected = await invoke(name, { amount: 1, invoiceId: "cannot-reinterpret", noteCommitment: state.ledger.notes[0].commitment });
        assert.equal(rejected.error.code, -32603);
        assert.match(rejected.error.message, /line\.seed.*reset.*action-count deadlines cannot be converted/i);
        assert.equal(readFileSync(path, "utf8"), serialized, "rejected legacy state was not silently rewritten");
      }
    }
    const reset = await invoke("line.seed", { step: 3 });
    assert.equal(JSON.parse(reset.result.content[0].text).ok, true);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).deadlineUnits, "unix-seconds");
    assert.equal((await invoke("line.status")).error, undefined);
  });

  it("FEE_SPEC: draw locks pending fees and only merchant redemption earns withdrawable fees", async () => {
    const seedRes = await handleMessage({
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: { name: "line.seed", arguments: { step: 3, feeFlat: 5, feeBps: 0 } },
    });
    assert.equal(JSON.parse(seedRes.result.content[0].text).ok, true);

    const quoteRes = await handleMessage({
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: { name: "line.quote", arguments: { amount: 40, invoiceId: "fee-inv" } },
    });
    const qBody = JSON.parse(quoteRes.result.content[0].text);
    assert.equal(qBody.ok, true);

    for (const fee of [0, 6]) {
      const rejected = await handleMessage({ jsonrpc: "2.0", id: 45, method: "tools/call", params: { name: "line.draw", arguments: { quoteId: qBody.quoteCommitment, fee } } });
      const body = JSON.parse(rejected.result.content[0].text);
      assert.equal(body.ok, false);
      assert.equal(body.message, "Clearance could not be proven.");
    }

    const drawRes = await handleMessage({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: { name: "line.draw", arguments: { quoteId: qBody.quoteCommitment, fee: 5 } },
    });
    const dBody = JSON.parse(drawRes.result.content[0].text);
    assert.equal(dBody.ok, true);
    assert.equal(dBody.public.feeReserve, 0);
    assert.equal(dBody.public.pendingFeeReserve, 5);
    assert.equal(dBody.public.encumberedReserve, 40); // note encumbers amount only
    assert.equal(dBody.public.withdrawableReserve, 500 - 40 - 5);

    const pendingWithdrawal = await handleMessage({ jsonrpc: "2.0", id: 47, method: "tools/call", params: { name: "line.withdrawFees", arguments: {} } });
    assert.equal(JSON.parse(pendingWithdrawal.result.content[0].text).ok, false);
    const redeemed = await handleMessage({ jsonrpc: "2.0", id: 48, method: "tools/call", params: { name: "line.redeem", arguments: { noteCommitment: dBody.noteCommitment } } });
    const redeemedBody = JSON.parse(redeemed.result.content[0].text);
    assert.equal(redeemedBody.ok, true);
    assert.equal(redeemedBody.public.pendingFeeReserve, 0);
    assert.equal(redeemedBody.public.feeReserve, 5);

    const wfRes = await handleMessage({
      jsonrpc: "2.0",
      id: 43,
      method: "tools/call",
      params: { name: "line.withdrawFees", arguments: {} },
    });
    const wfBody = JSON.parse(wfRes.result.content[0].text);
    assert.equal(wfBody.ok, true);
    assert.equal(wfBody.fees, 5);
    assert.equal(wfBody.public.feeReserve, 0);
    assert.equal(wfBody.public.totalReserve, 495);

    // Second withdrawal with zero accrued fees is rejected, not a crash.
    const wf2 = await handleMessage({
      jsonrpc: "2.0",
      id: 44,
      method: "tools/call",
      params: { name: "line.withdrawFees", arguments: {} },
    });
    assert.equal(JSON.parse(wf2.result.content[0].text).ok, false);
  });

  it("uses issuer fee policy when draw fee is omitted and refuses legacy unpriced state", async () => {
    const invoke = (name, args = {}) => handleMessage({ jsonrpc: "2.0", id: 46, method: "tools/call", params: { name, arguments: args } });
    const seed = JSON.parse((await invoke("line.seed", { step: 3, feeFlat: 3, feeBps: 250 })).result.content[0].text);
    assert.equal(seed.ok, true);
    assert.equal(seed.public.feeFlat, 3);
    assert.equal(seed.public.feeBps, 250);
    const quoted = JSON.parse((await invoke("line.quote", { amount: 41, invoiceId: "rounded-mcp-fee" })).result.content[0].text);
    assert.equal(quoted.ok, true);
    const drawn = JSON.parse((await invoke("line.draw", { quoteId: quoted.quoteCommitment })).result.content[0].text);
    assert.equal(drawn.ok, true);
    assert.equal(drawn.public.pendingFeeReserve, 5, "ceil(41*250/10000)+3 is exactly 5");
    assert.equal(drawn.public.feeReserve, 0);
    assert.equal(drawn.public.encumberedReserve, 41);
    const path = join(dir, "state.json");
    const state = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(state.feePolicy, "flat-plus-ceil-bps-v1");
    for (const legacy of [{ ...state, feePolicy: undefined }, { ...state, ledger: { ...state.ledger, feeFlat: undefined } }]) {
      const serialized = JSON.stringify(legacy);
      writeFileSync(path, serialized);
      const rejected = await invoke("line.status");
      assert.match(rejected.error.message, /fee.*line\.seed|line\.seed.*fee/i);
      assert.equal(readFileSync(path, "utf8"), serialized);
    }
    assert.equal(JSON.parse((await invoke("line.seed", { step: 3 })).result.content[0].text).ok, true);
  });

  it("expires, allocates compensation and reports a private cash refund without releasing its unverified reserve hold", async (t) => {
    let now = Math.floor(Date.now() / 1000);
    t.mock.method(Date, "now", () => now * 1000);
    const invoke = async (name, args = {}) => {
      const response = await handleMessage({ jsonrpc: "2.0", id: 49, method: "tools/call", params: { name, arguments: args } });
      assert.equal(response.error, undefined);
      return JSON.parse(response.result.content[0].text);
    };
    assert.equal((await invoke("line.seed", { step: 3, feeFlat: 5, feeBps: 0 })).ok, true);
    const quote = await invoke("line.quote", { amount: 40, invoiceId: "mcp-compensation" });
    assert.equal(quote.ok, true);
    const drawn = await invoke("line.draw", { quoteId: quote.quoteCommitment });
    assert.equal(drawn.ok, true);
    const D = drawn.noteCommitment;
    assert.equal((await invoke("line.repay", { amount: 20 })).ok, true);
    const stored = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    now = stored.ledger.notes.find(note => note.commitment === D).expiry;
    const expired = await invoke("line.expireNote", { noteCommitment: D });
    assert.equal(expired.ok, true);
    assert.equal(expired.public.refundReserve, 45);
    assert.equal(expired.public.pendingFeeReserve, 0);
    assert.equal(expired.public.feeReserve, 0);
    const allocated = await invoke("line.compensate", { noteCommitment: D });
    assert.equal(allocated.ok, true);
    assert.equal(allocated.public.refundReserve, 45);
    const note = allocated.public.notes.find(note => note.commitment === D);
    assert.equal(note.compensationAllocated, true);
    assert.equal(note.cashRefundOwed, true);
    assert.equal(note.refundAcknowledged, false);
    assert.equal(note.refundPaymentNullifier, "0".repeat(64));
    assert.equal("refundAmount" in note, false);
    assert.equal("allocatedCredit" in note, false);
    const privateAllocation = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    assert.equal(privateAllocation.compensationPolicy, "private-refund-full-cost-lock-v1");
    assert.equal(privateAllocation.agent.witness.B, 0);
    assert.equal(privateAllocation.refunds[0].amount, 20);
    assert.equal(privateAllocation.refunds[0].allocatedCredit, 25);
    assert.equal(privateAllocation.refunds[0].status, "allocated");
    assert.equal(JSON.stringify(allocated).includes(privateAllocation.refunds[0].salt), false);
    assert.equal(JSON.stringify(allocated).includes("allocatedCredit"), false);
    assert.equal((await invoke("line.compensate", { noteCommitment: D })).ok, false);
    const acknowledged = await invoke("line.refund.acknowledge", { noteCommitment: D, paymentRef: "wire-mcp-compensation-refund" });
    assert.equal(acknowledged.ok, true);
    assert.equal(acknowledged.public.refundReserve, 0);
    assert.equal(acknowledged.public.reportedRefundReserve, 45);
    assert.equal(acknowledged.public.withdrawableReserve, 455);
    assert.equal(acknowledged.public.totalReserve, 500);
    const attributed = acknowledged.public.notes.find(note => note.commitment === D).refundPaymentNullifier;
    assert.notEqual(attributed, "0".repeat(64));
    assert.ok(acknowledged.public.nullifiers.includes(attributed));
    assert.match(acknowledged.message, /No cash payment is verified/i);
    const privateReport = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    assert.equal(privateReport.refunds[0].status, "issuer-reported");
    assert.equal(privateReport.refunds[0].paymentReference, "wire-mcp-compensation-refund");
    assert.equal(JSON.stringify(acknowledged).includes("wire-mcp-compensation-refund"), false);
    assert.equal((await invoke("line.refund.acknowledge", { noteCommitment: D, paymentRef: "another-refund" })).ok, false);
  });

  it("requires explicit compensation state migration and preserves rejected files", async () => {
    const invoke = (name, args = {}) => handleMessage({ jsonrpc: "2.0", id: 70, method: "tools/call", params: { name, arguments: args } });
    await invoke("line.seed", { step: 5, feeFlat: 5 });
    const path = join(dir, "state.json"), original = JSON.parse(readFileSync(path, "utf8"));
    const candidates = [
      { ...original, compensationPolicy: undefined },
      { ...original, compensationPolicy: "legacy-public-refund" },
      { ...original, refunds: undefined },
      { ...original, ledger: { ...original.ledger, pendingFeeReserve: undefined } },
      { ...original, ledger: { ...original.ledger, refundReserve: -1 } },
      { ...original, ledger: { ...original.ledger, reportedRefundReserve: 501 } },
      { ...original, ledger: { ...original.ledger, notes: original.ledger.notes.map(n => ({ ...n, fee: undefined })) } },
      { ...original, ledger: { ...original.ledger, notes: original.ledger.notes.map(n => ({ ...n, refundPaymentNullifier: undefined })) } },
      { ...original, notes: original.notes.map(n => ({ ...n, preimage: { ...n.preimage, fee: undefined } })) },
    ];
    for (const candidate of candidates) {
      const serialized = JSON.stringify(candidate); writeFileSync(path, serialized);
      for (const name of ["line.status", "line.note.status", "line.compensate", "line.refund.acknowledge"]) {
        const rejected = await invoke(name, { noteCommitment: original.notes[0].D, paymentRef: "cannot-migrate" });
        assert.equal(rejected.error.code, -32603);
        assert.match(rejected.error.message, /compensation.*line\.seed/i);
        assert.equal(readFileSync(path, "utf8"), serialized);
      }
    }
    const reset = await invoke("line.seed", { step: 3 });
    assert.equal(JSON.parse(reset.result.content[0].text).ok, true);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).refunds, []);
    assert.equal((await invoke("line.status")).error, undefined);
  });

  it("compensates a fully unpaid purchase without creating cash and rejects premature or unknown claims", async t => {
    let now = Math.floor(Date.now() / 1000); t.mock.method(Date, "now", () => now * 1000);
    const invoke = async (name, args = {}) => {
      const response = await handleMessage({ jsonrpc: "2.0", id: 71, method: "tools/call", params: { name, arguments: args } });
      assert.equal(response.error, undefined); return JSON.parse(response.result.content[0].text);
    };
    const seeded = await invoke("line.seed", { step: 5, feeFlat: 5 });
    const D = seeded.public.notes[0].commitment, path = join(dir, "state.json"), before = readFileSync(path, "utf8");
    for (const args of [{}, { noteCommitment: 12 }, { noteCommitment: "missing" }, { noteCommitment: D }]) assert.equal((await invoke("line.compensate", args)).ok, false);
    assert.equal(readFileSync(path, "utf8"), before);
    now = seeded.public.notes[0].expiry;
    const allocated = await invoke("line.compensate", { noteCommitment: D });
    assert.equal(allocated.ok, true); assert.equal(allocated.public.refundReserve, 0);
    assert.equal(allocated.public.withdrawableReserve, 500); assert.equal(allocated.public.notes[0].cashRefundOwed, false);
    const stored = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(stored.agent.witness.B, 0); assert.equal(stored.refunds[0].amount, 0); assert.equal(stored.refunds[0].allocatedCredit, 45);
    assert.equal((await invoke("line.refund.acknowledge", { noteCommitment: D, paymentRef: "cannot-report-zero" })).ok, false);
    assert.equal((await invoke("line.withdrawFees")).ok, false);
    assert.equal((await invoke("line.redeem", { noteCommitment: D })).ok, false);
  });

  it("prevents payment reference reuse between repayment and two refunds with exact long-string identities", async t => {
    let now = Math.floor(Date.now() / 1000); t.mock.method(Date, "now", () => now * 1000);
    const invoke = async (name, args = {}) => {
      const response = await handleMessage({ jsonrpc: "2.0", id: 72, method: "tools/call", params: { name, arguments: args } });
      assert.equal(response.error, undefined); return JSON.parse(response.result.content[0].text);
    };
    await invoke("line.seed", { step: 3, feeFlat: 5 });
    const notes = [];
    for (const [amount, invoiceId] of [[40, "first-compensated"], [20, "second-compensated"]]) {
      const quote = await invoke("line.quote", { amount, invoiceId }); assert.equal(quote.ok, true);
      const draw = await invoke("line.draw", { quoteId: quote.quoteCommitment }); assert.equal(draw.ok, true);
      notes.push(draw.noteCommitment);
    }
    const inboundRef = "rail/bank/durable-event/" + "a".repeat(80);
    assert.equal((await invoke("line.repay", { amount: 50, paymentRef: inboundRef })).ok, true);
    const path = join(dir, "state.json"), stored = JSON.parse(readFileSync(path, "utf8"));
    now = Math.max(...stored.ledger.notes.map(note => note.expiry));
    for (const D of notes) assert.equal((await invoke("line.compensate", { noteCommitment: D })).ok, true);
    assert.equal((await invoke("line.refund.acknowledge", { noteCommitment: notes[0], paymentRef: inboundRef })).ok, false);
    const prefix = "rail/refund/" + "same-prefix".repeat(15);
    for (const paymentRef of [undefined, "", " whitespace", 12, "x".repeat(4097)]) assert.equal((await invoke("line.refund.acknowledge", { noteCommitment: notes[0], paymentRef })).ok, false);
    const first = await invoke("line.refund.acknowledge", { noteCommitment: notes[0], paymentRef: prefix + "/first" }); assert.equal(first.ok, true);
    const beforeRepeated = readFileSync(path, "utf8");
    const repeated = await invoke("line.refund.acknowledge", { noteCommitment: notes[1], paymentRef: prefix + "/first" }); assert.equal(repeated.ok, false);
    assert.match(repeated.message, /used/i); assert.equal(readFileSync(path, "utf8"), beforeRepeated);
    const unreportedNote = JSON.parse(beforeRepeated).ledger.notes.find(note => note.commitment === notes[1]);
    assert.equal(unreportedNote.refundPaymentNullifier, "0".repeat(64));
    const second = await invoke("line.refund.acknowledge", { noteCommitment: notes[1], paymentRef: prefix + "/second" }); assert.equal(second.ok, true);
    assert.equal(second.public.refundReserve, 0); assert.equal(second.public.reportedRefundReserve, 70);
    assert.equal(second.public.totalReserve, 500); assert.equal(second.public.withdrawableReserve, 430);
    const final = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(final.refunds.map(refund => refund.amount), [25, 25]);
    assert.deepEqual(final.refunds.map(refund => refund.paymentReference), [prefix + "/first", prefix + "/second"]);
    const [firstPaymentN, secondPaymentN] = notes.map(D => final.ledger.notes.find(note => note.commitment === D).refundPaymentNullifier);
    assert.notEqual(firstPaymentN, secondPaymentN);
    assert.ok(final.ledger.nullifiers.includes(firstPaymentN)); assert.ok(final.ledger.nullifiers.includes(secondPaymentN));
    const status = await invoke("line.status"), noteStatus = await invoke("line.note.status", { noteCommitment: notes[1] });
    for (const output of [first, second, status, noteStatus]) {
      const serialized = JSON.stringify(output);
      for (const privateValue of ["allocatedCredit", "refundAmount", "refundDue", "paymentReference", final.refunds[0].salt, final.refunds[1].salt, prefix]) assert.equal(serialized.includes(privateValue), false);
    }
  });

  it("L2: line.disableMerchant blocks new quotes; pre-disable quotes stay drawable", async () => {
    const seedRes = await handleMessage({
      jsonrpc: "2.0",
      id: 50,
      method: "tools/call",
      params: { name: "line.seed", arguments: { step: 3 } },
    });
    assert.equal(JSON.parse(seedRes.result.content[0].text).ok, true);

    // Quote posted while merchant A is enabled succeeds.
    const q1 = await handleMessage({
      jsonrpc: "2.0",
      id: 51,
      method: "tools/call",
      params: { name: "line.quote", arguments: { amount: 40, invoiceId: "pre-disable-inv" } },
    });
    const q1Body = JSON.parse(q1.result.content[0].text);
    assert.equal(q1Body.ok, true);

    // Issuer disables merchant A.
    const dis = await handleMessage({
      jsonrpc: "2.0",
      id: 52,
      method: "tools/call",
      params: { name: "line.disableMerchant", arguments: { merchantPk: MERCHANT_A_PK } },
    });
    const disBody = JSON.parse(dis.result.content[0].text);
    assert.equal(disBody.ok, true);
    assert.equal(disBody.merchantPk, MERCHANT_A_PK);

    // New quotes from the disabled merchant are rejected.
    const q2 = await handleMessage({
      jsonrpc: "2.0",
      id: 53,
      method: "tools/call",
      params: { name: "line.quote", arguments: { amount: 20, invoiceId: "post-disable-inv" } },
    });
    const q2Body = JSON.parse(q2.result.content[0].text);
    assert.equal(q2Body.ok, false);
    assert.ok(q2Body.message.toLowerCase().includes("disabled"));

    // The already-posted quote stays drawable (membership-only check).
    const d = await handleMessage({
      jsonrpc: "2.0",
      id: 54,
      method: "tools/call",
      params: { name: "line.draw", arguments: { quoteId: q1Body.quoteCommitment } },
    });
    const dBody = JSON.parse(d.result.content[0].text);
    assert.equal(dBody.ok, true);
    assert.equal(dBody.public.encumberedReserve, 40);

    // Disabling an unknown merchant fails cleanly.
    const bad = await handleMessage({
      jsonrpc: "2.0",
      id: 55,
      method: "tools/call",
      params: { name: "line.disableMerchant", arguments: { merchantPk: "ab".repeat(32) } },
    });
    assert.equal(JSON.parse(bad.result.content[0].text).ok, false);
  });
});
