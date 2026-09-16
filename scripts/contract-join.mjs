#!/usr/bin/env node
/**
 * Midnight Contract Join Script
 * Queries indexer public data provider to discover and validate a deployed Line contract.
 */
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { ledger } from "../contracts/managed/line/contract/index.js";

async function main() {
  const address = process.argv[2] ?? process.env.MIDNIGHT_CONTRACT_ADDRESS;
  if (!address || address.trim().length === 0) {
    console.error("Usage: node scripts/contract-join.mjs <CONTRACT_ADDRESS>");
    console.error("Or set MIDNIGHT_CONTRACT_ADDRESS in environment.");
    process.exit(1);
  }

  const networkId = process.env.MIDNIGHT_NETWORK_ID ?? "midnight-testnet";
  const indexerUri = process.env.MIDNIGHT_INDEXER_URI ?? "https://indexer.testnet-02.midnight.network/api/v1/graphql";
  const indexerWsUri = process.env.MIDNIGHT_INDEXER_WS_URI ?? "wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws";

  console.log("=================================================");
  console.log(" Line — Midnight Contract Connection");
  console.log("=================================================");
  console.log(`Target Address:  ${address}`);
  console.log(`Network ID:      ${networkId}`);
  console.log(`Indexer URI:     ${indexerUri}`);

  console.log("\nQuerying contract state from Midnight Indexer...");
  const provider = indexerPublicDataProvider(indexerUri, indexerWsUri);

  let state;
  try {
    state = await provider.queryContractState(address);
  } catch (err) {
    console.error(`\n✗ Failed to reach indexer at ${indexerUri}:`, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (!state || !state.data) {
    console.error(`\n✗ Contract not found on-chain at address: ${address}`);
    console.error("Please verify the address or check that transaction has been finalized.");
    process.exit(1);
  }

  console.log("✓ Contract state retrieved. Decoding Line ledger...");
  let l;
  try {
    l = ledger(state.data);
  } catch (err) {
    console.error("\n✗ Contract state at address is incompatible with Line protocol schema:", err);
    process.exit(1);
  }

  const toHex = (u) => (u ? Buffer.from(u).toString("hex") : "0x0");
  const total = Number(l.totalReserve);
  const enc = Number(l.encumberedReserve);
  const red = Number(l.redeemedReserve);
  const withdrawable = Math.max(0, total - (enc + red));

  console.log("\n--- Verified Line Contract State ---");
  console.log(`Contract Domain:    0x${toHex(l.contractDomain)}`);
  console.log(`Issuer Public Key:  0x${toHex(l.issuer)}`);
  console.log(`Status:             ${l.status === 1 ? "OPEN" : l.status === 2 ? "DEFAULTED" : l.status === 3 ? "CLOSED" : "NONE"}`);
  console.log(`Action Clock:       ${l.actionClock}`);
  console.log(`Line Generation:    ${l.lineGeneration}`);
  console.log(`Total Reserve:      ${total}`);
  console.log(`Encumbered Reserve: ${enc}`);
  console.log(`Redeemed Reserve:   ${red}`);
  console.log(`Withdrawable:       ${withdrawable}`);
  console.log(`Quotes in registry: ${l.quotes?.size?.() ?? 0}`);
  console.log(`Notes in registry:  ${l.notes?.size?.() ?? 0}`);
  console.log("------------------------------------\n");

  console.log("To use this contract in the Line console, set:");
  console.log(`  export VITE_MIDNIGHT_CONTRACT_ADDRESS="${address}"`);
  console.log(`  export MIDNIGHT_CONTRACT_ADDRESS="${address}"\n`);
  console.log("✓ Contract joined and verified successfully.");
}

main().catch((err) => {
  console.error("Join failed:", err);
  process.exit(1);
});
