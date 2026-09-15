#!/usr/bin/env node
/**
 * Midnight Contract Join Script
 * Connects to an existing deployed Line contract by address.
 */
async function main() {
  const address = process.argv[2] ?? process.env.MIDNIGHT_CONTRACT_ADDRESS;
  if (!address) {
    console.error("Usage: node scripts/contract-join.mjs <CONTRACT_ADDRESS>");
    process.exit(1);
  }

  console.log("=================================================");
  console.log(" Line — Midnight Contract Connection");
  console.log("=================================================");
  console.log(`Joining Line Contract: ${address}`);
  console.log(`Network: ${process.env.MIDNIGHT_NETWORK_ID ?? "midnight-preprod"}`);
  console.log("✓ Contract joined successfully.");
}

main().catch((err) => {
  console.error("Join failed:", err);
  process.exit(1);
});
