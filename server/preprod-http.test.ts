import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import { preprodMiddleware } from "./preprod-http.ts";

test("live mutation requires the local operator request and one active job; polling does not submit", async () => {
  let calls = 0, finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const live = preprodMiddleware({ env: { LINE_LIVE_PREPROD: "1" }, create: async () => ({
    summary: () => ({ network: "preprod", contractAddress: "ab".repeat(32), phase: "ready", progress: "Ready", busy: false, pending: null, privateBook: { limit: 60, outstanding: 0, remaining: 60 }, orders: [], receipts: [], settlement: "test", custody: "test" }),
    setup: async () => { throw Error("No deployment through HTTP"); },
    purchase: async () => { calls++; await wait; return {} as never; }, acknowledge: async () => { calls++; return {} as never; }, close: async () => {},
  }) });
  const server = createServer((req, res) => { void live.middleware(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string"); const origin = `http://127.0.0.1:${address.port}`;
  const payload = JSON.stringify({ requestId: "12345678-1234-1234-1234-123456789abc", document: "A document." });
  try {
    const denied = await fetch(`${origin}/api/preprod/purchase`, { method: "POST", headers: { Origin: "https://external.example", "X-Line-Preprod": "operator" }, body: payload }); assert.equal(denied.status, 403); assert.equal(calls, 0);
    const headers = { Origin: origin, "X-Line-Preprod": "operator", "Content-Type": "application/json" };
    const status = await fetch(`${origin}/api/preprod/status`, { headers }); assert.equal(status.status, 200); assert.equal(status.headers.get("cache-control"), "no-store"); assert.equal(calls, 0);
    const first = await fetch(`${origin}/api/preprod/purchase`, { method: "POST", headers, body: payload }); assert.equal(first.status, 202);
    const concurrent = await fetch(`${origin}/api/preprod/purchase`, { method: "POST", headers, body: payload }); assert.equal(concurrent.status, 409); assert.equal(calls, 1);
  } finally { finish(); await live.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("two bodies admitted before either finishes still start exactly one operation", async () => {
  let calls = 0, finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const live = preprodMiddleware({ env: { LINE_LIVE_PREPROD: "1" }, create: async () => ({
    summary: () => ({} as never), setup: async () => ({} as never),
    purchase: async () => { calls++; await wait; return {} as never; }, acknowledge: async () => ({} as never), close: async () => {},
  }) });
  const statuses: number[] = [];
  const streams = [new PassThrough(), new PassThrough()];
  const runs = streams.map(stream => {
    Object.assign(stream, { method: "POST", url: "/api/preprod/purchase", socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:5174", origin: "http://127.0.0.1:5174", "x-line-preprod": "operator" } });
    const response = { writeHead: (status: number) => { statuses.push(status); }, end: () => {} };
    return live.middleware(stream as unknown as IncomingMessage, response as unknown as ServerResponse, () => assert.fail("Unexpected route"));
  });
  try {
    for (const stream of streams) stream.end(JSON.stringify({ requestId: "12345678-1234-1234-1234-123456789abc", document: "A document." }));
    await Promise.all(runs); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(statuses.sort(), [202, 409]); assert.equal(calls, 1);
  } finally { finish(); await live.close(); }
});

test("a temporary initialization failure can be retried without submitting", async () => {
  let attempts = 0;
  const live = preprodMiddleware({ env: { LINE_LIVE_PREPROD: "1" }, create: async () => {
    if (++attempts === 1) throw Error("Receipt not indexed yet");
    return { summary: () => ({} as never), setup: async () => ({} as never), purchase: async () => assert.fail("No purchase"), acknowledge: async () => assert.fail("No repayment"), close: async () => {} };
  } });
  const req = { method: "GET", url: "/api/preprod/status", socket: { remoteAddress: "127.0.0.1" }, headers: { host: "localhost:5174", origin: "http://localhost:5174", "x-line-preprod": "operator" } } as unknown as IncomingMessage;
  const statuses: number[] = [], res = { writeHead: (status: number) => { statuses.push(status); }, end: () => {} } as unknown as ServerResponse;
  try { await live.middleware(req, res, () => {}); await live.middleware(req, res, () => {}); assert.deepEqual(statuses, [503, 200]); assert.equal(attempts, 2); }
  finally { await live.close(); }
});

test("reconciliation is admitted through the same job guard without creating a purchase or repayment", async () => {
  let recovered = 0;
  const live = preprodMiddleware({ env: { LINE_LIVE_PREPROD: "1" }, create: async () => ({
    summary: () => ({} as never), setup: async () => assert.fail("No setup"), purchase: async () => assert.fail("No purchase"), acknowledge: async () => assert.fail("No repayment"), recoverPending: async () => { recovered++; }, close: async () => {},
  }) });
  const stream = new PassThrough();
  Object.assign(stream, { method: "POST", url: "/api/preprod/reconcile", socket: { remoteAddress: "127.0.0.1" }, headers: { host: "localhost:5174", origin: "http://localhost:5174", "x-line-preprod": "operator" } });
  const statuses: number[] = [], res = { writeHead: (status: number) => { statuses.push(status); }, end: () => {} } as unknown as ServerResponse;
  const run = live.middleware(stream as unknown as IncomingMessage, res, () => assert.fail("Unknown route"));
  stream.end(JSON.stringify({ requestId: "12345678-1234-1234-1234-123456789abc" }));
  await run; await live.close(); assert.deepEqual(statuses, [202]); assert.equal(recovered, 1);
});

test("test-token setup and canonical purchases share one fee-wallet job guard", async () => {
  let setups = 0, purchases = 0, finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const parent = { summary: () => ({} as never), setup: async () => assert.fail("Canonical deployment is not exposed"), purchase: async () => { purchases++; return {} as never; }, acknowledge: async () => ({} as never), close: async () => {} };
  const live = preprodMiddleware({ env: { LINE_LIVE_PREPROD: "1" }, create: async () => parent, createSettlement: async actual => {
    assert.equal(actual, parent);
    return { ...parent, setup: async () => { setups++; await waiting; return {} as never; } };
  } });
  const server = createServer((req, res) => { void live.middleware(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = { Origin: origin, "X-Line-Preprod": "operator", "Content-Type": "application/json" };
  const body = JSON.stringify({ requestId: "12345678-1234-1234-1234-123456789abc", document: "Test-token purchase" });
  try {
    assert.equal((await fetch(`${origin}/api/preprod/setup`, { method: "POST", headers, body })).status, 404);
    assert.equal((await fetch(`${origin}/api/preprod/settlement/status`, { headers })).status, 200);
    assert.equal(setups, 0);
    assert.equal((await fetch(`${origin}/api/preprod/settlement/setup`, { method: "POST", headers, body })).status, 202);
    assert.equal((await fetch(`${origin}/api/preprod/purchase`, { method: "POST", headers, body })).status, 409);
    assert.equal((await fetch(`${origin}/api/preprod/settlement/purchase`, { method: "POST", headers, body })).status, 409);
    assert.equal(setups, 1); assert.equal(purchases, 0);
    const status = await (await fetch(`${origin}/api/preprod/status`, { headers })).json();
    assert.equal(status.busy, true);
    assert.equal(status.progress, "Another Preprod contract operation is running");
  } finally { finish(); await live.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
