#!/usr/bin/env node
import { getRuntime } from "../src/lib/runtime/index.ts";

async function main() {
  console.log("=================================================");
  console.log(" Line — Midnight Network & Runtime Smoke Test");
  console.log("=================================================");

  const preferredMode = (process.env.LINE_RUNTIME ?? "local");
  console.log(`Target Runtime Mode: ${preferredMode}`);

  const runtime = getRuntime(preferredMode);
  console.log(`Active Runtime: ${runtime.mode} (Network: ${runtime.networkId})`);
  console.log(`Connected: ${runtime.isConnected() ? "YES" : "NO"}`);
  console.log(`Contract Address: ${runtime.getContractAddress() ?? "None (unjoined)"}`);

  const status = await runtime.getStatus();
  console.log("\n--- Ledger Public Status ---");
  console.log(`Contract Domain:    ${status.contractDomain}`);
  console.log(`Line Status:        ${status.status}`);
  console.log(`Action Clock:       ${status.actionClock}`);
  console.log(`Line Generation:    ${status.lineGeneration}`);
  console.log(`Total Reserve:      ${status.totalReserve}`);
  console.log(`Encumbered Reserve: ${status.encumberedReserve}`);
  console.log(`Redeemed Reserve:   ${status.redeemedReserve}`);
  console.log(`Withdrawable:       ${status.withdrawableReserve}`);
  console.log(`Quotes Count:       ${status.quoteCount}`);
  console.log(`Notes Count:        ${status.noteCount}`);
  console.log(`Nullifiers Count:   ${status.nullifierCount}`);
  console.log("----------------------------\n");

  console.log("✓ Smoke test completed successfully.");
}

main().catch((err) => {
  console.error("✗ Smoke test failed:", err);
  process.exit(1);
});
