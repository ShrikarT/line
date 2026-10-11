import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import * as RT from "@midnight-ntwrk/compact-runtime";
import { CheckoutEvaluation, CheckoutError } from "./checkout-engine.ts";
import { checkoutMiddleware } from "./checkout-http.ts";
import { call, blankPrivate, readLedger, type Session, type CircuitCall, type PrivateState } from "../src/lib/line/compact-harness.ts";
import { agentId, canonicalPaymentReferenceBytes, paymentNullifier, toHex } from "../src/lib/line/encoding.ts";
import { encodeVaultJson, decodeVaultJson } from "../src/lib/security/vault-codec.ts";

describe("generated Compact product checkout", () => {
  it("recovery requires the exact note-bound refund reference, global receipt membership and zero receipt before reporting", async () => {
    let now = 1_800_000_000, saved: any;
    const copy = (value: unknown) => decodeVaultJson(encodeVaultJson(value)) as any;
    const storage = { mode: "encrypted-disk" as const, async save(_id: string, value: unknown) { saved = copy(value); },
      loadAll: async () => [saved], remove: async () => {}, close: async () => {} };
    const engine = await CheckoutEvaluation.create(storage, { clock: () => now }); await engine.configure(100, 200);
    const access = engine as unknown as { transition(ps: PrivateState, op: CircuitCall): Promise<unknown> }, transition = access.transition.bind(engine);
    access.transition = async (ps, op) => { if (op.name === "redeemDraw") throw new CheckoutError(503, "Merchant unavailable"); return transition(ps, op); };
    await assert.rejects(engine.purchase("text-analysis", "bound refund receipt", "bound-refund-order"), /Merchant unavailable/);
    const incoming = "bound-incoming-receipt", outgoing = "bound-outgoing-receipt";
    await engine.acknowledge(10, incoming); now += 600;
    assert.equal((await engine.purchase("text-analysis", "bound refund receipt", "bound-refund-order")).outcome, "compensated");
    const allocated = copy(saved), D = allocated.orders[0][1].D as Uint8Array;
    const domain = Buffer.from(engine.publicView().domain, "hex");
    const incomingNullifier = paymentNullifier(saved.issuerKey, canonicalPaymentReferenceBytes(incoming), domain);
    const outgoingNullifier = paymentNullifier(saved.issuerKey, canonicalPaymentReferenceBytes(outgoing), domain);
    // Corrupt actual serialized ledger state, rather than mocked recovery evidence.
    const editMapEntry = (snapshot: any, key: Uint8Array, edit: (value: RT.StateValue) => RT.StateValue | null) => {
      const state = RT.ContractState.deserialize(snapshot.state); let changed = 0;
      const rewrite = (value: RT.StateValue): RT.StateValue => {
        const array = value.asArray();
        if (array) return array.reduce((next, item) => next.arrayPush(rewrite(item)), RT.StateValue.newArray());
        const map = value.asMap();
        if (!map) return value;
        let next = new RT.StateMap();
        for (const entry of map.keys()) {
          const child = map.get(entry)!;
          if (entry.value.length === 1 && toHex(entry.value[0]) === toHex(key)) {
            changed += 1; const replacement = edit(child); if (replacement) next = next.insert(entry, replacement);
          } else next = next.insert(entry, rewrite(child));
        }
        return RT.StateValue.newMap(next);
      };
      state.data = new RT.ChargedState(rewrite(state.data.state)); snapshot.state = state.serialize(); assert.equal(changed, 1);
    };
    const forgeNoteReceipt = (snapshot: any, receipt: Uint8Array) => editMapEntry(snapshot, D, value => {
      const cell = value.asCell();
      assert.equal(cell.value.length, 11, "NoteMeta layout must match generated Compact schema");
      return RT.StateValue.newCell({ ...cell, value: cell.value.map((part, index) => index === 10 ? (receipt.every(byte => byte === 0) ? new Uint8Array(0) : receipt) : part) });
    });
    assert.equal(CheckoutEvaluation.recover(allocated, storage, { clock: () => now }).issuerView().refunds[0].reported, false);
    const premature = copy(allocated); forgeNoteReceipt(premature, incomingNullifier);
    assert.throws(() => CheckoutEvaluation.recover(premature, storage), /refund receipt/);
    await engine.reportRefund("bound-refund-order", outgoing);
    const reported = copy(saved);
    assert.equal(CheckoutEvaluation.recover(reported, storage, { clock: () => now }).issuerView().refunds[0].reported, true);
    const substituted = copy(reported); substituted.orders[0][1].compensation.reportedReference = incoming;
    assert.throws(() => CheckoutEvaluation.recover(substituted, storage), /refund receipt/);
    const absent = copy(reported); editMapEntry(absent, outgoingNullifier, () => null);
    assert.throws(() => CheckoutEvaluation.recover(absent, storage), /refund receipt/);
    const erased = copy(reported); forgeNoteReceipt(erased, new Uint8Array(32));
    assert.throws(() => CheckoutEvaluation.recover(erased, storage), /refund receipt/);
  });

  for (const phase of ["prepared", "quoted"] as const) {
    it(`recovered expired ${phase} intent is terminal without authorization, delivery or debt`, async () => {
      let now = 1_800_000_000, saved: any, interrupted = false;
      const storage = { mode: "encrypted-disk" as const, async save(_id: string, value: unknown) {
        saved = decodeVaultJson(encodeVaultJson(value));
        if (!interrupted && saved.orders[0]?.[1].phase === phase) { interrupted = true; throw new Error("Interrupted checkpoint"); }
      }, loadAll: async () => [saved], remove: async () => {}, close: async () => {} };
      const engine = await CheckoutEvaluation.create(storage, { clock: () => now }); await engine.configure(100, 200);
      await assert.rejects(engine.purchase("text-analysis", "expired quote", "expired-quote-intent"), /checkpoint failed/);
      now += 600;
      const recovered = CheckoutEvaluation.recover(saved, storage, { clock: () => now });
      const receipt = await recovered.purchase("text-analysis", "expired quote", "expired-quote-intent");
      assert.equal(receipt.outcome, "expired"); assert.equal(receipt.note, null); assert.equal(receipt.output, undefined);
      assert.equal(receipt.stages.filter(stage => stage === "quote-expired-before-authorization").length, 1);
      assert.deepEqual(await recovered.purchase("text-analysis", "expired quote", "expired-quote-intent"), receipt);
      assert.equal(recovered.issuerView().privateBooks.outstanding, 0); assert.equal(recovered.publicView().deliveries, 0);
      assert.equal(recovered.publicView().refundReserve, 0); assert.equal(recovered.publicView().encumberedReserve, 0);
    });
  }
  it("recovered redeemed intent still delivers after its note deadline without compensation or another charge", async () => {
    let now = 1_800_000_000, saved: any, interrupted = false;
    const storage = { mode: "encrypted-disk" as const, async save(_id: string, value: unknown) {
      saved = decodeVaultJson(encodeVaultJson(value));
      if (!interrupted && saved.orders[0]?.[1].phase === "redeemed") { interrupted = true; throw new Error("Interrupted checkpoint"); }
    }, loadAll: async () => [saved], remove: async () => {}, close: async () => {} };
    const engine = await CheckoutEvaluation.create(storage, { clock: () => now }); await engine.configure(100, 200);
    await assert.rejects(engine.purchase("text-analysis", "delivered after deadline", "redeemed-expiry-intent"), /checkpoint failed/);
    now += 600; const recovered = CheckoutEvaluation.recover(saved, storage, { clock: () => now });
    const receipt = await recovered.purchase("text-analysis", "delivered after deadline", "redeemed-expiry-intent");
    assert.equal(receipt.outcome, "delivered"); assert.equal(receipt.output?.words, 3);
    assert.equal(recovered.issuerView().privateBooks.outstanding, 25); assert.equal(recovered.publicView().redeemedReserve, 25);
    assert.equal(recovered.publicView().refundReserve, 0); assert.equal(recovered.publicView().deliveries, 1);
  });
  it("expired authorization compensates private debt, privately retains partial refund and reports it exactly once", async () => {
    let now = 1_800_000_000, saved: any;
    const storage = { mode: "encrypted-disk" as const, async save(_id: string, value: unknown) { saved = decodeVaultJson(encodeVaultJson(value)); },
      loadAll: async () => [saved], remove: async () => {}, close: async () => {} };
    const engine = await CheckoutEvaluation.create(storage, { clock: () => now }); await engine.configure(100, 200);
    const internal = engine as unknown as { transition: (ps: PrivateState, op: CircuitCall) => Promise<unknown> }, transition = internal.transition.bind(engine);
    internal.transition = async (ps, op) => { if (op.name === "redeemDraw") throw new CheckoutError(503, "Merchant outage"); return transition(ps, op); };
    await assert.rejects(engine.purchase("text-analysis", "partial refund", "partial-refund-order"), /Merchant outage/);
    const pending = engine.publicView().orders[0]; await engine.acknowledge(10, "incoming-payment-ref"); now += 600;
    const recovered = CheckoutEvaluation.recover(saved, storage, { clock: () => now });
    const receipt = await recovered.purchase("text-analysis", "partial refund", "partial-refund-order");
    assert.equal(receipt.outcome, "compensated"); assert.equal(receipt.note, pending.note); assert.equal(receipt.quote, pending.quote); assert.equal(receipt.output, undefined);
    assert.deepEqual(await recovered.purchase("text-analysis", "partial refund", "partial-refund-order"), receipt);
    assert.equal(recovered.issuerView().privateBooks.outstanding, 0); assert.equal(recovered.publicView().deliveries, 0);
    assert.equal(recovered.publicView().refundReserve, 25); assert.equal(recovered.publicView().totalReserve, 200);
    assert.equal("refunds" in recovered.publicView(), false); assert.equal("privateBooks" in recovered.publicView(), false);
    assert.deepEqual(recovered.issuerView().refunds.map(({ amount, credited, reported }) => ({ amount, credited, reported })), [{ amount: 10, credited: 15, reported: false }]);
    assert.throws(() => CheckoutEvaluation.recover({ ...saved, version: 2 }, storage), /Invalid checkout snapshot/);
    const corrupt = decodeVaultJson(encodeVaultJson(saved)) as any; corrupt.orders[0][1].compensation.amount = 9n; corrupt.orders[0][1].compensation.credit = 16n;
    assert.throws(() => CheckoutEvaluation.recover(corrupt, storage), /compensation opening/);
    await assert.rejects(recovered.reportRefund("partial-refund-order", "incoming-payment-ref"), /already allocated/);
    const first = await recovered.reportRefund("partial-refund-order", "outgoing-refund-ref");
    assert.equal(first.reportedRefundReserve, 25); assert.equal(first.refundReserve, 0); assert.equal(first.totalReserve, 200); assert.equal(first.payout, "not-connected");
    assert.deepEqual(await recovered.reportRefund("partial-refund-order", "outgoing-refund-ref"), first);
    await assert.rejects(recovered.reportRefund("partial-refund-order", "changed-outgoing-ref"), /another reference/);
    const again = CheckoutEvaluation.recover(saved, storage, { clock: () => now });
    assert.deepEqual(await again.reportRefund("partial-refund-order", "outgoing-refund-ref"), first);
    await again.purchase("cost-report", "new service", "new-service-after-compensation");
    await assert.rejects(again.acknowledge(1, "outgoing-refund-ref"), /already reported a refund/);
    assert.equal(again.issuerView().privateBooks.outstanding, 20);
  });
  it("delivers document-specific results, declines over credit, then revolves after issuer acknowledgement", async () => {
    const engine = await CheckoutEvaluation.create();
    await engine.configure(40, 200);
    const a = await engine.purchase("text-analysis", "Line line. Privacy matters!", "order-analysis-1");
    assert.equal(a.outcome, "delivered");
    assert.equal(a.output?.words, 4);
    assert.equal(a.output?.sentences, 2);
    assert.ok(a.note);
    const denied = await engine.purchase("cost-report", "hello", "order-cost-1");
    assert.equal(denied.outcome, "declined");
    assert.equal(denied.message, "Clearance could not be proven.");
    assert.equal(denied.note, null);
    assert.equal(denied.output, undefined);
    assert.equal(engine.publicView().deliveries, 1);
    assert.equal(engine.issuerView().privateBooks.outstanding, 25);
    await engine.acknowledge(25, "payment-reference-1");
    const b = await engine.purchase("cost-report", "hello", "order-cost-2");
    assert.equal(b.outcome, "delivered");
    assert.equal(b.output?.utf8Bytes, 5);
    assert.equal(b.output?.estimatedTokens, 2);
    assert.notEqual(a.note, b.note);
    assert.equal(engine.issuerView().privateBooks.outstanding, 20);
    assert.equal(engine.publicView().redeemedReserve, 45);
    assert.equal(engine.publicView().totalReserve, 200, "Repayment acknowledgement is not a reserve top-up");
    assert.equal(engine.publicView().encumberedReserve, 0);
    assert.equal(engine.publicView().payout, "not-connected");
    assert.equal("privateBooks" in engine.publicView(), false);
  });
  it("serializes concurrent duplicate intentions, rejects changed terms and isolates contract instances", async () => {
    const engine = await CheckoutEvaluation.create();
    await engine.configure(100, 200);
    const receipts = await Promise.all(Array.from({ length: 6 }, () => engine.purchase("text-analysis", "repeat", "same-purchase-id")));
    for (const receipt of receipts) assert.deepEqual(receipt, receipts[0]);
    assert.equal(engine.issuerView().privateBooks.outstanding, 25);
    assert.equal(engine.publicView().deliveries, 1);
    await assert.rejects(engine.purchase("text-analysis", "changed", "same-purchase-id"), /different purchase terms/);
    const other = await CheckoutEvaluation.create();
    assert.notEqual(engine.publicView().domain, other.publicView().domain);
    assert.notEqual(engine.agentToken, engine.issuerToken);
    assert.notEqual(engine.agentToken, other.agentToken);
  });
  it("resumes a failed merchant redemption without a second quote, draw or charge", async () => {
    const engine = await CheckoutEvaluation.create();
    await engine.configure(100, 200);
    const internal = engine as unknown as { transition: (ps: PrivateState, op: CircuitCall) => Promise<unknown> };
    const real = internal.transition.bind(engine);
    let failOnce = true;
    internal.transition = async (ps, op) => {
      if (op.name === "redeemDraw" && failOnce) { failOnce = false; throw new CheckoutError(503, "Temporary merchant outage"); }
      return real(ps, op);
    };
    await assert.rejects(engine.purchase("text-analysis", "Recovery matters.", "recovery-purchase"), /Temporary merchant outage/);
    const pending = engine.publicView();
    assert.equal(pending.encumberedReserve, 25);
    assert.equal(pending.orders[0].outcome, "pending");
    assert.equal(engine.issuerView().privateBooks.outstanding, 25);
    const receipt = await engine.purchase("text-analysis", "Recovery matters.", "recovery-purchase");
    assert.equal(receipt.note, pending.orders[0].note);
    assert.equal(receipt.quote, pending.orders[0].quote);
    assert.equal(receipt.outcome, "delivered");
    assert.equal(engine.publicView().orders.length, 1);
    assert.equal(engine.issuerView().privateBooks.outstanding, 25);
    assert.equal(engine.publicView().redeemedReserve, 25);
    assert.equal(engine.publicView().encumberedReserve, 0);
    assert.equal(engine.publicView().deliveries, 1);
  });
  it("only the designated merchant can claim, and a successful claim cannot be replayed", async () => {
    const engine = await CheckoutEvaluation.create();
    await engine.configure(100, 200);
    const internal = engine as unknown as { session: Session; agentKey: Uint8Array; merchants: Record<string, Uint8Array>; orders: Map<string, { D: Uint8Array; Q: Uint8Array; noteNonce: Uint8Array; noteSalt: Uint8Array; noteExpiry: bigint }> };
    await engine.purchase("text-analysis", "bound", "merchant-bound-order");
    const order = internal.orders.get("merchant-bound-order")!;
    // Test wrong merchant on an unredeemed note by clearing only the test
    // execution path before redemption in a second evaluation.
    const fresh = await CheckoutEvaluation.create();
    await fresh.configure(100, 200);
    const hooked = fresh as unknown as typeof internal & { transition: (ps: PrivateState, op: CircuitCall) => Promise<unknown> };
    const real = hooked.transition.bind(fresh);
    hooked.transition = async (ps, op) => { if (op.name === "redeemDraw") throw new CheckoutError(503, "Hold claim for test"); return real(ps, op); };
    await assert.rejects(fresh.purchase("text-analysis", "bound", "fresh-merchant-order"));
    const opening = hooked.orders.get("fresh-merchant-order")!;
    const wrong = await call(hooked.session, blankPrivate({ callerSecret: hooked.merchants["cost-report"], noteIdentity: agentId(hooked.agentKey), noteQuoteCommit: opening.Q, noteNonce: opening.noteNonce, noteSalt: opening.noteSalt, redeemAmount: 25n }), { name: "redeemDraw", args: [opening.D, opening.noteExpiry] });
    assert.equal(wrong.ok, false);
    assert.equal(readLedger(hooked.session).encumberedReserve, 25n);
    const replay = await call(internal.session, blankPrivate({ callerSecret: internal.merchants["text-analysis"], noteIdentity: agentId(internal.agentKey), noteQuoteCommit: order.Q, noteNonce: order.noteNonce, noteSalt: order.noteSalt, redeemAmount: 25n }), { name: "redeemDraw", args: [order.D, order.noteExpiry] });
    assert.equal(replay.ok, false);
    assert.equal(readLedger(internal.session).redeemedReserve, 25n);
  });
  it("persists the merchant's Unix deadline and cannot deliver an expired pending claim after recovery", async (t) => {
    const START = 1_800_000_000;
    t.mock.timers.enable({ apis: ["Date"], now: START * 1000 });
    let saved: any;
    const storage = { mode: "encrypted-disk" as const, save: async (_id: string, value: unknown) => { saved = value; },
      loadAll: async () => [saved], remove: async () => {}, close: async () => {} };
    const engine = await CheckoutEvaluation.create(storage);
    await engine.configure(100, 200);
    const internal = engine as unknown as { transition: (ps: PrivateState, op: CircuitCall) => Promise<unknown> };
    const real = internal.transition.bind(engine);
    internal.transition = async (ps, op) => {
      if (op.name === "redeemDraw") throw new CheckoutError(503, "Merchant unavailable");
      return real(ps, op);
    };
    await assert.rejects(engine.purchase("text-analysis", "expires", "unix-expiry-order"), /Merchant unavailable/);
    assert.equal(saved.version, 4); assert.equal(saved.deadlineUnits, "unix-seconds");
    const order = saved.orders[0][1];
    assert.equal(order.expiry, BigInt(START + 600)); assert.equal(order.noteExpiry, order.expiry);
    assert.equal(order.phase, "authorized");
    assert.throws(() => CheckoutEvaluation.recover({ ...saved, version: 1, deadlineUnits: undefined }, storage), /Invalid checkout snapshot/);
    assert.throws(() => CheckoutEvaluation.recover({ ...saved, deadlineUnits: "actions" }, storage), /Invalid checkout snapshot/);
    t.mock.timers.setTime((START + 600) * 1000);
    const recovered = CheckoutEvaluation.recover(saved, storage);
    const compensated = await recovered.purchase("text-analysis", "expires", "unix-expiry-order");
    assert.equal(compensated.outcome, "compensated");
    assert.deepEqual(await recovered.purchase("text-analysis", "expires", "unix-expiry-order"), compensated);
    assert.equal(recovered.publicView().deliveries, 0);
    assert.equal(recovered.publicView().encumberedReserve, 0);
    assert.equal(recovered.publicView().refundReserve, 0);
    assert.equal(recovered.issuerView().privateBooks.outstanding, 0);
    assert.equal(recovered.publicView().orders.length, 1);
  });
  it("declines an otherwise valid purchase when accounting reserve is exhausted", async () => {
    const engine = await CheckoutEvaluation.create();
    await engine.configure(100, 24);
    const receipt = await engine.purchase("text-analysis", "unfunded", "reserve-short-order");
    assert.equal(receipt.message, "Clearance could not be proven.");
    assert.equal(engine.publicView().deliveries, 0);
    assert.equal(engine.issuerView().privateBooks.outstanding, 0);
  });
  it("facility and acknowledgement retries are idempotent across later credit transitions", async () => {
    const engine = await CheckoutEvaluation.create();
    await engine.configure(100, 200);
    await engine.configure(100, 200);
    assert.equal(engine.publicView().totalReserve, 200);
    await engine.purchase("text-analysis", "once", "first-purchase-id");
    await engine.acknowledge(25, "stable-payment-ref");
    await engine.purchase("text-analysis", "again", "second-purchase-id");
    await engine.acknowledge(25, "stable-payment-ref");
    assert.equal(engine.issuerView().privateBooks.outstanding, 25);
    await assert.rejects(engine.acknowledge(24, "stable-payment-ref"), /another amount/);
  });
});

describe("checkout HTTP role boundary", () => {
  let server: Server;
  let base: string;
  before(async () => {
    const handler = checkoutMiddleware();
    server = createServer((req, res) => { void handler(req, res, () => { res.writeHead(404); res.end(); }); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/checkout`;
  });
  after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  it("agent capability cannot read issuer books, issue credit or acknowledge a repayment", async () => {
    const response = await fetch(`${base}/sessions`, { method: "POST" });
    const session = await response.json() as { id: string; issuerToken: string; agentToken: string };
    for (const suffix of ["issuer", "issuer/configure", "issuer/acknowledge"]) {
      const rejected = await fetch(`${base}/sessions/${session.id}/${suffix}`, { method: suffix === "issuer" ? "GET" : "POST", headers: { Authorization: `Bearer ${session.agentToken}`, "Content-Type": "application/json" }, ...(suffix === "issuer" ? {} : { body: JSON.stringify({ limit: 100, reserve: 200, amount: 25, reference: "forged-reference" }) }) });
      assert.equal(rejected.status, 403);
    }
    const privateView = await fetch(`${base}/sessions/${session.id}/issuer`, { headers: { Authorization: `Bearer ${session.issuerToken}` } });
    assert.ok((await privateView.json()).privateBooks);
    const publicView = await fetch(`${base}/sessions/${session.id}/public`, { headers: { Authorization: `Bearer ${session.agentToken}` } });
    assert.equal("privateBooks" in await publicView.json(), false);
    const invalid = await fetch(`${base}/sessions/${session.id}/issuer`, { headers: { Authorization: `Bearer ${"é".repeat(64)}` } });
    assert.equal(invalid.status, 403);
  });
  it("rejects cross-origin writes and malformed request content", async () => {
    const cross = await fetch(`${base}/sessions`, { method: "POST", headers: { Origin: "https://untrusted.example" } });
    assert.equal(cross.status, 403);
    const response = await fetch(`${base}/sessions`, { method: "POST" });
    const session = await response.json() as { id: string; issuerToken: string };
    const malformed = await fetch(`${base}/sessions/${session.id}/issuer/configure`, { method: "POST", headers: { Authorization: `Bearer ${session.issuerToken}`, "Content-Type": "application/json" }, body: "[]" });
    assert.equal(malformed.status, 400);
  });
});
