import test from "node:test";
import assert from "node:assert/strict";
import type { Configuration } from "@midnight-ntwrk/dapp-connector-api";
import { organizationReadEndpoints } from "../src/lib/organization/read-endpoints.ts";

const configuration = { networkId: "preprod", indexerUri: "https://midnight-preprod.blockfrost.io/api/v0", indexerWsUri: "wss://midnight-preprod.blockfrost.io/api/v0/ws", substrateNodeUri: "https://rpc.midnight-preprod.blockfrost.io", proverServerUri: "http://127.0.0.1:6300" } as Configuration;
const origin = "https://line.example";
const metadata = { networkId: "preprod", indexerUri: origin + "/api/organization/network/indexer", indexerWsUri: "wss://line.example/api/organization/network/indexer/ws" };

test("a public organization uses authenticated read URLs without fetching a local operator token or changing wallet submission", async () => {
  const calls: string[] = [];
  const reads = await organizationReadEndpoints(configuration, { request: async path => { calls.push(path); return metadata; } }, origin, async () => { throw Error("A public site must not request the local token helper"); });
  assert.equal(reads.indexerUri, metadata.indexerUri); assert.equal(reads.indexerWsUri, metadata.indexerWsUri); assert.deepEqual(calls, ["network"]);
  await reads.authorize?.(); assert.deepEqual(calls, ["network", "network"]);
  assert.equal(configuration.substrateNodeUri, "https://rpc.midnight-preprod.blockfrost.io");
});

test("working wallet indexers remain preferred and a local helper only fills missing credentials", async () => {
  const wallet = { ...configuration, indexerUri: configuration.indexerUri + "?project_id=wallet-owned-provider", indexerWsUri: configuration.indexerWsUri + "?project_id=wallet-owned-provider" };
  const never = { request: async () => { throw Error("Do not replace a working wallet indexer"); } };
  const ready = await organizationReadEndpoints(wallet, never, origin, async () => { throw Error("Unnecessary token request"); });
  assert.equal(ready.indexerUri, wallet.indexerUri); assert.equal(ready.indexerWsUri, wallet.indexerWsUri);
  const partial = await organizationReadEndpoints({ ...configuration, indexerUri: wallet.indexerUri }, { request: async () => metadata }, origin);
  assert.equal(partial.indexerUri, wallet.indexerUri); assert.equal(partial.indexerWsUri, metadata.indexerWsUri);
  let helperCalls = 0;
  const local = await organizationReadEndpoints({ ...configuration, indexerUri: wallet.indexerUri }, never, "http://127.0.0.1:5174", async (url, options) => {
    assert.equal(String(url), "http://127.0.0.1:5174/api/line/network-session"); assert.equal(options?.method, "POST"); helperCalls++;
    return new Response(JSON.stringify({ networkId: "preprod", blockfrostProjectId: "local-provider-control" }));
  });
  assert.equal(helperCalls, 1); assert.equal(local.indexerUri, wallet.indexerUri); assert.equal(new URL(local.indexerWsUri).searchParams.get("project_id"), "local-provider-control");
});

test("network fallback rejects external URLs, credentials and a different network", async () => {
  for (const value of [{ ...metadata, networkId: "mainnet" }, { ...metadata, indexerUri: "https://attacker.example/read" }, { ...metadata, indexerWsUri: metadata.indexerWsUri + "?project_id=leaked-control" }]) {
    await assert.rejects(organizationReadEndpoints(configuration, { request: async () => value }, origin), /invalid Preprod read connection/);
  }
  await assert.rejects(organizationReadEndpoints({ ...configuration, indexerUri: "https://indexer.mainnet.midnight.network" }, { request: async () => metadata }, origin), /retired/);
});

test("retired Preprod wallet readers use authenticated Line reads without using the wallet's retired node", async () => {
  const wallet = { ...configuration, indexerUri: "https://indexer.preprod.midnight.network/api/v3/graphql", indexerWsUri: "wss://indexer.preprod.midnight.network/api/v3/graphql/ws", substrateNodeUri: "https://rpc.preprod.midnight.network" };
  const calls: string[] = [];
  const reads = await organizationReadEndpoints(wallet, { request: async path => { calls.push(path); return metadata; } }, origin);
  assert.equal(reads.indexerUri, metadata.indexerUri);
  assert.equal(reads.indexerWsUri, metadata.indexerWsUri);
  await reads.authorize?.();
  assert.deepEqual(calls, ["network", "network"]);
  assert.equal(wallet.substrateNodeUri, "https://rpc.preprod.midnight.network");
});

test("an unused retired submission node cannot block working wallet readers", async () => {
  const wallet = { ...configuration, indexerUri: "https://indexer.example.test/graphql", indexerWsUri: "wss://indexer.example.test/graphql/ws", substrateNodeUri: "https://rpc.preprod.midnight.network" };
  const reads = await organizationReadEndpoints(wallet, { request: async () => { throw Error("Working wallet readers need no fallback"); } }, origin);
  assert.equal(reads.indexerUri, wallet.indexerUri);
  assert.equal(reads.indexerWsUri, wallet.indexerWsUri);
});

test("retired reader recovery does not accept credentials, invalid protocols or a different wallet network", async () => {
  for (const indexerUri of ["https://user:password@indexer.preprod.midnight.network/graphql", "ftp://indexer.preprod.midnight.network/graphql", "not-a-url"]) {
    await assert.rejects(organizationReadEndpoints({ ...configuration, indexerUri }, { request: async () => metadata }, origin));
  }
  await assert.rejects(organizationReadEndpoints({ ...configuration, networkId: "mainnet" }, { request: async () => metadata }, origin), /network|Preprod/);
});
