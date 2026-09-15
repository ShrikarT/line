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
  type Ledger,
  type LedgerEvent,
  type LineStatus,
  type LineWitness,
  type NoteRecord,
  type QuotePreimage,
  type QuoteRecord,
  type RepayReceipt,
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

function isRegisteredMerchant(ledger: Ledger, callerSecret: string) {
  const pk = merchantPublicKey(callerSecret);
  return ledger.registeredMerchants[pk] === true;
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

  const locked = next.encumberedReserve + next.redeemedReserve;
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

export function openLine(
  ledger: Ledger,
  input: {
    caller: string;
    agentSecret: string;
    limit: number;
    salt: string;
    expiry: number;
  },
): CircuitResult<{ ledger: Ledger; agent: AgentStore }> {
  const next = cloneLedger(ledger);
  if (!isIssuer(next, input.caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  if (!assertSafeUint(input.limit) || input.limit <= 0) return fail("LIMIT", FAIL.LIMIT);
  if (!assertSafeUint(input.expiry) || input.expiry <= next.actionClock) return fail("EXPIRY", FAIL.EXPIRY);
  if (next.status !== "none" && next.status !== "closed") {
    return fail("LINE_EXISTS", FAIL.LINE_EXISTS);
  }

  const I = identityCommitment(input.agentSecret);
  const witness: LineWitness = {
    domain: next.contractDomain,
    I,
    L: input.limit,
    B: 0,
    e: 0,
    s: toHex(asBytes32(input.salt)),
  };
  const C = lineCommitment(witness);
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
    agent: { secret: toHex(asBytes32(input.agentSecret)), witness },
  };
}

export function postQuote(
  ledger: Ledger,
  input: {
    caller: string;
    amount: number;
    invoiceId: string;
    expiry: number;
    nonce: string;
  },
): CircuitResult<{ ledger: Ledger; quote: QuotePreimage; Q: string }> {
  const next = cloneLedger(ledger);
  if (!isRegisteredMerchant(next, input.caller)) return fail("AUTH_MERCHANT", FAIL.AUTH_MERCHANT);
  if (next.status !== "open") return fail("STATUS", FAIL.STATUS);
  if (!assertSafeUint(input.amount) || input.amount <= 0) return fail("ZERO", FAIL.ZERO);
  if (!assertSafeUint(input.expiry) || input.expiry <= next.actionClock) return fail("EXPIRY", FAIL.EXPIRY);

  const mPk = merchantPublicKey(input.caller);
  const preimage: QuotePreimage = {
    merchantCommitment: mPk,
    amount: input.amount,
    invoiceId: toHex(asBytes32(input.invoiceId)),
    expiry: input.expiry,
    nonce: toHex(asBytes32(input.nonce)),
    generation: next.lineGeneration,
  };
  const Q = quoteCommitment(preimage, next.contractDomain);
  if (next.quotes.some((q) => q.commitment === Q)) {
    return fail("QUOTE_USED", "quote commitment already posted");
  }
  next.quotes.push({
    commitment: Q,
    merchantPk: mPk,
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

export function draw(
  ledger: Ledger,
  input: {
    agentSecret: string;
    witness: LineWitness;
    quote: QuotePreimage;
    newSalt: string;
    noteNonce?: string;
    noteSalt?: string;
    noteExpiry?: number;
  },
): CircuitResult<{ ledger: Ledger; agent: AgentStore; note: DrawNote }> {
  const next = cloneLedger(ledger);
  if (next.status !== "open") return fail("STATUS", FAIL.STATUS);
  if (!next.lineCommitment) return fail("NO_LINE", FAIL.NO_LINE);
  if (next.lineExpiry <= next.actionClock) return fail("LINE_EXPIRED", FAIL.LINE_EXPIRED);

  const I = identityCommitment(input.agentSecret);
  if (I !== input.witness.I || I !== next.identityCommitment) {
    return fail("AUTH_AGENT", FAIL.AUTH_AGENT);
  }
  if (!opens(input.witness, next.lineCommitment)) {
    return fail("STALE", FAIL.STALE);
  }

  const Q = quoteCommitment(input.quote, next.contractDomain);
  const live = next.quotes.find((q) => q.commitment === Q);
  if (!live) return fail("QUOTE", FAIL.QUOTE);
  if (live.used) return fail("QUOTE_USED", FAIL.QUOTE_USED);
  if (live.expiry <= next.actionClock) return fail("QUOTE_EXPIRED", FAIL.QUOTE_EXPIRED);
  if (live.lineGeneration !== next.lineGeneration || input.quote.generation !== next.lineGeneration) {
    return fail("QUOTE_GEN", FAIL.QUOTE_GEN);
  }
  if (live.merchantPk !== input.quote.merchantCommitment) {
    return fail("QUOTE_AUTH", FAIL.QUOTE_AUTH);
  }
  if (!assertSafeUint(input.quote.amount) || input.quote.amount <= 0) {
    return fail("ZERO", FAIL.ZERO);
  }

  const { L, B } = input.witness;
  const A = input.quote.amount;
  if (B < 0 || A > Number.MAX_SAFE_INTEGER - B) return fail("OVERFLOW", FAIL.OVERFLOW);
  const nextB = B + A;
  if (nextB > L) return fail("CAPACITY", FAIL.CAPACITY);
  if (BigInt(nextB) > UINT64_MAX) return fail("OVERFLOW", FAIL.OVERFLOW);

  // Reserve capacity check
  const locked = next.encumberedReserve + next.redeemedReserve;
  const withdrawable = next.totalReserve - locked;
  if (A > withdrawable) {
    return fail("RESERVE_CAPACITY", FAIL.RESERVE_CAPACITY);
  }

  const noteExp = input.noteExpiry ?? live.expiry;
  if (noteExp <= next.actionClock) return fail("NOTE_EXPIRED", FAIL.NOTE_EXPIRED);

  const N = drawNullifier(input.agentSecret, Q, next.contractDomain);
  if (next.nullifiers.includes(N)) return fail("NULLIFIER", FAIL.NULLIFIER);

  // Construct merchant-bound settlement note
  const noteNonce = toHex(asBytes32(input.noteNonce ?? pad32(`note:nonce:${next.actionClock}`)));
  const noteSalt = toHex(asBytes32(input.noteSalt ?? pad32(`note:salt:${next.actionClock}`)));
  const notePreimage: DrawNotePreimage = {
    domain: next.contractDomain,
    lineGeneration: next.lineGeneration,
    identity: I,
    quoteCommit: Q,
    merchantPk: live.merchantPk,
    amount: A,
    noteNonce,
    expiry: noteExp,
  };
  const D = drawNoteCommitment(notePreimage, noteSalt);
  if (next.notes.some((n) => n.commitment === D)) {
    return fail("NOTE_USED", "note commitment already exists");
  }

  const nextWitness: LineWitness = {
    domain: next.contractDomain,
    I,
    L,
    B: nextB,
    e: input.witness.e + 1,
    s: toHex(asBytes32(input.newSalt)),
  };
  const C2 = lineCommitment(nextWitness);
  live.used = true;
  next.lineCommitment = C2;
  next.nullifiers.push(N);
  next.encumberedReserve += A;
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

export function redeemDraw(
  ledger: Ledger,
  input: {
    caller: string;
    noteCommitment: string;
    notePreimage: DrawNotePreimage;
    noteSalt: string;
  },
): CircuitResult<{ ledger: Ledger; N_redeem: string }> {
  const next = cloneLedger(ledger);
  const live = next.notes.find((n) => n.commitment === input.noteCommitment);
  if (!live) return fail("NOTE_NOT_FOUND", FAIL.NOTE_NOT_FOUND);
  if (live.redeemed) return fail("NOTE_USED", FAIL.NOTE_USED);
  if (live.cancelled) return fail("NOTE_CANCELLED", FAIL.NOTE_CANCELLED);
  if (live.expiry <= next.actionClock) return fail("NOTE_EXPIRED", FAIL.NOTE_EXPIRED);

  // Check merchant ownership
  const mPk = merchantPublicKey(input.caller);
  if (mPk !== input.notePreimage.merchantPk) {
    return fail("NOTE_AUTH", FAIL.NOTE_AUTH);
  }
  if (input.notePreimage.amount !== live.amount) {
    return fail("AMOUNT", "note preimage amount mismatch");
  }
  if (input.notePreimage.lineGeneration !== live.lineGeneration) {
    return fail("QUOTE_GEN", "note preimage generation mismatch");
  }
  if (input.notePreimage.expiry !== live.expiry) {
    return fail("EXPIRY", "note preimage expiry mismatch");
  }

  // Check note opening
  const computedD = drawNoteCommitment(input.notePreimage, input.noteSalt);
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

export function acknowledgeRepayment(
  ledger: Ledger,
  input: {
    caller: string;
    witness: LineWitness;
    receipt: RepayReceipt;
    newSalt: string;
  },
): CircuitResult<{ ledger: Ledger; witness: LineWitness }> {
  const next = cloneLedger(ledger);
  if (!isIssuer(next, input.caller)) return fail("AUTH_ISSUER", FAIL.AUTH_ISSUER);
  if (next.status !== "open" && next.status !== "defaulted") {
    return fail("STATUS", FAIL.STATUS);
  }
  if (!next.lineCommitment) return fail("NO_LINE", FAIL.NO_LINE);
  if (!opens(input.witness, next.lineCommitment)) return fail("STALE", FAIL.STALE);

  const r = input.receipt;
  if (r.contractDomain !== next.contractDomain) return fail("RECEIPT", FAIL.RECEIPT);
  if (r.identity !== input.witness.I || r.identity !== next.identityCommitment) {
    return fail("RECEIPT", FAIL.RECEIPT);
  }
  if (r.currentC !== next.lineCommitment) return fail("RECEIPT_STALE", FAIL.RECEIPT_STALE);
  if (!assertSafeUint(r.expiry) || r.expiry <= next.actionClock) return fail("EXPIRY", FAIL.EXPIRY);

  const R = r.amount;
  const { B, L, I, e } = input.witness;
  if (!assertSafeUint(R) || R <= 0 || R > B) return fail("RECEIPT_RANGE", FAIL.RECEIPT_RANGE);

  const N = repayNullifier(r.nonce, I, next.lineCommitment, R, r.paymentRef, next.contractDomain);
  if (next.nullifiers.includes(N)) return fail("RECEIPT_USED", FAIL.RECEIPT_USED);

  const nextWitness: LineWitness = {
    domain: next.contractDomain,
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
    witness: LineWitness;
    quote: QuotePreimage;
    newSalt: string;
    noteNonce?: string;
    noteSalt?: string;
    noteExpiry?: number;
  },
): CircuitResult<{ availableAfter: number }> {
  const r = draw(ledger, input);
  if (!r.ok) return r;
  const w = r.agent.witness!;
  return { ok: true, availableAfter: w.L - w.B };
}

export function available(w: LineWitness): number {
  return w.L - w.B;
}

export function publicLedgerView(ledger: Ledger): Pick<
  Ledger,
  | "contractDomain"
  | "identityCommitment"
  | "lineCommitment"
  | "status"
  | "lineGeneration"
  | "quotes"
  | "notes"
  | "nullifiers"
  | "totalReserve"
  | "encumberedReserve"
  | "redeemedReserve"
  | "actionClock"
  | "events"
> {
  return {
    contractDomain: ledger.contractDomain,
    identityCommitment: ledger.identityCommitment,
    lineCommitment: ledger.lineCommitment,
    status: ledger.status,
    lineGeneration: ledger.lineGeneration,
    quotes: ledger.quotes.map((q) => ({
      commitment: q.commitment,
      merchantPk: q.merchantPk,
      expiry: q.expiry,
      lineGeneration: q.lineGeneration,
      used: q.used,
    })),
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
    actionClock: ledger.actionClock,
    events: ledger.events.map((e) => ({ ...e })),
  };
}
