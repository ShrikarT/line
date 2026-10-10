#!/usr/bin/env node
/**
 * Midnight Contract Deployment Script
 *
 * Deploys the Line contract to Midnight Preprod using midnight-js-contracts and
 * the Midnight wallet SDK (WalletFacade) for balancing + DUST fee payment.
 *
 * Required env:
 *   MIDNIGHT_DEPLOYER_MNEMONIC   24-word BIP-39 phrase of a funded wallet
 *                                (legacy alias: MIDNIGHT_DEPLOYER_SEED)
 *
 * Optional env:
 *   LINE_ZK_DIR                  Directory with full ZK artifacts (keys/, zkir/, contract/)
 *                                produced by a validated full release. Default: current-release.json pointer
 *   MIDNIGHT_NETWORK_ID          default "preprod"
 *   MIDNIGHT_INDEXER_URI / MIDNIGHT_INDEXER_WS_URI / MIDNIGHT_NODE_URI / MIDNIGHT_PROOF_SERVER_URI
 *   MIDNIGHT_ISSUER_PK / MIDNIGHT_INITIAL_MERCHANT_PK / MIDNIGHT_INSTANCE_NONCE  (32-byte hex)
 *   MIDNIGHT_STORAGE_PASSWORD    private state encryption password
 *   MIDNIGHT_DUST_CACHE          path for the serialized DUST wallet cache
 *                                (default .midnight-cache/dust-state.json) — avoids a ~1h re-sync
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { resolveContractRelease, validateContractArtifacts } from "./contract-artifacts.mjs";
import { resolveMidnightEndpoints, assertEndpointCredentials, redactEndpoint, sanitizeServiceError } from "../src/lib/runtime/endpoints.ts";
import { pathToFileURL } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { issuerPublicKey, merchantPublicKey } from "../src/lib/line/encoding.ts";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import {
  WalletFacade,
  HDWallet,
  Roles,
  ShieldedWallet,
  UnshieldedWallet,
  DustWallet,
  createKeystore,
  PublicKey,
} from "@midnight-ntwrk/wallet-sdk";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { mnemonicToSeed } from "@scure/bip39";
import { ApiPromise, HttpProvider } from "@polkadot/api";
import { u8aToHex } from "@polkadot/util";

function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstState = (facade) =>
  new Promise((resolve) => {
    const sub = facade.state().subscribe((s) => {
      sub.unsubscribe();
      resolve(s);
    });
  });

async function main() {
  console.log("=================================================");
  console.log(" Line — Midnight Contract Deployment");
  console.log("=================================================");

  const zkDir = process.env.LINE_ZK_DIR ? resolve(process.env.LINE_ZK_DIR) : resolveContractRelease();
  const { compilerInfo } = validateContractArtifacts({ artifactDir: zkDir });
  const { Contract } = await import(pathToFileURL(join(zkDir, "contract/index.js")).href);
  console.log(`Compiler Version: ${compilerInfo["compiler-version"]}`);
  console.log(`Runtime Version:  ${compilerInfo["runtime-version"]}`);
  const endpoints = resolveMidnightEndpoints({
    networkId: process.env.MIDNIGHT_NETWORK_ID,
    blockfrostProjectId: process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID,
    indexerUri: process.env.MIDNIGHT_INDEXER_URI,
    indexerWsUri: process.env.MIDNIGHT_INDEXER_WS_URI,
    nodeUri: process.env.MIDNIGHT_NODE_URI,
    proofServerUri: process.env.MIDNIGHT_PROOF_SERVER_URI,
  });
  assertEndpointCredentials(endpoints);
  const { networkId, indexerUri, indexerWsUri, nodeUri, proofServerUri } = endpoints;
  const mnemonic = (process.env.MIDNIGHT_DEPLOYER_MNEMONIC ?? process.env.MIDNIGHT_DEPLOYER_SEED ?? "").trim();
  const dustCachePath = join(process.cwd(), process.env.MIDNIGHT_DUST_CACHE ?? ".midnight-cache/dust-state.json");

  console.log(`Target Network:   ${networkId}`);
  console.log(`Node URI:         ${redactEndpoint(nodeUri)}`);
  console.log(`Indexer URI:      ${redactEndpoint(indexerUri)}`);
  console.log(`Proof Server:     ${redactEndpoint(proofServerUri)}`);
  console.log(`ZK artifacts:     ${zkDir}`);

  if (mnemonic.split(/\s+/).length !== 24) {
    console.error("\n[DEPLOYMENT BLOCKED] Set MIDNIGHT_DEPLOYER_MNEMONIC to the funded wallet's 24-word recovery phrase.");
    process.exit(1);
  }

  const exactPublicKey = (name, fallback) => {
    const value = process.env[name]?.trim().replace(/^0x/, "");
    if (value) {
      if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error(`${name} must be an explicit 32-byte public key hex.`);
      return hexToBytes(value);
    }
    return fallback();
  };
  const issuerPk = exactPublicKey("MIDNIGHT_ISSUER_PK", () => {
    const sk = new Uint8Array(createHash("sha256").update(mnemonic + ":line:issuer").digest());
    return issuerPublicKey(sk);
  });
  const initialMerchantPk = exactPublicKey("MIDNIGHT_INITIAL_MERCHANT_PK", () => {
    const sk = new Uint8Array(createHash("sha256").update(mnemonic + ":line:initial_merchant").digest());
    return merchantPublicKey(sk);
  });
  const instanceNonce = process.env.MIDNIGHT_INSTANCE_NONCE
    ? exactPublicKey("MIDNIGHT_INSTANCE_NONCE", () => Uint8Array.from(randomBytes(32)))
    : Uint8Array.from(randomBytes(32));
  const storagePassword = process.env.MIDNIGHT_STORAGE_PASSWORD ||
    `${createHash("sha256").update(mnemonic + ":storage").digest("hex").slice(0, 20)}Aa1!`;

  console.log(`Issuer PK:        ${Buffer.from(issuerPk).toString("hex")}`);
  console.log(`Merchant PK:      ${Buffer.from(initialMerchantPk).toString("hex")}`);
  console.log(`Instance Nonce:   ${Buffer.from(instanceNonce).toString("hex")}`);

  setNetworkId(networkId);

  console.log("Connecting Substrate HTTP RPC API...");
  const api = await ApiPromise.create({ provider: new HttpProvider(nodeUri), noInitWarn: true });
  console.log(`✓ Connected to Substrate Node (genesis: ${api.genesisHash.toHex()})`);

  // ── Wallet (HD keys → WalletFacade) ───────────────────────────────────────
  const seed = await mnemonicToSeed(mnemonic);
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== "seedOk") throw new Error("HDWallet seed derivation failed");
  const account = hd.hdWallet.selectAccount(0);
  const zswapSecretKeys = ledger.ZswapSecretKeys.fromSeed(account.selectRole(Roles.Zswap).deriveKeyAt(0).key);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(account.selectRole(Roles.Dust).deriveKeyAt(0).key);
  const unshieldedKeystore = createKeystore(account.selectRole(Roles.NightExternal).deriveKeyAt(0).key, networkId);
  const unshieldedPublicKey = PublicKey.fromKeyStore(unshieldedKeystore);
  const dustParameters = ledger.LedgerParameters.initialParameters().dust;

  const configuration = {
    networkId,
    indexerClientConnection: { indexerHttpUrl: indexerUri, indexerWsUrl: indexerWsUri },
    relayURL: new URL(nodeUri.replace(/^http/, "ws")),
    provingServerUrl: new URL(proofServerUri),
    // Large batches: the DUST event stream is ~1.6M events; default batching is far too slow.
    batchUpdates: { size: 5000, timeout: 50, spacing: 0 },
    costParameters: {
      feeBlocksMargin: 5,
      additionalFeeOverhead: 0n,
    },
  };

  let restoredDust = null;
  if (existsSync(dustCachePath)) {
    try {
      restoredDust = readFileSync(dustCachePath, "utf8");
      console.log(`Restoring DUST wallet cache from ${dustCachePath}`);
    } catch {
      restoredDust = null;
    }
  }

  const buildFacade = (useCache) =>
    WalletFacade.init({
      configuration,
      submissionService: () => ({
        submitTransaction: async () => {},
        close: async () => {},
      }),
      shielded: (config) => ShieldedWallet(config).startWithSecretKeys(zswapSecretKeys),
      unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(unshieldedPublicKey),
      dust: (config) =>
        useCache && restoredDust
          ? DustWallet(config).restore(restoredDust)
          : DustWallet(config).startWithSecretKey(dustSecretKey, dustParameters),
    });

  console.log("\nInitializing wallet facade...");
  let facade;
  try {
    facade = await buildFacade(true);
  } catch (err) {
    console.warn("DUST cache restore failed, falling back to full sync:", err?.message ?? err);
    facade = await buildFacade(false);
  }
  await facade.start(zswapSecretKeys, dustSecretKey);

  console.log("Syncing wallet (first run takes ~1h for DUST history; cached afterwards)...");
  const t0 = Date.now();
  for (;;) {
    const s = await firstState(facade);
    const applied = s.dust.progress?.appliedIndex ?? 0n;
    const highest = s.dust.progress?.highestRelevantWalletIndex ?? 0n;
    const night = Object.keys(s.unshielded?.balances ?? {}).length > 0;
    const dust = s.dust.balance(new Date());
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] dust ${applied}/${highest} | night:${night} | dustBalance:${dust}`);
    if (highest > 0n && applied >= highest && night) {
      if (dust === 0n) {
        console.error("\nWallet is synced but has 0 DUST. Register NIGHT UTXOs for DUST generation first.");
        await facade.stop();
        process.exit(1);
      }
      break;
    }
    await sleep(15000);
  }

  try {
    mkdirSync(dirname(dustCachePath), { recursive: true });
    writeFileSync(dustCachePath, await facade.dust.serializeState());
    console.log(`DUST wallet cache written to ${dustCachePath}`);
  } catch (err) {
    console.warn("Could not write DUST cache (continuing):", err?.message ?? err);
  }

  // ── Providers ─────────────────────────────────────────────────────────────
  const zkConfigProvider = new NodeZkConfigProvider(zkDir);
  const publicDataProvider = indexerPublicDataProvider(indexerUri, indexerWsUri);
  const rawProofProvider = httpClientProofProvider(proofServerUri, zkConfigProvider);
  const proofProvider = {
    proveTx: async (unprovenTx) => {
      console.log("\n[1/4] Generating zero-knowledge proof for constructor via proof server (http://127.0.0.1:6300)...");
      const t = Date.now();
      const proven = await rawProofProvider.proveTx(unprovenTx);
      console.log(`✓ Proof generated successfully in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      return proven;
    },
  };
  const privateStateProvider = levelPrivateStateProvider({
    privateStoragePasswordProvider: () => storagePassword,
    accountId: "deployer",
  });

  const walletProvider = {
    getCoinPublicKey: () => zswapSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => zswapSecretKeys.encryptionPublicKey,
    balanceTx: async (unboundTx, ttl) => {
      console.log("\n[2/4] Balancing transaction and allocating DUST fees...");
      const t = Date.now();
      const recipe = await facade.balanceUnboundTransaction(
        unboundTx,
        { shieldedSecretKeys: zswapSecretKeys, dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const finalized = await facade.finalizeRecipe(recipe);
      console.log(`✓ Transaction balanced with DUST fees in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      return finalized;
    },
  };

  const midnightProvider = {
    submitTx: async (tx) => {
      console.log("\n[3/4] Submitting extrinsic to Midnight Preprod node via HTTP JSON-RPC...");
      const extHex = api.tx.midnight.sendMnTransaction(u8aToHex(tx.serialize())).toHex();
      const res = await fetch(nodeUri, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "author_submitExtrinsic", params: [extHex] }),
      });
      const json = await res.json();
      if (json.error) throw new Error(`RPC Error (${json.error.code}): ${json.error.message} - ${json.error.data}`);
      console.log(`✓ Extrinsic submitted! Hash: ${json.result}`);
      console.log("\n[4/4] Watching for inclusion and block finality on-chain...");
      return tx.identifiers().at(-1);
    },
  };

  // ── Contract + constructor args ───────────────────────────────────────────
  // Witnesses are never executed by the constructor; vacant placeholders satisfy the type.
  const zeroBytes = () => [undefined, new Uint8Array(32)];
  const zeroBig = () => [undefined, 0n];
  const witnesses = {
    callerSecret: zeroBytes, agentSecret: zeroBytes, salt: zeroBytes, newSalt: zeroBytes,
    invoiceId: zeroBytes, quoteNonce: zeroBytes, receiptNonce: zeroBytes, paymentRef: zeroBytes,
    noteNonce: zeroBytes, noteSalt: zeroBytes, noteIdentity: zeroBytes, noteQuoteCommit: zeroBytes,
    quoteMerchantPk: zeroBytes,
    lineLimit: zeroBig, lineOutstanding: zeroBig, lineEpoch: zeroBig, quoteAmount: zeroBig,
    drawAmount: zeroBig, redeemAmount: zeroBig, repayAmount: zeroBig,
  };
  const compiledContract = CompiledContract.make("line", Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(zkDir),
  );


  console.log("\nSubmitting deployment via deployContract() (proving → balancing → submit → watch)...");
  const deployed = await deployContract(
    { publicDataProvider, zkConfigProvider, proofProvider, privateStateProvider, walletProvider, midnightProvider },
    { compiledContract, args: [issuerPk, initialMerchantPk, instanceNonce] },
  );

  const pub = deployed.deployTxData.public;
  console.log("\n✓ Contract deployed!");
  console.log(`Contract Address: ${pub.contractAddress}`);
  console.log(`Transaction ID:   ${pub.txId}`);
  console.log(`Transaction Hash: ${pub.txHash}`);
  console.log(`Block Height:     ${pub.blockHeight}`);
  console.log(`Instance Nonce:   ${Buffer.from(instanceNonce).toString("hex")}`);

  const queryResult = await publicDataProvider.queryContractState(pub.contractAddress);
  if (!queryResult) {
    console.error(`\n✗ Verification failed: contract not found by indexer at ${pub.contractAddress}`);
    process.exit(1);
  }
  console.log("✓ Contract state verified on-chain via indexer.");

  await facade.stop();
  await api.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Deployment failed:", sanitizeServiceError(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
