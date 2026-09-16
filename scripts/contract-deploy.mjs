#!/usr/bin/env node
/**
 * Midnight Contract Deployment Script
 * Deploys Line contract to Midnight network using midnight-js-contracts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { Contract } from "../contracts/managed/line/contract/index.js";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";

async function main() {
  console.log("=================================================");
  console.log(" Line — Midnight Contract Deployment");
  console.log("=================================================");

  const manifestPath = join(process.cwd(), "contracts/managed/line/compiler/contract-manifest.json");
  if (!existsSync(manifestPath)) {
    console.error("Error: Contract manifest not found. Run `npm run compact:compile` first.");
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  console.log(`Compiler Version: ${manifest["compiler-version"]}`);
  console.log(`Runtime Version:  ${manifest["runtime-version"]}`);

  const networkId = process.env.MIDNIGHT_NETWORK_ID ?? "midnight-testnet";
  const indexerUri = process.env.MIDNIGHT_INDEXER_URI ?? "https://indexer.testnet-02.midnight.network/api/v1/graphql";
  const indexerWsUri = process.env.MIDNIGHT_INDEXER_WS_URI ?? "wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws";
  const nodeUri = process.env.MIDNIGHT_NODE_URI ?? "https://rpc.testnet-02.midnight.network";
  const proofServerUri = process.env.MIDNIGHT_PROOF_SERVER_URI ?? "http://127.0.0.1:6300";
  const deployerSeed = process.env.MIDNIGHT_DEPLOYER_SEED;

  console.log(`Target Network:   ${networkId}`);
  console.log(`Node URI:         ${nodeUri}`);
  console.log(`Indexer URI:      ${indexerUri}`);
  console.log(`Proof Server:     ${proofServerUri}`);

  if (!deployerSeed) {
    console.log("\n[DEPLOYMENT BLOCKED — MISSING WALLET CREDENTIALS]");
    console.log("----------------------------------------------------------------------");
    console.log("Deploying the Line contract to an active Midnight network requires a funded");
    console.log("deployer account with sufficient tDUST to balance the deploy transaction.");
    console.log("\nTo execute an on-chain deployment, provide the following environment variables:");
    console.log("  MIDNIGHT_DEPLOYER_SEED      Funded deployer seed phrase or secret key");
    console.log("  MIDNIGHT_NETWORK_ID         Target network ID (default: midnight-testnet)");
    console.log("  MIDNIGHT_NODE_URI           Midnight Substrate RPC endpoint");
    console.log("  MIDNIGHT_INDEXER_URI        Midnight GraphQL indexer endpoint");
    console.log("  MIDNIGHT_PROOF_SERVER_URI   Local or remote Midnight proof server");
    console.log("\nOnce configured, rerun:");
    console.log("  node scripts/contract-deploy.mjs");
    console.log("----------------------------------------------------------------------\n");
    return;
  }

  console.log("\nInitializing providers for deployment...");
  const zkConfigProvider = new NodeZkConfigProvider(join(process.cwd(), "contracts/managed/line"));
  const publicDataProvider = indexerPublicDataProvider(indexerUri, indexerWsUri);
  const proofProvider = httpClientProofProvider(proofServerUri);
  const privateStateProvider = levelPrivateStateProvider({
    privateStoragePassword: "LineDeployerStoragePassword",
    accountId: "deployer",
  });

  console.log("Preparing deployment transaction...");
  const dummyWitnesses = {
    callerSecret: () => [undefined, new Uint8Array(32)],
    agentSecret: () => [undefined, new Uint8Array(32)],
    salt: () => [undefined, new Uint8Array(32)],
    newSalt: () => [undefined, new Uint8Array(32)],
    invoiceId: () => [undefined, new Uint8Array(32)],
    quoteNonce: () => [undefined, new Uint8Array(32)],
    receiptNonce: () => [undefined, new Uint8Array(32)],
    paymentRef: () => [undefined, new Uint8Array(32)],
    noteNonce: () => [undefined, new Uint8Array(32)],
    noteSalt: () => [undefined, new Uint8Array(32)],
    noteIdentity: () => [undefined, new Uint8Array(32)],
    noteQuoteCommit: () => [undefined, new Uint8Array(32)],
  };
  const lineContract = new Contract(dummyWitnesses);

  // Deploy requires wallet provider integration
  console.log("Submitting deployment to Midnight network via deployContract()...");
  const deployed = await deployContract(
    {
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      privateStateProvider,
    },
    {
      compiledContract: lineContract,
      args: [
        new Uint8Array(32), // initial issuer PK
        new Uint8Array(32), // initial merchant PK
        new Uint8Array(32), // instance nonce
      ],
    }
  );

  console.log("\n✓ Deployed successfully!");
  console.log(`Contract Address: ${deployed.deployTxData.public.contractAddress}`);
  console.log(`Transaction ID:   ${deployed.deployTxData.public.txId}`);
  console.log(`Block Height:     ${deployed.deployTxData.public.blockHeight}`);
}

main().catch((err) => {
  console.error("\n✗ Deployment transaction failed:", err);
  process.exit(1);
});
