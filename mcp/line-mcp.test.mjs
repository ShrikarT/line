import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("MCP interface", () => {
  let handleMessage;
  let dir;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "line-mcp-"));
    process.env.LINE_MCP_STATE = join(dir, "state.json");
    ({ handleMessage } = await import("./line-mcp.mjs"));
  });

  it("lists all 8 Wave 2 tools", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = res.result.tools.map((t) => t.name);
    assert.ok(names.includes("line.status"));
    assert.ok(names.includes("line.reserve.status"));
    assert.ok(names.includes("line.seed"));
    assert.ok(names.includes("line.quote"));
    assert.ok(names.includes("line.draw"));
    assert.ok(names.includes("line.note.status"));
    assert.ok(names.includes("line.redeem"));
    assert.ok(names.includes("line.repay"));
    assert.equal(names.length, 8);
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
    // Step 5 in Wave 2 demo is after draw 40: Note D1 is issued
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
    const { MERCHANT_B_SK } = await import("../src/lib/line/keys.ts");
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
});
