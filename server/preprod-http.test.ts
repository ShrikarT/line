import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
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
