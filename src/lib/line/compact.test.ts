import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEMO,
  Status,
  blankPrivate,
  boot,
  bootWithPk,
  call,
  firstQuote,
  notesOf,
  nullifiersOf,
  quotesOf,
  readLedger,
  type PrivateState,
  type Session,
} from "./compact-harness.ts";
import {
  agentId,
  contractDomain,
  drawNoteCommit,
  drawNullifier,
  issuerPublicKey,
  lineStateCommit,
  merchantPublicKey,
  pad32,
  quoteCommit,
  redeemNullifier,
  repayNullifier,
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
    noteNonce: pad32("nn-40"),
    noteSalt: pad32("ns-40"),
    noteIdentity: agentId(DEMO.agent),
    noteQuoteCommit: pad32("0"),
    ...overrides,
  });
}

async function genesis(instanceNonce?: Uint8Array) {
  return boot(DEMO.issuer, DEMO.merchantA, instanceNonce, ps());
}

async function opened(session?: Session) {
  const s = session ?? (await genesis());
  const funded = await call(s, ps(), { name: "fundReserve", args: [1000n] });
  assert.equal(funded.ok, true, funded.ok ? "" : funded.error);
  const r = await call(funded.session, ps(), { name: "openLine", args: [LIMIT, EXPIRY] });
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  if (!r.ok) throw new Error("open");
  return r;
}

async function quoted(amount = 40n, invoice = "inv-40", nonce = "n40", from?: Session, merchant = DEMO.merchantA) {
  const o = from ? { ok: true as const, session: from, ledger: readLedger(from) } : await opened();
  const r = await call(
    o.session,
    ps({
      callerSecret: merchant,
      invoiceId: pad32(invoice),
      quoteNonce: pad32(nonce),
    }),
    { name: "postQuote", args: [amount, EXPIRY] },
  );
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  if (!r.ok) throw new Error("quote");
  return r;
}

describe("compact simulator: constructor and domains", () => {
  it("seals issuer, domain, registers initial merchant; status NONE", async () => {
    const s = await genesis();
    const L = readLedger(s);
    assert.equal(L.status, Status.NONE);
    assert.equal(L.actionClock, 0n);
    assert.equal(L.lineGeneration, 0n);
    assert.equal(L.totalReserve, 0n);
    assert.equal(L.encumberedReserve, 0n);
    assert.equal(L.redeemedReserve, 0n);
    assert.equal(toHex(L.issuer).length, 64);
    assert.equal(toHex(L.contractDomain).length, 64);
    const mAPk = merchantPublicKey(DEMO.merchantA);
    assert.equal(L.registeredMerchants.member(mAPk), true);
  });

  it("constructor accepts public keys directly without private secrets", async () => {
    const ipk = issuerPublicKey(DEMO.issuer);
    const mpk = merchantPublicKey(DEMO.merchantA);
    const s = await bootWithPk(ipk, mpk, DEMO.instanceNonce);
    const L = readLedger(s);
    assert.equal(toHex(L.issuer), toHex(ipk));
    assert.equal(L.status, Status.NONE);
    assert.equal(L.lineGeneration, 0n);
    assert.equal(L.registeredMerchants.member(mpk), true);
  });

  it("unique instance nonces produce unique contract domains", async () => {
    const s1 = await genesis(pad32("instance:1"));
    const s2 = await genesis(pad32("instance:2"));
    const L1 = readLedger(s1);
    const L2 = readLedger(s2);
    assert.notEqual(toHex(L1.contractDomain), toHex(L2.contractDomain));
  });
});

describe("compact simulator: merchant registry", () => {
  it("issuer can register a second merchant (Merchant B)", async () => {
    const s = await genesis();
    const mBPk = merchantPublicKey(DEMO.merchantB);
    const r = await call(s, ps({ callerSecret: DEMO.issuer }), {
      name: "registerMerchant",
      args: [mBPk],
    });
    assert.equal(r.ok, true);
    assert.equal(r.ledger.registeredMerchants.member(mBPk), true);
  });

  it("unauthorized caller cannot register a merchant", async () => {
    const s = await genesis();
    const mBPk = merchantPublicKey(DEMO.merchantB);
    const r = await call(s, ps({ callerSecret: DEMO.merchantA }), {
      name: "registerMerchant",
      args: [mBPk],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /not issuer/);
  });

  it("cannot register the same merchant twice", async () => {
    const s = await genesis();
    const mAPk = merchantPublicKey(DEMO.merchantA);
    const r = await call(s, ps({ callerSecret: DEMO.issuer }), {
      name: "registerMerchant",
      args: [mAPk],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /merchant already registered/);
  });

  it("registered Merchant B can post quotes", async () => {
    const o = await opened();
    const mBPk = merchantPublicKey(DEMO.merchantB);
    const reg = await call(o.session, ps({ callerSecret: DEMO.issuer }), {
      name: "registerMerchant",
      args: [mBPk],
    });
    assert.equal(reg.ok, true);

    const q = await call(
      reg.session,
      ps({
        callerSecret: DEMO.merchantB,
        invoiceId: pad32("inv-b-1"),
        quoteNonce: pad32("nonce-b-1"),
      }),
      { name: "postQuote", args: [60n, EXPIRY] },
    );
    assert.equal(q.ok, true);
  });

  it("unregistered merchant cannot post quotes", async () => {
    const o = await opened();
    const unregisteredSk = pad32("line:demo:unregistered");
    const q = await call(
      o.session,
      ps({
        callerSecret: unregisteredSk,
        invoiceId: pad32("inv-unreg"),
        quoteNonce: pad32("nonce-unreg"),
      }),
      { name: "postQuote", args: [50n, EXPIRY] },
    );
    assert.equal(q.ok, false);
    assert.match(q.error, /unregistered merchant/);
  });
});

describe("compact simulator: reserve accounting", () => {
  it("issuer funds reserve; totalReserve increases", async () => {
    const s = await genesis();
    const r = await call(s, ps({ callerSecret: DEMO.issuer }), {
      name: "fundReserve",
      args: [500n],
    });
    assert.equal(r.ok, true);
    assert.equal(r.ledger.totalReserve, 500n);
    assert.equal(r.ledger.encumberedReserve, 0n);
    assert.equal(r.ledger.redeemedReserve, 0n);
  });

  it("unauthorized actor cannot fund reserve as issuer", async () => {
    const s = await genesis();
    const r = await call(s, ps({ callerSecret: DEMO.agent }), {
      name: "fundReserve",
      args: [500n],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /not issuer/);
  });

  it("zero fund is rejected", async () => {
    const s = await genesis();
    const r = await call(s, ps({ callerSecret: DEMO.issuer }), {
      name: "fundReserve",
      args: [0n],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /zero fund/);
  });

  it("issuer can withdraw unencumbered reserve", async () => {
    const s = await genesis();
    const f = await call(s, ps({ callerSecret: DEMO.issuer }), {
      name: "fundReserve",
      args: [500n],
    });
    const w = await call(f.session, ps({ callerSecret: DEMO.issuer }), {
      name: "withdrawUnencumberedReserve",
      args: [200n],
    });
    assert.equal(w.ok, true);
    assert.equal(w.ledger.totalReserve, 300n);
  });

  it("issuer cannot withdraw more than unencumbered reserve", async () => {
    const s = await genesis();
    const f = await call(s, ps({ callerSecret: DEMO.issuer }), {
      name: "fundReserve",
      args: [100n],
    });
    const w = await call(f.session, ps({ callerSecret: DEMO.issuer }), {
      name: "withdrawUnencumberedReserve",
      args: [150n],
    });
    assert.equal(w.ok, false);
    assert.match(w.error, /amount exceeds unencumbered reserve/);
  });

  it("draw fails when reserve is insufficient for draw note", async () => {
    const s = await genesis();
    // Fund only 20
    const f = await call(s, ps(), { name: "fundReserve", args: [20n] });
    const o = await call(f.session, ps(), { name: "openLine", args: [150n, EXPIRY] });
    const q = await quoted(40n, "inv-40", "n40", o.session);
    const Q = firstQuote(q.ledger)!.Q;

    // Draw 40 against 20 reserve
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, EXPIRY, 0n] },
    );
    assert.equal(d.ok, false);
    assert.match(d.error, /insufficient reserve/);
  });

  it("issuer cannot withdraw funds backing an outstanding draw note", async () => {
    const q = await quoted(40n);
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, EXPIRY, 0n] },
    );
    assert.equal(d.ok, true);
    // Total is 1000, encumbered is 40. Withdrawable is 960.
    // Withdrawing 980 should fail
    const w = await call(d.session, ps({ callerSecret: DEMO.issuer }), {
      name: "withdrawUnencumberedReserve",
      args: [980n],
    });
    assert.equal(w.ok, false);
    assert.match(w.error, /amount exceeds unencumbered reserve/);
  });
});

describe("compact simulator: openLine", () => {
  it("valid issuer opens a line; C commits to I,L,0,epoch,salt", async () => {
    const r = await opened();
    assert.equal(r.ledger.status, Status.OPEN);
    assert.equal(r.ledger.lineGeneration, 1n);
    const I = agentId(DEMO.agent);
    const C0 = lineStateCommit(
      { identity: I, limit: LIMIT, outstanding: 0n, epoch: 0n },
      pad32("salt-0"),
    );
    assert.equal(toHex(r.ledger.identityCommit), toHex(I));
    assert.equal(toHex(r.ledger.lineCommit), toHex(C0));
    assert.equal(r.ledger.lineExpiry, EXPIRY);
  });

  it("forged issuer is rejected and state is unchanged", async () => {
    const s = await genesis();
    const fake = pad32("line:demo:attacker");
    const r = await call(s, ps({ callerSecret: fake }), {
      name: "openLine",
      args: [LIMIT, EXPIRY],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /not issuer/);
    assert.equal(r.ledger.status, Status.NONE);
    assert.equal(r.ledger.lineGeneration, 0n);
  });

  it("second open while active is rejected", async () => {
    const o = await opened();
    const r = await call(o.session, ps(), { name: "openLine", args: [LIMIT, EXPIRY] });
    assert.equal(r.ok, false);
    assert.match(r.error, /line already open/);
  });

  it("zero limit is rejected", async () => {
    const s = await genesis();
    const r = await call(s, ps(), { name: "openLine", args: [0n, EXPIRY] });
    assert.equal(r.ok, false);
    assert.match(r.error, /limit/);
  });
});

describe("compact simulator: postQuote", () => {
  it("authorized merchant posts an opaque quote", async () => {
    const q = await quoted();
    const Qs = quotesOf(q.ledger);
    assert.equal(Qs.length, 1);
    assert.equal(Qs[0]!.used, false);
    assert.equal(Qs[0]!.lineGeneration, 1n);
  });

  it("zero quote is rejected", async () => {
    const o = await opened();
    const r = await call(o.session, ps({ callerSecret: DEMO.merchantA }), {
      name: "postQuote",
      args: [0n, EXPIRY],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /zero/);
  });

  it("quote cannot be posted when line is defaulted", async () => {
    const o = await opened();
    const def = await call(o.session, ps({ callerSecret: DEMO.issuer }), {
      name: "setStatus",
      args: [Status.DEFAULTED],
    });
    const q = await call(def.session, ps({ callerSecret: DEMO.merchantA }), {
      name: "postQuote",
      args: [40n, EXPIRY],
    });
    assert.equal(q.ok, false);
    assert.match(q.error, /status/);
  });
});

describe("compact simulator: draw and merchant-bound settlement notes", () => {
  it("valid draw creates merchant-bound note D and rotates C", async () => {
    const q = await quoted(40n);
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, EXPIRY, 0n] },
    );
    assert.equal(d.ok, true);
    assert.equal(d.ledger.encumberedReserve, 40n);
    const notes = notesOf(d.ledger);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.amount, 40n);
    assert.equal(notes[0]!.redeemed, false);
    assert.equal(notes[0]!.cancelled, false);
  });

  it("over-limit draw fails and leaves state unchanged", async () => {
    const q = await quoted(160n, "inv-160", "n160");
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-160"),
        quoteNonce: pad32("n160"),
        noteNonce: pad32("nn-160"),
        noteSalt: pad32("ns-160"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 160n, EXPIRY, 0n] },
    );
    assert.equal(d.ok, false);
    assert.match(d.error, /capacity/);
    assert.equal(d.ledger.encumberedReserve, 0n);
  });

  it("tampered amount fails quote reconstruction", async () => {
    const q = await quoted(40n);
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 39n, EXPIRY, 0n] },
    );
    assert.equal(d.ok, false);
    assert.match(d.error, /quote preimage/);
  });

  it("wrong agent fails draw", async () => {
    const q = await quoted(40n);
    const Q = firstQuote(q.ledger)!.Q;
    const fakeAgent = pad32("line:demo:fakeagent");
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: fakeAgent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, EXPIRY, 0n] },
    );
    assert.equal(d.ok, false);
    assert.match(d.error, /agent/);
  });

  it("reused quote fails draw", async () => {
    const q = await quoted(40n);
    const Q = firstQuote(q.ledger)!.Q;
    const d1 = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40-1"),
        noteSalt: pad32("ns-40-1"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, EXPIRY, 0n] },
    );
    assert.equal(d1.ok, true);

    const d2 = await call(
      d1.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-1"),
        newSalt: pad32("salt-2"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40-2"),
        noteSalt: pad32("ns-40-2"),
      }),
      { name: "draw", args: [Q, 150n, 40n, 1n, 40n, EXPIRY, 0n] },
    );
    assert.equal(d2.ok, false);
    assert.match(d2.error, /used/);
  });
});

describe("compact simulator: merchant redemption", () => {
  async function drawn() {
    const q = await quoted(40n);
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, EXPIRY, 0n] },
    );
    assert.equal(d.ok, true);
    const D = notesOf(d.ledger)[0]!.D;
    return { session: d.session, ledger: d.ledger, Q, D };
  }

  it("designated Merchant A redeems note once; reserve accounting reconciles", async () => {
    const { session, Q, D } = await drawn();
    const r = await call(
      session,
      ps({
        callerSecret: DEMO.merchantA,
        noteIdentity: agentId(DEMO.agent),
        noteQuoteCommit: Q,
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "redeemDraw", args: [D, 40n, EXPIRY] },
    );
    assert.equal(r.ok, true);
    assert.equal(r.ledger.encumberedReserve, 0n);
    assert.equal(r.ledger.redeemedReserve, 40n);
    const note = notesOf(r.ledger)[0]!;
    assert.equal(note.redeemed, true);
  });

  it("Merchant B cannot redeem Merchant A's note (role separation)", async () => {
    const { session, Q, D } = await drawn();
    const r = await call(
      session,
      ps({
        callerSecret: DEMO.merchantB,
        noteIdentity: agentId(DEMO.agent),
        noteQuoteCommit: Q,
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "redeemDraw", args: [D, 40n, EXPIRY] },
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /note opening invalid/);
  });

  it("double redemption fails (nullifier spent)", async () => {
    const { session, Q, D } = await drawn();
    const r1 = await call(
      session,
      ps({
        callerSecret: DEMO.merchantA,
        noteIdentity: agentId(DEMO.agent),
        noteQuoteCommit: Q,
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "redeemDraw", args: [D, 40n, EXPIRY] },
    );
    assert.equal(r1.ok, true);

    const r2 = await call(
      r1.session,
      ps({
        callerSecret: DEMO.merchantA,
        noteIdentity: agentId(DEMO.agent),
        noteQuoteCommit: Q,
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "redeemDraw", args: [D, 40n, EXPIRY] },
    );
    assert.equal(r2.ok, false);
    assert.match(r2.error, /note already redeemed/);
  });

  it("tampered amount fails redemption", async () => {
    const { session, Q, D } = await drawn();
    const r = await call(
      session,
      ps({
        callerSecret: DEMO.merchantA,
        noteIdentity: agentId(DEMO.agent),
        noteQuoteCommit: Q,
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "redeemDraw", args: [D, 39n, EXPIRY] },
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /amount mismatch/);
  });

  it("wrong note salt fails opening", async () => {
    const { session, Q, D } = await drawn();
    const r = await call(
      session,
      ps({
        callerSecret: DEMO.merchantA,
        noteIdentity: agentId(DEMO.agent),
        noteQuoteCommit: Q,
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("wrong-salt"),
      }),
      { name: "redeemDraw", args: [D, 40n, EXPIRY] },
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /note opening invalid/);
  });
});

describe("compact simulator: note cancellation and expiry", () => {
  it("unexpired note cannot be cancelled", async () => {
    const q = await quoted(40n);
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, EXPIRY, 0n] },
    );
    const D = notesOf(d.ledger)[0]!.D;
    const c = await call(d.session, ps(), {
      name: "cancelOrExpireNote",
      args: [D],
    });
    assert.equal(c.ok, false);
    assert.match(c.error, /note not expired/);
  });
});

describe("compact simulator: acknowledgeRepayment", () => {
  async function drawn() {
    const q = await quoted(40n);
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, EXPIRY, 0n] },
    );
    return d;
  }

  it("valid issuer-confirmed repayment restores capacity", async () => {
    const d = await drawn();
    const ack = await call(
      d.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-1"),
        newSalt: pad32("salt-2"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("wire-40"),
      }),
      { name: "acknowledgeRepayment", args: [150n, 40n, 1n, 40n, EXPIRY] },
    );
    assert.equal(ack.ok, true);
    const I = agentId(DEMO.agent);
    const C2 = lineStateCommit(
      { identity: I, limit: 150n, outstanding: 0n, epoch: 2n },
      pad32("salt-2"),
    );
    assert.equal(toHex(ack.ledger.lineCommit), toHex(C2));
  });

  it("agent-initiated fake repayment fails", async () => {
    const d = await drawn();
    const ack = await call(
      d.session,
      ps({
        callerSecret: DEMO.agent,
        agentSecret: DEMO.agent,
        salt: pad32("salt-1"),
        newSalt: pad32("salt-2"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("wire-40"),
      }),
      { name: "acknowledgeRepayment", args: [150n, 40n, 1n, 40n, EXPIRY] },
    );
    assert.equal(ack.ok, false);
    assert.match(ack.error, /not issuer/);
  });

  it("repayment greater than B fails", async () => {
    const d = await drawn();
    const ack = await call(
      d.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-1"),
        newSalt: pad32("salt-2"),
        receiptNonce: pad32("r1"),
        paymentRef: pad32("wire-40"),
      }),
      { name: "acknowledgeRepayment", args: [150n, 40n, 1n, 50n, EXPIRY] },
    );
    assert.equal(ack.ok, false);
    assert.match(ack.error, /range/);
  });
});

describe("compact simulator: setStatus and line generation", () => {
  it("defaulted line rejects draw", async () => {
    const q = await quoted(40n);
    const Q = firstQuote(q.ledger)!.Q;
    const def = await call(q.session, ps({ callerSecret: DEMO.issuer }), {
      name: "setStatus",
      args: [Status.DEFAULTED],
    });
    const d = await call(
      def.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, EXPIRY, 0n] },
    );
    assert.equal(d.ok, false);
    assert.match(d.error, /status/);
  });

  it("quote from generation 1 cannot be drawn after closing and reopening generation 2", async () => {
    const q = await quoted(40n);
    const Q1 = firstQuote(q.ledger)!.Q;

    // Close line
    const closed = await call(q.session, ps({ callerSecret: DEMO.issuer }), {
      name: "setStatus",
      args: [Status.CLOSED],
    });

    // Reopen line in generation 2
    const reopen = await call(closed.session, ps({ callerSecret: DEMO.issuer }), {
      name: "openLine",
      args: [150n, EXPIRY + 1000n],
    });
    assert.equal(reopen.ledger.lineGeneration, 2n);

    // Attempt draw with Q1
    const d = await call(
      reopen.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "draw", args: [Q1, 150n, 0n, 0n, 40n, EXPIRY, 0n] },
    );
    assert.equal(d.ok, false);
    assert.match(d.error, /line generation mismatch/);
  });
});

describe("compact simulator: cross-instance replay rejection", () => {
  it("draw note from instance A cannot be redeemed in instance B", async () => {
    const sA = await genesis(pad32("inst:A"));
    const sB = await genesis(pad32("inst:B"));

    const oA = await opened(sA);
    const oB = await opened(sB);

    const qA = await quoted(40n, "inv-40", "n40", oA.session);
    const QA = firstQuote(qA.ledger)!.Q;

    const dA = await call(
      qA.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "draw", args: [QA, 150n, 0n, 0n, 40n, EXPIRY, 0n] },
    );
    assert.equal(dA.ok, true);
    const DA = notesOf(dA.ledger)[0]!.D;

    // Attempt to redeem note DA on instance B
    const rB = await call(
      oB.session,
      ps({
        callerSecret: DEMO.merchantA,
        noteIdentity: agentId(DEMO.agent),
        noteQuoteCommit: QA,
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "redeemDraw", args: [DA, 40n, EXPIRY] },
    );
    assert.equal(rB.ok, false);
    assert.match(rB.error, /note not found/);
  });
});

describe("compact simulator: issuer fees", () => {
  async function drawWithFee(fee: bigint, amount = 40n, invoice = "inv-fee", nonce = "nfee") {
    const q = await quoted(amount, invoice, nonce);
    const Q = firstQuote(q.ledger)!.Q;
    return call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32(invoice),
        quoteNonce: pad32(nonce),
        noteNonce: pad32("nn-fee"),
        noteSalt: pad32("ns-fee"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, amount, EXPIRY, fee] },
    );
  }

  it("fee charges outstanding by amount+fee; encumbers amount; accrues feeReserve", async () => {
    const d = await drawWithFee(5n);
    assert.equal(d.ok, true, d.ok ? "" : d.error);
    // Note encumbers only the invoice amount
    assert.equal(d.ledger.encumberedReserve, 40n);
    // Fee accrues to the issuer's fee reserve
    assert.equal(d.ledger.feeReserve, 5n);
    assert.equal(d.ledger.totalReserve, 1000n);
    // Agent's outstanding is amount + fee (45), committed in the rotated C
    const I = agentId(DEMO.agent);
    const C1 = lineStateCommit(
      { identity: I, limit: LIMIT, outstanding: 45n, epoch: 1n },
      pad32("salt-1"),
    );
    assert.equal(toHex(d.ledger.lineCommit), toHex(C1));
    // Reserve invariant holds: encumbered + redeemed + fee <= total
    assert.ok(d.ledger.encumberedReserve + d.ledger.redeemedReserve + d.ledger.feeReserve <= d.ledger.totalReserve);
  });

  it("zero fee behaves exactly like the pre-fee draw", async () => {
    const d = await drawWithFee(0n);
    assert.equal(d.ok, true, d.ok ? "" : d.error);
    assert.equal(d.ledger.encumberedReserve, 40n);
    assert.equal(d.ledger.feeReserve, 0n);
    const I = agentId(DEMO.agent);
    const C1 = lineStateCommit(
      { identity: I, limit: LIMIT, outstanding: 40n, epoch: 1n },
      pad32("salt-1"),
    );
    assert.equal(toHex(d.ledger.lineCommit), toHex(C1));
  });

  it("fee counts toward the credit limit: B + amount + fee <= L", async () => {
    // 140 + 20 fee = 160 > 150 limit, but 140 alone would clear it
    const q = await quoted(140n, "inv-cap", "ncap");
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-cap"),
        quoteNonce: pad32("ncap"),
        noteNonce: pad32("nn-cap"),
        noteSalt: pad32("ns-cap"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 140n, EXPIRY, 20n] },
    );
    assert.equal(d.ok, false);
    assert.match(d.error, /capacity/);
    assert.equal(d.ledger.encumberedReserve, 0n);
    assert.equal(d.ledger.feeReserve, 0n);
  });

  it("fee counts toward reserve solvency: amount + fee <= unencumberedReserve", async () => {
    const s = await genesis();
    // Fund only 40: the 40 note clears, but 40 + 5 fee does not
    const f = await call(s, ps(), { name: "fundReserve", args: [40n] });
    const o = await call(f.session, ps(), { name: "openLine", args: [150n, EXPIRY] });
    const q = await quoted(40n, "inv-rsv", "nrsv", o.session);
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-rsv"),
        quoteNonce: pad32("nrsv"),
        noteNonce: pad32("nn-rsv"),
        noteSalt: pad32("ns-rsv"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, EXPIRY, 5n] },
    );
    assert.equal(d.ok, false);
    assert.match(d.error, /insufficient reserve/);
  });

  it("issuer withdraws accrued fees: feeReserve zeroes, totalReserve shrinks", async () => {
    const d = await drawWithFee(5n);
    assert.equal(d.ok, true);
    const w = await call(d.session, ps({ callerSecret: DEMO.issuer }), {
      name: "withdrawFees",
      args: [],
    });
    assert.equal(w.ok, true, w.ok ? "" : w.error);
    assert.equal(w.ledger.feeReserve, 0n);
    assert.equal(w.ledger.totalReserve, 995n);
    // Note liabilities and redemption accounting are untouched
    assert.equal(w.ledger.encumberedReserve, 40n);
    assert.equal(w.ledger.redeemedReserve, 0n);
  });

  it("withdrawFees is issuer-only", async () => {
    const d = await drawWithFee(5n);
    const w = await call(d.session, ps({ callerSecret: DEMO.merchantA }), {
      name: "withdrawFees",
      args: [],
    });
    assert.equal(w.ok, false);
    assert.match(w.error, /not issuer/);
    assert.equal(w.ledger.feeReserve, 5n);
  });

  it("withdrawFees with no accrued fees is rejected", async () => {
    const s = await genesis();
    const w = await call(s, ps({ callerSecret: DEMO.issuer }), {
      name: "withdrawFees",
      args: [],
    });
    assert.equal(w.ok, false);
    assert.match(w.error, /no fees/);
  });

  it("withdrawUnencumberedReserve locks accrued fees (only withdrawFees releases them)", async () => {
    const d = await drawWithFee(5n);
    assert.equal(d.ok, true);
    // Unencumbered = 1000 - 40 (encumbered) - 0 (redeemed) - 5 (fees) = 955
    const tooMuch = await call(d.session, ps({ callerSecret: DEMO.issuer }), {
      name: "withdrawUnencumberedReserve",
      args: [956n],
    });
    assert.equal(tooMuch.ok, false);
    assert.match(tooMuch.error, /amount exceeds unencumbered reserve/);
    const ok = await call(d.session, ps({ callerSecret: DEMO.issuer }), {
      name: "withdrawUnencumberedReserve",
      args: [955n],
    });
    assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
    assert.equal(ok.ledger.totalReserve, 45n);
    assert.equal(ok.ledger.feeReserve, 5n);
    // Fees still withdrawable afterwards
    const w = await call(ok.session, ps({ callerSecret: DEMO.issuer }), {
      name: "withdrawFees",
      args: [],
    });
    assert.equal(w.ok, true);
    assert.equal(w.ledger.totalReserve, 40n);
    assert.equal(w.ledger.feeReserve, 0n);
  });
});

describe("compact simulator: disableMerchant (audit L2)", () => {
  it("issuer can disable a merchant; disabled merchant cannot post quotes", async () => {
    const o = await opened();
    const mAPk = merchantPublicKey(DEMO.merchantA);
    const dis = await call(o.session, ps({ callerSecret: DEMO.issuer }), {
      name: "disableMerchant",
      args: [mAPk],
    });
    assert.equal(dis.ok, true, dis.ok ? "" : dis.error);
    assert.equal(dis.ledger.registeredMerchants.lookup(mAPk), false);

    const q = await call(
      dis.session,
      ps({
        callerSecret: DEMO.merchantA,
        invoiceId: pad32("inv-dis"),
        quoteNonce: pad32("ndis"),
      }),
      { name: "postQuote", args: [40n, EXPIRY] },
    );
    assert.equal(q.ok, false);
    assert.match(q.error, /merchant disabled/);
  });

  it("unauthorized caller cannot disable a merchant", async () => {
    const o = await opened();
    const mAPk = merchantPublicKey(DEMO.merchantA);
    const r = await call(o.session, ps({ callerSecret: DEMO.merchantA }), {
      name: "disableMerchant",
      args: [mAPk],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /not issuer/);
    assert.equal(r.ledger.registeredMerchants.lookup(mAPk), true);
  });

  it("disabling an unknown merchant is rejected", async () => {
    const o = await opened();
    const unknown = merchantPublicKey(pad32("line:demo:nobody"));
    const r = await call(o.session, ps({ callerSecret: DEMO.issuer }), {
      name: "disableMerchant",
      args: [unknown],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown merchant/);
  });
});

describe("compact simulator: expiry headroom-2 (audit L3)", () => {
  it("postQuote rejects expiry = clock+1 (would be immediately undrawable)", async () => {
    const o = await opened();
    // genesis(0) -> fundReserve(1) -> openLine(2): clock is 2 here
    assert.equal(o.ledger.actionClock, 2n);
    const r = await call(o.session, ps({ callerSecret: DEMO.merchantA }), {
      name: "postQuote",
      args: [40n, 3n],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /expiry/);
    // clock+2 is the minimum that passes
    const ok = await call(o.session, ps({ callerSecret: DEMO.merchantA }), {
      name: "postQuote",
      args: [40n, 4n],
    });
    assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
  });

  it("draw rejects noteExpiry = clock+1 (would be immediately unredeemable)", async () => {
    const q = await quoted(40n);
    const Q = firstQuote(q.ledger)!.Q;
    // clock is 3 after the quote; noteExpiry = 4 is clock+1
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-40"),
        quoteNonce: pad32("n40"),
        noteNonce: pad32("nn-40"),
        noteSalt: pad32("ns-40"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, 4n, 0n] },
    );
    assert.equal(d.ok, false);
    assert.match(d.error, /note expiry/);
    assert.equal(d.ledger.encumberedReserve, 0n);
  });

  it("draw accepts noteExpiry = clock+2 (survives this circuit's clock tick)", async () => {
    const q = await quoted(40n, "inv-h2", "nh2");
    const Q = firstQuote(q.ledger)!.Q;
    const d = await call(
      q.session,
      ps({
        callerSecret: DEMO.issuer,
        agentSecret: DEMO.agent,
        salt: pad32("salt-0"),
        newSalt: pad32("salt-1"),
        invoiceId: pad32("inv-h2"),
        quoteNonce: pad32("nh2"),
        noteNonce: pad32("nn-h2"),
        noteSalt: pad32("ns-h2"),
      }),
      { name: "draw", args: [Q, 150n, 0n, 0n, 40n, 5n, 0n] },
    );
    assert.equal(d.ok, true, d.ok ? "" : d.error);
    assert.equal(d.ledger.encumberedReserve, 40n);
  });
});
