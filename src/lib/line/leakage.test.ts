import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createLedger,
  fundReserve,
  openLine,
  postQuote,
  draw,
  redeemDraw,
  acknowledgeRepayment,
  setStatus,
  cancelOrExpireNote,
  publicLedgerView,
} from "./protocol.ts";
import {
  ISSUER_SK,
  MERCHANT_A_SK,
  MERCHANT_B_SK,
  AGENT_SK,
  INSTANCE_NONCE,
} from "../../test/fixtures/keys.ts";
import { handleMessage } from "../../../mcp/line-mcp.mjs";
import type { CircuitFail, CircuitOk, CircuitResult } from "./types.ts";

function assertOk<T extends object>(res: CircuitResult<T>): asserts res is CircuitOk<T> {
  assert.equal(res.ok, true, res.ok ? undefined : (res as CircuitFail).message);
}

describe("privacy and leakage boundaries", () => {
  it("different partial refunds publish the same full-cost reserve movements and no private remainder", () => {
    const outputs = [15, 25].map(repaid => {
      let now = 0;
      const initial = createLedger({ clock: () => now, issuerSecret: ISSUER_SK, merchantSecret: MERCHANT_A_SK, instanceNonce: INSTANCE_NONCE });
      const funded = fundReserve(initial, { caller: ISSUER_SK, amount: 500 }); assertOk(funded);
      const opened = openLine(funded.ledger, { caller: ISSUER_SK, agentSecret: AGENT_SK, feeFlat: 5, salt: "privacy-original", expiry: 10_000 }, { limit: 150 }); assertOk(opened);
      const quoted = postQuote(opened.ledger, { caller: MERCHANT_A_SK, invoiceId: "private-refund", nonce: "private-refund", expiry: 1_000 }, { amount: 40 }); assertOk(quoted);
      const drawn = draw(quoted.ledger, { agentSecret: AGENT_SK, quoteCommit: quoted.Q, fee: 5, noteNonce: "private-refund-note", noteSalt: "private-note-opening", newSalt: "private-draw" }, { books: opened.agent.witness!, quote: quoted.quote }); assertOk(drawn);
      const paid = acknowledgeRepayment(drawn.ledger, { caller: ISSUER_SK, newSalt: "private-paid" }, { books: drawn.agent.witness!, receipt: { identity: drawn.agent.witness!.I, currentC: drawn.ledger.lineCommitment!, amount: repaid, paymentRef: "private-payment", nonce: "private-payment", expiry: 2_000, contractDomain: drawn.ledger.contractDomain } }); assertOk(paid);
      now = 1_000;
      const allocated = cancelOrExpireNote(paid.ledger, { caller: AGENT_SK, action: 1, note: drawn.note, compensation: { note: drawn.note.preimage, noteSalt: drawn.note.salt, newSalt: "private-refund-opening", books: paid.witness } }); assertOk(allocated);
      assert.equal(allocated.refund!.amount, repaid);
      const beforeReport = publicLedgerView(allocated.ledger);
      assert.equal(beforeReport.refundReserve, 45); assert.equal(beforeReport.totalReserve, 500);
      const reported = cancelOrExpireNote(allocated.ledger, { caller: ISSUER_SK, action: 2, note: drawn.note, refundAck: { identity: allocated.refund!.identity, amount: repaid, salt: allocated.refund!.salt, paymentRef: "private-refund-rail-event", receiptExpiry: 2_000 } }); assertOk(reported);
      const afterReport = publicLedgerView(reported.ledger);
      assert.equal(afterReport.reportedRefundReserve, 45); assert.equal(afterReport.refundReserve, 0); assert.equal(afterReport.totalReserve, 500);
      for (const publicState of [beforeReport, afterReport]) {
        const serialized = JSON.stringify(publicState);
        for (const forbidden of ["refundDue", "refundAmount", "allocatedCredit", "outstanding", "private-refund-opening", "private-refund-rail-event", ISSUER_SK, AGENT_SK]) assert.ok(!serialized.includes(forbidden), `${forbidden} must remain private`);
        assert.equal(publicState.notes[0]!.cashRefundOwed, true); // A documented balance bound remains public.
      }
      return { beforeReport, afterReport };
    });
    for (const stage of ["beforeReport", "afterReport"] as const) {
      for (const field of ["totalReserve", "encumberedReserve", "redeemedReserve", "feeReserve", "pendingFeeReserve", "refundReserve", "reportedRefundReserve"] as const) assert.equal(outputs[0]![stage][field], outputs[1]![stage][field], `${stage}.${field} cannot reveal the different remainders`);
      assert.notEqual(outputs[0]![stage].notes[0]!.refundCommitment, outputs[1]![stage].notes[0]!.refundCommitment);
    }
  });

  it("credit-book openings and capacity are absent as direct public ledger fields", () => {
    const l0 = createLedger({
      clock: () => 0,
      issuerSecret: ISSUER_SK,
      merchantSecret: MERCHANT_A_SK,
      instanceNonce: INSTANCE_NONCE,
    });
    const funded = fundReserve(l0, { caller: ISSUER_SK, amount: 500 });
    assertOk(funded);

    const opened = openLine(funded.ledger, {
      caller: ISSUER_SK,
      agentSecret: AGENT_SK,
      limit: 150,
      salt: "salt-0",
      expiry: 10_000,
    });
    assertOk(opened);

    const ledger = opened.ledger;
    const serializedLedger = JSON.stringify(ledger);

    // 1. Credit limit L (150) and debt B (0) are private to the agent witness
    // The ledger stores only the commitment C, not L or B
    assert.ok(!("limit" in ledger), "limit must not be a public ledger property");
    assert.ok(!("outstanding" in ledger), "outstanding must not be a public ledger property");
    assert.ok(!("capacity" in ledger), "capacity must not be a public ledger property");
    assert.ok(!("agentSecret" in ledger), "agentSecret must not be on public ledger");
    assert.ok(!("salt" in ledger), "salt must not be on public ledger");

    // 2. Secret keys must never leak into serialized public state
    assert.ok(!serializedLedger.includes(ISSUER_SK), "issuer secret must not leak");
    assert.ok(!serializedLedger.includes(AGENT_SK), "agent secret must not leak");
    assert.ok(!serializedLedger.includes(MERCHANT_A_SK), "merchant secret must not leak");
  });

  it("honest amount disclosure: note amount and reserve deltas match transaction amount A", () => {
    const l0 = createLedger({
      clock: () => 0,
      issuerSecret: ISSUER_SK,
      merchantSecret: MERCHANT_A_SK,
      instanceNonce: INSTANCE_NONCE,
    });
    const funded = fundReserve(l0, { caller: ISSUER_SK, amount: 500 });
    assertOk(funded);
    const opened = openLine(funded.ledger, {
      caller: ISSUER_SK,
      agentSecret: AGENT_SK,
      limit: 150,
      salt: "salt-0",
      expiry: 10_000,
    });
    assertOk(opened);
    const quoted = postQuote(opened.ledger, {
      caller: MERCHANT_A_SK,
      amount: 40,
      invoiceId: "inv-40",
      expiry: 10_000,
      nonce: "nonce-40",
    });
    assertOk(quoted);

    const preDrawReserve = quoted.ledger.encumberedReserve;
    const drawn = draw(quoted.ledger, {
      agentSecret: AGENT_SK,
      witness: opened.agent.witness!,
      quote: quoted.quote,
      newSalt: "salt-1",
      noteNonce: "nn-40",
      noteSalt: "ns-40",
    });
    assertOk(drawn);

    // Delta encumbered reserve reveals draw amount A
    const postDrawReserve = drawn.ledger.encumberedReserve;
    const deltaEncumbered = postDrawReserve - preDrawReserve;
    assert.equal(deltaEncumbered, 40, "Delta encumberedReserve reveals draw amount 40");

    // Note metadata stores amount publicly for settlement redemption
    const noteMeta = drawn.ledger.notes.find((n) => n.commitment === drawn.note.D);
    assert.ok(noteMeta, "Note metadata exists on ledger");
    assert.equal(noteMeta.amount, 40, "Public NoteMeta.amount exposes settlement claim amount");

    // Redemption moves encumbered to redeemed
    const preRedeemEncumbered = drawn.ledger.encumberedReserve;
    const preRedeemRedeemed = drawn.ledger.redeemedReserve;
    const redeemed = redeemDraw(drawn.ledger, {
      caller: MERCHANT_A_SK,
      noteCommitment: drawn.note.D,
      notePreimage: drawn.note.preimage,
      noteSalt: drawn.note.salt,
    });
    assertOk(redeemed);

    const deltaRedeemed = redeemed.ledger.redeemedReserve - preRedeemRedeemed;
    const deltaEncumberedDrop = preRedeemEncumbered - redeemed.ledger.encumberedReserve;
    assert.equal(deltaRedeemed, 40, "Delta redeemedReserve equals settlement amount 40");
    assert.equal(deltaEncumberedDrop, 40, "Delta encumberedReserve drop equals settlement amount 40");
  });

  it("merchant linkability boundary: QuoteMeta links merchant pseudonym; note binds merchant privately", () => {
    const l0 = createLedger({
      clock: () => 0,
      issuerSecret: ISSUER_SK,
      merchantSecret: MERCHANT_A_SK,
      instanceNonce: INSTANCE_NONCE,
    });
    const opened = openLine(l0, {
      caller: ISSUER_SK,
      agentSecret: AGENT_SK,
      limit: 150,
      salt: "salt-0",
      expiry: 10_000,
    });
    assertOk(opened);

    const quoted = postQuote(opened.ledger, {
      caller: MERCHANT_A_SK,
      amount: 40,
      invoiceId: "inv-40",
      expiry: 10_000,
      nonce: "nonce-40",
    });
    assertOk(quoted);

    // Public QuoteMeta does not contain merchantPk (audit H3: unlinkability)
    const quoteMeta = quoted.ledger.quotes.find((q) => q.commitment === quoted.Q);
    assert.ok(quoteMeta, "QuoteMeta exists in ledger array");
    assert.equal("merchantPk" in quoteMeta, false, "QuoteMeta must not contain merchantPk");

    // Invoice ID and nonce are NOT stored on public ledger
    const serialized = JSON.stringify(quoted.ledger);
    assert.ok(!serialized.includes("inv-40"), "Invoice ID must not be stored on public ledger");
    assert.ok(!serialized.includes("nonce-40"), "Quote nonce must not be stored on public ledger");
  });

  it("MCP public state inspection conforms to privacy inventory", async () => {
    // Seed step 5 into MCP
    await handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "line.seed", arguments: { step: 5 } },
    });

    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "line.status", arguments: {} },
    });
    assert.ok(res.result, "line.status returns result");
    const text = res.result.content[0].text;
    const parsed = JSON.parse(text);

    // MCP status must not expose private credit book (limit, balance, capacity)
    assert.ok(!("limit" in parsed), "MCP public status must not include limit");
    assert.ok(!("outstanding" in parsed), "MCP public status must not include outstanding");
    assert.ok(!("capacity" in parsed), "MCP public status must not include capacity");
    assert.ok(!text.includes(ISSUER_SK), "MCP status must not leak issuer private key");
    assert.ok(!text.includes(AGENT_SK), "MCP status must not leak agent private key");
    assert.ok(!text.includes("salt-"), "MCP status must not leak commitment salts");
  });
});
