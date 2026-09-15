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
} from "./protocol.ts";
import {
  ISSUER_SK,
  MERCHANT_A_SK,
  MERCHANT_B_SK,
  AGENT_SK,
  INSTANCE_NONCE,
} from "./keys.ts";
import { handleMessage } from "../../../mcp/line-mcp.mjs";
import type { CircuitFail, CircuitOk, CircuitResult } from "./types.ts";

function assertOk<T extends object>(res: CircuitResult<T>): asserts res is CircuitOk<T> {
  assert.equal(res.ok, true, res.ok ? undefined : (res as CircuitFail).message);
}

describe("privacy and leakage boundaries", () => {
  it("credit book privacy: L, B, capacity, secrets, and salts never appear in public ledger", () => {
    const l0 = createLedger({
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

    // Public QuoteMeta contains merchantPk (pseudonym)
    const quoteMeta = quoted.ledger.quotes.find((q) => q.commitment === quoted.Q);
    assert.ok(quoteMeta, "QuoteMeta exists in ledger array");
    assert.ok(quoteMeta.merchantPk, "QuoteMeta contains merchantPk pseudonym");

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
