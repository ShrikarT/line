import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { bech32m } from "@scure/base";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { organizationApi } from "../server/organization-api.mjs";
import { OrganizationSupplierClient } from "../src/lib/organization/supplier-client.ts";
import { organizationSignInMessage } from "../src/lib/organization/sign-in.ts";
import { OrganizationAuth } from "../server/organization-auth.mjs";

test("the browser supplier client signs in, renews expired sessions and retries only the exact saved request", async () => {
  const key = L.sampleSigningKey(), verifyingKey = L.signatureVerifyingKey(key);
  const receivingAddress = bech32m.encodeFromBytes("mn_addr_preprod", Buffer.from(L.addressFromKey(verifyingKey), "hex"));
  const origin = "https://line.example", id = "11111111-1111-4111-8111-111111111111", body = { id, contractAddress: "ab".repeat(32), service: "text-metrics", document: "Actual content" };
  let api: ReturnType<typeof organizationApi>, signatures = 0, quotes = 0, cookie = "", fault = false;
  const service = { catalog: () => ({ services: [] }), order: () => null, authorizeOrganization: async (_: string, recipient: string) => recipient === L.addressFromKey(verifyingKey), quote: async () => { quotes++; }, redeem: async () => {}, close: async () => {} };
  // The existing challenge protocol tolerates this ordinary clock difference.
  // Resuming its session must accept the same clock range.
  api = organizationApi({ service, origin, auth: new OrganizationAuth(origin, () => Date.now() + 30_000) });
  const server = createServer((req, res) => { void api.middleware(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address === "object");
  const calls: { path: string; body?: string | null }[] = [];
  const transport: typeof fetch = async (url, options) => {
    const path = new URL(String(url)).pathname; calls.push({ path, body: options?.body as string });
    if (fault && path === "/api/organization/orders") throw Error("Transport response is uncertain");
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { ...options, headers: { ...options?.headers, Origin: origin, Cookie: cookie } });
    const updated = response.headers.get("set-cookie"); if (updated) cookie = updated.split(";")[0]; return response;
  };
  const account = { receivingAddress, assertSession: () => {}, assertWallet: async () => {}, wallet: { signData: async (message: string) => {
    signatures++; const bytes = Buffer.from(`midnight_signed_message:${Buffer.byteLength(message)}:${message}`);
    return { data: message, verifyingKey, signature: L.signData(key, bytes) };
  } } };
  const client = new OrganizationSupplierClient(account, origin, () => {}, transport);
  try {
    await client.request("catalog"); assert.equal(signatures, 0);
    await client.request("orders", body); assert.equal(signatures, 1); assert.equal(quotes, 1);
    const refreshed = new OrganizationSupplierClient(account, origin, () => {}, transport);
    const resumeStart = calls.length;
    await refreshed.request(`orders/${id}`);
    assert.equal(signatures, 1, "a refreshed client must reuse the valid wallet-bound HTTP session");
    assert.deepEqual(calls.slice(resumeStart).map(row => row.path), ["/api/organization/catalog", "/api/organization/auth/session", `/api/organization/orders/${id}`]);
    api.auth.close(); // A server restart/expiration invalidates only the HTTP session.
    await client.request("orders", body); assert.equal(signatures, 2); assert.equal(quotes, 2);
    assert(calls.filter(row => row.path === "/api/organization/orders").every(row => row.body === JSON.stringify(body)));
    fault = true;
    const before = calls.length;
    await assert.rejects(client.request("orders", body), /uncertain/);
    assert.equal(calls.length, before + 1); assert.equal(signatures, 2); assert.equal(quotes, 2);
    const tampered: typeof fetch = async (url, options) => new URL(String(url)).pathname.endsWith("/auth/challenge")
      ? new Response(JSON.stringify({ nonce: "00".repeat(32), expiresAt: Date.now() + 60_000, message: "Sign unrelated content" }), { headers: { "Content-Type": "application/json" } }) : transport(url, options);
    const fresh = new OrganizationSupplierClient(account, origin, () => {}, tampered);
    api.auth.close();
    await assert.rejects(fresh.request("orders", body), /invalid wallet sign-in challenge/);
    assert.equal(signatures, 2); assert.equal(quotes, 2);
  } finally { await api.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("a rate-limited sign-in is identified and never automatically signed again", async () => {
  const origin = "https://line.example", receivingAddress = "test-receiving-address";
  const nonce = "ab".repeat(32), expiresAt = Date.now() + 60_000;
  let signatures = 0;
  const paths: string[] = [];
  const client = new OrganizationSupplierClient({ receivingAddress, assertSession() {}, async assertWallet() {}, wallet: {
    async signData() { signatures++; throw Error("Rate limited https://wallet.example/api?project_id=fixture-provider"); },
  } }, origin, () => {}, async url => {
    const path = new URL(String(url)).pathname; paths.push(path);
    if (path.endsWith("/catalog")) return Response.json({ walletAuthentication: "required", services: [] });
    if (path.endsWith("/auth/session")) return Response.json({ code: "WALLET_AUTH_REQUIRED" }, { status: 401 });
    if (path.endsWith("/auth/challenge")) return Response.json({ nonce, expiresAt, message: organizationSignInMessage(origin, receivingAddress, nonce, expiresAt) });
    throw Error("A failed signature cannot reach verification or a supplier action");
  });
  await assert.rejects(client.request("network"), error => {
    assert(error instanceof Error);
    assert.match(error.message, /Wallet sign-in did not complete: Rate limited/);
    assert.match(error.message, /not.*retried/);
    assert(!error.message.includes("fixture-provider"));
    return true;
  });
  assert.equal(signatures, 1);
  assert.deepEqual(paths, ["/api/organization/catalog", "/api/organization/auth/session", "/api/organization/auth/challenge"]);
});

test("an unavailable or invalid retained sign-in cannot trigger a signature or supplier action", async () => {
  for (const result of [() => Response.json({}, { status: 503 }), () => Response.json({ authenticated: true, expiresAt: Date.now() + 24 * 60 * 60_000 }), () => { throw Error("Session read unavailable"); }]) {
    let signatures = 0, actions = 0;
    const client = new OrganizationSupplierClient({ receivingAddress: "fixture-wallet", assertSession() {}, async assertWallet() {}, wallet: { async signData() { signatures++; throw Error("Unexpected signature"); } } }, "https://line.example", () => {}, async url => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/catalog")) return Response.json({ walletAuthentication: "required" });
      if (path.endsWith("/auth/session")) return result();
      actions++; throw Error("Unexpected supplier action");
    });
    await assert.rejects(client.request("orders", { id: "fixture" }));
    assert.equal(signatures, 0); assert.equal(actions, 0);
  }
});

test("a wallet lock during HTTP-session restoration prevents publication and supplier admission", async () => {
  let current = true, signatures = 0, actions = 0;
  const client = new OrganizationSupplierClient({ receivingAddress: "fixture-wallet", assertSession() { if (!current) throw Error("Organization locked"); }, async assertWallet() {}, wallet: { async signData() { signatures++; throw Error("Unexpected signature"); } } }, "https://line.example", () => {}, async url => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/catalog")) return Response.json({ walletAuthentication: "required" });
    if (path.endsWith("/auth/session")) { current = false; return Response.json({ authenticated: true, expiresAt: Date.now() + 20 * 60_000 }); }
    actions++; throw Error("Unexpected supplier action");
  });
  await assert.rejects(client.request("orders", { id: "fixture" }), /Organization locked/);
  assert.equal(signatures, 0); assert.equal(actions, 0);
});
