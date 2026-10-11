import { boot, bootWithPk } from "../../test/fixtures/compact.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Status,
  blankPrivate,
  call,
  firstQuote,
  notesOf,
  nullifiersOf,
  quotesOf,
  readLedger,
  type CircuitCall,
  type PrivateState,
  type Session,
} from "./compact-harness.ts";
import { DEMO } from "../../test/fixtures/keys.ts";
import {
  agentId,
  contractDomain,
  drawNoteCommit,
  drawNullifier,
  encodeU64,
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
    lineLimit: LIMIT,
    lineOutstanding: 0n,
    lineEpoch: 0n,
    quoteAmount: 40n,
    drawAmount: 40n,
    redeemAmount: 40n,
    repayAmount: 40n,
    quoteMerchantPk: merchantPublicKey(DEMO.merchantA),
    ...overrides,
  });
}

async function genesis(instanceNonce?: Uint8Array) {
  return boot(DEMO.issuer, DEMO.merchantA, instanceNonce, ps());
}

async function opened(session?: Session, flatFee = 0n, basisPoints = 0n) {
  const s = session ?? (await genesis());
  const funded = await call(s, ps(), { name: "fundReserve", args: [1000n] });
  assert.equal(funded.ok, true, funded.ok ? "" : funded.error);
  const r = await call(funded.session, ps(), { name: "openLine", args: [EXPIRY, flatFee, basisPoints] });
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
      quoteAmount: amount,
      quoteMerchantPk: merchantPublicKey(merchant),
    }),
    { name: "postQuote", args: [EXPIRY] },
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
        quoteAmount: 60n,
        quoteMerchantPk: merchantPublicKey(DEMO.merchantB),
      }),
      { name: "postQuote", args: [EXPIRY] },
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
        quoteAmount: 50n,
      }),
      { name: "postQuote", args: [EXPIRY] },
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
    const o = await call(f.session, ps(), { name: "openLine", args: [EXPIRY] });
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
      { name: "draw", args: [Q, EXPIRY, 0n] },
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
      { name: "draw", args: [Q, EXPIRY, 0n] },
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
      { domain: r.ledger.contractDomain, identity: I, limit: LIMIT, outstanding: 0n, epoch: 0n },
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
      args: [EXPIRY],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /not issuer/);
    assert.equal(r.ledger.status, Status.NONE);
    assert.equal(r.ledger.lineGeneration, 0n);
  });

  it("second open while active is rejected", async () => {
    const o = await opened();
    const r = await call(o.session, ps(), { name: "openLine", args: [EXPIRY] });
    assert.equal(r.ok, false);
    assert.match(r.error, /line already open/);
  });

  it("zero limit is rejected", async () => {
    const s = await genesis();
    const r = await call(s, ps({ lineLimit: 0n }), { name: "openLine", args: [EXPIRY] });
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
    const r = await call(o.session, ps({ callerSecret: DEMO.merchantA, quoteAmount: 0n }), {
      name: "postQuote",
      args: [EXPIRY],
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
      args: [EXPIRY],
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
      { name: "draw", args: [Q, EXPIRY, 0n] },
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
        drawAmount: 160n,
      }),
      { name: "draw", args: [Q, EXPIRY, 0n] },
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
        drawAmount: 39n,
      }),
      { name: "draw", args: [Q, EXPIRY, 0n] },
    );
    assert.equal(d.ok, false);
    assert.match(d.error, /quote preimage/);
  });

  it("wrong merchant witness fails quote reconstruction (unlinkability enforced)", async () => {
    const q = await quoted(40n);
    const Q = firstQuote(q.ledger)!.Q;
    // The ledger no longer stores the quote's merchant; the agent must supply
    // the correct merchantPk as a witness. A wrong one cannot open Q.
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
        quoteMerchantPk: merchantPublicKey(DEMO.merchantB),
      }),
      { name: "draw", args: [Q, EXPIRY, 0n] },
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
      { name: "draw", args: [Q, EXPIRY, 0n] },
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
      { name: "draw", args: [Q, EXPIRY, 0n] },
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
        lineOutstanding: 40n,
        lineEpoch: 1n,
      }),
      { name: "draw", args: [Q, EXPIRY, 0n] },
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
      { name: "draw", args: [Q, EXPIRY, 0n] },
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
      { name: "redeemDraw", args: [D, EXPIRY] },
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
      { name: "redeemDraw", args: [D, EXPIRY] },
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
      { name: "redeemDraw", args: [D, EXPIRY] },
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
      { name: "redeemDraw", args: [D, EXPIRY] },
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
        redeemAmount: 39n,
      }),
      { name: "redeemDraw", args: [D, EXPIRY] },
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
      { name: "redeemDraw", args: [D, EXPIRY] },
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
      { name: "draw", args: [Q, EXPIRY, 0n] },
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
      { name: "draw", args: [Q, EXPIRY, 0n] },
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
        lineOutstanding: 40n,
        lineEpoch: 1n,
      }),
      { name: "acknowledgeRepayment", args: [EXPIRY] },
    );
    assert.equal(ack.ok, true);
    const I = agentId(DEMO.agent);
    const C2 = lineStateCommit(
      { domain: ack.ledger.contractDomain, identity: I, limit: 150n, outstanding: 0n, epoch: 2n },
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
        lineOutstanding: 40n,
        lineEpoch: 1n,
      }),
      { name: "acknowledgeRepayment", args: [EXPIRY] },
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
        lineOutstanding: 40n,
        lineEpoch: 1n,
        repayAmount: 50n,
      }),
      { name: "acknowledgeRepayment", args: [EXPIRY] },
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
      { name: "draw", args: [Q, EXPIRY, 0n] },
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
      args: [EXPIRY + 1000n],
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
      { name: "draw", args: [Q1, EXPIRY, 0n] },
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
      { name: "draw", args: [QA, EXPIRY, 0n] },
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
      { name: "redeemDraw", args: [DA, EXPIRY] },
    );
    assert.equal(rB.ok, false);
    assert.match(rB.error, /note not found/);
  });

  it("identical quote parameters under different contract domains produce different Q", async () => {
    const sA = await genesis(pad32("inst:A"));
    const sB = await genesis(pad32("inst:B"));
    const LA = readLedger(sA);
    const LB = readLedger(sB);
    const mPk = merchantPublicKey(DEMO.merchantA);
    const QA = quoteCommit({
      merchantPk: mPk,
      invoiceId: pad32("inv-40"),
      amount: 40n,
      expiry: EXPIRY,
      nonce: pad32("n40"),
      generation: 1n,
      domain: LA.contractDomain,
    });
    const QB = quoteCommit({
      merchantPk: mPk,
      invoiceId: pad32("inv-40"),
      amount: 40n,
      expiry: EXPIRY,
      nonce: pad32("n40"),
      generation: 1n,
      domain: LB.contractDomain,
    });
    assert.notEqual(toHex(QA), toHex(QB));
  });

  it("line-state opening from instance A fails in instance B even with identical keys", async () => {
    const sA = await genesis(pad32("inst:A"));
    const sB = await genesis(pad32("inst:B"));

    const oA = await opened(sA);
    const oB = await opened(sB);

    // Identical secrets, limit, debt, epoch and salt still produce distinct
    // roots because the private line opening is bound to contractDomain.
    assert.notEqual(toHex(oA.ledger.lineCommit), toHex(oB.ledger.lineCommit));

    // Merchant posts quote on instance B
    const qB = await quoted(40n, "inv-40", "n40", oB.session);
    const QB = firstQuote(qB.ledger)!.Q;

    // Agent attempts to use quote QB from instance B on instance A: fails because quote does not exist on instance A
    const dA_with_QB = await call(
      oA.session,
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
      { name: "draw", args: [QB, EXPIRY, 0n] },
    );
    assert.equal(dA_with_QB.ok, false);
    assert.match(dA_with_QB.error, /quote/);
  });
});

describe("compact simulator: issuer fees", () => {
  async function drawWithFee(fee: bigint, amount = 40n, invoice = "inv-fee", nonce = "nfee") {
    const o = await opened(undefined, fee);
    const q = await quoted(amount, invoice, nonce, o.session);
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
        drawAmount: amount,
      }),
      { name: "draw", args: [Q, EXPIRY, fee] },
    );
  }

  async function redeemedWithFee(fee: bigint) {
    const d = await drawWithFee(fee);
    if (!d.ok) return d;
    return call(d.session, ps({ callerSecret: DEMO.merchantA, noteIdentity: agentId(DEMO.agent),
      noteQuoteCommit: firstQuote(d.ledger)!.Q, noteNonce: pad32("nn-fee"), noteSalt: pad32("ns-fee") }),
      { name: "redeemDraw", args: [notesOf(d.ledger)[0].D, EXPIRY] });
  }

  it("fee charges outstanding by amount+fee; encumbers amount; locks pending fee", async () => {
    const d = await drawWithFee(5n);
    assert.equal(d.ok, true, d.ok ? "" : d.error);
    // Note encumbers only the invoice amount
    assert.equal(d.ledger.encumberedReserve, 40n);
    // The issuer earns its pending fee only when the merchant redeems.
    assert.equal(d.ledger.pendingFeeReserve, 5n);
    assert.equal(d.ledger.feeReserve, 0n);
    assert.equal(d.ledger.totalReserve, 1000n);
    // Agent's outstanding is amount + fee (45), committed in the rotated C
    const I = agentId(DEMO.agent);
    const C1 = lineStateCommit(
      { domain: d.ledger.contractDomain, identity: I, limit: LIMIT, outstanding: 45n, epoch: 1n },
      pad32("salt-1"),
    );
    assert.equal(toHex(d.ledger.lineCommit), toHex(C1));
    // Reserve invariant holds: encumbered + redeemed + fee <= total
    assert.ok(d.ledger.encumberedReserve + d.ledger.redeemedReserve + d.ledger.feeReserve + d.ledger.pendingFeeReserve + d.ledger.refundReserve + d.ledger.reportedRefundReserve <= d.ledger.totalReserve);
  });

  it("zero fee behaves exactly like the pre-fee draw", async () => {
    const d = await drawWithFee(0n);
    assert.equal(d.ok, true, d.ok ? "" : d.error);
    assert.equal(d.ledger.encumberedReserve, 40n);
    assert.equal(d.ledger.feeReserve, 0n);
    const I = agentId(DEMO.agent);
    const C1 = lineStateCommit(
      { domain: d.ledger.contractDomain, identity: I, limit: LIMIT, outstanding: 40n, epoch: 1n },
      pad32("salt-1"),
    );
    assert.equal(toHex(d.ledger.lineCommit), toHex(C1));
  });

  it("fee counts toward the credit limit: B + amount + fee <= L", async () => {
    // 140 + 20 fee = 160 > 150 limit, but 140 alone would clear it
    const o = await opened(undefined, 20n);
    const q = await quoted(140n, "inv-cap", "ncap", o.session);
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
        drawAmount: 140n,
      }),
      { name: "draw", args: [Q, EXPIRY, 20n] },
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
    const o = await call(f.session, ps(), { name: "openLine", args: [EXPIRY, 5n, 0n] });
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
      { name: "draw", args: [Q, EXPIRY, 5n] },
    );
    assert.equal(d.ok, false);
    assert.match(d.error, /insufficient reserve/);
  });

  it("issuer withdraws accrued fees: feeReserve zeroes, totalReserve shrinks", async () => {
    const d = await redeemedWithFee(5n);
    assert.equal(d.ok, true);
    const w = await call(d.session, ps({ callerSecret: DEMO.issuer }), {
      name: "withdrawFees",
      args: [],
    });
    assert.equal(w.ok, true, w.ok ? "" : w.error);
    assert.equal(w.ledger.feeReserve, 0n);
    assert.equal(w.ledger.totalReserve, 995n);
    // Note liabilities and redemption accounting are untouched
    assert.equal(w.ledger.encumberedReserve, 0n);
    assert.equal(w.ledger.redeemedReserve, 40n);
  });

  it("withdrawFees is issuer-only", async () => {
    const d = await redeemedWithFee(5n);
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
    const d = await redeemedWithFee(5n);
    assert.equal(d.ok, true);
    // Unencumbered = 1000 - 0 (encumbered) - 40 (redeemed) - 5 (earned fees) = 955
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
      { name: "postQuote", args: [EXPIRY] },
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

  it("a disabled merchant's already-posted quotes stay drawable", async () => {
    const q = await quoted(40n);
    const Q = firstQuote(q.ledger)!.Q;
    const mAPk = merchantPublicKey(DEMO.merchantA);
    const dis = await call(q.session, ps({ callerSecret: DEMO.issuer }), {
      name: "disableMerchant",
      args: [mAPk],
    });
    assert.equal(dis.ok, true, dis.ok ? "" : dis.error);
    // draw checks registry membership, not enabled-ness: quotes posted while
    // the merchant was active remain valid; only NEW quotes are blocked.
    const d = await call(
      dis.session,
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
      { name: "draw", args: [Q, EXPIRY, 0n] },
    );
    assert.equal(d.ok, true, d.ok ? "" : d.error);
    assert.equal(d.ledger.encumberedReserve, 40n);
  });
});

describe("compact simulator: merchant-authenticated expiry", () => {
  it("postQuote rejects the current second and accepts one future second", async () => {
    const o = await opened();
    assert.equal(o.ledger.actionClock, 2n);
    const rejected = await call(o.session, ps({ callerSecret: DEMO.merchantA }), { name: "postQuote", args: [0n] });
    assert.equal(rejected.ok, false);
    assert.match(rejected.ok ? "" : rejected.error, /expiry/);
    const accepted = await call(o.session, ps({ callerSecret: DEMO.merchantA }), { name: "postQuote", args: [1n] });
    assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
  });

  it("draw rejects shortening the merchant's committed note deadline", async () => {
    const q = await quoted();
    const rejected = await call(q.session, ps(), { name: "draw", args: [firstQuote(q.ledger)!.Q, EXPIRY - 1n, 0n] });
    assert.equal(rejected.ok, false);
    assert.match(rejected.ok ? "" : rejected.error, /note expiry terms/);
    assert.equal(rejected.ledger.encumberedReserve, 0n);
    assert.equal(firstQuote(rejected.ledger)!.used, false);
  });

  it("draw uses the merchant's quote deadline unchanged", async () => {
    const q = await quoted();
    const accepted = await call(q.session, ps(), { name: "draw", args: [firstQuote(q.ledger)!.Q, EXPIRY, 0n] });
    assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
    assert.equal(accepted.ledger.encumberedReserve, 40n);
    assert.equal(notesOf(accepted.ledger)[0].expiry, EXPIRY);
  });
});

describe("compact simulator: private direct fields and documented public disclosures", () => {
  // Distinctive secrets: if any of these 64-hex-char encodings shows up in a
  // public input or public ledger state, it is a real leak, not a coincidence.
  const PLIMIT = 987_654_321n;
  const PAMT = 123_456_789n; // drawn quote's invoice amount
  const Q2AMT = 777_888_999n; // never-drawn quote's invoice amount
  const PFEE = 7n; // public by design (issuer business model)
  const PSALT0 = pad32("priv-s0-9f3a7c1e");
  const PNS0 = pad32("priv-ns0-9f3a7c1e");
  const PNS1 = pad32("priv-ns1-9f3a7c1e");
  const PNS2 = pad32("priv-ns2-9f3a7c1e");
  const PINV = pad32("priv-inv-9f3a7c1e");
  const PQN = pad32("priv-qn-9f3a7c1e");
  const PINV2 = pad32("priv-inv2-9f3a7c1");
  const PQN2 = pad32("priv-qn2-9f3a7c1");
  const PNN = pad32("priv-nn-9f3a7c1e");
  const PNSALT = pad32("priv-nsalt-9f3a7c1");
  const PRN = pad32("priv-rn-9f3a7c1e");
  const PPR = pad32("priv-pr-9f3a7c1e");

  const u64hx = (n: bigint) => toHex(encodeU64(n));
  const mAPk = merchantPublicKey(DEMO.merchantA);
  const I = agentId(DEMO.agent);

  type PubCall = { name: string; args: Array<bigint | Uint8Array | Status> };
  type Flow = {
    ledger: ReturnType<typeof readLedger>;
    pubCalls: PubCall[];
    Q: Uint8Array;
    Q2: Uint8Array;
    D: Uint8Array;
    C0: Uint8Array;
    C1: Uint8Array;
    C2: Uint8Array;
    Qcheck: Uint8Array;
    openCommit: Uint8Array;
    drawCommit: Uint8Array;
  };

  function basePs(overrides: Partial<PrivateState> = {}): PrivateState {
    return ps({
      salt: PSALT0,
      invoiceId: PINV,
      quoteNonce: PQN,
      lineLimit: PLIMIT,
      quoteAmount: PAMT,
      drawAmount: PAMT,
      redeemAmount: PAMT,
      repayAmount: PAMT,
      quoteMerchantPk: mAPk,
      ...overrides,
    });
  }

  async function runPrivateFlow(): Promise<Flow> {
    const pubCalls: PubCall[] = [];
    let sess = await boot(DEMO.issuer, DEMO.merchantA, pad32("priv-inst-9f3a7c"), basePs());
    const step = async (p: PrivateState, op: CircuitCall) => {
      const r = await call(sess, p, op);
      assert.equal(r.ok, true, r.ok ? "" : (r as { error: string }).error);
      pubCalls.push({ name: op.name, args: op.args as PubCall["args"] });
      sess = r.session;
      return r;
    };
    await step(basePs(), { name: "fundReserve", args: [10_000_000_000n] });
    const openedR = await step(basePs({ newSalt: PNS0 }), { name: "openLine", args: [EXPIRY, PFEE, 0n] });
    const q1 = await step(basePs({ callerSecret: DEMO.merchantA }), {
      name: "postQuote",
      args: [EXPIRY],
    });
    const Q = firstQuote(q1.ledger)!.Q;
    // A second quote that is NEVER drawn: its invoice amount must stay hidden.
    const q2 = await step(
      basePs({
        callerSecret: DEMO.merchantA,
        invoiceId: PINV2,
        quoteNonce: PQN2,
        quoteAmount: Q2AMT,
      }),
      { name: "postQuote", args: [EXPIRY] },
    );
    const Q2 = [...q2.ledger.quotes].map(([k]) => k).find((k) => toHex(k) !== toHex(Q))!;
    const drawn = await step(basePs({ newSalt: PNS1, noteNonce: PNN, noteSalt: PNSALT }), {
      name: "draw",
      args: [Q, EXPIRY, PFEE],
    });
    const D = notesOf(drawn.ledger)[0]!.D;
    const red = await step(
      basePs({
        callerSecret: DEMO.merchantA,
        noteIdentity: I,
        noteQuoteCommit: Q,
        noteNonce: PNN,
        noteSalt: PNSALT,
      }),
      { name: "redeemDraw", args: [D, EXPIRY] },
    );
    assert.equal(red.ledger.redeemedReserve, PAMT);
    const ack = await step(
      basePs({
        callerSecret: DEMO.issuer,
        salt: PNS1,
        newSalt: PNS2,
        receiptNonce: PRN,
        paymentRef: PPR,
        lineOutstanding: PAMT + PFEE,
        lineEpoch: 1n,
      }),
      { name: "acknowledgeRepayment", args: [EXPIRY] },
    );
    const domain = ack.ledger.contractDomain;
    // Independent recomputation of every commitment from the SECRET values:
    // proves the circuits actually consumed the witnesses (not accepted-and-ignored).
    const C0 = lineStateCommit(
      { domain, identity: I, limit: PLIMIT, outstanding: 0n, epoch: 0n },
      PSALT0,
    );
    const C1 = lineStateCommit(
      { domain, identity: I, limit: PLIMIT, outstanding: PAMT + PFEE, epoch: 1n },
      PNS1,
    );
    const C2 = lineStateCommit(
      { domain, identity: I, limit: PLIMIT, outstanding: PFEE, epoch: 2n },
      PNS2,
    );
    const Qcheck = quoteCommit({
      merchantPk: mAPk,
      invoiceId: PINV,
      amount: PAMT,
      expiry: EXPIRY,
      nonce: PQN,
      generation: 1n,
      domain: ack.ledger.contractDomain,
      feeFlat: PFEE, feeBps: 0n,
    });
    return {
      ledger: ack.ledger,
      pubCalls,
      Q,
      Q2,
      D,
      C0,
      C1,
      C2,
      Qcheck,
      openCommit: openedR.ledger.lineCommit,
      drawCommit: drawn.ledger.lineCommit,
    };
  }

  function argHex(a: bigint | Uint8Array | Status): string {
    if (typeof a === "bigint") return u64hx(a);
    if (a instanceof Uint8Array) return toHex(a);
    return `status:${a}`;
  }

  function publicArgsBlob(pubCalls: PubCall[]): string {
    return pubCalls.map((c) => `${c.name}:${c.args.map(argHex).join(",")}`).join("|");
  }

  function ledgerBlob(L: ReturnType<typeof readLedger>): string {
    // registeredMerchants is EXCLUDED: a public allowlist is the design, and
    // the linkage test below scopes merchantPk absence to quote/note entries.
    const obj = {
      issuer: toHex(L.issuer),
      domain: toHex(L.contractDomain),
      total: u64hx(L.totalReserve),
      encumbered: u64hx(L.encumberedReserve),
      redeemed: u64hx(L.redeemedReserve),
      fees: u64hx(L.feeReserve),
      pendingFees: u64hx(L.pendingFeeReserve),
      refunds: u64hx(L.refundReserve),
      reportedRefunds: u64hx(L.reportedRefundReserve),
      feeFlat: u64hx(L.feeFlat),
      feeBps: u64hx(L.feeBps),
      identityCommit: toHex(L.identityCommit),
      lineCommit: toHex(L.lineCommit),
      lineExpiry: u64hx(L.lineExpiry),
      status: L.status,
      generation: u64hx(L.lineGeneration),
      clock: u64hx(L.actionClock),
      quotes: [...L.quotes].map(([k, m]) => ({
        k: toHex(k),
        expiry: u64hx(m.expiry),
        gen: u64hx(m.lineGeneration),
        used: m.used,
      })),
      notes: [...L.notes].map(([k, m]) => ({
        k: toHex(k),
        amount: u64hx(m.amount),
        fee: u64hx(m.fee),
        compensationAllocated: m.compensationAllocated,
        refundCommitment: toHex(m.refundCommitment),
        cashRefundOwed: m.cashRefundOwed,
        refundAcknowledged: m.refundAcknowledged,
        redeemed: m.redeemed,
        cancelled: m.cancelled,
        expiry: u64hx(m.expiry),
        gen: u64hx(m.lineGeneration),
      })),
      nullifiers: [...L.nullifiers].map(toHex),
    };
    return JSON.stringify(obj);
  }

  it("witnesses are really consumed: C0/C1/C2/Q recompute from the secret values", async () => {
    const f = await runPrivateFlow();
    // If the circuits ignored the witnesses, these would not match: the
    // public flow above carried NO secret in any argument, yet the on-ledger
    // commitments equal hashes of the secrets. This is the anti-theater check.
    assert.equal(toHex(f.openCommit), toHex(f.C0), "C0 must bind witness L");
    assert.equal(toHex(f.drawCommit), toHex(f.C1), "C1 must bind witness L/B/epoch");
    assert.equal(toHex(f.ledger.lineCommit), toHex(f.C2), "C2 must bind witness L/B/epoch");
    assert.notEqual(toHex(f.Q), toHex(f.Q2), "quotes must be distinct");
    assert.equal(toHex(f.Q), toHex(f.Qcheck), "Q must commit to the witness merchantPk/amount");
  });

  it("limit, outstanding, and the never-drawn invoice amount appear nowhere public", async () => {
    const f = await runPrivateFlow();
    const haystack = publicArgsBlob(f.pubCalls) + "\n" + ledgerBlob(f.ledger);
    const forbidden = [
      u64hx(PLIMIT), // credit limit L
      u64hx(PAMT + PFEE), // outstanding balance B after the draw
      u64hx(Q2AMT), // invoice amount of the quote that was never drawn
      toHex(PSALT0),
      toHex(PNS0),
      toHex(PNS1),
      toHex(PNS2),
      toHex(PINV),
      toHex(PQN),
      toHex(PINV2),
      toHex(PQN2),
      toHex(PNN),
      toHex(PNSALT),
      toHex(PRN),
      toHex(PPR),
      toHex(DEMO.agent), // agent secret
      toHex(DEMO.issuer), // issuer secret
      toHex(DEMO.merchantA), // merchant secret
    ];
    for (const secret of forbidden) {
      assert.ok(
        !haystack.includes(secret),
        `secret leaked into public inputs/state: ${secret.slice(0, 16)}…`,
      );
    }
  });

  it("draw's public args expose no amount, books, invoice material, or merchant", async () => {
    const f = await runPrivateFlow();
    const drawCall = f.pubCalls.find((c) => c.name === "draw")!;
    const blob = drawCall.args.map(argHex).join(",");
    // Public draw args are exactly [Q, noteExpiry, fee]; everything else is a witness.
    assert.equal(drawCall.args.length, 3);
    for (const secret of [
      u64hx(PLIMIT),
      u64hx(PAMT),
      u64hx(PAMT + PFEE),
      toHex(PINV),
      toHex(PQN),
      toHex(PNN),
      toHex(PNSALT),
      toHex(PSALT0),
      toHex(PNS1),
      toHex(mAPk),
    ]) {
      assert.ok(!blob.includes(secret), `draw public arg leaks secret: ${secret.slice(0, 16)}…`);
    }
    // The fee IS public by design (issuer business model) — assert it is there.
    assert.ok(blob.includes(u64hx(PFEE)), "fee must remain a public parameter");
  });

  it("merchant<->quote unlinkability: merchantPk in no quote/note/nullifier or public arg", async () => {
    const f = await runPrivateFlow();
    const mPkHex = toHex(mAPk);
    // Quote entries: keys are opaque Q, values carry no merchantPk (struct field removed).
    for (const [k, m] of f.ledger.quotes) {
      const entry = toHex(k) + u64hx(m.expiry) + u64hx(m.lineGeneration) + String(m.used);
      assert.ok(!entry.includes(mPkHex), "quote entry links merchant");
    }
    // Note entries: NoteMeta has no merchant field; D is an opaque commitment.
    for (const [k, m] of f.ledger.notes) {
      const entry =
        toHex(k) + u64hx(m.amount) + String(m.redeemed) + String(m.cancelled) + u64hx(m.expiry);
      assert.ok(!entry.includes(mPkHex), "note entry links merchant");
    }
    for (const n of f.ledger.nullifiers) {
      assert.ok(!toHex(n).includes(mPkHex), "nullifier links merchant");
    }
    const argsBlob = publicArgsBlob(f.pubCalls);
    assert.ok(!argsBlob.includes(mPkHex), "public circuit args link merchant");
    // Sanity: the allowlist DOES contain the merchant (public by design) —
    // unlinkability is about quote/note linkage, not registry membership.
    assert.equal(f.ledger.registeredMerchants.member(mAPk), true);
  });

  it("honest boundary: settled amounts ARE public escrow accounting", async () => {
    const f = await runPrivateFlow();
    // The witness migration hides invoice amounts pre-settlement; once a note
    // settles, its amount is visible via the public counters. Assert this
    // openly rather than claiming otherwise.
    assert.equal(f.ledger.redeemedReserve, PAMT);
    assert.equal(f.ledger.encumberedReserve, 0n);
    const note = notesOf(f.ledger)[0]!;
    assert.equal(note.amount, PAMT);
    assert.equal(note.redeemed, true);
  });
});
