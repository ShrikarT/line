import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { bech32m } from "@scure/base";
import * as L from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { organizationApi } from "../server/organization-api.mjs";
import { OrganizationSupplierClient } from "../src/lib/organization/supplier-client.ts";
import { organizationSignInMessage } from "../src/lib/organization/sign-in.ts";

test("the browser supplier client signs in, renews expired sessions and retries only the exact saved request", async () => {
  const key = L.sampleSigningKey(), verifyingKey = L.signatureVerifyingKey(key);
  const receivingAddress = bech32m.encodeFromBytes("mn_addr_preprod", Buffer.from(L.addressFromKey(verifyingKey), "hex"));
  const origin = "https://line.example", id = "11111111-1111-4111-8111-111111111111", body = { id, contractAddress: "ab".repeat(32), service: "text-metrics", document: "Actual content" };
  let api: ReturnType<typeof organizationApi>, signatures = 0, quotes = 0, cookie = "", fault = false;
  const service = { catalog: () => ({ services: [] }), order: () => null, authorizeOrganization: async (_: string, recipient: string) => recipient === L.addressFromKey(verifyingKey), quote: async () => { quotes++; }, redeem: async () => {}, close: async () => {} };
  api = organizationApi({ service, origin });
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
  assert.deepEqual(paths, ["/api/organization/catalog", "/api/organization/auth/challenge"]);
});
