import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
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

  it("lists all 11 Line protocol MCP tools", async () => {
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
    assert.equal(names.length, 11);
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

    // Real note but not yet expired (demo expiries are actionClock + 10000)
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

  it("FEE_SPEC: line.draw with fee accrues feeReserve; line.withdrawFees releases it", async () => {
    const seedRes = await handleMessage({
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: { name: "line.seed", arguments: { step: 3 } },
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

    const drawRes = await handleMessage({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: { name: "line.draw", arguments: { quoteId: qBody.quoteCommitment, fee: 5 } },
    });
    const dBody = JSON.parse(drawRes.result.content[0].text);
    assert.equal(dBody.ok, true);
    assert.equal(dBody.public.feeReserve, 5);
    assert.equal(dBody.public.encumberedReserve, 40); // note encumbers amount only
    assert.equal(dBody.public.withdrawableReserve, 500 - 40 - 5);

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
