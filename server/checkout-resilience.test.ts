import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CircuitCall, PrivateState, readLedger } from "../src/lib/line/compact-harness.ts";
import { CheckoutError, CheckoutEvaluation } from "./checkout-engine.ts";
import { checkoutMiddleware } from "./checkout-http.ts";

type Middleware = ReturnType<typeof checkoutMiddleware>;
type Response = { status: number; value: Record<string, unknown> };
type TransitionAccess = {
  transition(witness: PrivateState, operation: CircuitCall): Promise<ReturnType<typeof readLedger>>;
};

async function request(middleware: Middleware, path: string, method = "GET", token?: string, payload?: Record<string, unknown>): Promise<Response> {
  let status = 0;
  let value: Record<string, unknown> = {};
  const incoming = {
    url: path,
    method,
    headers: { host: "localhost", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload ? { "content-type": "application/json" } : {}) },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(payload ?? {})); },
  } as IncomingMessage;
  const outgoing = {
    writeHead(code: number) { status = code; },
    end(body: string) { value = JSON.parse(body) as Record<string, unknown>; },
  } as unknown as ServerResponse;
  await middleware(incoming, outgoing, () => assert.fail("Checkout request fell through middleware."));
  return { status, value };
}

test("HTTP reserves capacity before construction: forty concurrent requests start only twenty sessions", async (t) => {
  let initializations = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(CheckoutEvaluation, "create", async () => {
    const id = `capacity-session-${++initializations}`;
    await gate;
    // No Compact execution is needed to test the HTTP resource reservation.
    return { id, issuerToken: "a".repeat(64), agentToken: "b".repeat(64), createdAt: Date.now() } as CheckoutEvaluation;
  });
  const middleware = checkoutMiddleware();
  const requests = Array.from({ length: 40 }, () => request(middleware, "/api/checkout/sessions", "POST"));
  assert.equal(initializations, 20, "Rejected requests must not start expensive session construction.");
  release();
  const responses = await Promise.all(requests);
  assert.equal(responses.filter(response => response.status === 201).length, 20);
  assert.equal(responses.filter(response => response.status === 429).length, 20);
  assert.equal((await request(middleware, "/api/checkout/sessions", "POST")).status, 429);
  assert.equal(initializations, 20);
});

test("a failed HTTP initialization releases its capacity reservation", async (t) => {
  let attempts = 0;
  t.mock.method(CheckoutEvaluation, "create", async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Injected constructor failure");
    return { id: `retry-session-${attempts}`, issuerToken: "a".repeat(64), agentToken: "b".repeat(64), createdAt: Date.now() } as CheckoutEvaluation;
  });
  const middleware = checkoutMiddleware();
  assert.equal((await request(middleware, "/api/checkout/sessions", "POST")).status, 500);
  const successes = await Promise.all(Array.from({ length: 20 }, () => request(middleware, "/api/checkout/sessions", "POST")));
  assert.equal(successes.filter(response => response.status === 201).length, 20);
  assert.equal(attempts, 21);
});

test("configure resumes after an interrupted open without funding twice or changing accepted terms", async (t) => {
  const evaluation = await CheckoutEvaluation.create();
  const access = evaluation as unknown as TransitionAccess;
  const original = access.transition.bind(evaluation);
  let failOpening = true;
  t.mock.method(access, "transition", async (witness: PrivateState, operation: CircuitCall) => {
    if (operation.name === "openLine" && failOpening) {
      failOpening = false;
      throw new Error("Injected opening failure");
    }
    return original(witness, operation);
  });
  await assert.rejects(evaluation.configure(100, 100), /Injected opening failure/);
  assert.equal(evaluation.publicView().totalReserve, 100);
  assert.equal(evaluation.publicView().opened, false);
  await assert.rejects(evaluation.configure(200, 100), (error: unknown) => error instanceof CheckoutError && error.status === 409);
  const configured = await evaluation.configure(100, 100);
  assert.equal(configured.opened, true);
  assert.equal(configured.totalReserve, 100);
  assert.deepEqual(configured.privateBooks, { limit: 100, outstanding: 0, remaining: 100 });
  const replay = await evaluation.configure(100, 100);
  assert.equal(replay.totalReserve, 100);
  assert.equal(replay.lineCommit, configured.lineCommit);
});

test("pending checkout remains inspectable and exact concurrent retries resume one claim and one delivery", async (t) => {
  const evaluation = await CheckoutEvaluation.create();
  await evaluation.configure(100, 100);
  const access = evaluation as unknown as TransitionAccess;
  const original = access.transition.bind(evaluation);
  let failRedemption = true;
  t.mock.method(access, "transition", async (witness: PrivateState, operation: CircuitCall) => {
    if (operation.name === "redeemDraw" && failRedemption) {
      failRedemption = false;
      throw new Error("Injected redemption failure");
    }
    return original(witness, operation);
  });
  await assert.rejects(evaluation.purchase("text-analysis", "alpha beta alpha.", "pending_order_001"), /Injected redemption failure/);
  const before = evaluation.publicView();
  assert.equal(before.orders.length, 1);
  assert.equal(before.orders[0].outcome, "pending");
  assert.match(before.orders[0].note!, /^[a-f0-9]{64}$/);
  assert.equal(before.encumberedReserve, 25);
  assert.equal(before.redeemedReserve, 0);
  assert.equal(evaluation.issuerView().privateBooks.outstanding, 25);
  assert.equal(before.deliveries, 0);

  t.mock.method(CheckoutEvaluation, "create", async () => evaluation);
  const middleware = checkoutMiddleware();
  assert.equal((await request(middleware, "/api/checkout/sessions", "POST")).status, 201);
  const observed = await request(middleware, `/api/checkout/sessions/${evaluation.id}/agent`, "GET", evaluation.agentToken);
  assert.equal(observed.status, 200);
  assert.equal("privateBooks" in observed.value, false);
  const observedOrders = observed.value.orders as typeof before.orders;
  assert.equal(observedOrders[0].note, before.orders[0].note);
  assert.equal(observedOrders[0].outcome, "pending");
  assert.equal("output" in observedOrders[0], false);
  await assert.rejects(evaluation.purchase("text-analysis", "different document", "pending_order_001"), (error: unknown) => error instanceof CheckoutError && error.status === 409);
  const [first, second] = await Promise.all([
    evaluation.purchase("text-analysis", "alpha beta alpha.", "pending_order_001"),
    evaluation.purchase("text-analysis", "alpha beta alpha.", "pending_order_001"),
  ]);
  assert.deepEqual(first, second);
  assert.equal(first.quote, before.orders[0].quote);
  assert.equal(first.note, before.orders[0].note);
  assert.equal(first.outcome, "delivered");
  assert.equal(first.stages.filter(stage => stage === "merchant-quote-posted").length, 1);
  assert.equal(first.stages.filter(stage => stage === "authorization-accepted").length, 1);
  assert.equal(first.stages.filter(stage => stage === "merchant-claim-redeemed").length, 1);
  assert.equal(first.stages.filter(stage => stage === "service-delivered").length, 1);
  assert.equal(evaluation.issuerView().privateBooks.outstanding, 25);
  const after = evaluation.publicView();
  assert.equal(after.orders.length, 1);
  assert.equal(after.encumberedReserve, 0);
  assert.equal(after.redeemedReserve, 25);
  assert.equal(after.deliveries, 1);
});

test("malformed multibyte bearer tokens are rejected as unauthorized without exposing issuer books", async (t) => {
  const evaluation = await CheckoutEvaluation.create();
  t.mock.method(CheckoutEvaluation, "create", async () => evaluation);
  const middleware = checkoutMiddleware();
  await request(middleware, "/api/checkout/sessions", "POST");
  const issuerPath = `/api/checkout/sessions/${evaluation.id}/issuer`;
  for (const token of ["\u00e9".repeat(64), "g".repeat(64), evaluation.agentToken]) {
    const denied = await request(middleware, issuerPath, "GET", token);
    assert.equal(denied.status, 403);
    assert.equal("privateBooks" in denied.value, false);
  }
  const allowed = await request(middleware, issuerPath, "GET", evaluation.issuerToken);
  assert.equal(allowed.status, 200);
  assert.equal("privateBooks" in allowed.value, true);
});

test("idle TTL preserves unresolved private obligations, allows exact compensation retries and blocks new purchases", async (t) => {
  const start = 1_800_000_000_000; t.mock.timers.enable({ apis: ["Date"], now: start });
  const engine = await CheckoutEvaluation.create(); await engine.configure(100, 200);
  const access = engine as unknown as TransitionAccess, original = access.transition.bind(engine);
  t.mock.method(access, "transition", async (ps: PrivateState, op: CircuitCall) => {
    if (op.name === "redeemDraw") throw new Error("Merchant unavailable"); return original(ps, op);
  });
  await assert.rejects(engine.purchase("text-analysis", "retained obligation", "ttl-original-order"), /Merchant unavailable/);
  await engine.acknowledge(10, "ttl-incoming-receipt");
  t.mock.method(CheckoutEvaluation, "create", async () => engine);
  const middleware = checkoutMiddleware(); await request(middleware, "/api/checkout/sessions", "POST");
  t.mock.timers.setTime(start + 30 * 60 * 1000 + 1);
  const agentPath = `/api/checkout/sessions/${engine.id}/agent`;
  assert.equal((await request(middleware, agentPath, "GET", engine.agentToken)).status, 200);
  const fresh = await request(middleware, `${agentPath}/purchase`, "POST", engine.agentToken,
    { service: "cost-report", document: "new", requestId: "ttl-new-order" }); assert.equal(fresh.status, 410);
  const recovered = await request(middleware, `${agentPath}/purchase`, "POST", engine.agentToken,
    { service: "text-analysis", document: "retained obligation", requestId: "ttl-original-order" });
  assert.equal(recovered.status, 200); assert.equal(recovered.value.outcome, "compensated");
  const publicView = await request(middleware, agentPath, "GET", engine.agentToken);
  assert.equal(publicView.status, 200); assert.equal("refunds" in publicView.value, false); assert.equal(publicView.value.refundReserve, 25);
  const reportPath = `/api/checkout/sessions/${engine.id}/issuer/report-refund`;
  const payload = { orderId: "ttl-original-order", reference: "ttl-outgoing-receipt" };
  const denied = await request(middleware, reportPath, "POST", engine.agentToken, payload);
  assert.equal(denied.status, 403); assert.equal("privateBooks" in denied.value, false);
  const report = await request(middleware, reportPath, "POST", engine.issuerToken, payload);
  assert.equal(report.status, 200); assert.equal(report.value.reportedRefundReserve, 25); assert.equal(report.value.payout, "not-connected");
  assert.equal(engine.publicView().deliveries, 0); assert.equal(engine.issuerView().privateBooks.outstanding, 0);
  assert.equal(engine.hasOutstandingObligations(), true, "An issuer report leaves its full backing locked.");
  t.mock.timers.setTime(start + 60 * 60 * 1000);
  assert.equal((await request(middleware, agentPath, "GET", engine.agentToken)).status, 200);
  const replay = await request(middleware, reportPath, "POST", engine.issuerToken, payload);
  assert.equal(replay.status, 200); assert.deepEqual(replay.value, report.value);
  const issuer = await request(middleware, `/api/checkout/sessions/${engine.id}/issuer`, "GET", engine.issuerToken);
  assert.equal(issuer.status, 200); assert.equal((issuer.value.refunds as Array<{ reported: boolean }>)[0].reported, true);
  assert.equal((await request(middleware, `${agentPath}/purchase`, "POST", engine.agentToken,
    { service: "cost-report", document: "still blocked", requestId: "ttl-after-report-order" })).status, 410);
});
