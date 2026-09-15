import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentId,
  contractDomain,
  drawNullifier,
  fromHex,
  issuerPublicKey,
  lineStateCommit,
  merchantPublicKey,
  pad32,
  quoteCommit,
  repayNullifier,
  toHex,
} from "./encoding.ts";
import { DEMO, boot, call, firstQuote, readLedger } from "./compact-harness.ts";
import { identityCommitment, lineCommitment, quoteCommitment } from "./protocol.ts";
import { AGENT_SK, ISSUER_SK, MERCHANT_SK } from "./keys.ts";
import { createLedger, openLine, postQuote } from "./protocol.ts";

describe("browser-safe hex", () => {
  it("round-trips 32-byte values without Node Buffer", () => {
    const bytes = pad32("line:demo:issuer");
    const hex = toHex(bytes);
    assert.equal(hex.length, 64);
    assert.equal(hex, hex.toLowerCase());
    assert.deepEqual(fromHex(hex), bytes);
    assert.deepEqual(fromHex("0x" + hex), bytes);
  });

  it("rejects malformed hex", () => {
    assert.throws(() => fromHex("aa"));
    assert.throws(() => fromHex("z".repeat(64)));
  });
});

describe("cross-language commitment vectors", () => {
  it("publicKey, agentId, domain, C, Q, draw N, repay N match Compact", async () => {
    const session = await boot(DEMO.issuer, DEMO.merchant);
    const L0 = readLedger(session);
    assert.equal(toHex(L0.issuer), toHex(issuerPublicKey(DEMO.issuer)));
    assert.equal(toHex(L0.merchant), toHex(merchantPublicKey(DEMO.merchant)));
    assert.equal(toHex(L0.contractDomain), toHex(contractDomain(L0.issuer, L0.merchant)));

    const opened = await call(
      session,
      {
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("pay"),
      },
      { name: "openLine", args: [150n, 10_000n] },
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) throw new Error("open failed");
    assert.equal(opened.ledger.lineGeneration, 1n);
    const I = agentId(DEMO.agent);
    const C0 = lineStateCommit(
      { identity: I, limit: 150n, outstanding: 0n, epoch: 0n },
      pad32("salt-0"),
    );
    assert.equal(toHex(opened.ledger.identityCommit), toHex(I));
    assert.equal(toHex(opened.ledger.lineCommit), toHex(C0));

    const quoted = await call(
      opened.session,
      {
        callerSecret: DEMO.merchant,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("pay"),
      },
      { name: "postQuote", args: [40n, 10_000n] },
    );
    assert.equal(quoted.ok, true);
    if (!quoted.ok) throw new Error("quote failed");
    const Q = quoteCommit({
      merchantPk: quoted.ledger.merchant,
      invoiceId: pad32("inv-40"),
      amount: 40n,
      expiry: 10_000n,
      nonce: pad32("n40"),
      generation: 1n,
      domain: quoted.ledger.contractDomain,
    });
    assert.equal(toHex(firstQuote(quoted.ledger)!.Q), toHex(Q));
    assert.equal(firstQuote(quoted.ledger)!.lineGeneration, 1n);

    const drawn = await call(
      quoted.session,
      {
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("pay"),
      },
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n] },
    );
    assert.equal(drawn.ok, true);
    if (!drawn.ok) throw new Error("draw failed");
    const Ndraw = drawNullifier(DEMO.agent, Q, quoted.ledger.contractDomain);
    const n0 = [...drawn.ledger.nullifiers][0]!;
    assert.equal(toHex(n0), toHex(Ndraw));

    const C1 = lineStateCommit(
      { identity: I, limit: 150n, outstanding: 40n, epoch: 1n },
      pad32("salt-1"),
    );
    assert.equal(toHex(drawn.ledger.lineCommit), toHex(C1));

    const Nrepay = repayNullifier({
      nonce: pad32("r1"),
      identity: I,
      currentC: C1,
      amount: 40n,
      paymentRef: pad32("pay"),
      domain: quoted.ledger.contractDomain,
    });
    const ack = await call(
      drawn.session,
      {
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-1"),
        newSalt: pad32("salt-2"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("pay"),
      },
      { name: "acknowledgeRepayment", args: [150n, 40n, 1n, 40n, 10_000n] },
    );
    assert.equal(ack.ok, true);
    if (!ack.ok) throw new Error("ack failed");
    const ns = [...ack.ledger.nullifiers].map(toHex);
    assert.ok(ns.includes(toHex(Nrepay)));
  });

  it("TypeScript reference engine uses the same encodings as Compact", () => {
    const ledger = createLedger({ issuerSecret: ISSUER_SK, merchantSecret: MERCHANT_SK });
    const open = openLine(ledger, {
      caller: ISSUER_SK,
      agentSecret: AGENT_SK,
      limit: 150,
      salt: "salt-0",
      expiry: 10_000,
    });
    assert.equal(open.ok, true);
    if (!open.ok) throw new Error("open");
    assert.equal(open.agent.witness!.I, identityCommitment(AGENT_SK));
    assert.equal(open.ledger.lineCommitment, lineCommitment(open.agent.witness!));
    const q = postQuote(open.ledger, {
      caller: MERCHANT_SK,
      amount: 40,
      invoiceId: "inv-40",
      expiry: 10_000,
      nonce: "n40",
    });
    assert.equal(q.ok, true);
    if (!q.ok) throw new Error("q");
    assert.equal(q.Q, quoteCommitment(q.quote, open.ledger.contractDomain));
  });
});
