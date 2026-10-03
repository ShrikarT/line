import {
  agentId,
  contractDomain,
  drawNoteCommit,
  drawNullifier as encodeDrawNullifier,
  fromHex,
  issuerPublicKey as encodeIssuerPublicKey,
  lineStateCommit,
  merchantPublicKey as encodeMerchantPublicKey,
  pad32,
  quoteCommit as encodeQuoteCommit,
  redeemNullifier as encodeRedeemNullifier,
  repayNullifier as encodeRepayNullifier,
  toHex,
} from "./encoding.ts";
import {
  GENERIC_DRAW_FAIL,
  type AgentStore,
  type CircuitResult,
  type DrawNote,
  type DrawNotePreimage,
  type DrawWitness,
  type Ledger,
  type LedgerEvent,
  type LineStatus,
  type LineWitness,
  type OpenLineWitness,
  type PostQuoteWitness,
  type QuotePreimage,
  type RedeemWitness,
  type RepayWitness,
} from "./types.ts";
import { INSTANCE_NONCE, ISSUER_SK, MERCHANT_A_SK } from "./keys.ts";

export const FAIL = {
  AUTH_ISSUER: "caller is not the registered issuer",
  AUTH_MERCHANT: "caller is not a registered merchant",
  AUTH_AGENT: "agent secret does not own this line",
  LINE_EXISTS: "an open line already exists for this identity",
  NO_LINE: "no line is open",
  STATUS: "line status does not allow this circuit",
  LIMIT: "limit must be a positive integer",
  AMOUNT: "amount must be a positive integer",
  OVERFLOW: "balance arithmetic overflowed",
  CAPACITY: "draw exceeds available credit",
  STALE: "line-state commitment is stale",
  WITNESS: "witness does not open the current commitment",
  QUOTE: "quote preimage does not match a live quote",
  QUOTE_USED: "quote already consumed",
  QUOTE_EXPIRED: "quote expired",
  QUOTE_AUTH: "quote is not bound to a registered merchant",
  QUOTE_GEN: "quote is bound to a different line generation",
  NULLIFIER: "nullifier already spent",
  RECEIPT: "repayment receipt is invalid for this line",
  RECEIPT_STALE: "receipt does not reference the current commitment",
  RECEIPT_USED: "repayment receipt already used",
  RECEIPT_RANGE: "repayment amount is not in (0, outstanding]",
  EXPIRY: "expiry is not in the future",
  LINE_EXPIRED: "line expired",
  CLOSED: "closed line cannot be reused in this epoch",
  ZERO: "zero-amount operations are rejected",
  BAD_STATUS: "status transition is not allowed",
  RESERVE_CAPACITY: "insufficient reserve for draw note",
  RESERVE_WITHDRAW: "withdrawal exceeds unencumbered reserve",
  MERCHANT_REGISTERED: "merchant already registered",
  MERCHANT_DISABLED: "merchant is disabled",
  UNKNOWN_MERCHANT: "merchant is not in the registry",
  NO_FEES: "no fees",
  RESERVE_DEFICIT: "reserve deficit",
  NOTE_NOT_FOUND: "draw note not found",
  NOTE_USED: "draw note already redeemed",
  NOTE_CANCELLED: "draw note is cancelled",
  NOTE_EXPIRED: "draw note expired",
  NOTE_NOT_EXPIRED: "draw note has not expired yet",
  NOTE_OPENING: "note preimage does not open commitment",
  NOTE_AUTH: "caller is not the designated merchant for this note",
} as const;

const UINT64_MAX = 18446744073709551615n;

function fail(code: string, reason: string, message = GENERIC_DRAW_FAIL): CircuitResult<never> {
  return { ok: false, code, reason, message };
}

export function asBytes32(input: string | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  const clean = input.startsWith("0x") ? input.slice(2) : input;
  if (/^[0-9a-fA-F]{64}$/.test(clean)) return fromHex(clean);
  return pad32(input);
}

/**
 * L7 — known replica bound: amounts in this TypeScript simulator are JS
 * `number`s, so every Uint<64>-compatible value must be an integer in
 * [0, 2^53 − 1] (Number.isSafeInteger). The on-chain Compact contract's native
 * Uint<64> spans the full 2^64 range; the simulator intentionally narrows it to
 * the lossless float64-integer domain. All protocol entry points enforce this
 * via assertSafeUint before reaching u64(), so any value ≥ 2^53 is rejected as
 * a fail result (never silently rounded) — see FAIL.OVERFLOW / fail() paths.
 */
function u64(n: number): bigint {
  if (!Number.isInteger(n) || n < 0 || !Number.isSafeInteger(n)) {
    throw new RangeError("not a Uint<64>-compatible integer");
  }
  return BigInt(n);
}

export function identityCommitment(agentSecret: string): string {
  return toHex(agentId(asBytes32(agentSecret)));
}

export function issuerPublicKey(issuerSecret: string): string {
  return toHex(encodeIssuerPublicKey(asBytes32(issuerSecret)));
}

export function merchantPublicKey(merchantSecret: string): string {
  return toHex(encodeMerchantPublicKey(asBytes32(merchantSecret)));
}

export function merchantCommitment(merchantSecret: string): string {
  return merchantPublicKey(merchantSecret);
}

export function lineCommitment(w: LineWitness): string {
  return toHex(
    lineStateCommit(
      {
        identity: asBytes32(w.I),
        limit: u64(w.L),
        outstanding: u64(w.B),
        epoch: u64(w.e),
      },
      asBytes32(w.s),
    ),
  );
}

export function quoteCommitment(q: QuotePreimage, domain: string): string {
  return toHex(
    encodeQuoteCommit({
      merchantPk: asBytes32(q.merchantCommitment),
      invoiceId: asBytes32(q.invoiceId),
      amount: u64(q.amount),
      expiry: u64(q.expiry),
      nonce: asBytes32(q.nonce),
      generation: u64(q.generation),
      domain: asBytes32(domain),
    }),
  );
}

export function drawNoteCommitment(np: DrawNotePreimage, salt: string): string {
  return toHex(
    drawNoteCommit(
      {
        domain: asBytes32(np.domain),
        lineGeneration: u64(np.lineGeneration),
        identity: asBytes32(np.identity),
        quoteCommit: asBytes32(np.quoteCommit),
        merchantPk: asBytes32(np.merchantPk),
        amount: u64(np.amount),
        noteNonce: asBytes32(np.noteNonce),
        expiry: u64(np.expiry),
      },
      asBytes32(salt),
    ),
  );
}

export function drawNullifier(agentSecret: string, Q: string, domain: string): string {
  return toHex(encodeDrawNullifier(asBytes32(agentSecret), asBytes32(Q), asBytes32(domain)));
}

export function redeemNullifier(merchantSecret: string, D: string, domain: string): string {
  return toHex(encodeRedeemNullifier(asBytes32(merchantSecret), asBytes32(D), asBytes32(domain)));
}

export function repayNullifier(
  receiptNonce: string,
  I: string,
  currentC: string,
  amount: number,
  paymentRef: string,
  domain: string,
): string {
  return toHex(
    encodeRepayNullifier({
      nonce: asBytes32(receiptNonce),
      identity: asBytes32(I),
      currentC: asBytes32(currentC),
      amount: u64(amount),
      paymentRef: asBytes32(paymentRef),
      domain: asBytes32(domain),
    }),
  );
}

function pushEvent(ledger: Ledger, event: Omit<LedgerEvent, "t">): void {
  ledger.actionClock += 1;
  ledger.events.unshift({ t: ledger.actionClock, ...event });
}

export function createLedger(params?: {
  issuerSecret?: string;
  merchantSecret?: string;
  instanceNonce?: string;
  issuerPubKey?: string;
  merchantPubKey?: string;
}): Ledger {
  const issuerPk = params?.issuerPubKey
    ? asBytes32(params.issuerPubKey)
    : encodeIssuerPublicKey(asBytes32(params?.issuerSecret ?? ISSUER_SK));
  const merchantPk = params?.merchantPubKey
    ? asBytes32(params.merchantPubKey)
    : encodeMerchantPublicKey(asBytes32(params?.merchantSecret ?? MERCHANT_A_SK));
  const nonce = asBytes32(params?.instanceNonce ?? INSTANCE_NONCE);
  const domain = toHex(contractDomain(issuerPk, merchantPk, nonce));
  const merchantHex = toHex(merchantPk);

  return {
    contractDomain: domain,
    issuerPubKey: toHex(issuerPk),
    initialMerchantPubKey: merchantHex,
    instanceNonce: toHex(nonce),
    registeredMerchants: { [merchantHex]: true },
    totalReserve: 0,
    encumberedReserve: 0,
    redeemedReserve: 0,
    feeReserve: 0,
    identityCommitment: null,
    lineCommitment: null,
    lineExpiry: 0,
    status: "none",
    lineGeneration: 0,
    quotes: [],
    notes: [],
    nullifiers: [],
    events: [],
    actionClock: 0,
  };
}

export function cloneLedger(ledger: Ledger): Ledger {
  return {
    ...ledger,
    registeredMerchants: { ...ledger.registeredMerchants },
    quotes: ledger.quotes.map((q) => ({ ...q })),
    notes: ledger.notes.map((n) => ({ ...n })),
    nullifiers: [...ledger.nullifiers],
    events: ledger.events.map((e) => ({ ...e })),
  };
}

function isIssuer(ledger: Ledger, callerSecret: string) {
  return issuerPublicKey(callerSecret) === ledger.issuerPubKey;
}

function opens(w: LineWitness, C: string | null): boolean {
  return C != null && lineCommitment(w) === C;
}

function assertSafeUint(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && Number.isSafeInteger(n);
}

export function registerMerchant(
  ledger: Ledger,
  input: { caller: string; merchantPk: string },
): CircuitResult<{ ledger: Ledger }> {
  const next = cloneLedger(ledger);
  if (!isIssuer(next, input.caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  const pubM = toHex(asBytes32(input.merchantPk));
  if (next.registeredMerchants[pubM]) {
    return fail("MERCHANT_REGISTERED", FAIL.MERCHANT_REGISTERED);
  }
  next.registeredMerchants[pubM] = true;
  pushEvent(next, {
    circuit: "registerMerchant",
    ok: true,
    publicNote: `Merchant registered: ${pubM.slice(0, 8)}...`,
  });
  return { ok: true, ledger: next };
}

/**
 * Mirror of the Compact `disableMerchant(merchantPk)` circuit (audit L2).
 *
 * Issuer-only: sets the merchant's registeredMerchants flag to false. The
 * merchant STAYS in the registry (membership intact) — only new quotes are
 * blocked at postQuote; already-posted quotes remain drawable (draw checks
 * membership only, exactly as the circuit). Re-disabling is idempotent,
 * exactly as the circuit (no "already disabled" assert).
 */
export function disableMerchant(
  ledger: Ledger,
  input: { caller: string; merchantPk: string },
): CircuitResult<{ ledger: Ledger }> {
  const next = cloneLedger(ledger);
  if (!isIssuer(next, input.caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  const pubM = toHex(asBytes32(input.merchantPk));
  if (!(pubM in next.registeredMerchants)) {
    return fail("UNKNOWN_MERCHANT", FAIL.UNKNOWN_MERCHANT);
  }
  next.registeredMerchants[pubM] = false;
  pushEvent(next, {
    circuit: "disableMerchant",
    ok: true,
    publicNote: `Merchant disabled: ${pubM.slice(0, 8)}... New quotes blocked; existing quotes stay drawable.`,
  });
  return { ok: true, ledger: next };
}

export function fundReserve(
  ledger: Ledger,
  input: { caller: string; amount: number },
): CircuitResult<{ ledger: Ledger }> {
  const next = cloneLedger(ledger);
  if (!isIssuer(next, input.caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  if (!assertSafeUint(input.amount) || input.amount <= 0) return fail("ZERO", FAIL.ZERO);

  const nextReserve = next.totalReserve + input.amount;
  if (BigInt(nextReserve) > UINT64_MAX) return fail("OVERFLOW", FAIL.OVERFLOW);

  next.totalReserve = nextReserve;
  pushEvent(next, {
    circuit: "fundReserve",
    ok: true,
    publicNote: `Reserve funded by ${input.amount}. Total reserve: ${nextReserve}.`,
    amount: input.amount,
  });
  return { ok: true, ledger: next };
}

export function withdrawUnencumberedReserve(
  ledger: Ledger,
  input: { caller: string; amount: number },
): CircuitResult<{ ledger: Ledger }> {
  const next = cloneLedger(ledger);
  if (!isIssuer(next, input.caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  if (!assertSafeUint(input.amount) || input.amount <= 0) return fail("ZERO", FAIL.ZERO);

  // FEE_SPEC §3: accrued fees are locked — only withdrawFees releases them.
  const locked = next.encumberedReserve + next.redeemedReserve + next.feeReserve;
  const withdrawable = next.totalReserve - locked;
  if (input.amount > withdrawable) {
    return fail("RESERVE_WITHDRAW", FAIL.RESERVE_WITHDRAW);
  }

  next.totalReserve -= input.amount;
  pushEvent(next, {
    circuit: "withdrawUnencumberedReserve",
    ok: true,
    publicNote: `Withdrew ${input.amount} unencumbered reserve. Remaining total: ${next.totalReserve}.`,
    amount: input.amount,
  });
  return { ok: true, ledger: next };
}

/** FEE_SPEC §4: issuer-only release of accrued fees. Accrued fees are locked
    inside totalReserve — only withdrawFees releases them (withdrawUnencumberedReserve
    cannot touch them). In this prototype the reserve is an accounting counter
    (no tokens move), so "payout" means the issuer's accrued-fee claim is released
    by shrinking totalReserve. */
export function withdrawFees(
  ledger: Ledger,
  input: { caller: string },
): CircuitResult<{ ledger: Ledger; fees: number }> {
  const next = cloneLedger(ledger);
  if (!isIssuer(next, input.caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  const f = next.feeReserve;
  if (f <= 0) return fail("NO_FEES", FAIL.NO_FEES);
  const locked = next.encumberedReserve + next.redeemedReserve + next.feeReserve;
  if (next.totalReserve < locked) return fail("RESERVE_DEFICIT", FAIL.RESERVE_DEFICIT);
  next.totalReserve -= f;
  next.feeReserve = 0;
  pushEvent(next, {
    circuit: "withdrawFees",
    ok: true,
    publicNote: `Issuer withdrew ${f} accrued fees.`,
    amount: f,
  });
  return { ok: true, ledger: next, fees: f };
}

/**
 * Mirror of the Compact `openLine(expiry)` circuit.
 *
 * Public circuit parameters travel in `input`; the credit limit is a PRIVATE
 * witness (lineLimit()) supplied in `witness` — it is never a public
 * parameter, never logged, and never lands on the public ledger. Only the
 * identity commitment I and the line-state commitment C0 are disclosed.
 */
export function openLine(
  ledger: Ledger,
  input: {
    caller: string;
    agentSecret: string;
    salt: string;
    expiry: number;
  },
  witness: OpenLineWitness,
): CircuitResult<{ ledger: Ledger; agent: AgentStore }> {
  const next = cloneLedger(ledger);
  if (!isIssuer(next, input.caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  if (!assertSafeUint(witness.limit) || witness.limit <= 0) return fail("LIMIT", FAIL.LIMIT);
  // Headroom-2 rule (audit L3), mirroring the circuit: this circuit ends with
  // actionClock.increment(1), so expiry = clock+1 would pass yet open an
  // immediately-unusable line. Require expiry > clock+1 (i.e. >= clock+2).
  if (!assertSafeUint(input.expiry) || input.expiry <= next.actionClock + 1) {
    return fail("EXPIRY", FAIL.EXPIRY);
  }
  if (next.status !== "none" && next.status !== "closed") {
    return fail("LINE_EXISTS", FAIL.LINE_EXISTS);
  }

  const I = identityCommitment(input.agentSecret);
  const lineWitness: LineWitness = {
    I,
    L: witness.limit,
    B: 0,
    e: 0,
    s: toHex(asBytes32(input.salt)),
  };
  const C = lineCommitment(lineWitness);
  next.identityCommitment = I;
  next.lineCommitment = C;
  next.lineExpiry = input.expiry;
  next.status = "open";
  next.lineGeneration += 1;
  pushEvent(next, {
    circuit: "openLine",
    ok: true,
    publicNote: "Line opened. Commitment published. Limit is not on the ledger.",
    commitment: C,
  });
  return {
    ok: true,
    ledger: next,
    agent: { secret: toHex(asBytes32(input.agentSecret)), witness: lineWitness },
  };
}

/**
 * Mirror of the Compact `postQuote(expiry)` circuit.
 *
 * The invoice amount is a PRIVATE witness (quoteAmount()) supplied in
 * `witness` — it is never a public parameter and never lands on the ledger.
 * The stored QuoteRecord mirrors QuoteMeta {expiry, lineGeneration, used}:
 * NO merchantPk, so the public ledger cannot link merchant<->quote.
 * The returned preimage is the merchant's private invoice record (off-ledger).
 */
export function postQuote(
  ledger: Ledger,
  input: {
    caller: string;
    invoiceId: string;
    expiry: number;
    nonce: string;
  },
  witness: PostQuoteWitness,
): CircuitResult<{ ledger: Ledger; quote: QuotePreimage; Q: string }> {
  const next = cloneLedger(ledger);
  const mPk = merchantPublicKey(input.caller);
  // Mirror the circuit's assert order: registry MEMBERSHIP ("unregistered
  // merchant") is asserted before the enabled flag ("merchant disabled").
  // A disabled merchant stays in the registry — their new quotes are blocked
  // here, but their already-posted quotes remain drawable.
  if (!(mPk in next.registeredMerchants)) return fail("AUTH_MERCHANT", FAIL.AUTH_MERCHANT);
  if (next.registeredMerchants[mPk] !== true) {
    return fail("MERCHANT_DISABLED", FAIL.MERCHANT_DISABLED);
  }
  if (next.status !== "open") return fail("STATUS", FAIL.STATUS);
  if (!assertSafeUint(witness.amount) || witness.amount <= 0) return fail("ZERO", FAIL.ZERO);
  // Headroom-2 rule (audit L3), mirroring the circuit: expiry must be >
  // clock+1 so the quote is still drawable after this circuit's clock tick.
  if (!assertSafeUint(input.expiry) || input.expiry <= next.actionClock + 1) {
    return fail("EXPIRY", FAIL.EXPIRY);
  }

  const preimage: QuotePreimage = {
    merchantCommitment: mPk,
    amount: witness.amount,
    invoiceId: toHex(asBytes32(input.invoiceId)),
    expiry: input.expiry,
    nonce: toHex(asBytes32(input.nonce)),
    generation: next.lineGeneration,
  };
  const Q = quoteCommitment(preimage, next.contractDomain);
  if (next.quotes.some((q) => q.commitment === Q)) {
    return fail("QUOTE_USED", "quote commitment already posted");
  }
  // Public quote meta carries NO merchantPk (audit H3): the merchant is a
  // private witness inside draw. Only the opaque commitment is public.
  next.quotes.push({
    commitment: Q,
    expiry: input.expiry,
    lineGeneration: next.lineGeneration,
    used: false,
  });
  pushEvent(next, {
    circuit: "postQuote",
    ok: true,
    publicNote: "Opaque quote commitment posted.",
    quote: Q,
  });
  return { ok: true, ledger: next, quote: preimage, Q };
}

/**
 * Mirror of the Compact `draw(quoteCommitPublic, noteExpiry, fee)` circuit.
 *
 * Public circuit parameters travel in `input` (the quote commitment, the note
 * expiry, and the public issuer fee). EVERYTHING private travels in `witness`:
 * the line books (lineLimit()/lineOutstanding()/lineEpoch() witnesses) and the
 * merchant's invoice preimage (invoiceId()/drawAmount()/quoteNonce()/
 * quoteMerchantPk() witnesses).
 *
 * Merchant unlinkability (audit H3): the quote's merchant is NOT read from
 * public ledger state — the ledger no longer stores it. The agent supplies it
 * as a witness and the engine proves, exactly as the circuit does:
 *   (1) the witness (merchantPk, invoiceId, amount, nonce) recomputed with the
 *       PUBLIC quote meta (expiry, lineGeneration) opens the public Q, and
 *   (2) the witness merchantPk is on the registeredMerchants allowlist
 *       (membership only — a disabled merchant's already-posted quotes stay
 *       drawable, matching the circuit).
 * The stale-commitment check and the capacity check evaluate over the witness
 * books exactly as the circuit does.
 */
export function draw(
  ledger: Ledger,
  input: {
    agentSecret: string;
    /** PUBLIC quoteCommitPublic circuit parameter: the opaque quote commitment. */
    quoteCommit: string;
    newSalt: string;
    noteNonce?: string;
    noteSalt?: string;
    /** PUBLIC noteExpiry circuit parameter. */
    noteExpiry?: number;
    /** Issuer fee (PUBLIC Uint<64> circuit parameter, appended last per FEE_SPEC §2).
        fee = 0 reproduces pre-fee behavior exactly. */
    fee?: number;
  },
  witness: DrawWitness,
): CircuitResult<{ ledger: Ledger; agent: AgentStore; note: DrawNote }> {
  const next = cloneLedger(ledger);
  if (next.status !== "open") return fail("STATUS", FAIL.STATUS);
  if (!next.lineCommitment) return fail("NO_LINE", FAIL.NO_LINE);
  if (next.lineExpiry <= next.actionClock) return fail("LINE_EXPIRED", FAIL.LINE_EXPIRED);

  const books = witness.books;
  const I = identityCommitment(input.agentSecret);
  if (I !== books.I || I !== next.identityCommitment) {
    return fail("AUTH_AGENT", FAIL.AUTH_AGENT);
  }
  // Stale check over the WITNESS books: lineStateCommit({I,L,B,e}, s) == lineCommit.
  if (!opens(books, next.lineCommitment)) {
    return fail("STALE", FAIL.STALE);
  }

  const Q = input.quoteCommit;
  const live = next.quotes.find((q) => q.commitment === Q);
  if (!live) return fail("QUOTE", FAIL.QUOTE);
  if (live.used) return fail("QUOTE_USED", FAIL.QUOTE_USED);
  if (live.expiry <= next.actionClock) return fail("QUOTE_EXPIRED", FAIL.QUOTE_EXPIRED);
  if (live.lineGeneration !== next.lineGeneration) {
    return fail("QUOTE_GEN", FAIL.QUOTE_GEN);
  }

  // Private invoice witnesses (audit H1/H3).
  const wq = witness.quote;
  const wMerchantPk = toHex(asBytes32(wq.merchantCommitment));
  const A = wq.amount;
  if (!assertSafeUint(A) || A <= 0) {
    return fail("ZERO", FAIL.ZERO);
  }
  // Quote reconstruction, exactly as the circuit: the witness
  // (merchantPk, invoiceId, amount, nonce) is recomputed with the PUBLIC quote
  // meta (expiry, lineGeneration) and must open the public Q. The preimage's
  // own expiry/generation copies are the merchant's record and are not
  // consulted — the circuit uses the ledger meta's values.
  const recon = quoteCommitment(
    {
      merchantCommitment: wMerchantPk,
      invoiceId: toHex(asBytes32(wq.invoiceId)),
      amount: A,
      expiry: live.expiry,
      nonce: toHex(asBytes32(wq.nonce)),
      generation: live.lineGeneration,
    },
    next.contractDomain,
  );
  if (recon !== Q) return fail("QUOTE", "quote preimage does not match a live quote");
  // Registry MEMBERSHIP only (audit L2): a disabled merchant's already-posted
  // quotes stay drawable; only new quotes are blocked at postQuote.
  if (!(wMerchantPk in next.registeredMerchants)) {
    return fail("QUOTE_AUTH", FAIL.QUOTE_AUTH);
  }

  const { L, B, e } = books;
  // FEE_SPEC §3: cost = amount + fee is charged to the agent's outstanding;
  // the settlement note encumbers ONLY the invoice amount, the fee accrues to
  // the issuer's feeReserve. fee = 0 reproduces pre-fee behavior exactly.
  const f = input.fee ?? 0;
  if (!assertSafeUint(f)) return fail("AMOUNT", "fee must be a non-negative integer");
  const cost = A + f;
  if (cost < A || !assertSafeUint(cost)) return fail("OVERFLOW", FAIL.OVERFLOW); // "fee overflow" guard
  const nextB = B + cost;
  if (nextB < B || !assertSafeUint(nextB)) return fail("OVERFLOW", FAIL.OVERFLOW);
  if (nextB > L) return fail("CAPACITY", FAIL.CAPACITY);

  // Reserve capacity check: fee counts toward solvency.
  const locked = next.encumberedReserve + next.redeemedReserve + next.feeReserve;
  if (next.totalReserve < locked) return fail("RESERVE_DEFICIT", FAIL.RESERVE_DEFICIT);
  const free = next.totalReserve - locked; // == unencumberedReserve
  if (cost > free) {
    return fail("RESERVE_CAPACITY", FAIL.RESERVE_CAPACITY);
  }

  // Headroom-2 rule (audit L3), mirroring the circuit: this circuit ends with
  // actionClock.increment(1), so noteExpiry = clock+1 would pass yet be
  // immediately unredeemable. Require noteExpiry > clock+1 (i.e. >= clock+2).
  const noteExp = input.noteExpiry ?? live.expiry;
  if (!assertSafeUint(noteExp) || noteExp <= next.actionClock + 1) {
    return fail("NOTE_EXPIRED", FAIL.NOTE_EXPIRED);
  }

  const N = drawNullifier(input.agentSecret, Q, next.contractDomain);
  if (next.nullifiers.includes(N)) return fail("NULLIFIER", FAIL.NULLIFIER);

  // Construct merchant-bound settlement note. The note binds the WITNESS
  // merchantPk (disclosed inside the circuit as pubM) — the ledger never
  // learns which merchant this note is for beyond the opaque commitment D.
  const noteNonce = toHex(asBytes32(input.noteNonce ?? pad32(`note:nonce:${next.actionClock}`)));
  const noteSalt = toHex(asBytes32(input.noteSalt ?? pad32(`note:salt:${next.actionClock}`)));
  const notePreimage: DrawNotePreimage = {
    domain: next.contractDomain,
    lineGeneration: next.lineGeneration,
    identity: I,
    quoteCommit: Q,
    merchantPk: wMerchantPk,
    amount: A,
    noteNonce,
    expiry: noteExp,
  };
  const D = drawNoteCommitment(notePreimage, noteSalt);
  if (next.notes.some((n) => n.commitment === D)) {
    return fail("NOTE_USED", "note commitment already exists");
  }

  const nextWitness: LineWitness = {
    I,
    L,
    B: nextB,
    e: e + 1,
    s: toHex(asBytes32(input.newSalt)),
  };
  const C2 = lineCommitment(nextWitness);
  live.used = true;
  next.lineCommitment = C2;
  next.nullifiers.push(N);
  next.encumberedReserve += A; // note encumbers ONLY the invoice amount (FEE_SPEC §3)
  next.feeReserve += f; // fee accrues to the issuer
  // Settled amounts ARE public escrow accounting (honest boundary): the note
  // amount and the reserve-counter deltas stay public by design.
  next.notes.push({
    commitment: D,
    amount: A,
    redeemed: false,
    cancelled: false,
    expiry: noteExp,
    lineGeneration: next.lineGeneration,
  });

  pushEvent(next, {
    circuit: "draw",
    ok: true,
    publicNote: "Draw authorized. Note commitment issued. Balance and limit remain private.",
    commitment: C2,
    quote: Q,
    note: D,
    nullifier: N,
  });

  return {
    ok: true,
    ledger: next,
    agent: { secret: toHex(asBytes32(input.agentSecret)), witness: nextWitness },
    note: { D, preimage: notePreimage, salt: noteSalt },
  };
}

/**
 * Mirror of the Compact `redeemDraw(noteCommitPublic, noteExpiry)` circuit.
 *
 * Public circuit parameters travel in `input` (the note commitment, the note
 * expiry, and the note salt). The merchant's note preimage travels in
 * `witness`: its amount is the redeemAmount() witness, asserted against the
 * PUBLIC NoteMeta.amount ("amount mismatch") — settled amounts are public
 * escrow accounting (honest boundary), so this check is public-vs-witness,
 * not witness-vs-witness.
 *
 * Exactly as the circuit does, the note opening is recomputed with the PUBLIC
 * noteExpiry parameter and the PUBLIC note meta's lineGeneration (not the
 * witness's copies), and the merchantPk is derived from the caller's secret
 * (callerSecret() witness) rather than trusted from the witness preimage.
 */
export function redeemDraw(
  ledger: Ledger,
  input: {
    caller: string;
    noteCommitment: string;
    /** PUBLIC noteExpiry circuit parameter — goes into the note preimage. */
    noteExpiry: number;
    noteSalt: string;
  },
  witness: RedeemWitness,
): CircuitResult<{ ledger: Ledger; N_redeem: string }> {
  const next = cloneLedger(ledger);
  const live = next.notes.find((n) => n.commitment === input.noteCommitment);
  if (!live) return fail("NOTE_NOT_FOUND", FAIL.NOTE_NOT_FOUND);
  if (live.redeemed) return fail("NOTE_USED", FAIL.NOTE_USED);
  if (live.cancelled) return fail("NOTE_CANCELLED", FAIL.NOTE_CANCELLED);
  if (live.expiry <= next.actionClock) return fail("NOTE_EXPIRED", FAIL.NOTE_EXPIRED);

  // Merchant proof of ownership: the caller secret derives the merchantPk
  // bound in the note. Kept as an explicit NOTE_AUTH check (the circuit would
  // reject via "note opening invalid"; the TS engine reports the finer code).
  const mPk = merchantPublicKey(input.caller);
  const wn = witness.note;
  if (mPk !== toHex(asBytes32(wn.merchantPk))) {
    return fail("NOTE_AUTH", FAIL.NOTE_AUTH);
  }
  // Honest boundary: the settled amount is PUBLIC escrow accounting
  // (NoteMeta.amount); the redeemAmount() witness must equal it.
  if (wn.amount !== live.amount) {
    return fail("AMOUNT", "note preimage amount mismatch");
  }

  // Note opening, exactly as the circuit: public noteExpiry and public
  // meta.lineGeneration go into the preimage; identity/quoteCommit/nonce come
  // from witnesses; merchantPk is derived from the caller secret.
  const computedD = drawNoteCommitment(
    {
      domain: next.contractDomain,
      lineGeneration: live.lineGeneration,
      identity: toHex(asBytes32(wn.identity)),
      quoteCommit: toHex(asBytes32(wn.quoteCommit)),
      merchantPk: mPk,
      amount: wn.amount,
      noteNonce: toHex(asBytes32(wn.noteNonce)),
      expiry: input.noteExpiry,
    },
    input.noteSalt,
  );
  if (computedD !== input.noteCommitment) {
    return fail("NOTE_OPENING", FAIL.NOTE_OPENING);
  }

  // Check redemption nullifier
  const N = redeemNullifier(input.caller, input.noteCommitment, next.contractDomain);
  if (next.nullifiers.includes(N)) {
    return fail("NULLIFIER", "redemption nullifier already spent");
  }

  live.redeemed = true;
  next.nullifiers.push(N);
  next.encumberedReserve -= live.amount;
  next.redeemedReserve += live.amount;

  pushEvent(next, {
    circuit: "redeemDraw",
    ok: true,
    publicNote: "Merchant redeemed draw note against issuer reserve.",
    note: input.noteCommitment,
    nullifier: N,
  });

  return { ok: true, ledger: next, N_redeem: N };
}

export function cancelOrExpireNote(
  ledger: Ledger,
  input: { noteCommitment: string },
): CircuitResult<{ ledger: Ledger }> {
  const next = cloneLedger(ledger);
  const live = next.notes.find((n) => n.commitment === input.noteCommitment);
  if (!live) return fail("NOTE_NOT_FOUND", FAIL.NOTE_NOT_FOUND);
  if (live.redeemed) return fail("NOTE_USED", FAIL.NOTE_USED);
  if (live.cancelled) return fail("NOTE_CANCELLED", FAIL.NOTE_CANCELLED);
  if (live.expiry > next.actionClock) return fail("NOTE_NOT_EXPIRED", FAIL.NOTE_NOT_EXPIRED);

  live.cancelled = true;
  next.encumberedReserve -= live.amount;

  pushEvent(next, {
    circuit: "cancelOrExpireNote",
    ok: true,
    publicNote: "Expired note cancelled and encumbered reserve released.",
    note: input.noteCommitment,
  });

  return { ok: true, ledger: next };
}

/**
 * Mirror of the Compact `acknowledgeRepayment(receiptExpiry)` circuit.
 *
 * Public circuit parameters travel in `input` (only the receipt expiry).
 * EVERYTHING else is a private witness in `witness`: the line books
 * (lineLimit()/lineOutstanding()/lineEpoch() witnesses) and the issuer's
 * repayment receipt (repayAmount()/receiptNonce()/paymentRef() witnesses).
 * The stale-commitment check and the range check evaluate over the witness
 * values exactly as the circuit does. The receipt amount is never published.
 */
export function acknowledgeRepayment(
  ledger: Ledger,
  input: {
    caller: string;
    newSalt: string;
    /** PUBLIC receiptExpiry circuit parameter. */
    receiptExpiry: number;
  },
  witness: RepayWitness,
): CircuitResult<{ ledger: Ledger; witness: LineWitness }> {
  const next = cloneLedger(ledger);
  if (!isIssuer(next, input.caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  if (next.status !== "open" && next.status !== "defaulted") {
    return fail("STATUS", FAIL.STATUS);
  }
  if (!next.lineCommitment) return fail("NO_LINE", FAIL.NO_LINE);
  const books = witness.books;
  // Stale check over the WITNESS books: lineStateCommit({I,L,B,e}, s) == C.
  if (!opens(books, next.lineCommitment)) return fail("STALE", FAIL.STALE);

  const r = witness.receipt;
  if (r.contractDomain !== next.contractDomain) return fail("RECEIPT", FAIL.RECEIPT);
  if (r.identity !== books.I || r.identity !== next.identityCommitment) {
    return fail("RECEIPT", FAIL.RECEIPT);
  }
  if (r.currentC !== next.lineCommitment) return fail("RECEIPT_STALE", FAIL.RECEIPT_STALE);
  // The circuit checks the PUBLIC receiptExpiry parameter (> actionClock).
  if (!assertSafeUint(input.receiptExpiry) || input.receiptExpiry <= next.actionClock) {
    return fail("EXPIRY", FAIL.EXPIRY);
  }

  // Repayment amount is the repayAmount() WITNESS: 0 < R <= B (witness B).
  const R = r.amount;
  const { B, L, I, e } = books;
  if (!assertSafeUint(R) || R <= 0 || R > B) return fail("RECEIPT_RANGE", FAIL.RECEIPT_RANGE);

  const N = repayNullifier(r.nonce, I, next.lineCommitment, R, r.paymentRef, next.contractDomain);
  if (next.nullifiers.includes(N)) return fail("RECEIPT_USED", FAIL.RECEIPT_USED);

  const nextWitness: LineWitness = {
    I,
    L,
    B: B - R,
    e: e + 1,
    s: toHex(asBytes32(input.newSalt)),
  };
  const C2 = lineCommitment(nextWitness);
  next.lineCommitment = C2;
  next.nullifiers.push(N);
  pushEvent(next, {
    circuit: "acknowledgeRepayment",
    ok: true,
    publicNote: "Issuer acknowledged repayment. Line commitment rotated. Amount is not on the ledger.",
    commitment: C2,
    nullifier: N,
  });
  return { ok: true, ledger: next, witness: nextWitness };
}

export function setStatus(
  ledger: Ledger,
  input: { caller: string; status: Exclude<LineStatus, "none"> },
): CircuitResult<{ ledger: Ledger }> {
  const next = cloneLedger(ledger);
  if (!isIssuer(next, input.caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  if (next.status === "none" || !next.lineCommitment) return fail("NO_LINE", FAIL.NO_LINE);
  if (input.status === ("none" as LineStatus)) return fail("BAD_STATUS", FAIL.BAD_STATUS);
  if (next.status === "closed") return fail("CLOSED", FAIL.CLOSED);
  if (input.status === "open" && next.status !== "open" && next.status !== "defaulted") {
    return fail("BAD_STATUS", FAIL.BAD_STATUS);
  }
  next.status = input.status;
  pushEvent(next, {
    circuit: "setStatus",
    ok: true,
    publicNote: `Status set to ${input.status}.`,
  });
  return { ok: true, ledger: next };
}

/** Local preflight — same checks as draw, no mutation. */
export function simulateDraw(
  ledger: Ledger,
  input: {
    agentSecret: string;
    quoteCommit: string;
    newSalt: string;
    noteNonce?: string;
    noteSalt?: string;
    noteExpiry?: number;
    fee?: number;
  },
  witness: DrawWitness,
): CircuitResult<{ availableAfter: number }> {
  const r = draw(ledger, input, witness);
  if (!r.ok) return r;
  const w = r.agent.witness!;
  return { ok: true, availableAfter: w.L - w.B };
}

export function available(w: LineWitness): number {
  return w.L - w.B;
}

/**
 * The public ledger view — what a chain observer sees.
 *
 * PRIVACY BOUNDARY (audit H1/H2/H3): this view MUST NOT expose L, B,
 * per-quote invoice amounts, or merchant<->quote linkage. The ledger stores no
 * merchantPk on quotes (QuoteMeta has no such field), and witness values never
 * flow here.
 *
 * PUBLIC BY DESIGN (honest boundary): reserve totals/deltas (total,
 * encumbered, redeemed, fee), SETTLED note amounts (NoteMeta.amount is public
 * escrow accounting — see the note-amount delta between encumberedReserve and
 * redeemedReserve), commitments (I, C, Q, D), nullifiers, the
 * registered-merchant allowlist, lineExpiry, status, generation, and the
 * actionClock.
 */
export function publicLedgerView(ledger: Ledger): Pick<
  Ledger,
  | "contractDomain"
  | "issuerPubKey"
  | "registeredMerchants"
  | "identityCommitment"
  | "lineCommitment"
  | "lineExpiry"
  | "status"
  | "lineGeneration"
  | "quotes"
  | "notes"
  | "nullifiers"
  | "totalReserve"
  | "encumberedReserve"
  | "redeemedReserve"
  | "feeReserve"
  | "actionClock"
  | "events"
> {
  return {
    contractDomain: ledger.contractDomain,
    issuerPubKey: ledger.issuerPubKey,
    // Public allowlist by design (audit H3): membership is public, but nothing
    // here links a merchant to a specific quote or note.
    registeredMerchants: { ...ledger.registeredMerchants },
    identityCommitment: ledger.identityCommitment,
    lineCommitment: ledger.lineCommitment,
    lineExpiry: ledger.lineExpiry,
    status: ledger.status,
    lineGeneration: ledger.lineGeneration,
    // Quote entries carry NO merchantPk and NO amount: opaque commitments only.
    quotes: ledger.quotes.map((q) => ({
      commitment: q.commitment,
      expiry: q.expiry,
      lineGeneration: q.lineGeneration,
      used: q.used,
    })),
    // Settled note amounts ARE public escrow accounting (honest boundary):
    // NoteMeta.amount and the reserve-counter deltas stay visible by design.
    notes: ledger.notes.map((n) => ({
      commitment: n.commitment,
      amount: n.amount,
      redeemed: n.redeemed,
      cancelled: n.cancelled,
      expiry: n.expiry,
      lineGeneration: n.lineGeneration,
    })),
    nullifiers: [...ledger.nullifiers],
    totalReserve: ledger.totalReserve,
    encumberedReserve: ledger.encumberedReserve,
    redeemedReserve: ledger.redeemedReserve,
    feeReserve: ledger.feeReserve,
    actionClock: ledger.actionClock,
    events: ledger.events.map((e) => ({ ...e })),
  };
}
