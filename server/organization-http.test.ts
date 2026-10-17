import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { preprodMiddleware } from "./preprod-http.ts";

test("organization suppliers share the real fee-wallet admission lock and never expose issuer records", async () => {
  let quoteCalls = 0, release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const fakeRuntime = { summary: () => ({} as never), setup: async () => ({} as never), purchase: async () => ({} as never), acknowledge: async () => ({} as never), close: async () => {} };
  const live = preprodMiddleware({
    env: { LINE_LIVE_PREPROD: "1" }, create: async () => fakeRuntime, createSettlement: async () => fakeRuntime,
    createMerchants: async () => ({
      catalog: () => ({ services: [{ id: "text-metrics", price: "25000" }] }), order: id => ({ id, status: "created" }),
      quote: async () => { quoteCalls++; await wait; }, redeem: async () => {}, close: async () => {},
    }),
  });
  const server = createServer((req, res) => { void live.middleware(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address === "object");
  const base = "http://127.0.0.1:" + address.port, id = "11111111-1111-4111-8111-111111111111";
  const headers = { Origin: base, "X-Line-Organization": "wallet", "Content-Type": "application/json" };
  try {
    const denied = await fetch(base + "/api/organization/catalog", { headers: { ...headers, Origin: "https://another.example" } });
    assert.equal(denied.status, 403); assert.equal(quoteCalls, 0);
    const catalog = await fetch(base + "/api/organization/catalog", { headers });
    assert.equal(catalog.status, 200); assert.equal(catalog.headers.get("cache-control"), "no-store");
    assert(!JSON.stringify(await catalog.json()).includes("issuerSecret"));
    const started = await fetch(base + "/api/organization/orders", { method: "POST", headers, body: JSON.stringify({ id, contractAddress: "ab".repeat(32), service: "text-metrics", document: "Actual document" }) });
    assert.equal(started.status, 202);
    const competing = await fetch(base + "/api/preprod/purchase", { method: "POST", headers: { ...headers, "X-Line-Preprod": "operator" }, body: JSON.stringify({ requestId: id, document: "Other operation" }) });
    assert.equal(competing.status, 409); assert.equal(quoteCalls, 1);
    const status = await fetch(base + "/api/organization/orders/" + id, { headers });
    assert.equal((await status.json()).busy, true);
    assert.equal(quoteCalls, 1);
  } finally { release(); await live.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
