#!/usr/bin/env node
/**
 * Midnight Contract Deployment Script
 * Deploys Line contract to Midnight network using midnight-js-contracts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { Contract } from "../contracts/managed/line/contract/index.js";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";

function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const len = clean.length;
  const bytes = new Uint8Array(len / 2);
  for (let i = 0; i < len; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

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

  if (!deployerSeed || deployerSeed.trim().length === 0) {
    console.error("\n[DEPLOYMENT BLOCKED — MISSING WALLET CREDENTIALS]");
    console.error("----------------------------------------------------------------------");
    console.error("Deploying the Line contract to an active Midnight network requires a funded");
    console.error("deployer account with sufficient tDUST to balance the deploy transaction.");
    console.error("\nTo execute an on-chain deployment, provide the following environment variables:");
    console.error("  MIDNIGHT_DEPLOYER_SEED      Funded deployer seed phrase or secret key");
    console.error("  MIDNIGHT_STORAGE_PASSWORD   (Optional) Encryption password for private state");
    console.error("  MIDNIGHT_NETWORK_ID         Target network ID (default: midnight-testnet)");
    console.error("  MIDNIGHT_NODE_URI           Midnight Substrate RPC endpoint");
    console.error("  MIDNIGHT_INDEXER_URI        Midnight GraphQL indexer endpoint");
    console.error("  MIDNIGHT_PROOF_SERVER_URI   Local or remote Midnight proof server");
    console.error("\nOnce configured, rerun:");
    console.error("  node scripts/contract-deploy.mjs");
    console.error("----------------------------------------------------------------------\n");
    process.exit(1);
  }

  console.log("\nInitializing providers for deployment...");
  const zkConfigProvider = new NodeZkConfigProvider(join(process.cwd(), "contracts/managed/line"));
  const publicDataProvider = indexerPublicDataProvider(indexerUri, indexerWsUri);
  const proofProvider = httpClientProofProvider(proofServerUri);
  const privateStatePassword = process.env.MIDNIGHT_STORAGE_PASSWORD || randomUUID();
  const privateStateProvider = levelPrivateStateProvider({
    privateStoragePassword: privateStatePassword,
    accountId: "deployer",
  });

  // Construct wallet provider bound to deployer credentials
  const walletProvider = {
    getCoinPublicKey: () => {
      return createHash("sha256").update(deployerSeed + ":coin").digest("hex");
    },
    getEncryptionPublicKey: () => {
      return createHash("sha256").update(deployerSeed + ":enc").digest("hex");
    },
    balanceTx: async (tx) => {
      throw new Error(
        "Transaction balancing requires an active Midnight wallet daemon or DApp connector connected to the network node.",
      );
    },
  };

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

  // Derive non-zero constructor parameters
  const instanceNonce = process.env.MIDNIGHT_INSTANCE_NONCE
    ? hexToBytes(process.env.MIDNIGHT_INSTANCE_NONCE)
    : Uint8Array.from(randomBytes(32));

  const issuerPk = process.env.MIDNIGHT_ISSUER_PK
    ? hexToBytes(process.env.MIDNIGHT_ISSUER_PK)
    : Uint8Array.from(createHash("sha256").update(deployerSeed + ":line:issuer").digest());

  const initialMerchantPk = process.env.MIDNIGHT_INITIAL_MERCHANT_PK
    ? hexToBytes(process.env.MIDNIGHT_INITIAL_MERCHANT_PK)
    : Uint8Array.from(createHash("sha256").update(deployerSeed + ":line:initial_merchant").digest());

  console.log("Submitting deployment to Midnight network via deployContract()...");
  const deployed = await deployContract(
    {
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      privateStateProvider,
      walletProvider,
    },
    {
      compiledContract: lineContract,
      args: [issuerPk, initialMerchantPk, instanceNonce],
    },
  );

  const deployedAddress = deployed?.deployTxData?.public?.contractAddress;
  if (!deployedAddress) {
    console.error("\n✗ Deployment failed: No contract address returned in deploy transaction data.");
    process.exit(1);
  }

  console.log("\n✓ Contract deployment submitted!");
  console.log(`Contract Address: ${deployedAddress}`);
  console.log(`Transaction ID:   ${deployed.deployTxData.public.txId}`);
  console.log(`Block Height:     ${deployed.deployTxData.public.blockHeight}`);

  console.log("\nVerifying deployed contract on-chain via indexer...");
  const queryResult = await publicDataProvider.queryContractState(deployedAddress);
  if (!queryResult || !queryResult.data) {
    console.error(`\n✗ Deployed contract verification failed: Contract not found on-chain at ${deployedAddress}`);
    process.exit(1);
  }
  console.log("✓ Deployed contract state verified on-chain via indexer.");
}

main().catch((err) => {
  console.error("\n✗ Deployment transaction failed:", err);
  process.exit(1);
});
