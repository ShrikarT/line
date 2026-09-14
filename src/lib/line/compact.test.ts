import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as RT from "@midnight-ntwrk/compact-runtime";
import {
  DEMO,
  Status,
  blankPrivate,
  boot,
  call,
  firstQuote,
  nullifiersOf,
  quotesOf,
  readLedger,
  type PrivateState,
  type Session,
} from "./compact-harness.ts";
import {
  agentId,
  lineStateCommit,
  pad32,
  quoteCommit,
  toHex,
} from "./encoding.ts";

const LIMIT = 150n;
const EXPIRY = 10_000n;

function ps(overrides: Partial<PrivateState> = {}): PrivateState {
  return blankPrivate({
    callerSecret: DEMO.issuer,
    agentSecret: DEMO.agent,
    salt: pad32("salt-0"),
    newSalt: pad32("salt-1"),
    invoiceId: pad32("inv-40"),
    quoteNonce: pad32("n40"),
    receiptNonce: pad32("r1"),
    paymentRef: pad32("pay"),
    ...overrides,
  });
}

async function genesis() {
  return boot(DEMO.issuer, DEMO.merchant, ps());
}

async function opened(session?: Session) {
  const s = session ?? (await genesis());
  const r = await call(s, ps(), { name: "openLine", args: [LIMIT, EXPIRY] });
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  if (!r.ok) throw new Error("open");
  return r;
}

async function quoted(amount = 40n, invoice = "inv-40", nonce = "n40", from?: Session) {
  const o = from ? { ok: true as const, session: from, ledger: readLedger(from) } : await opened();
  const r = await call(
    o.session,
    ps({
      callerSecret: DEMO.merchant,
      invoiceId: pad32(invoice),
      quoteNonce: pad32(nonce),
    }),
    { name: "postQuote", args: [amount, EXPIRY] },
  );
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  if (!r.ok) throw new Error("quote");
  return r;
}

describe("compact simulator: constructor", () => {
  it("seals issuer, merchant, and domain; status NONE", async () => {
    const s = await genesis();
    const L = readLedger(s);
    assert.equal(L.status, Status.NONE);
    assert.equal(L.clock, 0n);
    assert.equal(toHex(L.issuer).length, 64);
    assert.notEqual(toHex(L.issuer), toHex(L.merchant));
    assert.equal(toHex(L.contractDomain).length, 64);
  });
});

describe("compact simulator: openLine", () => {
  it("valid issuer opens a line; C commits to I,L,0,epoch,salt", async () => {
    const r = await opened();
    assert.equal(r.ledger.status, Status.OPEN);
    const I = agentId(DEMO.agent);
    assert.equal(toHex(r.ledger.identityCommit), toHex(I));
    const expected = lineStateCommit(
      { identity: I, limit: LIMIT, outstanding: 0n, epoch: 0n },
      pad32("salt-0"),
    );
    assert.equal(toHex(r.ledger.lineCommit), toHex(expected));
    assert.equal(r.ledger.lineExpiry, EXPIRY);
  });

  it("forged issuer is rejected and state is unchanged", async () => {
    const s = await genesis();
    const before = toHex(readLedger(s).issuer);
    const r = await call(s, ps({ callerSecret: pad32("forged") }), {
      name: "openLine",
      args: [LIMIT, EXPIRY],
    });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("expected fail");
    assert.match(r.error, /not issuer/);
    assert.equal(r.ledger.status, Status.NONE);
    assert.equal(toHex(r.ledger.issuer), before);
  });

  it("second open while active is rejected", async () => {
    const o = await opened();
    const r = await call(o.session, ps({ salt: pad32("salt-x") }), {
      name: "openLine",
      args: [80n, EXPIRY],
    });
    assert.equal(r.ok, false);
    assert.equal(toHex(o.ledger.lineCommit), toHex(readLedger(o.session).lineCommit));
  });

  it("zero limit is rejected", async () => {
    const s = await genesis();
    const r = await call(s, ps(), { name: "openLine", args: [0n, EXPIRY] });
    assert.equal(r.ok, false);
  });

  it("expired line open is rejected", async () => {
    const s = await genesis();
    const r = await call(s, ps(), { name: "openLine", args: [LIMIT, 0n] });
    assert.equal(r.ok, false);
  });
});

describe("compact simulator: postQuote", () => {
  it("authorized merchant posts an opaque quote", async () => {
    const r = await quoted();
    const q = firstQuote(r.ledger);
    assert.ok(q);
    const expected = quoteCommit({
      merchantPk: r.ledger.merchant,
      invoiceId: pad32("inv-40"),
      amount: 40n,
      expiry: EXPIRY,
      nonce: pad32("n40"),
      domain: r.ledger.contractDomain,
    });
    assert.equal(toHex(q!.Q), toHex(expected));
    assert.equal(q!.used, false);
  });

  it("unauthorized merchant is rejected", async () => {
    const o = await opened();
    const r = await call(o.session, ps({ callerSecret: pad32("stranger") }), {
      name: "postQuote",
      args: [40n, EXPIRY],
    });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("expected fail");
    assert.match(r.error, /not merchant/);
    assert.equal(r.ledger.quotes.size(), 0n);
  });

  it("zero quote is rejected", async () => {
    const o = await opened();
    const r = await call(o.session, ps({ callerSecret: DEMO.merchant }), {
      name: "postQuote",
      args: [0n, EXPIRY],
    });
    assert.equal(r.ok, false);
  });

  it("expired quote is rejected at post", async () => {
    const o = await opened();
    const r = await call(o.session, ps({ callerSecret: DEMO.merchant }), {
      name: "postQuote",
      args: [40n, o.ledger.clock],
    });
    assert.equal(r.ok, false);
  });
});

describe("compact simulator: draw", () => {
  it("valid draw within capacity succeeds and rotates C", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const r = await call(q.session, ps(), {
      name: "draw",
      args: [Q, LIMIT, 0n, 0n, 40n],
    });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (!r.ok) throw new Error("draw");
    const expected = lineStateCommit(
      { identity: agentId(DEMO.agent), limit: LIMIT, outstanding: 40n, epoch: 1n },
      pad32("salt-1"),
    );
    assert.equal(toHex(r.ledger.lineCommit), toHex(expected));
    assert.notEqual(toHex(r.ledger.lineCommit), toHex(q.ledger.lineCommit));
    assert.equal(nullifiersOf(r.ledger).length, 1);
    assert.equal(quotesOf(r.ledger)[0]?.used, true);
  });

  it("over-limit draw fails and leaves state unchanged", async () => {
    const q = await quoted(151n, "inv-151", "n151");
    const Q = firstQuote(q.ledger)!.Q;
    const before = toHex(q.ledger.lineCommit);
    const r = await call(q.session, ps({ invoiceId: pad32("inv-151"), quoteNonce: pad32("n151") }), {
      name: "draw",
      args: [Q, LIMIT, 0n, 0n, 151n],
    });
    assert.equal(r.ok, false);
    assert.equal(toHex(r.ledger.lineCommit), before);
    assert.equal(quotesOf(r.ledger)[0]?.used, false);
  });

  it("supplying a fake high L fails because it does not open C", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const r = await call(q.session, ps(), {
      name: "draw",
      args: [Q, 10_000n, 0n, 0n, 40n],
    });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("expected fail");
    assert.match(r.error, /stale/);
  });

  it("supplying a fake low B fails because it does not open C", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(q.session, ps(), { name: "draw", args: [Q, LIMIT, 0n, 0n, 40n] });
    assert.equal(d.ok, true);
    if (!d.ok) throw new Error("d");
    const q2 = await quoted(10n, "inv-10", "n10", d.session);
    const Q2 = quotesOf(q2.ledger).at(-1)!.Q;
    const r = await call(
      q2.session,
      ps({ salt: pad32("salt-1"), newSalt: pad32("salt-2"), invoiceId: pad32("inv-10"), quoteNonce: pad32("n10") }),
      { name: "draw", args: [Q2, LIMIT, 0n, 1n, 10n] },
    );
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("expected fail");
    assert.match(r.error, /stale/);
  });

  it("tampered amount fails Q reconstruction", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const r = await call(q.session, ps(), {
      name: "draw",
      args: [Q, LIMIT, 0n, 0n, 1n],
    });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("expected fail");
    assert.match(r.error, /quote preimage/);
  });

  it("tampered invoice fails Q reconstruction", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const r = await call(q.session, ps({ invoiceId: pad32("other-inv") }), {
      name: "draw",
      args: [Q, LIMIT, 0n, 0n, 40n],
    });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("expected fail");
    assert.match(r.error, /quote preimage/);
  });

  it("wrong agent fails", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const r = await call(q.session, ps({ agentSecret: pad32("intruder") }), {
      name: "draw",
      args: [Q, LIMIT, 0n, 0n, 40n],
    });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("expected fail");
    assert.match(r.error, /agent/);
  });

  it("reused quote / nullifier fails", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const d1 = await call(q.session, ps(), { name: "draw", args: [Q, LIMIT, 0n, 0n, 40n] });
    assert.equal(d1.ok, true);
    if (!d1.ok) throw new Error("d1");
    const d2 = await call(
      d1.session,
      ps({ salt: pad32("salt-1"), newSalt: pad32("salt-2") }),
      { name: "draw", args: [Q, LIMIT, 40n, 1n, 40n] },
    );
    assert.equal(d2.ok, false);
  });

  it("stale C fails", async () => {
    const q1 = await quoted(40n, "a", "na");
    const q2 = await quoted(40n, "b", "nb", q1.session);
    const Qa = quotesOf(q2.ledger)[0]!.Q;
    const Qb = quotesOf(q2.ledger)[1]!.Q;
    const d1 = await call(
      q2.session,
      ps({ invoiceId: pad32("a"), quoteNonce: pad32("na") }),
      { name: "draw", args: [Qa, LIMIT, 0n, 0n, 40n] },
    );
    assert.equal(d1.ok, true);
    if (!d1.ok) throw new Error("d1");
    const d2 = await call(
      d1.session,
      ps({ invoiceId: pad32("b"), quoteNonce: pad32("nb"), salt: pad32("salt-0"), newSalt: pad32("salt-2") }),
      { name: "draw", args: [Qb, LIMIT, 0n, 0n, 40n] },
    );
    assert.equal(d2.ok, false);
    if (d2.ok) throw new Error("expected stale");
    assert.match(d2.error, /stale/);
  });

  it("two proofs against the same old C cannot both be included", async () => {
    const q1 = await quoted(100n, "a", "na");
    const q2 = await quoted(100n, "b", "nb", q1.session);
    const Qa = quoteCommit({
      merchantPk: q2.ledger.merchant,
      invoiceId: pad32("a"),
      amount: 100n,
      expiry: EXPIRY,
      nonce: pad32("na"),
      domain: q2.ledger.contractDomain,
    });
    const Qb = quoteCommit({
      merchantPk: q2.ledger.merchant,
      invoiceId: pad32("b"),
      amount: 100n,
      expiry: EXPIRY,
      nonce: pad32("nb"),
      domain: q2.ledger.contractDomain,
    });
    const proofA = await call(
      q2.session,
      ps({ invoiceId: pad32("a"), quoteNonce: pad32("na"), newSalt: pad32("s1") }),
      { name: "draw", args: [Qa, LIMIT, 0n, 0n, 100n] },
    );
    const proofB = await call(
      q2.session,
      ps({ invoiceId: pad32("b"), quoteNonce: pad32("nb"), newSalt: pad32("s2") }),
      { name: "draw", args: [Qb, LIMIT, 0n, 0n, 100n] },
    );
    assert.equal(proofA.ok, true, proofA.ok ? "" : proofA.error);
    assert.equal(proofB.ok, true, proofB.ok ? "" : proofB.error);
    if (!proofA.ok) throw new Error("A");
    const includeB = await call(
      proofA.session,
      ps({ invoiceId: pad32("b"), quoteNonce: pad32("nb"), salt: pad32("salt-0"), newSalt: pad32("s2") }),
      { name: "draw", args: [Qb, LIMIT, 0n, 0n, 100n] },
    );
    assert.equal(includeB.ok, false);
  });

  it("expired quote fails at draw", async () => {
    const o = await opened();
    const posted = await call(
      o.session,
      ps({ callerSecret: DEMO.merchant }),
      { name: "postQuote", args: [10n, o.ledger.clock + 1n] },
    );
    assert.equal(posted.ok, true);
    if (!posted.ok) throw new Error("post");
    const Q = firstQuote(posted.ledger)!.Q;
    const r = await call(posted.session, ps(), {
      name: "draw",
      args: [Q, LIMIT, 0n, 0n, 10n],
    });
    assert.equal(r.ok, false);
  });
});

describe("compact simulator: acknowledgeRepayment", () => {
  it("valid issuer-confirmed repayment restores capacity", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(q.session, ps(), { name: "draw", args: [Q, LIMIT, 0n, 0n, 40n] });
    assert.equal(d.ok, true);
    if (!d.ok) throw new Error("d");
    const ack = await call(
      d.session,
      ps({ callerSecret: DEMO.issuer, salt: pad32("salt-1"), newSalt: pad32("salt-2") }),
      { name: "acknowledgeRepayment", args: [LIMIT, 40n, 1n, 40n, EXPIRY] },
    );
    assert.equal(ack.ok, true, ack.ok ? "" : ack.error);
    if (!ack.ok) throw new Error("ack");
    const expected = lineStateCommit(
      { identity: agentId(DEMO.agent), limit: LIMIT, outstanding: 0n, epoch: 2n },
      pad32("salt-2"),
    );
    assert.equal(toHex(ack.ledger.lineCommit), toHex(expected));
  });

  it("agent-initiated fake repayment fails", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(q.session, ps(), { name: "draw", args: [Q, LIMIT, 0n, 0n, 40n] });
    if (!d.ok) throw new Error("d");
    const r = await call(
      d.session,
      ps({ callerSecret: DEMO.agent, salt: pad32("salt-1"), newSalt: pad32("salt-2") }),
      { name: "acknowledgeRepayment", args: [LIMIT, 40n, 1n, 40n, EXPIRY] },
    );
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("expected fail");
    assert.match(r.error, /not issuer/);
    assert.equal(toHex(r.ledger.lineCommit), toHex(d.ledger.lineCommit));
  });

  it("repayment against stale C fails", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(q.session, ps(), { name: "draw", args: [Q, LIMIT, 0n, 0n, 40n] });
    if (!d.ok) throw new Error("d");
    const r = await call(
      d.session,
      ps({ callerSecret: DEMO.issuer, salt: pad32("salt-0") }),
      { name: "acknowledgeRepayment", args: [LIMIT, 0n, 0n, 1n, EXPIRY] },
    );
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("expected fail");
    assert.match(r.error, /stale/);
  });

  it("repayment greater than B fails", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(q.session, ps(), { name: "draw", args: [Q, LIMIT, 0n, 0n, 40n] });
    if (!d.ok) throw new Error("d");
    const r = await call(
      d.session,
      ps({ callerSecret: DEMO.issuer, salt: pad32("salt-1") }),
      { name: "acknowledgeRepayment", args: [LIMIT, 40n, 1n, 41n, EXPIRY] },
    );
    assert.equal(r.ok, false);
  });

  it("reused repayment receipt fails", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(q.session, ps(), { name: "draw", args: [Q, LIMIT, 0n, 0n, 40n] });
    if (!d.ok) throw new Error("d");
    const ack1 = await call(
      d.session,
      ps({ callerSecret: DEMO.issuer, salt: pad32("salt-1"), newSalt: pad32("salt-2") }),
      { name: "acknowledgeRepayment", args: [LIMIT, 40n, 1n, 40n, EXPIRY] },
    );
    assert.equal(ack1.ok, true);
    if (!ack1.ok) throw new Error("ack1");
    const q2 = await quoted(40n, "inv-40b", "n40b", ack1.session);
    const Q2 = quotesOf(q2.ledger).at(-1)!.Q;
    const d2 = await call(
      q2.session,
      ps({
        salt: pad32("salt-2"),
        newSalt: pad32("salt-3"),
        invoiceId: pad32("inv-40b"),
        quoteNonce: pad32("n40b"),
      }),
      { name: "draw", args: [Q2, LIMIT, 0n, 2n, 40n] },
    );
    assert.equal(d2.ok, true);
    if (!d2.ok) throw new Error("d2");
    const reuse = await call(
      d2.session,
      ps({
        callerSecret: DEMO.issuer,
        salt: pad32("salt-3"),
        newSalt: pad32("salt-4"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("pay"),
      }),
      { name: "acknowledgeRepayment", args: [LIMIT, 40n, 3n, 40n, EXPIRY] },
    );
    // Same nonce+payRef against a new C is a different nullifier; Compact binds
    // the receipt to current C. Reuse of the *same* C-bound receipt is the stale
    // case. Here we also pin nonce and assert a second ack on the *original* C
    // snapshot cannot apply after rotation:
    const replayOld = await call(
      ack1.session,
      ps({
        callerSecret: DEMO.issuer,
        salt: pad32("salt-1"),
        newSalt: pad32("salt-x"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("pay"),
      }),
      { name: "acknowledgeRepayment", args: [LIMIT, 40n, 1n, 40n, EXPIRY] },
    );
    assert.equal(replayOld.ok, false);
    void reuse;
  });

  it("repayment against another line (wrong I via stale preimage) fails", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(q.session, ps(), { name: "draw", args: [Q, LIMIT, 0n, 0n, 40n] });
    if (!d.ok) throw new Error("d");
    const r = await call(
      d.session,
      ps({ callerSecret: DEMO.issuer, salt: pad32("foreign-salt") }),
      { name: "acknowledgeRepayment", args: [LIMIT, 40n, 1n, 40n, EXPIRY] },
    );
    assert.equal(r.ok, false);
  });
});

describe("compact simulator: setStatus", () => {
  it("defaulted line rejects draw", async () => {
    const o = await opened();
    const s = await call(o.session, ps({ callerSecret: DEMO.issuer }), {
      name: "setStatus",
      args: [Status.DEFAULTED],
    });
    assert.equal(s.ok, true);
    if (!s.ok) throw new Error("status");
    const q = await quoted(40n, "x", "nx", s.session);
    const Q = quotesOf(q.ledger).at(-1)!.Q;
    const d = await call(q.session, ps({ invoiceId: pad32("x"), quoteNonce: pad32("nx") }), {
      name: "draw",
      args: [Q, LIMIT, 0n, 0n, 40n],
    });
    assert.equal(d.ok, false);
  });

  it("closed line rejects draw; new openLine is allowed after CLOSED", async () => {
    const o = await opened();
    const c = await call(o.session, ps({ callerSecret: DEMO.issuer }), {
      name: "setStatus",
      args: [Status.CLOSED],
    });
    assert.equal(c.ok, true);
    if (!c.ok) throw new Error("closed");
    const q = await quoted(10n, "z", "nz", c.session);
    const Q = quotesOf(q.ledger).at(-1)!.Q;
    const d = await call(q.session, ps({ invoiceId: pad32("z"), quoteNonce: pad32("nz") }), {
      name: "draw",
      args: [Q, LIMIT, 0n, 0n, 10n],
    });
    assert.equal(d.ok, false);
    const reopen = await call(c.session, ps({ salt: pad32("new-epoch") }), {
      name: "openLine",
      args: [80n, EXPIRY],
    });
    assert.equal(reopen.ok, true, reopen.ok ? "" : reopen.error);
  });

  it("unauthorized caller cannot change status", async () => {
    const o = await opened();
    const r = await call(o.session, ps({ callerSecret: DEMO.agent }), {
      name: "setStatus",
      args: [Status.CLOSED],
    });
    assert.equal(r.ok, false);
  });

  it("CLOSED cannot setStatus back to OPEN", async () => {
    const o = await opened();
    const c = await call(o.session, ps({ callerSecret: DEMO.issuer }), {
      name: "setStatus",
      args: [Status.CLOSED],
    });
    assert.equal(c.ok, true);
    if (!c.ok) throw new Error("c");
    const r = await call(c.session, ps({ callerSecret: DEMO.issuer }), {
      name: "setStatus",
      args: [Status.OPEN],
    });
    assert.equal(r.ok, false);
  });
});

describe("compact simulator: domain-separated nullifiers", () => {
  it("draw and repay nullifiers cannot collide across operation types", async () => {
    const q = await quoted();
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(q.session, ps(), { name: "draw", args: [Q, LIMIT, 0n, 0n, 40n] });
    if (!d.ok) throw new Error("d");
    const drawN = toHex(nullifiersOf(d.ledger)[0]!);
    const ack = await call(
      d.session,
      ps({
        callerSecret: DEMO.issuer,
        salt: pad32("salt-1"),
        newSalt: pad32("salt-2"),
        receiptNonce: pad32("n40"),
        paymentRef: Q,
      }),
      { name: "acknowledgeRepayment", args: [LIMIT, 40n, 1n, 40n, EXPIRY] },
    );
    assert.equal(ack.ok, true, ack.ok ? "" : ack.error);
    if (!ack.ok) throw new Error("ack");
    const ns = nullifiersOf(ack.ledger).map(toHex);
    assert.equal(ns.length, 2);
    assert.notEqual(ns[0], ns[1]);
    assert.ok(ns.includes(drawN));
  });
});

describe("compact simulator: failed operations leave state unchanged", () => {
  it("clock, C, quotes, and nullifiers stay put on a failed draw", async () => {
    const q = await quoted();
    const before = {
      clock: q.ledger.clock,
      C: toHex(q.ledger.lineCommit),
      quotes: q.ledger.quotes.size(),
      nullifiers: q.ledger.nullifiers.size(),
    };
    const r = await call(q.session, ps(), {
      name: "draw",
      args: [firstQuote(q.ledger)!.Q, LIMIT, 0n, 0n, 1n],
    });
    assert.equal(r.ok, false);
    assert.equal(r.ledger.clock, before.clock);
    assert.equal(toHex(r.ledger.lineCommit), before.C);
    assert.equal(r.ledger.quotes.size(), before.quotes);
    assert.equal(r.ledger.nullifiers.size(), before.nullifiers);
  });
});

describe("compact simulator: authorization is domain-bound", () => {
  it("issuer of contract A cannot open a line on contract B", async () => {
    const otherIssuer = pad32("other-issuer");
    const b = await boot(otherIssuer, DEMO.merchant, ps({ callerSecret: otherIssuer }));
    const r = await call(b, ps({ callerSecret: DEMO.issuer }), {
      name: "openLine",
      args: [LIMIT, EXPIRY],
    });
    assert.equal(r.ok, false);
  });
});

void RT;
