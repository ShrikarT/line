import { domainHash } from "./hash.ts";
import {
  CONTRACT_ID,
  DOMAIN,
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
  NULLIFIER: "nullifier already spent",
  RECEIPT: "repayment receipt is invalid for this line",
  RECEIPT_STALE: "receipt does not reference the current commitment",
  RECEIPT_USED: "repayment receipt already used",
  RECEIPT_RANGE: "repayment amount is not in (0, outstanding]",
  EXPIRY: "expiry is not in the future",
  CLOSED: "closed line cannot be reused in this epoch",
  ZERO: "zero-amount operations are rejected",
} as const;

function fail(code: string, reason: string, message = GENERIC_DRAW_FAIL): CircuitResult<never> {
  return { ok: false, code, reason, message };
}

export function identityCommitment(agentSecret: string): string {
  return domainHash(DOMAIN.id, [agentSecret]);
}

export function merchantCommitment(merchantKey: string): string {
  return domainHash(DOMAIN.merchant, [merchantKey]);
}

export function lineCommitment(w: LineWitness): string {
  return domainHash(DOMAIN.state, [w.I, w.L, w.B, w.e, w.s]);
}

export function quoteCommitment(q: QuotePreimage, contractId = CONTRACT_ID): string {
  return domainHash(DOMAIN.quote, [
    q.merchantCommitment,
    q.amount,
    q.invoiceId,
    q.expiry,
    q.nonce,
    contractId,
  ]);
}

export function drawNullifier(agentSecret: string, Q: string, contractId = CONTRACT_ID): string {
  return domainHash(DOMAIN.draw, [agentSecret, Q, contractId]);
}

export function repayNullifier(receiptNonce: string, I: string, contractId = CONTRACT_ID): string {
  return domainHash(DOMAIN.repay, [receiptNonce, I, contractId]);
}

export function receiptCommitment(r: RepayReceipt): string {
  return domainHash(DOMAIN.receipt, [
    r.identity,
    r.currentC,
    r.amount,
    r.paymentRef,
    r.nonce,
    r.expiry,
    r.contractId,
  ]);
}

function pushEvent(ledger: Ledger, event: Omit<LedgerEvent, "t">): void {
  ledger.clock += 1;
  ledger.events.unshift({ t: ledger.clock, ...event });
}

export function createLedger(params?: {
  issuerPubKey?: string;
  merchantPubKey?: string;
}): Ledger {
  return {
    contractId: CONTRACT_ID,
    issuerPubKey: params?.issuerPubKey ?? "issuer-demo-key",
    merchantPubKey: params?.merchantPubKey ?? "merchant-demo-key",
    identityCommitment: null,
    lineCommitment: null,
    status: "none",
    quotes: [],
    nullifiers: [],
    events: [],
    clock: 0,
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

function isIssuer(ledger: Ledger, caller: string) {
  return caller === ledger.issuerPubKey;
}

function isMerchant(ledger: Ledger, caller: string) {
  return caller === ledger.merchantPubKey;
}

function opens(w: LineWitness, C: string | null): boolean {
  return C != null && lineCommitment(w) === C;
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
  if (!Number.isInteger(input.limit) || input.limit <= 0) return fail("LIMIT", FAIL.LIMIT);
  if (input.expiry <= next.clock) return fail("EXPIRY", FAIL.EXPIRY);
  if (next.status === "open") return fail("LINE_EXISTS", FAIL.LINE_EXISTS);

  const I = identityCommitment(input.agentSecret);
  if (next.identityCommitment && next.identityCommitment !== I && next.status !== "none") {
    return fail("LINE_EXISTS", FAIL.LINE_EXISTS);
  }

  const witness: LineWitness = {
    I,
    L: input.limit,
    B: 0,
    e: 0,
    s: input.salt,
  };
  const C = lineCommitment(witness);
  next.identityCommitment = I;
  next.lineCommitment = C;
  next.status = "open";
  pushEvent(next, {
    circuit: "openLine",
    ok: true,
    publicNote: "Line opened. Commitment published. Limit is not on the ledger.",
    commitment: C,
  });
  return {
    ok: true,
    ledger: next,
    agent: { secret: input.agentSecret, witness },
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
  if (!Number.isInteger(input.amount) || input.amount <= 0) return fail("ZERO", FAIL.ZERO);
  if (input.expiry <= next.clock) return fail("EXPIRY", FAIL.EXPIRY);

  const preimage: QuotePreimage = {
    merchantCommitment: merchantCommitment(next.merchantPubKey),
    amount: input.amount,
    invoiceId: input.invoiceId,
    expiry: input.expiry,
    nonce: input.nonce,
  };
  const Q = quoteCommitment(preimage, next.contractId);
  if (next.quotes.some((q) => q.commitment === Q)) {
    return fail("QUOTE_USED", "quote commitment already posted");
  }
  next.quotes.push({ commitment: Q, expiry: input.expiry, used: false });
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

  const I = identityCommitment(input.agentSecret);
  if (I !== input.witness.I || I !== next.identityCommitment) {
    return fail("AUTH_AGENT", FAIL.AUTH_AGENT);
  }
  if (!opens(input.witness, next.lineCommitment)) {
    return fail("STALE", FAIL.STALE);
  }

  const Q = quoteCommitment(input.quote, next.contractId);
  const live = next.quotes.find((q) => q.commitment === Q);
  if (!live) return fail("QUOTE", FAIL.QUOTE);
  if (live.used) return fail("QUOTE_USED", FAIL.QUOTE_USED);
  if (live.expiry <= next.clock) return fail("QUOTE_EXPIRED", FAIL.QUOTE_EXPIRED);

  const expectedM = merchantCommitment(next.merchantPubKey);
  if (input.quote.merchantCommitment !== expectedM) {
    return fail("QUOTE_AUTH", FAIL.QUOTE_AUTH);
  }
  if (input.quote.amount <= 0 || !Number.isInteger(input.quote.amount)) {
    return fail("ZERO", FAIL.ZERO);
  }

  const { L, B } = input.witness;
  const A = input.quote.amount;
  if (B < 0 || A > Number.MAX_SAFE_INTEGER - B) return fail("OVERFLOW", FAIL.OVERFLOW);
  if (B + A > L) return fail("CAPACITY", FAIL.CAPACITY);

  const N = drawNullifier(input.agentSecret, Q, next.contractId);
  if (next.nullifiers.includes(N)) return fail("NULLIFIER", FAIL.NULLIFIER);

  const nextWitness: LineWitness = {
    I,
    L,
    B: B + A,
    e: input.witness.e + 1,
    s: input.newSalt,
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
    agent: { secret: input.agentSecret, witness: nextWitness },
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
  if (r.contractId !== next.contractId) return fail("RECEIPT", FAIL.RECEIPT);
  if (r.identity !== input.witness.I || r.identity !== next.identityCommitment) {
    return fail("RECEIPT", FAIL.RECEIPT);
  }
  if (r.currentC !== next.lineCommitment) return fail("RECEIPT_STALE", FAIL.RECEIPT_STALE);
  if (r.expiry <= next.clock) return fail("EXPIRY", FAIL.EXPIRY);

  const R = r.amount;
  const { B, L, I, e } = input.witness;
  if (!Number.isInteger(R) || R <= 0 || R > B) return fail("RECEIPT_RANGE", FAIL.RECEIPT_RANGE);

  const N = repayNullifier(r.nonce, I, next.contractId);
  if (next.nullifiers.includes(N)) return fail("RECEIPT_USED", FAIL.RECEIPT_USED);

  const nextWitness: LineWitness = {
    I,
    L,
    B: B - R,
    e: e + 1,
    s: input.newSalt,
  };
  const C2 = lineCommitment(nextWitness);
  next.lineCommitment = C2;
  next.nullifiers.push(N);
  if (next.status === "defaulted" && nextWitness.B === 0) {
    // stays defaulted until issuer reopens status; capacity restored but draws still blocked
  }
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
  if (!next.lineCommitment) return fail("NO_LINE", FAIL.NO_LINE);
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
