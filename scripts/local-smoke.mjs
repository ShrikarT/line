#!/usr/bin/env node
/**
 * Local Simulator Smoke Test
 * Exercises the complete multi-role Line protocol lifecycle on LocalDevelopmentRuntime.
 */
import { LocalDevelopmentRuntime } from "../src/lib/runtime/local.ts";
import { ISSUER_SK, MERCHANT_A_SK, MERCHANT_B_SK, AGENT_SK, MERCHANT_B_PK } from "../src/test/fixtures/keys.ts";
import { createLedger } from "../src/lib/line/protocol.ts";

async function main() {
  console.log("=================================================");
  console.log(" Line — Local Development Simulator Smoke Test");
  console.log("=================================================");

  const runtime = new LocalDevelopmentRuntime(
    createLedger({ issuerSecret: ISSUER_SK, merchantSecret: MERCHANT_A_SK })
  );
  console.log(`Runtime: ${runtime.mode} | Network: ${runtime.networkId}`);

  console.log("\n1. Registering Merchant B...");
  const regRes = await runtime.registerMerchant(MERCHANT_B_PK, ISSUER_SK);
  if (!regRes.ok) throw new Error(`Merchant registration failed: ${regRes.error}`);
  console.log(`✓ Merchant B registered. Tx: ${regRes.txHash}`);

  console.log("\n2. Funding reserve pool (500 units)...");
  const fundRes = await runtime.fundReserve(500, ISSUER_SK);
  if (!fundRes.ok) throw new Error(`Fund reserve failed: ${fundRes.error}`);
  console.log(`✓ Reserve funded. Tx: ${fundRes.txHash}`);

  console.log("\n3. Opening Line (Limit: 150, Expiry: 10000)...");
  const openRes = await runtime.openLine({
    limit: 150,
    expiry: 10000,
    callerSk: ISSUER_SK,
    agentSecret: AGENT_SK,
    salt: "salt-init",
  });
  if (!openRes.ok) throw new Error(`Open line failed: ${openRes.error}`);
  console.log(`✓ Line opened. Tx: ${openRes.txHash}`);

  console.log("\n4. Posting Quote (Amount: 40, Merchant A)...");
  const quoteRes = await runtime.postQuote({
    amount: 40,
    expiry: 2000,
    invoiceId: "inv-smoke-001",
    nonce: "nonce-q-001",
    merchantSk: MERCHANT_A_SK,
  });
  if (!quoteRes.ok) throw new Error(`Post quote failed: ${quoteRes.error}`);
  console.log(`✓ Quote posted. Tx: ${quoteRes.txHash}`);

  const status = await runtime.getStatus();
  console.log("\n--- Ledger Status ---");
  console.log(`Line Status:        ${status.status}`);
  console.log(`Action Clock:       ${status.actionClock}`);
  console.log(`Total Reserve:      ${status.totalReserve}`);
  console.log(`Quotes in registry: ${status.quoteCount}`);
  console.log("---------------------\n");

  console.log("✓ Local simulator smoke test completed successfully.");
}

main().catch((err) => {
  console.error("✗ Local smoke test failed:", err);
  process.exit(1);
});
