/** Local product evaluation, executing generated Compact circuits, never token transfers.
 * Keys and books remain in this process. Capability separation is HTTP authorization,
 * not independent production custody. Optional encrypted checkpoints recover local execution.
 */
import { randomUUID } from "node:crypto";
import * as RT from "@midnight-ntwrk/compact-runtime";
import { Contract } from "../contracts/managed/line/contract/index.js";
import { blankPrivate, boot, call, readLedger, WITNESSES, type CircuitCall, type PrivateState, type Session } from "../src/lib/line/compact-harness.ts";
import { agentId, drawNoteCommit, lineStateCommit, refundCommit, merchantPublicKey, pad32, paymentNullifier, quoteCommit, randomBytes32, toHex, canonicalPaymentReferenceBytes } from "../src/lib/line/encoding.ts";
import type { CheckoutCheckpointStore } from "./checkout-storage.ts";

export const CATALOG = [
  { id: "text-analysis", merchant: "Merchant A", name: "Document analysis", price: 25, description: "Word counts, sentence counts and recurring terms computed from your document." },
  { id: "cost-report", merchant: "Merchant B", name: "Processing estimate", price: 20, description: "UTF-8 payload size and a disclosed token heuristic; an estimate, not a vendor bill." },
] as const;
export type ServiceId = typeof CATALOG[number]["id"];
export class CheckoutError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
type Output = Record<string, unknown>;
export type Receipt = {
  orderId: string; service: ServiceId; merchant: string; amount: number;
  quote: string; note: string | null; outcome: "pending" | "delivered" | "declined" | "expired" | "compensated";
  stages: string[]; message?: string; output?: Output;
  payout: "not-connected"; execution: "generated-compact-local";
};
type Order = {
  document: string; service: ServiceId; receipt: Receipt;
  phase: "prepared" | "quoted" | "authorized" | "redeemed" | "delivered" | "declined" | "expired" | "compensated";
  invoiceId: Uint8Array; quoteNonce: Uint8Array; Q: Uint8Array; expiry: bigint;
  noteNonce: Uint8Array; noteSalt: Uint8Array; D?: Uint8Array; noteExpiry?: bigint;
  compensation?: { amount: bigint; credit: bigint; salt: Uint8Array; commitment: Uint8Array; reportedReference?: string };
};
type Snapshot = {
  version: 4; deadlineUnits: "unix-seconds"; settlement: "private-compensation-v1"; id: string; issuerToken: string; agentToken: string; createdAt: number;
  issuerKey: Uint8Array; agentKey: Uint8Array; merchants: Record<ServiceId, Uint8Array>;
  state: Uint8Array; privateState: PrivateState; limit: bigint; outstanding: bigint; epoch: bigint;
  salt: Uint8Array; opened: boolean; fundedReserve: bigint; orders: [string, Order][];
  repayments: [string, number][]; deliveries: number;
};

function units(value: unknown, label: string): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new CheckoutError(400, `${label} must be an integer from 1 to 1000000 evaluation units.`);
  }
  return BigInt(value);
}
function intent(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(value)) throw new CheckoutError(400, "A stable request ID is required.");
  return value;
}

/** Deterministic services run only after the bound merchant redeems its claim. */
function deliver(service: ServiceId, document: string): Output {
  if (service === "text-analysis") {
    const words = document.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const counts = new Map<string, number>();
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
    return {
      words: words.length, sentences: (document.match(/[^.!?]+[.!?]?/g) ?? []).filter(s => s.trim()).length,
      recurringTerms: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([term, count]) => ({ term, count })),
    };
  }
  const bytes = Buffer.byteLength(document, "utf8");
  return { utf8Bytes: bytes, estimatedTokens: Math.ceil(document.length / 4), method: "ceil(UTF-16 code units / 4); heuristic, not model tokenization", servicePrice: 20, currency: "evaluation units; no cash value" };
}

export class CheckoutEvaluation {
  readonly id = randomUUID();
  readonly issuerToken = toHex(randomBytes32());
  readonly agentToken = toHex(randomBytes32());
  readonly createdAt = Date.now();
  private issuerKey = randomBytes32();
  private agentKey = randomBytes32();
  private merchants = { "text-analysis": randomBytes32(), "cost-report": randomBytes32() };
  private session!: Session;
  private limit = 0n;
  private outstanding = 0n;
  private epoch = 0n;
  private salt = randomBytes32();
  private opened = false;
  private fundedReserve = 0n;
  private orders = new Map<string, Order>();
  private repayments = new Map<string, number>();
  private deliveries = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private failed = false;
  private checkpointing = false;
  private storage?: CheckoutCheckpointStore;
  private clock = () => Math.floor(Date.now() / 1000);

  static async create(storage?: CheckoutCheckpointStore, options?: { clock?: () => number }): Promise<CheckoutEvaluation> {
    const evaluation = new CheckoutEvaluation();
    evaluation.storage = storage;
    evaluation.clock = options?.clock ?? evaluation.clock;
    evaluation.session = await boot(evaluation.issuerKey, evaluation.merchants["text-analysis"], randomBytes32(), undefined, evaluation.clock);
    await evaluation.transition(blankPrivate({ callerSecret: evaluation.issuerKey }), { name: "registerMerchant", args: [merchantPublicKey(evaluation.merchants["cost-report"])] });
    await evaluation.checkpoint();
    return evaluation;
  }

  static recover(value: unknown, storage: CheckoutCheckpointStore, options?: { clock?: () => number }): CheckoutEvaluation {
    const snapshot = value as Snapshot;
    if (!snapshot || snapshot.version !== 4 || snapshot.deadlineUnits !== "unix-seconds" || snapshot.settlement !== "private-compensation-v1" || !/^[0-9a-f-]{36}$/.test(snapshot.id) ||
        !/^[a-f0-9]{64}$/.test(snapshot.issuerToken) || !/^[a-f0-9]{64}$/.test(snapshot.agentToken) ||
        !Number.isSafeInteger(snapshot.createdAt) || !Array.isArray(snapshot.orders) || snapshot.orders.length > 100 ||
        !Array.isArray(snapshot.repayments) || !(snapshot.state instanceof Uint8Array)) throw new Error("Invalid checkout snapshot.");
    for (const bytes of [snapshot.issuerKey, snapshot.agentKey, snapshot.salt, snapshot.merchants?.["text-analysis"], snapshot.merchants?.["cost-report"]]) {
      if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error("Invalid checkout secret opening.");
    }
    for (const book of [snapshot.limit, snapshot.outstanding, snapshot.epoch, snapshot.fundedReserve]) {
      if (typeof book !== "bigint" || book < 0n) throw new Error("Invalid checkout private book.");
    }
    if (snapshot.outstanding > snapshot.limit || typeof snapshot.opened !== "boolean" || !Number.isSafeInteger(snapshot.deliveries) || snapshot.deliveries < 0) throw new Error("Invalid checkout accounting.");
    const evaluation = new CheckoutEvaluation();
    Object.assign(evaluation, { id: snapshot.id, issuerToken: snapshot.issuerToken, agentToken: snapshot.agentToken, createdAt: snapshot.createdAt,
      issuerKey: snapshot.issuerKey, agentKey: snapshot.agentKey, merchants: snapshot.merchants, limit: snapshot.limit,
      outstanding: snapshot.outstanding, epoch: snapshot.epoch, salt: snapshot.salt, opened: snapshot.opened,
      fundedReserve: snapshot.fundedReserve, deliveries: snapshot.deliveries });
    evaluation.orders = new Map(snapshot.orders);
    evaluation.repayments = new Map(snapshot.repayments);
    if (evaluation.orders.size !== snapshot.orders.length || evaluation.repayments.size !== snapshot.repayments.length || snapshot.repayments.length > 1000) throw new Error("Invalid duplicate checkout records.");
    for (const [reference, amount] of evaluation.repayments) {
      if (intent(reference) !== reference || !Number.isSafeInteger(amount) || amount < 1) throw new Error("Invalid checkout receipt record.");
    }
    evaluation.clock = options?.clock ?? evaluation.clock;
    evaluation.session = { contract: new Contract(WITNESSES as never), state: RT.ContractState.deserialize(snapshot.state).data, privateState: snapshot.privateState, clock: evaluation.clock };
    evaluation.storage = storage;
    // Decode through the generated ledger immediately, before exposing a recovered capability.
    const ledger = readLedger(evaluation.session);
    if (ledger.totalReserve !== snapshot.fundedReserve || ledger.encumberedReserve + ledger.redeemedReserve + ledger.feeReserve + ledger.pendingFeeReserve + ledger.refundReserve + ledger.reportedRefundReserve > ledger.totalReserve || ledger.feeFlat !== 0n || ledger.feeBps !== 0n) throw new Error("Checkout ledger does not match its checkpoint.");
    if (snapshot.opened && toHex(lineStateCommit({ domain: ledger.contractDomain, identity: agentId(snapshot.agentKey), limit: snapshot.limit, outstanding: snapshot.outstanding, epoch: snapshot.epoch }, snapshot.salt)) !== toHex(ledger.lineCommit)) throw new Error("Checkout private book does not match its checkpoint.");
    for (const [requestId, order] of evaluation.orders) {
      const service = CATALOG.find(item => item.id === order.service);
      if (intent(requestId) !== order.receipt.orderId || !service || order.receipt.service !== order.service || order.receipt.amount !== service.price ||
          typeof order.document !== "string" || !order.document.trim() || order.document.length > 8000 || typeof order.expiry !== "bigint" || order.expiry < 0n ||
          !["prepared", "quoted", "authorized", "redeemed", "delivered", "declined", "expired", "compensated"].includes(order.phase)) throw new Error("Invalid checkout order checkpoint.");
      for (const bytes of [order.invoiceId, order.quoteNonce, order.Q, order.noteNonce, order.noteSalt]) {
        if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error("Invalid checkout order opening.");
      }
      const merchantPk = merchantPublicKey(snapshot.merchants[order.service]);
      const Q = quoteCommit({ merchantPk, invoiceId: order.invoiceId, amount: BigInt(service.price), expiry: order.expiry,
        nonce: order.quoteNonce, generation: ledger.lineGeneration, domain: ledger.contractDomain, feeFlat: ledger.feeFlat, feeBps: ledger.feeBps });
      if (toHex(Q) !== toHex(order.Q) || order.receipt.quote !== toHex(Q)) throw new Error("Checkout quote does not match its checkpoint.");
      if (["authorized", "redeemed", "delivered", "compensated"].includes(order.phase)) {
        const D = drawNoteCommit({ domain: ledger.contractDomain, lineGeneration: ledger.lineGeneration, identity: agentId(snapshot.agentKey),
          quoteCommit: Q, merchantPk, amount: BigInt(service.price), fee: 0n, noteNonce: order.noteNonce, expiry: order.expiry }, order.noteSalt);
        if (!(order.D instanceof Uint8Array) || toHex(order.D) !== toHex(D) || order.receipt.note !== toHex(D) || order.noteExpiry !== order.expiry || !ledger.notes.member(D)) throw new Error("Checkout note does not match its checkpoint.");
        const note = ledger.notes.lookup(D);
        if ((order.phase === "redeemed" || order.phase === "delivered") !== note.redeemed || (order.phase === "compensated") !== note.cancelled) throw new Error("Checkout note phase does not match its checkpoint.");
      }
      if (order.phase === "compensated") {
        const record = order.compensation;
        if (!record || typeof record.amount !== "bigint" || record.amount < 0n || typeof record.credit !== "bigint" || record.credit < 0n ||
            record.amount + record.credit !== BigInt(order.receipt.amount) || !(record.salt instanceof Uint8Array) || record.salt.length !== 32 || !order.D) throw new Error("Invalid checkout compensation checkpoint.");
        const note = ledger.notes.lookup(order.D);
        const commitment = refundCommit({ domain: ledger.contractDomain, lineGeneration: note.lineGeneration, identity: agentId(snapshot.agentKey), noteCommit: order.D, amount: record.amount }, record.salt);
        if (!note.cancelled || !note.compensationAllocated || note.cashRefundOwed !== (record.amount > 0n) ||
            toHex(note.refundCommitment) !== toHex(commitment) || toHex(record.commitment) !== toHex(commitment) ||
            note.refundAcknowledged !== !!record.reportedReference) throw new Error("Checkout compensation opening does not match its checkpoint.");
        const receipt = record.reportedReference
          ? paymentNullifier(snapshot.issuerKey, canonicalPaymentReferenceBytes(intent(record.reportedReference)), ledger.contractDomain)
          : new Uint8Array(32);
        if (toHex(note.refundPaymentNullifier) !== toHex(receipt) ||
            (record.reportedReference && !ledger.nullifiers.member(receipt))) throw new Error("Checkout refund receipt does not match its checkpoint.");
      }
    }
    return evaluation;
  }
  private snapshot(): Snapshot {
    const state = new RT.ContractState();
    state.data = this.session.state instanceof RT.ContractState ? this.session.state.data :
      this.session.state instanceof RT.ChargedState ? this.session.state : new RT.ChargedState(this.session.state);
    return { version: 4, deadlineUnits: "unix-seconds", settlement: "private-compensation-v1", id: this.id, issuerToken: this.issuerToken, agentToken: this.agentToken, createdAt: this.createdAt,
      issuerKey: this.issuerKey, agentKey: this.agentKey, merchants: this.merchants,
      state: state.serialize(), privateState: this.session.privateState, limit: this.limit,
      outstanding: this.outstanding, epoch: this.epoch, salt: this.salt, opened: this.opened,
      fundedReserve: this.fundedReserve, orders: [...this.orders], repayments: [...this.repayments], deliveries: this.deliveries };
  }
  private async checkpoint() {
    if (!this.storage) return;
    this.checkpointing = true;
    try { await this.storage.save(this.id, this.snapshot()); }
    catch { this.failed = true; throw new CheckoutError(503, "Checkout checkpoint failed. Restart the server and recover this session before retrying."); }
    finally { this.checkpointing = false; }
  }
  private ensureAvailable() {
    if (this.failed) throw new CheckoutError(503, "Checkout session requires server restart and recovery.");
    if (this.checkpointing) throw new CheckoutError(503, "Checkout checkpoint is still committing. Retry this read.");
  }
  async whenIdle() { await this.queue; this.ensureAvailable(); }
  durability() { return this.storage ? "encrypted-disk" as const : "volatile" as const; }
  hasOutstandingObligations() {
    this.ensureAvailable();
    return this.outstanding > 0n || readLedger(this.session).reportedRefundReserve > 0n || [...this.orders.values()].some(order => order.phase === "authorized" ||
      (order.compensation && order.compensation.amount > 0n && !order.compensation.reportedReference));
  }
  private now() {
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new CheckoutError(503, "Trusted execution time is unavailable.");
    return now;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => { this.ensureAvailable(); return fn(); });
    this.queue = result.catch(() => {});
    return result;
  }
  private async transition(witness: PrivateState, op: CircuitCall) {
    const result = await call(this.session, witness, op);
    if (!result.ok) throw new CheckoutError(409, op.name === "draw" ? "Clearance could not be proven." : "Contract transition rejected.");
    this.session = result.session;
    return result.ledger;
  }
  private books(overrides: Partial<PrivateState> = {}) {
    return blankPrivate({ agentSecret: this.agentKey, lineLimit: this.limit, lineOutstanding: this.outstanding, lineEpoch: this.epoch, salt: this.salt, ...overrides });
  }

  configure(limit: unknown, reserve: unknown) {
    const credit = units(limit, "Credit limit");
    const backing = units(reserve, "Reserve");
    return this.exclusive(async () => {
      if (this.opened) {
        if (credit === this.limit && backing === this.fundedReserve) return this.issuerView();
        throw new CheckoutError(409, "This evaluation already has an open line.");
      }
      if (this.fundedReserve && (this.fundedReserve !== backing || this.limit !== credit)) throw new CheckoutError(409, "Retry the original facility terms.");
      if (!this.fundedReserve) {
        await this.transition(blankPrivate({ callerSecret: this.issuerKey }), { name: "fundReserve", args: [backing] });
        this.fundedReserve = backing;
        this.limit = credit;
        await this.checkpoint();
      }
      this.limit = credit;
      await this.transition(this.books({ callerSecret: this.issuerKey }), { name: "openLine", args: [BigInt(this.now() + 10_000), 0n, 0n] });
      this.opened = true;
      await this.checkpoint();
      return this.issuerView();
    });
  }

  purchase(serviceValue: unknown, documentValue: unknown, requestValue: unknown): Promise<Receipt> {
    const service = CATALOG.find(item => item.id === serviceValue);
    if (!service) throw new CheckoutError(400, "Unknown service.");
    if (typeof documentValue !== "string" || !documentValue.trim() || documentValue.length > 8000) throw new CheckoutError(400, "Supply a document of 1 to 8000 characters.");
    const document = documentValue;
    const requestId = intent(requestValue);
    return this.exclusive(async () => {
      const prior = this.orders.get(requestId);
      if (prior) {
        if (prior.service !== service.id || prior.document !== document) throw new CheckoutError(409, "Request ID was already used for different purchase terms.");
        return this.resume(prior);
      }
      if (!this.opened) throw new CheckoutError(409, "Issuer must open the evaluation line first.");
      if (Date.now() - this.createdAt > 30 * 60 * 1000) throw new CheckoutError(410, "New purchases are closed for this evaluation. Exact retries and issuer reconciliation remain available.");
      if (this.orders.size >= 100) throw new CheckoutError(409, "Evaluation order limit reached. Start a new session.");
      const merchantKey = this.merchants[service.id];
      const merchantPk = merchantPublicKey(merchantKey);
      const invoiceId = pad32(randomUUID().replaceAll("-", ""));
      const quoteNonce = randomBytes32();
      const amount = BigInt(service.price);
      const before = readLedger(this.session);
      const expiry = BigInt(this.now() + 600);
      const Q = quoteCommit({ merchantPk, invoiceId, amount, expiry, nonce: quoteNonce, generation: before.lineGeneration, domain: before.contractDomain, feeFlat: before.feeFlat, feeBps: before.feeBps });
      const receipt: Receipt = { orderId: requestId, service: service.id, merchant: service.merchant, amount: service.price, quote: toHex(Q), note: null, outcome: "pending", stages: [], payout: "not-connected", execution: "generated-compact-local" };
      const order: Order = { document, service: service.id, receipt, phase: "prepared", invoiceId, quoteNonce, Q, expiry, noteNonce: randomBytes32(), noteSalt: randomBytes32() };
      // Persist the immutable intention and openings before its first circuit.
      this.orders.set(requestId, order);
      await this.checkpoint();
      return this.resume(order);
    });
  }

  private async resume(order: Order): Promise<Receipt> {
    const { receipt, invoiceId, quoteNonce, Q, expiry, noteNonce, noteSalt } = order;
    const merchantKey = this.merchants[order.service];
    const merchantPk = merchantPublicKey(merchantKey);
    const amount = BigInt(receipt.amount);
    if ((order.phase === "prepared" || order.phase === "quoted") && expiry <= BigInt(this.now())) {
      order.phase = "expired"; receipt.outcome = "expired"; receipt.stages.push("quote-expired-before-authorization");
      receipt.message = "The quote expired before authorization. No debt or merchant claim was created; a new purchase requires a new request ID.";
      await this.checkpoint();
    }
    if (order.phase === "prepared") {
      await this.transition(blankPrivate({ callerSecret: merchantKey, invoiceId, quoteNonce, quoteAmount: amount }), { name: "postQuote", args: [expiry] });
      order.phase = "quoted";
      receipt.stages.push("merchant-quote-posted");
      await this.checkpoint();
    }
    if (order.phase === "quoted") {
      const newSalt = randomBytes32();
      const noteExpiry = expiry;
      const witness = this.books({ invoiceId, quoteNonce, quoteMerchantPk: merchantPk, drawAmount: amount, newSalt, noteNonce, noteSalt });
      const draw = await call(this.session, witness, { name: "draw", args: [Q, noteExpiry, 0n] });
      if (!draw.ok) {
        receipt.stages.push("authorization-declined");
        receipt.message = "Clearance could not be proven.";
        receipt.outcome = "declined";
        order.phase = "declined";
        await this.checkpoint();
        return structuredClone(receipt);
      }
      this.session = draw.session;
      this.outstanding += amount;
      this.epoch += 1n;
      this.salt = newSalt;
      const D = drawNoteCommit({ domain: draw.ledger.contractDomain, lineGeneration: draw.ledger.lineGeneration, identity: agentId(this.agentKey), quoteCommit: Q, merchantPk, amount, fee: 0n, noteNonce, expiry: noteExpiry }, noteSalt);
      receipt.note = toHex(D);
      order.D = D;
      order.noteExpiry = noteExpiry;
      order.phase = "authorized";
      receipt.stages.push("authorization-accepted", "reserve-encumbered");
      await this.checkpoint();
    }
    if (order.phase === "authorized") {
      if (order.noteExpiry! <= BigInt(this.now())) {
        const newSalt = randomBytes32();
        const credit = this.outstanding < amount ? this.outstanding : amount;
        const refund = amount - credit;
        const ledger = await this.transition(this.books({ callerSecret: this.agentKey, newSalt, quoteMerchantPk: merchantPk,
          noteIdentity: agentId(this.agentKey), noteQuoteCommit: Q, noteNonce, noteSalt }), { name: "cancelOrExpireNote", args: [order.D!, 1n, 0n] });
        this.outstanding -= credit; this.epoch += 1n; this.salt = newSalt;
        order.compensation = { amount: refund, credit, salt: newSalt, commitment: ledger.notes.lookup(order.D!).refundCommitment };
        order.phase = "compensated"; receipt.outcome = "compensated";
        receipt.stages.push("claim-expired", "evaluation-compensation-recorded");
        if (refund > 0n) receipt.stages.push("cash-refund-obligation-recorded");
        receipt.message = "Expired claim compensation recorded. No service was delivered and no cash refund was paid.";
        await this.checkpoint();
        return structuredClone(receipt);
      }
      // Merchant gets the note opening, not the credit-book opening or agent secret.
      await this.transition(blankPrivate({ callerSecret: merchantKey, noteIdentity: agentId(this.agentKey), noteQuoteCommit: Q, noteNonce, noteSalt, redeemAmount: amount }), { name: "redeemDraw", args: [order.D!, order.noteExpiry!] });
      order.phase = "redeemed";
      receipt.stages.push("merchant-claim-redeemed");
      await this.checkpoint();
    }
    if (order.phase === "redeemed") {
      receipt.output = deliver(order.service, order.document);
      this.deliveries += 1;
      receipt.outcome = "delivered";
      receipt.stages.push("service-delivered");
      order.phase = "delivered";
      await this.checkpoint();
    }
    return structuredClone(receipt);
  }

  acknowledge(amountValue: unknown, referenceValue: unknown) {
    const amount = units(amountValue, "Acknowledgement");
    const reference = intent(referenceValue);
    return this.exclusive(async () => {
      const previous = this.repayments.get(reference);
      if (previous !== undefined) {
        if (previous !== Number(amount)) throw new CheckoutError(409, "Receipt reference was already used with another amount.");
        return this.issuerView();
      }
      if (!this.opened || amount > this.outstanding) throw new CheckoutError(409, "Acknowledgement exceeds outstanding evaluation debt.");
      if (this.repayments.size >= 1000) throw new CheckoutError(409, "Evaluation acknowledgement limit reached.");
      const newSalt = randomBytes32();
      if ([...this.orders.values()].some(order => order.compensation?.reportedReference === reference)) throw new CheckoutError(409, "Receipt reference already reported a refund.");
      await this.transition(this.books({ callerSecret: this.issuerKey, newSalt, repayAmount: amount, paymentRef: canonicalPaymentReferenceBytes(reference), receiptNonce: randomBytes32() }), { name: "acknowledgeRepayment", args: [BigInt(this.now() + 600)] });
      this.outstanding -= amount;
      this.epoch += 1n;
      this.salt = newSalt;
      this.repayments.set(reference, Number(amount));
      await this.checkpoint();
      return this.issuerView();
    });
  }

  reportRefund(orderIdValue: unknown, referenceValue: unknown) {
    const orderId = intent(orderIdValue), reference = intent(referenceValue);
    return this.exclusive(async () => {
      const order = this.orders.get(orderId), record = order?.compensation;
      if (!order || !record || record.amount === 0n) throw new CheckoutError(409, "No cash refund obligation exists for that order.");
      if (record.reportedReference) {
        if (record.reportedReference !== reference) throw new CheckoutError(409, "Refund was already reported with another reference.");
        return this.issuerView();
      }
      if (this.repayments.has(reference) || [...this.orders.values()].some(other => other.compensation?.reportedReference === reference)) throw new CheckoutError(409, "Receipt reference was already allocated.");
      await this.transition(blankPrivate({ callerSecret: this.issuerKey, noteIdentity: agentId(this.agentKey), repayAmount: record.amount,
        salt: record.salt, paymentRef: canonicalPaymentReferenceBytes(reference) }), { name: "cancelOrExpireNote", args: [order.D!, 2n, BigInt(this.now() + 600)] });
      record.reportedReference = reference; order.receipt.stages.push("issuer-reported-refund-acknowledgment");
      await this.checkpoint();
      return this.issuerView();
    });
  }

  publicView() {
    this.ensureAvailable();
    const ledger = readLedger(this.session);
    return {
      execution: "generated-compact-local", payout: "not-connected", durability: this.durability(), opened: this.opened,
      domain: toHex(ledger.contractDomain), lineCommit: toHex(ledger.lineCommit),
      totalReserve: Number(ledger.totalReserve), encumberedReserve: Number(ledger.encumberedReserve),
      redeemedReserve: Number(ledger.redeemedReserve), feeReserve: Number(ledger.feeReserve),
      pendingFeeReserve: Number(ledger.pendingFeeReserve), refundReserve: Number(ledger.refundReserve), reportedRefundReserve: Number(ledger.reportedRefundReserve),
      deliveries: this.deliveries, orders: [...this.orders.values()].map(order => { const { output, ...receipt } = order.receipt; return structuredClone(receipt); }),
      privacy: "Amounts and reserve deltas are public. A complete history can reveal outstanding debt; this evaluation does not prove historical credit-book confidentiality.",
    };
  }
  issuerView() { return { ...this.publicView(), privateBooks: { limit: Number(this.limit), outstanding: Number(this.outstanding), remaining: Number(this.limit - this.outstanding) },
    refunds: [...this.orders.values()].filter(order => order.compensation).map(order => ({ orderId: order.receipt.orderId,
      credited: Number(order.compensation!.credit), amount: Number(order.compensation!.amount), reported: !!order.compensation!.reportedReference,
      execution: "issuer-reported-accounting", payout: "not-connected" })) }; }
}
