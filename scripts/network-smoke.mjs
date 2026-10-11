#!/usr/bin/env node
/** Read-only service/version/public-state checks. Does not prove or submit a transaction. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MidnightNetworkRuntime } from "../src/lib/runtime/network.ts";
import { resolveMidnightEndpoints, assertEndpointCredentials, redactEndpoint, sanitizeServiceError } from "../src/lib/runtime/endpoints.ts";

export async function checkInfrastructure(endpoints, { fetchImpl = fetch, timeout = 15000 } = {}) {
  assertEndpointCredentials(endpoints);
  const post = async (url, body) => {
    const response = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`Service HTTP ${response.status}: ${redactEndpoint(url)}`);
    return response.json();
  };
  const rpc = async (method, id) => {
    const body = await post(endpoints.nodeUri, { jsonrpc: "2.0", id, method, params: [] });
    if (body.jsonrpc !== "2.0" || body.id !== id || body.error || body.result == null) throw new Error(`Invalid or rejected RPC response for ${method}.`);
    return body.result;
  };
  const health = await rpc("system_health", 1);
  if (typeof health !== "object" || typeof health.isSyncing !== "boolean" || health.isSyncing) throw new Error("Node health does not establish a synchronized node.");
  const ledgerVersion = await rpc("midnight_ledgerVersion", 2);
  if (typeof ledgerVersion !== "string" || !/^=?8\.\d+\.\d+$/.test(ledgerVersion)) throw new Error("Node does not report a compatible ledger 8 version.");
  const indexer = await post(endpoints.indexerUri, { query: "{ __typename }" });
  if (indexer.errors?.length || typeof indexer.data?.__typename !== "string" || !indexer.data.__typename) throw new Error("Indexer returned errors or missing GraphQL data.");
  const versionUrl = new URL(endpoints.proofServerUri);
  versionUrl.pathname = `${versionUrl.pathname.replace(/\/$/, "")}/version`;
  const proofResponse = await fetchImpl(versionUrl.href, { signal: AbortSignal.timeout(timeout) });
  if (!proofResponse.ok) throw new Error(`Proof server version check failed with HTTP ${proofResponse.status}.`);
  const text = await proofResponse.text();
  const versions = text.match(/(?<![0-9.])\d+\.\d+\.\d+(?![0-9.])/g) ?? [];
  if (versions.length !== 1 || versions[0] !== "8.1.3") throw new Error("Proof server must report supported version 8.1.3.");
  return { ledgerVersion, proofServerVersion: versions[0], indexerType: indexer.data.__typename };
}

async function main() {
  const address = (process.env.MIDNIGHT_CONTRACT_ADDRESS ?? process.env.VITE_MIDNIGHT_CONTRACT_ADDRESS ?? "").trim().replace(/^0x/, "");
  if (!/^[a-fA-F0-9]{64}$/.test(address)) throw new Error("Configure a 32-byte MIDNIGHT_CONTRACT_ADDRESS for the read-only smoke check.");
  const endpoints = resolveMidnightEndpoints({ networkId: process.env.MIDNIGHT_NETWORK_ID,
    blockfrostProjectId: process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID,
    indexerUri: process.env.MIDNIGHT_INDEXER_URI, indexerWsUri: process.env.MIDNIGHT_INDEXER_WS_URI,
    nodeUri: process.env.MIDNIGHT_NODE_URI, proofServerUri: process.env.MIDNIGHT_PROOF_SERVER_URI });
  console.log(`Line read-only service check: ${endpoints.networkId}`);
  console.log(`Indexer: ${redactEndpoint(endpoints.indexerUri)}`);
  const versions = await checkInfrastructure(endpoints);
  console.log(`Service checks passed: ledger ${versions.ledgerVersion}, proof server ${versions.proofServerVersion}.`);
  const runtime = new MidnightNetworkRuntime({ ...endpoints });
  const status = await runtime.joinContract(address);
  console.log(`Public contract state decoded: ${status.contractDomain}, status ${status.status}.`);
  console.log("No transaction proving, submission, deployment or asset payout was tested.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(sanitizeServiceError(error instanceof Error ? error.message : String(error))); process.exitCode = 1; });
}
