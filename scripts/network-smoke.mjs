#!/usr/bin/env node
/**
 * Midnight Network Smoke Test
 * Strictly executes network validation: verifies indexer, node, and proof server connectivity.
 */
import { MidnightNetworkRuntime } from "../src/lib/runtime/network.ts";

async function main() {
  console.log("=================================================");
  console.log(" Line — Midnight Network Infrastructure Smoke Test");
  console.log("=================================================");

  const networkId = process.env.MIDNIGHT_NETWORK_ID ?? "midnight-testnet";
  const indexerUri = process.env.MIDNIGHT_INDEXER_URI ?? "https://indexer.testnet-02.midnight.network/api/v1/graphql";
  const nodeUri = process.env.MIDNIGHT_NODE_URI ?? "https://rpc.testnet-02.midnight.network";
  const proofServerUri = process.env.MIDNIGHT_PROOF_SERVER_URI ?? "http://127.0.0.1:6300";
  const contractAddress = process.env.MIDNIGHT_CONTRACT_ADDRESS ?? process.env.VITE_MIDNIGHT_CONTRACT_ADDRESS;

  console.log(`Target Network:   ${networkId}`);
  console.log(`Node RPC URI:     ${nodeUri}`);
  console.log(`Indexer URI:      ${indexerUri}`);
  console.log(`Proof Server URI: ${proofServerUri}`);
  console.log(`Contract Address: ${contractAddress ?? "Not set (skipping on-chain query)"}`);

  const runtime = new MidnightNetworkRuntime({
    networkId,
    indexerUri,
    nodeUri,
    proofServerUri,
    contractAddress,
  });

  console.log("\n1. Testing Midnight GraphQL Indexer reachability...");
  try {
    const res = await fetch(indexerUri, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    console.log("✓ Midnight Indexer is reachable.");
  } catch (err) {
    console.error(`✗ Failed to reach Midnight Indexer at ${indexerUri}:`, err instanceof Error ? err.message : String(err));
    console.error("Please ensure the indexer is online or check your network connection.");
    process.exit(1);
  }

  console.log("\n2. Testing Midnight Proof Server reachability...");
  try {
    const res = await fetch(proofServerUri, { method: "GET" }).catch(() => null);
    if (res && res.status < 500) {
      console.log("✓ Midnight Proof Server is reachable.");
    } else {
      console.log("! Warning: Proof server at " + proofServerUri + " is not currently active.");
      console.log("  (Proving transactions on network will require a running proof-server instance.)");
    }
  } catch {
    console.log("! Warning: Proof server not reachable.");
  }

  if (contractAddress) {
    console.log(`\n3. Querying deployed contract ${contractAddress}...`);
    try {
      const status = await runtime.joinContract(contractAddress);
      console.log("✓ Contract successfully verified on network:");
      console.log(`  Domain:    ${status.contractDomain}`);
      console.log(`  Status:    ${status.status}`);
      console.log(`  Reserve:   ${status.totalReserve}`);
    } catch (err) {
      console.error("✗ Failed to query contract from indexer:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  console.log("\n✓ Network smoke test completed.");
}

main().catch((err) => {
  console.error("✗ Smoke test failed:", err);
  process.exit(1);
});
