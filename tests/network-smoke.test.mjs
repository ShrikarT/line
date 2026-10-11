import { it } from "node:test";
import assert from "node:assert/strict";
import { checkInfrastructure } from "../scripts/network-smoke.mjs";
import { resolveMidnightEndpoints } from "../src/lib/runtime/endpoints.ts";
const endpoints = resolveMidnightEndpoints({ networkId: "preview" });
function fetcher(overrides = {}) {
  return async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    if (url.endsWith("/version")) return new Response(overrides.version ?? '"8.1.3"', { status: overrides.proofStatus ?? 200 });
    const request = JSON.parse(options.body);
    if (request.query) return Response.json(overrides.indexer ?? { data: { __typename: "Query" } });
    if (overrides.rpcStatus) return new Response("wrong method", { status: overrides.rpcStatus });
    const result = request.method === "system_health" ? { isSyncing: false, peers: 2 } : "=8.1.3";
    return Response.json(overrides.rpc ?? { jsonrpc: "2.0", id: request.id, result });
  };
}
it("checks synchronized RPC, compatible ledger, GraphQL data and exact proof-server version with timeouts", async () => {
  const result = await checkInfrastructure(endpoints, { fetchImpl: fetcher() });
  assert.equal(result.ledgerVersion, "=8.1.3"); assert.equal(result.proofServerVersion, "8.1.3");
});
it("rejects HTTP405, JSON-RPC errors, syncing nodes and incompatible ledgers", async () => {
  await assert.rejects(() => checkInfrastructure(endpoints, { fetchImpl: fetcher({ rpcStatus: 405 }) }), /HTTP 405/);
  await assert.rejects(() => checkInfrastructure(endpoints, { fetchImpl: fetcher({ rpc: { jsonrpc: "2.0", id: 1, error: { code: -32601 } } }) }), /rejected RPC/);
  await assert.rejects(() => checkInfrastructure(endpoints, { fetchImpl: fetcher({ rpc: { jsonrpc: "2.0", id: 1, result: { isSyncing: true } } }) }), /synchronized/);
});
it("rejects successful HTTP responses containing failed or empty GraphQL", async () => {
  for (const indexer of [{ errors: [{ message: "denied" }] }, { data: null }]) {
    await assert.rejects(() => checkInfrastructure(endpoints, { fetchImpl: fetcher({ indexer }) }), /GraphQL/);
  }
});
it("refuses arbitrary reachable pages and old proof versions", async () => {
  for (const version of ["not a proof server", "8.0.3", "8.1.30", "8.1.3 9.0.0"]) {
    await assert.rejects(() => checkInfrastructure(endpoints, { fetchImpl: fetcher({ version }) }), /version 8.1.3/);
  }
  await assert.rejects(() => checkInfrastructure(endpoints, { fetchImpl: fetcher({ proofStatus: 404 }) }), /HTTP 404/);
});
