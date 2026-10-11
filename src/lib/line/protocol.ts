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
  paymentNullifier as encodePaymentNullifier,
  canonicalPaymentReferenceBytes,
  requiredDrawFee,
  refundCommit,
  randomBytes32,
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
  type MerchantInvoice,
  type NoteRecord,
  type OpenLineWitness,
  type PostQuoteWitness,
  type RepayReceipt,
  type QuotePreimage,
  type RedeemWitness,
  type RepayWitness,
  type RefundAllocation,
} from "./types.ts";

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

/** Execution environment, never public ledger data or caller-supplied witness. */
const executionClocks = new WeakMap<Ledger, () => number>();
const systemUnixSeconds = () => Math.floor(Date.now() / 1_000);
function executionUnixSeconds(ledger: Ledger): number {
  const now = (executionClocks.get(ledger) ?? systemUnixSeconds)();
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError("Invalid trusted model Unix-seconds clock");
  return now;
}

function fail(code: string, reason: string, message = GENERIC_DRAW_FAIL): CircuitResult<never> {
  return { ok: false, code, reason, message };
}

export function asBytes32(input?: string | Uint8Array | null): Uint8Array {
  if (!input) return new Uint8Array(32);
  if (input instanceof Uint8Array) return input;
  const clean = typeof input === "string" && input.startsWith("0x") ? input.slice(2) : input;
  if (typeof clean === "string" && /^[0-9a-fA-F]{64}$/.test(clean)) return fromHex(clean);
  return pad32(input);
}

function getCaller(input: { caller?: string; callerSk?: string }): string {
  return input.callerSk ?? input.caller ?? "";
}

function lockedReserve(ledger: Ledger): number {
  return ledger.encumberedReserve + ledger.redeemedReserve + ledger.feeReserve + ledger.pendingFeeReserve + ledger.refundReserve + ledger.reportedRefundReserve;
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
        domain: asBytes32(w.domain),
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
      feeFlat: u64(q.feeFlat),
      feeBps: u64(q.feeBps),
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
        fee: u64(np.fee),
        noteNonce: asBytes32(np.noteNonce),
        expiry: u64(np.expiry),
      },
      asBytes32(salt),
    ),
  );
}

export function refundCommitment(preimage: Pick<RefundAllocation, "domain" | "lineGeneration" | "identity" | "noteCommit" | "amount">, salt: string): string {
  return toHex(refundCommit({ domain: asBytes32(preimage.domain), lineGeneration: u64(preimage.lineGeneration), identity: asBytes32(preimage.identity), noteCommit: asBytes32(preimage.noteCommit), amount: u64(preimage.amount) }, asBytes32(salt)));
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
      paymentRef: canonicalPaymentReferenceBytes(paymentRef),
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
  /** Trusted model execution clock; deadlines are absolute Unix seconds. */
  clock?: () => number;
}): Ledger {
  const issuerPk = params?.issuerPubKey
    ? asBytes32(params.issuerPubKey)
    : params?.issuerSecret
    ? encodeIssuerPublicKey(asBytes32(params.issuerSecret))
    : randomBytes32();
  const merchantPk = params?.merchantPubKey
    ? asBytes32(params.merchantPubKey)
    : params?.merchantSecret
    ? encodeMerchantPublicKey(asBytes32(params.merchantSecret))
    : randomBytes32();
  const nonce = params?.instanceNonce
    ? asBytes32(params.instanceNonce)
    : randomBytes32();
  const domain = toHex(contractDomain(issuerPk, merchantPk, nonce));
  const merchantHex = toHex(merchantPk);

  const ledger: Ledger = {
    contractDomain: domain,
    issuerPubKey: toHex(issuerPk),
    initialMerchantPubKey: merchantHex,
    instanceNonce: toHex(nonce),
    registeredMerchants: { [merchantHex]: true },
    totalReserve: 0,
    encumberedReserve: 0,
    redeemedReserve: 0,
    feeReserve: 0,
    pendingFeeReserve: 0,
    refundReserve: 0,
    reportedRefundReserve: 0,
    feeFlat: 0,
    feeBps: 0,
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
  if (params?.clock !== undefined && typeof params.clock !== "function") throw new TypeError("Model clock must be a function");
  executionClocks.set(ledger, params?.clock ?? systemUnixSeconds);
  return ledger;
}

export function cloneLedger(ledger: Ledger): Ledger {
  const cloned: Ledger = {
    ...ledger,
    registeredMerchants: { ...ledger.registeredMerchants },
    quotes: ledger.quotes.map((q) => ({ ...q })),
    notes: ledger.notes.map((n) => ({ ...n })),
    nullifiers: [...ledger.nullifiers],
    events: ledger.events.map((e) => ({ ...e })),
  };
  executionClocks.set(cloned, executionClocks.get(ledger) ?? systemUnixSeconds);
  return cloned;
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
  input: { caller?: string; callerSk?: string; merchantPk: string },
): CircuitResult<{ ledger: Ledger }> {
  const next = cloneLedger(ledger);
  const caller = getCaller(input);
  if (!isIssuer(next, caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
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
  input: { caller?: string; callerSk?: string; amount: number },
): CircuitResult<{ ledger: Ledger }> {
  const next = cloneLedger(ledger);
  const caller = getCaller(input);
  if (!isIssuer(next, caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
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
  input: { caller?: string; callerSk?: string; amount: number },
): CircuitResult<{ ledger: Ledger }> {
  const next = cloneLedger(ledger);
  const caller = getCaller(input);
  if (!isIssuer(next, caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  if (!assertSafeUint(input.amount) || input.amount <= 0) return fail("ZERO", FAIL.ZERO);

  // FEE_SPEC §3: accrued fees are locked — only withdrawFees releases them.
  const locked = lockedReserve(next);
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
  const locked = lockedReserve(next);
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
 * Mirror of Compact `openLine(expiry, flatFee, basisPoints)`.
 *
 * Public circuit parameters travel in `input`; the credit limit is a PRIVATE
 * witness (lineLimit()) supplied in `witness` — it is never a public
 * parameter, never logged, and never lands on the public ledger. Identity I,
 * line commitment C0, expiry and issuer-approved pricing are public.
 */
export function openLine(
  ledger: Ledger,
  input: {
    caller?: string;
    callerSk?: string;
    agentSecret: string;
    limit?: number;
    salt?: string;
    expiry: number;
    feeFlat?: number;
    feeBps?: number;
  },
  witness?: OpenLineWitness,
): CircuitResult<{ ledger: Ledger; agent: AgentStore }> {
  const next = cloneLedger(ledger);
  const caller = getCaller(input);
  if (!isIssuer(next, caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  const limit = witness?.limit ?? input.limit ?? 0;
  if (!assertSafeUint(limit) || limit <= 0) return fail("LIMIT", FAIL.LIMIT);
  // Mirror blockTimeLt(expiry): action count cannot advance this deadline.
  if (!assertSafeUint(input.expiry) || input.expiry <= executionUnixSeconds(next)) {
    return fail("EXPIRY", FAIL.EXPIRY);
  }
  if (next.status !== "none" && next.status !== "closed") {
    return fail("LINE_EXISTS", FAIL.LINE_EXISTS);
  }
  const feeFlat = input.feeFlat === undefined ? 0 : input.feeFlat, feeBps = input.feeBps === undefined ? 0 : input.feeBps;
  if (!assertSafeUint(feeFlat) || !assertSafeUint(feeBps) || feeBps > 10_000) return fail("FEE_POLICY", "invalid issuer fee policy");

  const saltStr = input.salt ?? toHex(randomBytes32());
  const I = identityCommitment(input.agentSecret);
  const lineWitness: LineWitness = {
    domain: next.contractDomain,
    I,
    L: limit,
    B: 0,
    e: 0,
    s: toHex(asBytes32(saltStr)),
  };
  const C = lineCommitment(lineWitness);
  next.identityCommitment = I;
  next.lineCommitment = C;
  next.lineExpiry = input.expiry;
  next.feeFlat = feeFlat;
  next.feeBps = feeBps;
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
    agent: { secret: toHex(asBytes32(input.agentSecret)), witness: lineWitness, identityCommitment: I },
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
    caller?: string;
    callerSk?: string;
    merchantSecret?: string;
    amount?: number;
    invoiceId: string;
    expiry: number;
    nonce?: string;
  },
  witness?: PostQuoteWitness,
): CircuitResult<{ ledger: Ledger; quote: QuotePreimage; Q: string }> {
  const next = cloneLedger(ledger);
  const caller = input.callerSk ?? input.merchantSecret ?? input.caller ?? "";
  const mPk = merchantPublicKey(caller);
  // Mirror the circuit's assert order: registry MEMBERSHIP ("unregistered
  // merchant") is asserted before the enabled flag ("merchant disabled").
  // A disabled merchant stays in the registry — their new quotes are blocked
  // here, but their already-posted quotes remain drawable.
  if (!(mPk in next.registeredMerchants)) return fail("AUTH_MERCHANT", FAIL.AUTH_MERCHANT);
  if (next.registeredMerchants[mPk] !== true) {
    return fail("MERCHANT_DISABLED", FAIL.MERCHANT_DISABLED);
  }
  if (next.status !== "open") return fail("STATUS", FAIL.STATUS);
  const amount = witness?.amount ?? input.amount ?? 0;
  if (!assertSafeUint(amount) || amount <= 0) return fail("ZERO", FAIL.ZERO);
  if (!assertSafeUint(input.expiry) || input.expiry <= executionUnixSeconds(next)) {
    return fail("EXPIRY", FAIL.EXPIRY);
  }
  if (!assertSafeUint(next.feeFlat) || !assertSafeUint(next.feeBps) || next.feeBps > 10_000) return fail("FEE_POLICY", "missing or invalid issuer fee policy");

  const nonce = input.nonce ?? toHex(randomBytes32());
  const preimage: QuotePreimage = {
    merchantCommitment: mPk,
    amount,
    invoiceId: toHex(asBytes32(input.invoiceId)),
    expiry: input.expiry,
    nonce: toHex(asBytes32(nonce)),
    generation: next.lineGeneration,
    feeFlat: next.feeFlat,
    feeBps: next.feeBps,
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
    caller?: string;
    callerSk?: string;
    agentSecret?: string;
    agent?: AgentStore;
    witness?: LineWitness;
    quote?: QuotePreimage;
    invoice?: MerchantInvoice;
    quoteCommit?: string;
    newSalt?: string;
    noteNonce?: string;
    noteSalt?: string;
    noteExpiry?: number;
    fee?: number;
  },
  witness?: DrawWitness,
): CircuitResult<{ ledger: Ledger; agent: AgentStore; note: DrawNote }> {
  const next = cloneLedger(ledger);
  const now = executionUnixSeconds(next);
  if (next.status !== "open") return fail("STATUS", FAIL.STATUS);
  if (!next.lineCommitment) return fail("NO_LINE", FAIL.NO_LINE);
  if (next.lineExpiry <= now) return fail("LINE_EXPIRED", FAIL.LINE_EXPIRED);

  const secret = input.agentSecret ?? input.agent?.secret ?? input.callerSk ?? input.caller;
  if (!secret) return fail("AUTH_AGENT", FAIL.AUTH_AGENT);

  const books = witness?.books ?? input.witness ?? input.agent?.witness;
  if (!books) return fail("STALE", FAIL.STALE);

  const I = identityCommitment(secret);
  if (I !== books.I || I !== next.identityCommitment) {
    return fail("AUTH_AGENT", FAIL.AUTH_AGENT);
  }
  // Stale check includes this contract's domain: lineStateCommit({D,I,L,B,e}, s) == lineCommit.
  if (!opens(books, next.lineCommitment)) {
    return fail("STALE", FAIL.STALE);
  }

  const wq = witness?.quote ?? input.quote ?? input.invoice?.preimage;
  if (!wq) return fail("QUOTE", FAIL.QUOTE);
  if (!assertSafeUint(next.feeFlat) || !assertSafeUint(next.feeBps) || next.feeBps > 10_000) return fail("FEE_POLICY", "missing or invalid issuer fee policy");

  const Q = input.quoteCommit ?? quoteCommitment(wq, next.contractDomain);
  const live = next.quotes.find((q) => q.commitment === Q);
  if (!live) return fail("QUOTE", FAIL.QUOTE);
  if (live.used) return fail("QUOTE_USED", FAIL.QUOTE_USED);
  if (live.expiry <= now) return fail("QUOTE_EXPIRED", FAIL.QUOTE_EXPIRED);
  if (live.lineGeneration !== next.lineGeneration) {
    return fail("QUOTE_GEN", FAIL.QUOTE_GEN);
  }

  // Private invoice witnesses (audit H1/H3).
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
      feeFlat: next.feeFlat,
      feeBps: next.feeBps,
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
  // pendingFeeReserve until the merchant redeems. This is not cash collection.
  const f = input.fee ?? 0;
  if (!assertSafeUint(f)) return fail("AMOUNT", "fee must be a non-negative integer");
  let expectedFee: bigint;
  try { expectedFee = requiredDrawFee(u64(A), u64(next.feeFlat), u64(next.feeBps)); }
  catch { return fail("OVERFLOW", FAIL.OVERFLOW); }
  if (expectedFee > BigInt(Number.MAX_SAFE_INTEGER)) return fail("OVERFLOW", FAIL.OVERFLOW);
  if (u64(f) !== expectedFee) return fail("FEE_POLICY", "fee does not match issuer policy");
  const cost = A + f;
  if (cost < A || !assertSafeUint(cost)) return fail("OVERFLOW", FAIL.OVERFLOW); // "fee overflow" guard
  const nextB = B + cost;
  if (nextB < B || !assertSafeUint(nextB)) return fail("OVERFLOW", FAIL.OVERFLOW);
  if (nextB > L) return fail("CAPACITY", FAIL.CAPACITY);

  // Reserve capacity check: fee counts toward solvency.
  const locked = lockedReserve(next);
  if (next.totalReserve < locked) return fail("RESERVE_DEFICIT", FAIL.RESERVE_DEFICIT);
  const free = next.totalReserve - locked; // == unencumberedReserve
  if (cost > free) {
    return fail("RESERVE_CAPACITY", FAIL.RESERVE_CAPACITY);
  }

  const noteExp = input.noteExpiry ?? live.expiry;
  if (noteExp !== live.expiry) return fail("NOTE_EXPIRY", "note expiry must match authenticated quote deadline");
  if (!assertSafeUint(noteExp) || noteExp <= now) {
    return fail("NOTE_EXPIRED", FAIL.NOTE_EXPIRED);
  }

  const N = drawNullifier(secret, Q, next.contractDomain);
  if (next.nullifiers.includes(N)) return fail("NULLIFIER", FAIL.NULLIFIER);

  // Construct merchant-bound settlement note. The note binds the WITNESS
  // merchantPk (disclosed inside the circuit as pubM) — the ledger never
  // learns which merchant this note is for beyond the opaque commitment D.
  const noteNonce = toHex(asBytes32(input.noteNonce ?? randomBytes32()));
  const noteSalt = toHex(asBytes32(input.noteSalt ?? randomBytes32()));
  const notePreimage: DrawNotePreimage = {
    domain: next.contractDomain,
    lineGeneration: next.lineGeneration,
    identity: I,
    quoteCommit: Q,
    merchantPk: wMerchantPk,
    amount: A,
    fee: f,
    noteNonce,
    expiry: noteExp,
  };
  const D = drawNoteCommitment(notePreimage, noteSalt);
  if (next.notes.some((n) => n.commitment === D)) {
    return fail("NOTE_USED", "note commitment already exists");
  }

  const newSalt = input.newSalt ?? toHex(randomBytes32());
  const nextWitness: LineWitness = {
    domain: next.contractDomain,
    I,
    L,
    B: nextB,
    e: e + 1,
    s: toHex(asBytes32(newSalt)),
  };
  const C2 = lineCommitment(nextWitness);
  live.used = true;
  next.lineCommitment = C2;
  next.nullifiers.push(N);
  next.encumberedReserve += A; // note encumbers ONLY the invoice amount (FEE_SPEC §3)
  next.pendingFeeReserve += f;
  // Settled amounts ARE public escrow accounting (honest boundary): the note
  // amount and the reserve-counter deltas stay public by design.
  next.notes.push({
    commitment: D,
    amount: A,
    fee: f,
    redeemed: false,
    cancelled: false,
    expiry: noteExp,
    lineGeneration: next.lineGeneration,
    compensationAllocated: false,
    refundCommitment: toHex(new Uint8Array(32)),
    cashRefundOwed: false,
    refundAcknowledged: false,
    refundPaymentNullifier: toHex(new Uint8Array(32)),
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
    agent: { secret: toHex(asBytes32(secret)), witness: nextWitness, identityCommitment: I },
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
    caller?: string;
    callerSk?: string;
    merchantSecret?: string;
    note?: DrawNote;
    noteCommitment?: string;
    /** PUBLIC noteExpiry circuit parameter — goes into the note preimage. */
    noteExpiry?: number;
    notePreimage?: DrawNotePreimage;
    noteSalt?: string;
  },
  witness?: RedeemWitness,
): CircuitResult<{ ledger: Ledger; N_redeem: string }> {
  const next = cloneLedger(ledger);
  const caller = input.callerSk ?? input.merchantSecret ?? input.caller ?? "";
  const commitment = input.noteCommitment ?? input.note?.D ?? "";
  const preimage = witness?.note ?? input.notePreimage ?? input.note?.preimage;
  const salt = input.noteSalt ?? input.note?.salt ?? "";

  const live = next.notes.find((n) => n.commitment === commitment);
  if (!live) return fail("NOTE_NOT_FOUND", FAIL.NOTE_NOT_FOUND);
  if (live.redeemed) return fail("NOTE_USED", FAIL.NOTE_USED);
  if (live.cancelled) return fail("NOTE_CANCELLED", FAIL.NOTE_CANCELLED);
  if (live.expiry <= executionUnixSeconds(next)) return fail("NOTE_EXPIRED", FAIL.NOTE_EXPIRED);
  if (!preimage) return fail("NOTE_AUTH", FAIL.NOTE_AUTH);

  // Merchant proof of ownership: the caller secret derives the merchantPk
  // bound in the note. Kept as an explicit NOTE_AUTH check (the circuit would
  // reject via "note opening invalid"; the TS engine reports the finer code).
  const mPk = merchantPublicKey(caller);
  if (mPk !== toHex(asBytes32(preimage.merchantPk))) {
    return fail("NOTE_AUTH", FAIL.NOTE_AUTH);
  }
  // Honest boundary: the settled amount is PUBLIC escrow accounting
  // (NoteMeta.amount); the redeemAmount() witness must equal it.
  if (preimage.amount !== live.amount) {
    return fail("AMOUNT", "note preimage amount mismatch");
  }

  const noteExp = input.noteExpiry ?? preimage.expiry ?? live.expiry;

  // Note opening, exactly as the circuit: public noteExpiry and public
  // meta.lineGeneration go into the preimage; identity/quoteCommit/nonce come
  // from witnesses; merchantPk is derived from the caller secret.
  const computedD = drawNoteCommitment(
    {
      domain: next.contractDomain,
      lineGeneration: live.lineGeneration,
      identity: toHex(asBytes32(preimage.identity)),
      quoteCommit: toHex(asBytes32(preimage.quoteCommit)),
      merchantPk: mPk,
      amount: preimage.amount,
      fee: live.fee,
      noteNonce: toHex(asBytes32(preimage.noteNonce)),
      expiry: noteExp,
    },
    salt,
  );
  if (computedD !== commitment) {
    return fail("NOTE_OPENING", FAIL.NOTE_OPENING);
  }

  // Check redemption nullifier
  const N = redeemNullifier(caller, commitment, next.contractDomain);
  if (next.nullifiers.includes(N)) {
    return fail("NULLIFIER", "redemption nullifier already spent");
  }

  live.redeemed = true;
  next.nullifiers.push(N);
  next.encumberedReserve -= live.amount;
  next.redeemedReserve += live.amount;
  next.pendingFeeReserve -= live.fee;
  next.feeReserve += live.fee;

  pushEvent(next, {
    circuit: "redeemDraw",
    ok: true,
    publicNote: "Merchant redeemed draw note against issuer reserve.",
    note: commitment,
    nullifier: N,
  });

  return { ok: true, ledger: next, N_redeem: N };
}

export function cancelOrExpireNote(
  ledger: Ledger,
  input: {
    caller?: string;
    callerSk?: string;
    agentSecret?: string;
    noteCommitment?: string;
    note?: DrawNote;
    action?: 0 | 1 | 2;
    receiptExpiry?: number;
    compensation?: { note: DrawNotePreimage; noteSalt: string; newSalt: string; books?: LineWitness };
    refundAck?: { identity: string; amount: number; salt: string; paymentRef: string; receiptExpiry: number };
  },
): CircuitResult<{ ledger: Ledger; witness?: LineWitness; refund?: RefundAllocation }> {
  const next = cloneLedger(ledger);
  const commitment = input.noteCommitment ?? input.note?.D ?? "";
  const mode = input.action === undefined ? 0 : input.action;
  if (mode !== 0 && mode !== 1 && mode !== 2) return fail("COMPENSATION_ACTION", "unsupported compensation action");
  const live = next.notes.find((n) => n.commitment === commitment);
  if (!live) return fail("NOTE_NOT_FOUND", FAIL.NOTE_NOT_FOUND);
  if (live.redeemed) return fail("NOTE_USED", FAIL.NOTE_USED);
  if (!assertSafeUint(live.amount) || !assertSafeUint(live.fee) || !assertSafeUint(live.amount + live.fee)) return fail("OVERFLOW", FAIL.OVERFLOW);
  const cost = live.amount + live.fee;
  const caller = input.callerSk ?? input.caller ?? input.agentSecret ?? "";
  let updatedWitness: LineWitness | undefined;
  let allocation: RefundAllocation | undefined;
  let publicNote: string;
  if (mode === 0 || mode === 1) {
    if (mode === 0 && live.cancelled) return fail("NOTE_CANCELLED", FAIL.NOTE_CANCELLED);
    if (mode === 1 && live.compensationAllocated) return fail("COMPENSATION_USED", "compensation already allocated");
    if (!live.cancelled) {
      if (live.expiry > executionUnixSeconds(next)) return fail("NOTE_NOT_EXPIRED", FAIL.NOTE_NOT_EXPIRED);
      live.cancelled = true;
      next.encumberedReserve -= live.amount;
      next.pendingFeeReserve -= live.fee;
      next.refundReserve += cost;
    }
    if (mode === 0) {
      publicNote = "Expired note cancelled; full purchase budget locked for compensation.";
    } else {
      const proof = input.compensation;
      if (!proof) return fail("COMPENSATION_OPENING", "missing compensation note opening");
      const owner = toHex(asBytes32(proof.note.identity));
      let computedD: string;
      try {
        computedD = drawNoteCommitment({ ...proof.note, domain: next.contractDomain, lineGeneration: live.lineGeneration, identity: owner, amount: live.amount, fee: live.fee, expiry: live.expiry }, proof.noteSalt);
      } catch { return fail("COMPENSATION_OPENING", "invalid compensation note opening"); }
      if (computedD !== commitment) return fail("COMPENSATION_OPENING", "invalid compensation note opening");
      if (!isIssuer(next, caller) && identityCommitment(caller) !== owner) return fail("COMPENSATION_AUTH", "caller does not own compensation authority");
      let owed = cost, credited = 0;
      if (live.lineGeneration === next.lineGeneration) {
        if (owner !== next.identityCommitment) return fail("COMPENSATION_IDENTITY", "compensation identity mismatch");
        const books = proof.books;
        if (!books || books.I !== owner || !opens(books, next.lineCommitment)) return fail("STALE", "stale compensation book");
        if (!assertSafeUint(books.B) || !assertSafeUint(books.e + 1)) return fail("OVERFLOW", FAIL.OVERFLOW);
        credited = Math.min(books.B, cost);
        owed = cost - credited;
        updatedWitness = { ...books, domain: next.contractDomain, B: books.B - credited, e: books.e + 1, s: toHex(asBytes32(proof.newSalt)) };
        next.lineCommitment = lineCommitment(updatedWitness);
        if (owed === 0) next.refundReserve -= cost;
      } else if (live.lineGeneration >= next.lineGeneration) {
        return fail("COMPENSATION_GENERATION", "compensation generation mismatch");
      }
      allocation = { domain: next.contractDomain, lineGeneration: live.lineGeneration, identity: owner, noteCommit: commitment, amount: owed, allocatedCredit: credited, salt: toHex(asBytes32(proof.newSalt)), commitment: "" };
      allocation.commitment = refundCommitment(allocation, allocation.salt);
      live.compensationAllocated = true;
      live.refundCommitment = allocation.commitment;
      live.cashRefundOwed = owed > 0;
      live.refundAcknowledged = false;
      live.refundPaymentNullifier = toHex(new Uint8Array(32));
      publicNote = "Compensation allocated once; cash obligations remain private and unpaid.";
    }
  } else {
    if (!isIssuer(next, caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
    if (!live.cancelled || !live.compensationAllocated || !live.cashRefundOwed) return fail("NO_REFUND", "no cash refund obligation");
    if (live.refundAcknowledged) return fail("REFUND_USED", "refund already acknowledged");
    const ack = input.refundAck;
    if (!ack) return fail("REFUND_OPENING", "missing refund opening");
    const expiry = input.receiptExpiry ?? ack.receiptExpiry;
    if (!assertSafeUint(expiry) || expiry <= executionUnixSeconds(next)) return fail("EXPIRY", "refund receipt expired");
    if (!assertSafeUint(ack.amount) || ack.amount === 0 || ack.amount > cost) return fail("REFUND_AMOUNT", "refund amount is outside the note cost");
    let computedRefund: string, referenceBytes: Uint8Array;
    try {
      computedRefund = refundCommitment({ domain: next.contractDomain, lineGeneration: live.lineGeneration, identity: ack.identity, noteCommit: commitment, amount: ack.amount }, ack.salt);
      referenceBytes = canonicalPaymentReferenceBytes(ack.paymentRef);
    } catch { return fail("REFUND_OPENING", "invalid refund opening or payment reference"); }
    if (computedRefund !== live.refundCommitment) return fail("REFUND_OPENING", "refund opening does not match obligation");
    const paymentN = toHex(encodePaymentNullifier(asBytes32(caller), referenceBytes, asBytes32(next.contractDomain)));
    if (next.nullifiers.includes(paymentN)) return fail("RECEIPT_USED", FAIL.RECEIPT_USED);
    next.nullifiers.push(paymentN);
    live.refundAcknowledged = true;
    live.refundPaymentNullifier = paymentN;
    next.refundReserve -= cost;
    next.reportedRefundReserve += cost;
    publicNote = "Issuer reported cash refund; full original-cost budget remains conservatively locked.";
  }
  pushEvent(next, {
    circuit: "cancelOrExpireNote",
    ok: true,
    publicNote,
    note: commitment,
    ...(updatedWitness ? { commitment: next.lineCommitment! } : {}),
  });
  return { ok: true, ledger: next, ...(updatedWitness ? { witness: updatedWitness } : {}), ...(allocation ? { refund: allocation } : {}) };
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
    caller?: string;
    callerSk?: string;
    agent?: AgentStore;
    witness?: LineWitness;
    receipt?: RepayReceipt;
    newSalt?: string;
    receiptExpiry?: number;
  },
  witness?: RepayWitness,
): CircuitResult<{ ledger: Ledger; witness: LineWitness; agent?: AgentStore }> {
  const next = cloneLedger(ledger);
  const caller = getCaller(input);
  if (!isIssuer(next, caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  if (next.status !== "open" && next.status !== "defaulted") {
    return fail("STATUS", FAIL.STATUS);
  }
  if (!next.lineCommitment) return fail("NO_LINE", FAIL.NO_LINE);

  const books = witness?.books ?? input.witness ?? input.agent?.witness;
  if (!books) return fail("STALE", FAIL.STALE);
  // Stale check includes this contract's domain: lineStateCommit({D,I,L,B,e}, s) == C.
  if (!opens(books, next.lineCommitment)) return fail("STALE", FAIL.STALE);

  const r = witness?.receipt ?? input.receipt;
  if (!r) return fail("RECEIPT", FAIL.RECEIPT);
  if (r.contractDomain !== next.contractDomain) return fail("RECEIPT", FAIL.RECEIPT);
  if (r.identity !== books.I || r.identity !== next.identityCommitment) {
    return fail("RECEIPT", FAIL.RECEIPT);
  }
  if (r.currentC !== next.lineCommitment) return fail("RECEIPT_STALE", FAIL.RECEIPT_STALE);
  const receiptExpiry = input.receiptExpiry ?? r.expiry;
  // The circuit checks the PUBLIC absolute Unix-seconds deadline.
  if (!assertSafeUint(receiptExpiry) || receiptExpiry <= executionUnixSeconds(next)) {
    return fail("EXPIRY", FAIL.EXPIRY);
  }

  // Repayment amount is the repayAmount() WITNESS: 0 < R <= B (witness B).
  const R = r.amount;
  const { B, L, I, e } = books;
  if (!assertSafeUint(R) || R <= 0 || R > B) return fail("RECEIPT_RANGE", FAIL.RECEIPT_RANGE);

  let referenceBytes: Uint8Array;
  try { referenceBytes = canonicalPaymentReferenceBytes(r.paymentRef); }
  catch { return fail("RECEIPT", FAIL.RECEIPT); }
  const N = repayNullifier(r.nonce, I, next.lineCommitment, R, r.paymentRef, next.contractDomain);
  const paymentN = toHex(encodePaymentNullifier(asBytes32(caller), referenceBytes, asBytes32(next.contractDomain)));
  if (next.nullifiers.includes(paymentN)) return fail("RECEIPT_USED", FAIL.RECEIPT_USED);
  if (next.nullifiers.includes(N)) return fail("RECEIPT_USED", FAIL.RECEIPT_USED);

  const newSalt = input.newSalt ?? toHex(randomBytes32());
  const nextWitness: LineWitness = {
    domain: next.contractDomain,
    I,
    L,
    B: B - R,
    e: e + 1,
    s: toHex(asBytes32(newSalt)),
  };
  const C2 = lineCommitment(nextWitness);
  next.lineCommitment = C2;
  next.nullifiers.push(N);
  next.nullifiers.push(paymentN);
  pushEvent(next, {
    circuit: "acknowledgeRepayment",
    ok: true,
    publicNote: "Issuer acknowledged repayment. Line commitment rotated. Amount is not on the ledger.",
    commitment: C2,
    nullifier: N,
  });
  const updatedAgent = input.agent
    ? { ...input.agent, witness: nextWitness, identityCommitment: I }
    : undefined;
  return { ok: true, ledger: next, witness: nextWitness, agent: updatedAgent };
}

export function setStatus(
  ledger: Ledger,
  input: { caller?: string; callerSk?: string; status: Exclude<LineStatus, "none">; witness?: LineWitness },
): CircuitResult<{ ledger: Ledger }> {
  const next = cloneLedger(ledger);
  const caller = getCaller(input);
  if (!isIssuer(next, caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  if (next.status === "none" || !next.lineCommitment) return fail("NO_LINE", FAIL.NO_LINE);
  if (input.status === ("none" as LineStatus)) return fail("BAD_STATUS", FAIL.BAD_STATUS);
  if (next.status === "closed") return fail("CLOSED", FAIL.CLOSED);
  if (input.status === "open" && next.status !== "open" && next.status !== "defaulted") {
    return fail("BAD_STATUS", FAIL.BAD_STATUS);
  }
  if (input.status === "closed") {
    const books = input.witness;
    if (!books || books.I !== next.identityCommitment || !opens(books, next.lineCommitment)) return fail("STALE", "stale closing book");
    if (books.B !== 0) return fail("OUTSTANDING_DEBT", "outstanding debt");
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
  | "pendingFeeReserve"
  | "refundReserve"
  | "reportedRefundReserve"
  | "feeFlat"
  | "feeBps"
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
      fee: n.fee,
      redeemed: n.redeemed,
      cancelled: n.cancelled,
      expiry: n.expiry,
      lineGeneration: n.lineGeneration,
      compensationAllocated: n.compensationAllocated,
      refundCommitment: n.refundCommitment,
      cashRefundOwed: n.cashRefundOwed,
      refundAcknowledged: n.refundAcknowledged,
      refundPaymentNullifier: n.refundPaymentNullifier,
    })),
    nullifiers: [...ledger.nullifiers],
    totalReserve: ledger.totalReserve,
    encumberedReserve: ledger.encumberedReserve,
    redeemedReserve: ledger.redeemedReserve,
    feeReserve: ledger.feeReserve,
    pendingFeeReserve: ledger.pendingFeeReserve,
    refundReserve: ledger.refundReserve,
    reportedRefundReserve: ledger.reportedRefundReserve,
    feeFlat: ledger.feeFlat,
    feeBps: ledger.feeBps,
    actionClock: ledger.actionClock,
    events: ledger.events.map((e) => ({ ...e })),
  };
}
