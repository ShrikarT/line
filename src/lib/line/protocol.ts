import {
  agentId,
  contractDomain,
  drawNullifier as encodeDrawNullifier,
  fromHex,
  issuerPublicKey as encodeIssuerPublicKey,
  lineStateCommit,
  merchantPublicKey as encodeMerchantPublicKey,
  pad32,
  quoteCommit as encodeQuoteCommit,
  repayNullifier as encodeRepayNullifier,
  toHex,
} from "./encoding.ts";
import {
  GENERIC_DRAW_FAIL,
  type AgentStore,
  type CircuitResult,
  type Ledger,
  type LedgerEvent,
  type LineStatus,
  type LineWitness,
  type QuotePreimage,
  type RepayReceipt,
} from "./types.ts";
import { ISSUER_SK, MERCHANT_SK } from "./keys.ts";

export const FAIL = {
  AUTH_ISSUER: "caller is not the registered issuer",
  AUTH_MERCHANT: "caller is not the registered merchant",
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
  QUOTE_AUTH: "quote is not bound to the registered merchant",
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
} as const;

const UINT64_MAX = 18446744073709551615n;

function fail(code: string, reason: string, message = GENERIC_DRAW_FAIL): CircuitResult<never> {
  return { ok: false, code, reason, message };
}

export function asBytes32(input: string): Uint8Array {
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

export function drawNullifier(agentSecret: string, Q: string, domain: string): string {
  return toHex(encodeDrawNullifier(asBytes32(agentSecret), asBytes32(Q), asBytes32(domain)));
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
  issuerPubKey?: string;
  merchantPubKey?: string;
}): Ledger {
  const issuerPk = params?.issuerPubKey
    ? asBytes32(params.issuerPubKey)
    : encodeIssuerPublicKey(asBytes32(params?.issuerSecret ?? ISSUER_SK));
  const merchantPk = params?.merchantPubKey
    ? asBytes32(params.merchantPubKey)
    : encodeMerchantPublicKey(asBytes32(params?.merchantSecret ?? MERCHANT_SK));
  return {
    contractDomain: toHex(contractDomain(issuerPk, merchantPk)),
    issuerPubKey: toHex(issuerPk),
    merchantPubKey: toHex(merchantPk),
    identityCommitment: null,
    lineCommitment: null,
    lineExpiry: 0,
    status: "none",
    lineGeneration: 0,
    quotes: [],
    nullifiers: [],
    events: [],
    actionClock: 0,
  };
}

export function cloneLedger(ledger: Ledger): Ledger {
  return {
    ...ledger,
    quotes: ledger.quotes.map((q) => ({ ...q })),
    nullifiers: [...ledger.nullifiers],
    events: ledger.events.map((e) => ({ ...e })),
  };
}

function isIssuer(ledger: Ledger, callerSecret: string) {
  return issuerPublicKey(callerSecret) === ledger.issuerPubKey;
}

function isMerchant(ledger: Ledger, callerSecret: string) {
  return merchantPublicKey(callerSecret) === ledger.merchantPubKey;
}

function opens(w: LineWitness, C: string | null): boolean {
  return C != null && lineCommitment(w) === C;
}

function assertSafeUint(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && Number.isSafeInteger(n);
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
  if (!isMerchant(next, input.caller)) return fail("AUTH_MERCHANT", FAIL.AUTH_MERCHANT);
  if (next.status !== "open") return fail("STATUS", FAIL.STATUS);
  if (!assertSafeUint(input.amount) || input.amount <= 0) return fail("ZERO", FAIL.ZERO);
  if (!assertSafeUint(input.expiry) || input.expiry <= next.actionClock) return fail("EXPIRY", FAIL.EXPIRY);

  const preimage: QuotePreimage = {
    merchantCommitment: next.merchantPubKey,
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
  },
): CircuitResult<{ ledger: Ledger; agent: AgentStore }> {
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

  if (input.quote.merchantCommitment !== next.merchantPubKey) {
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

  const N = drawNullifier(input.agentSecret, Q, next.contractDomain);
  if (next.nullifiers.includes(N)) return fail("NULLIFIER", FAIL.NULLIFIER);

  const nextWitness: LineWitness = {
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
  pushEvent(next, {
    circuit: "draw",
    ok: true,
    publicNote: "Draw authorized. Line commitment rotated. Amount is not on the ledger.",
    commitment: C2,
    quote: Q,
    nullifier: N,
  });
  return {
    ok: true,
    ledger: next,
    agent: { secret: toHex(asBytes32(input.agentSecret)), witness: nextWitness },
  };
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
  | "nullifiers"
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
      expiry: q.expiry,
      lineGeneration: q.lineGeneration,
      used: q.used,
    })),
    nullifiers: [...ledger.nullifiers],
    actionClock: ledger.actionClock,
    events: ledger.events.map((e) => ({ ...e })),
  };
}
