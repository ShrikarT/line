import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentId,
  contractDomain,
  drawNoteCommit,
  drawNullifier,
  fromHex,
  issuerPublicKey,
  lineStateCommit,
  merchantPublicKey,
  pad32,
  quoteCommit,
  redeemNullifier,
  repayNullifier,
  toHex,
} from "./encoding.ts";
import { boot, call, firstQuote, readLedger } from "./compact-harness.ts";
import { DEMO } from "../../test/fixtures/keys.ts";
import {
  createLedger,
  draw,
  drawNoteCommitment,
  fundReserve,
  identityCommitment,
  lineCommitment,
  openLine,
  postQuote,
  quoteCommitment,
  redeemDraw,
} from "./protocol.ts";
import { AGENT_SK, INSTANCE_NONCE, ISSUER_SK, MERCHANT_A_SK, MERCHANT_B_SK } from "../../test/fixtures/keys.ts";

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
  it("publicKey, agentId, domain, C, Q, D, draw N, redeem N, repay N match Compact", async () => {
    const session = await boot(DEMO.issuer, DEMO.merchantA, DEMO.instanceNonce);
    const L0 = readLedger(session);
    assert.equal(toHex(L0.issuer), toHex(issuerPublicKey(DEMO.issuer)));
    assert.equal(
      toHex(L0.contractDomain),
      toHex(contractDomain(L0.issuer, merchantPublicKey(DEMO.merchantA), DEMO.instanceNonce)),
    );

    // Issuer funds reserve
    const funded = await call(
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
        noteNonce: pad32("nn40"),
        noteSalt: pad32("ns40"),
        noteIdentity: pad32("0"),
        noteQuoteCommit: pad32("0"),
      },
      { name: "fundReserve", args: [500n] },
    );
    assert.equal(funded.ok, true);
    assert.equal(funded.ledger.totalReserve, 500n);

    // Issuer opens line
    const opened = await call(
      funded.session,
      {
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("pay"),
        noteNonce: pad32("nn40"),
        noteSalt: pad32("ns40"),
        noteIdentity: pad32("0"),
        noteQuoteCommit: pad32("0"),
      },
      { name: "openLine", args: [150n, 10_000n] },
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) throw new Error("open failed");
    assert.equal(opened.ledger.lineGeneration, 1n);
    const I = agentId(DEMO.agent);
    const C0 = lineStateCommit(
      { domain: opened.ledger.contractDomain, identity: I, limit: 150n, outstanding: 0n, epoch: 0n },
      pad32("salt-0"),
    );
    assert.equal(toHex(opened.ledger.identityCommit), toHex(I));
    assert.equal(toHex(opened.ledger.lineCommit), toHex(C0));

    // Merchant A posts quote
    const quoted = await call(
      opened.session,
      {
        callerSecret: DEMO.merchantA,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("pay"),
        noteNonce: pad32("nn40"),
        noteSalt: pad32("ns40"),
        noteIdentity: pad32("0"),
        noteQuoteCommit: pad32("0"),
      },
      { name: "postQuote", args: [40n, 10_000n] },
    );
    assert.equal(quoted.ok, true);
    if (!quoted.ok) throw new Error("quote failed");
    const mAPk = merchantPublicKey(DEMO.merchantA);
    const Q = quoteCommit({
      merchantPk: mAPk,
      invoiceId: pad32("inv-40"),
      amount: 40n,
      expiry: 10_000n,
      nonce: pad32("n40"),
      generation: 1n,
      domain: quoted.ledger.contractDomain,
    });
    assert.equal(toHex(firstQuote(quoted.ledger)!.Q), toHex(Q));
    assert.equal(firstQuote(quoted.ledger)!.lineGeneration, 1n);

    // Agent draws 40 -> creates draw note D
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
        noteNonce: pad32("nn40"),
        noteSalt: pad32("ns40"),
        noteIdentity: pad32("0"),
        noteQuoteCommit: pad32("0"),
      },
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, 10_000n] },
    );
    assert.equal(drawn.ok, true);
    if (!drawn.ok) throw new Error("draw failed");
    assert.equal(drawn.ledger.encumberedReserve, 40n);

    const Ndraw = drawNullifier(DEMO.agent, Q, quoted.ledger.contractDomain);
    const nList = [...drawn.ledger.nullifiers].map(toHex);
    assert.ok(nList.includes(toHex(Ndraw)));

    const D = drawNoteCommit(
      {
        domain: quoted.ledger.contractDomain,
        lineGeneration: 1n,
        identity: I,
        quoteCommit: Q,
        merchantPk: mAPk,
        amount: 40n,
        noteNonce: pad32("nn40"),
        expiry: 10_000n,
      },
      pad32("ns40"),
    );
    const noteKeys = [...drawn.ledger.notes].map(([D]) => toHex(D));
    assert.ok(noteKeys.includes(toHex(D)));

    // Merchant A redeems note D
    const redeemed = await call(
      drawn.session,
      {
        callerSecret: DEMO.merchantA,
        agentSecret: DEMO.agent,
        salt: pad32("salt-1"),
        newSalt: pad32("salt-2"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("pay"),
        noteNonce: pad32("nn40"),
        noteSalt: pad32("ns40"),
        noteIdentity: I,
        noteQuoteCommit: Q,
      },
      { name: "redeemDraw", args: [D, 40n, 10_000n] },
    );
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) throw new Error("redeem failed");
    assert.equal(redeemed.ledger.encumberedReserve, 0n);
    assert.equal(redeemed.ledger.redeemedReserve, 40n);

    const Nredeem = redeemNullifier(DEMO.merchantA, D, quoted.ledger.contractDomain);
    const redNulls = [...redeemed.ledger.nullifiers].map(toHex);
    assert.ok(redNulls.includes(toHex(Nredeem)));

    const C1 = lineStateCommit(
      { domain: quoted.ledger.contractDomain, identity: I, limit: 150n, outstanding: 40n, epoch: 1n },
      pad32("salt-1"),
    );
    assert.equal(toHex(drawn.ledger.lineCommit), toHex(C1));

    // Repayment ack
    const Nrepay = repayNullifier({
      nonce: pad32("r1"),
      identity: I,
      currentC: C1,
      amount: 40n,
      paymentRef: pad32("pay"),
      domain: quoted.ledger.contractDomain,
    });
    const ack = await call(
      redeemed.session,
      {
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-1"),
        newSalt: pad32("salt-2"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("pay"),
        noteNonce: pad32("nn40"),
        noteSalt: pad32("ns40"),
        noteIdentity: I,
        noteQuoteCommit: Q,
      },
      { name: "acknowledgeRepayment", args: [150n, 40n, 1n, 40n, 10_000n] },
    );
    assert.equal(ack.ok, true);
    if (!ack.ok) throw new Error("ack failed");
    const ns = [...ack.ledger.nullifiers].map(toHex);
    assert.ok(ns.includes(toHex(Nrepay)));
  });

  it("identical I, L, B, epoch, salt under different contract domains produce different C", () => {
    const I = agentId(DEMO.agent);
    const domainA = pad32("domain-A");
    const domainB = pad32("domain-B");
    const CA = lineStateCommit(
      { domain: domainA, identity: I, limit: 150n, outstanding: 0n, epoch: 0n },
      pad32("salt-0"),
    );
    const CB = lineStateCommit(
      { domain: domainB, identity: I, limit: 150n, outstanding: 0n, epoch: 0n },
      pad32("salt-0"),
    );
    assert.notEqual(toHex(CA), toHex(CB));
  });

  it("TypeScript reference engine uses the same encodings as Compact", () => {
    const ledger = createLedger({
      issuerSecret: ISSUER_SK,
      merchantSecret: MERCHANT_A_SK,
      instanceNonce: INSTANCE_NONCE,
    });
    const funded = fundReserve(ledger, { caller: ISSUER_SK, amount: 500 });
    assert.equal(funded.ok, true);
    if (!funded.ok) throw new Error("fund");

    const open = openLine(funded.ledger, {
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
      caller: MERCHANT_A_SK,
      amount: 40,
      invoiceId: "inv-40",
      expiry: 10_000,
      nonce: "n40",
    });
    assert.equal(q.ok, true);
    if (!q.ok) throw new Error("q");
    assert.equal(q.Q, quoteCommitment(q.quote, open.ledger.contractDomain));

    const drawn = draw(q.ledger, {
      agentSecret: AGENT_SK,
      witness: open.agent.witness!,
      quote: q.quote,
      newSalt: "salt-1",
      noteNonce: "nn40",
      noteSalt: "ns40",
    });
    assert.equal(drawn.ok, true);
    if (!drawn.ok) throw new Error("draw");
    assert.equal(drawn.note.D, drawNoteCommitment(drawn.note.preimage, drawn.note.salt));

    const redeemed = redeemDraw(drawn.ledger, {
      caller: MERCHANT_A_SK,
      noteCommitment: drawn.note.D,
      notePreimage: drawn.note.preimage,
      noteSalt: drawn.note.salt,
    });
    assert.equal(redeemed.ok, true);
  });
});
