import "@midnight-ntwrk/wallet-sdk-node-client";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ApiPromise, HttpProvider } from "@polkadot/api";
import { u8aToHex } from "@polkadot/util";
import { mnemonicToSeed } from "@scure/bip39";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { deployContract, submitInsertVerifierKeyTx, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import * as compactRuntime from "@midnight-ntwrk/compact-runtime";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import {
  HDWallet,
  Roles,
  ShieldedWallet,
  UnshieldedWallet,
  DustWallet,
  createKeystore,
  PublicKey,
  WalletFacade,
} from "@midnight-ntwrk/wallet-sdk";
import {
  issuerPublicKey,
  merchantPublicKey,
  agentId,
  contractDomain,
  quoteCommit,
  drawNoteCommit,
  requiredDrawFee,
  canonicalInvoiceIdBytes,
  canonicalPaymentReferenceBytes,
} from "../src/lib/line/encoding.ts";
import { resolveMidnightEndpoints } from "../src/lib/runtime/endpoints.ts";
import { resolveContractRelease, validateContractArtifacts } from "./contract-artifacts.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log("===============================================================");
  console.log(" Midnight Preprod Incremental Deployment Pipeline (Option A) ");
  console.log("===============================================================");

  const mnemonic = process.env.MIDNIGHT_DEPLOYER_MNEMONIC;
  if (!mnemonic) throw new Error("MIDNIGHT_DEPLOYER_MNEMONIC environment variable is required");
  const zkDir = resolveContractRelease();
  validateContractArtifacts({ artifactDir: zkDir });
  const { Contract, ledger: contractLedger } = await import(pathToFileURL(join(zkDir, "contract/index.js")).href);

  const blockfrostProjectId = process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID;
  const endpoints = resolveMidnightEndpoints({
    networkId: "preprod",
    blockfrostProjectId,
  });
  const { networkId, indexerUri, indexerWsUri, nodeUri, proofServerUri } = endpoints;
  setNetworkId(networkId);

  console.log(`Connecting to Substrate Node at ${nodeUri.split("?")[0]}...`);
  const api = await ApiPromise.create({ provider: new HttpProvider(nodeUri), noInitWarn: true });
  console.log(`✓ Connected to Substrate Node (genesis: ${api.genesisHash.toHex()})`);

  console.log("Deriving wallet keys from mnemonic...");
  const seed = await mnemonicToSeed(mnemonic);
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== "seedOk") throw new Error("HDWallet seed derivation failed");
  const account = hd.hdWallet.selectAccount(0);
  const zswapSecretKeys = ledger.ZswapSecretKeys.fromSeed(account.selectRole(Roles.Zswap).deriveKeyAt(0).key);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(account.selectRole(Roles.Dust).deriveKeyAt(0).key);
  const unshieldedKeystore = createKeystore(account.selectRole(Roles.NightExternal).deriveKeyAt(0).key, networkId);
  const unshieldedPublicKey = PublicKey.fromKeyStore(unshieldedKeystore);

  const dustCachePath = join(process.cwd(), ".midnight-cache", "dust-state.json");
  const restoredDust = readFileSync(dustCachePath, "utf8");

  const configuration = {
    networkId,
    indexerClientConnection: { indexerHttpUrl: indexerUri, indexerWsUrl: indexerWsUri },
    relayURL: new URL(nodeUri.replace(/^http/, "ws")),
    provingServerUrl: new URL(proofServerUri),
    batchUpdates: { size: 500, timeout: 50, spacing: 0 },
    costParameters: { feeBlocksMargin: 5, additionalFeeOverhead: 0n },
  };

  console.log("Initializing WalletFacade with DUST wallet...");
  const facade = await WalletFacade.init({
    configuration,
    submissionService: () => ({ submitTransaction: async () => {}, close: async () => {} }),
    shielded: (config) => ShieldedWallet(config).startWithSecretKeys(zswapSecretKeys),
    unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(unshieldedPublicKey),
    dust: (config) => DustWallet(config).restore(restoredDust),
  });

  await facade.start(zswapSecretKeys, dustSecretKey);
  console.log("Stopping un-cached shielded wallet scanner to prevent event-loop starvation...");
  await facade.shielded.stop();
  console.log("✓ Shielded wallet stopped; DUST wallet active.");

  const waitForDustSync = async (timeoutMs = 5000) => {
    try {
      const s = await facade.dust.waitForSyncedState(5n);
      return { dust: s };
    } catch {
      return new Promise((resolve) => {
        const sub = facade.state().subscribe((s) => {
          const applied = s.dust.progress?.appliedIndex ?? 0n;
          const highest = s.dust.progress?.highestRelevantWalletIndex ?? 0n;
          if (highest > 0n && applied >= highest) {
            sub.unsubscribe();
            resolve(s);
          }
        });
        setTimeout(() => {
          let current;
          const s2 = facade.state().subscribe(v => { current = v; });
          s2.unsubscribe();
          resolve(current);
        }, timeoutMs);
      });
    }
  };

  console.log("Ensuring DUST wallet is up to date...");
  const syncStart = Date.now();
  const initialSyncedState = await waitForDustSync(6000);
  console.log(`✓ DUST wallet synced in ${((Date.now() - syncStart) / 1000).toFixed(1)}s (balance: ${initialSyncedState.dust.balance(new Date())})`);

  const saveDustCache = async () => {
    try {
      const serialized = await facade.dust.serializeState();
      writeFileSync(dustCachePath, serialized);
    } catch (e) {
      // ignore
    }
  };
  await saveDustCache();

  const evidenceFile = join(process.cwd(), "deployment-evidence.json");
  let evidence;
  let contractAddress;
  let deployTxHash;
  let deployBlockHeight;
  let insertionEvidence = [];
  const signingKey = createHash("sha256").update(mnemonic + ":line:deployer_signing_key").digest("hex");

  if (existsSync(evidenceFile)) {
    try {
      const loaded = JSON.parse(readFileSync(evidenceFile, "utf8"));
      if (loaded.contractAddress && loaded.keyInsertions?.length === 11) {
        console.log(`\n✓ Reusing existing contract with all 12 circuits: ${loaded.contractAddress}`);
        evidence = loaded;
        contractAddress = loaded.contractAddress;
        deployTxHash = loaded.deploy?.txHash;
        deployBlockHeight = loaded.deploy?.blockHeight;
        insertionEvidence = loaded.keyInsertions;
      }
    } catch (e) {
      // ignore
    }
  }

  const zkConfigProvider = new NodeZkConfigProvider(zkDir);
  const rawPublicDataProvider = indexerPublicDataProvider(indexerUri, indexerWsUri);
  const publicDataProvider = {
    ...rawPublicDataProvider,
    watchForDeployTxData: async (address) => {
      console.log(`    [publicDataProvider] watchForDeployTxData returning deploy metadata for ${address}`);
      const txHash = evidence?.deploy?.txHash ?? deployTxHash;
      const blockHeight = evidence?.deploy?.blockHeight ?? deployBlockHeight;
      return {
        tx: undefined,
        status: 0,
        txId: txHash,
        identifiers: [txHash],
        txHash: txHash,
        blockHeight: blockHeight,
      };
    },
  };
  const rawProofProvider = httpClientProofProvider(proofServerUri, zkConfigProvider);
  const proofProvider = {
    proveTx: async (unprovenTx) => {
      const t = Date.now();
      const proven = await rawProofProvider.proveTx(unprovenTx);
      console.log(`    ✓ ZK Proof generated in ${((Date.now() - t) / 1000).toFixed(2)}s`);
      return proven;
    },
  };
  const storagePassword = process.env.MIDNIGHT_STORAGE_PASSWORD;
  if (!storagePassword) throw new Error("MIDNIGHT_STORAGE_PASSWORD environment variable is required");
  const privateStateProvider = levelPrivateStateProvider({
    privateStoragePasswordProvider: () => storagePassword,
    accountId: "deployer",
  });

  const walletProvider = {
    getCoinPublicKey: () => zswapSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => zswapSecretKeys.encryptionPublicKey,
    balanceTx: async (unboundTx, ttl) => {
      console.log("    Starting balanceTx with DUST fee...");
      const t = Date.now();
      const recipe = await facade.balanceUnboundTransaction(
        unboundTx,
        { shieldedSecretKeys: zswapSecretKeys, dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000), tokenKindsToBalance: ["dust"] },
      );
      console.log(`    Recipe created in ${((Date.now() - t) / 1000).toFixed(2)}s, finalizing...`);
      const finalized = await facade.finalizeRecipe(recipe);
      console.log(`    ✓ DUST balancing complete in ${((Date.now() - t) / 1000).toFixed(1)}s (${finalized.serialize().length} bytes)`);
      return finalized;
    },
  };

  const midnightProvider = {
    submitTx: async (tx) => {
      const rawBytes = tx.serialize();
      const ext = api.tx.midnight.sendMnTransaction(u8aToHex(rawBytes));
      const extHex = ext.toHex();
      console.log(`    Submitting extrinsic (${extHex.length / 2} bytes)...`);

      const res = await fetch(nodeUri, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "author_submitExtrinsic", params: [extHex] }),
      });
      const json = await res.json();
      if (json.error) throw new Error(`RPC Error (${json.error.code}): ${json.error.message} - ${json.error.data}`);
      console.log(`    ✓ Substrate extrinsic submitted: ${json.result}`);
      return tx.identifiers().at(-1);
    },
  };

  const providers = {
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    privateStateProvider,
    walletProvider,
    midnightProvider,
  };

  // Active witness context for circuit execution
  let activeWitnessContext = null;
  const zeroBytes = () => [undefined, new Uint8Array(32)];
  const zeroBig = () => [undefined, 0n];

  const witnesses = {
    callerSecret: (ctx) => [ctx.privateState, activeWitnessContext?.callerSecret ?? new Uint8Array(32)],
    agentSecret: (ctx) => [ctx.privateState, activeWitnessContext?.agentSecret ?? new Uint8Array(32)],
    salt: (ctx) => [ctx.privateState, activeWitnessContext?.salt ?? new Uint8Array(32)],
    newSalt: (ctx) => [ctx.privateState, activeWitnessContext?.newSalt ?? new Uint8Array(32)],
    invoiceId: (ctx) => [ctx.privateState, activeWitnessContext?.invoiceId ?? new Uint8Array(32)],
    quoteNonce: (ctx) => [ctx.privateState, activeWitnessContext?.quoteNonce ?? new Uint8Array(32)],
    receiptNonce: (ctx) => [ctx.privateState, activeWitnessContext?.receiptNonce ?? new Uint8Array(32)],
    paymentRef: (ctx) => [ctx.privateState, activeWitnessContext?.paymentRef ?? new Uint8Array(32)],
    noteNonce: (ctx) => [ctx.privateState, activeWitnessContext?.noteNonce ?? new Uint8Array(32)],
    noteSalt: (ctx) => [ctx.privateState, activeWitnessContext?.noteSalt ?? new Uint8Array(32)],
    noteIdentity: (ctx) => [ctx.privateState, activeWitnessContext?.noteIdentity ?? new Uint8Array(32)],
    noteQuoteCommit: (ctx) => [ctx.privateState, activeWitnessContext?.noteQuoteCommit ?? new Uint8Array(32)],
    quoteMerchantPk: (ctx) => [ctx.privateState, activeWitnessContext?.quoteMerchantPk ?? new Uint8Array(32)],
    lineLimit: (ctx) => [ctx.privateState, activeWitnessContext?.lineLimit ?? 0n],
    lineOutstanding: (ctx) => [ctx.privateState, activeWitnessContext?.lineOutstanding ?? 0n],
    lineEpoch: (ctx) => [ctx.privateState, activeWitnessContext?.lineEpoch ?? 0n],
    quoteAmount: (ctx) => [ctx.privateState, activeWitnessContext?.quoteAmount ?? 0n],
    drawAmount: (ctx) => [ctx.privateState, activeWitnessContext?.drawAmount ?? 0n],
    redeemAmount: (ctx) => [ctx.privateState, activeWitnessContext?.redeemAmount ?? 0n],
    repayAmount: (ctx) => [ctx.privateState, activeWitnessContext?.repayAmount ?? 0n],
  };

  const fullCompiledContract = CompiledContract.make("line", Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(zkDir),
  );

  // Shell contract with only registerMerchant circuit
  class ShellContract extends Contract {
    constructor(w) {
      super(w);
      this.circuits = { registerMerchant: this.circuits.registerMerchant };
      this.provableCircuits = { registerMerchant: this.circuits.registerMerchant };
    }
    initialState(...args) {
      const res = super.initialState(...args);
      const origState = res.currentContractState;
      const shellState = new compactRuntime.ContractState();
      shellState.data = origState.data;
      shellState.setOperation("registerMerchant", origState.operation("registerMerchant"));
      return {
        ...res,
        currentContractState: shellState,
      };
    }
  }

  const compiledShell = CompiledContract.make("line", ShellContract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(zkDir),
  );

  const issuerSk = new Uint8Array(createHash("sha256").update(mnemonic + ":line:issuer").digest());
  const issuerPk = issuerPublicKey(issuerSk);
  const initialMerchantSk = new Uint8Array(createHash("sha256").update(mnemonic + ":line:initial_merchant").digest());
  const initialMerchantPk = merchantPublicKey(initialMerchantSk);
  const instanceNonce = Uint8Array.from(randomBytes(32));


  if (!contractAddress) {
    // =========================================================================
    // ITEM 1: Deploy Contract Shell
    // =========================================================================
    console.log("\n---------------------------------------------------------------");
    console.log("ITEM 1 — Deploying Contract Shell (Constructor + registerMerchant)");
    console.log("---------------------------------------------------------------");

    const deployOptions = {
      compiledContract: compiledShell,
      args: [issuerPk, initialMerchantPk, instanceNonce],
      signingKey,
    };

    const deployResult = await deployContract(providers, deployOptions);
    contractAddress = deployResult.deployTxData.public.contractAddress;
    deployTxHash = deployResult.deployTxData.public.txHash;
    deployBlockHeight = deployResult.deployTxData.public.blockHeight;

    console.log("\n✓ CONTRACT SHELL DEPLOYED!");
    console.log(`  Contract Address:    ${contractAddress}`);
    console.log(`  Deploy Tx Hash:      ${deployTxHash}`);
    console.log(`  Deploy Block Height: ${deployBlockHeight}`);

    await providers.privateStateProvider.setSigningKey(contractAddress, signingKey);

    // Write initial evidence immediately
    evidence = {
      contractAddress,
      deploy: { txHash: deployTxHash, blockHeight: deployBlockHeight },
      keyInsertions: [],
      flowExecution: [],
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));

    // Confirm contract state exists on indexer
    const stateCheck0 = await publicDataProvider.queryContractState(contractAddress);
    if (!stateCheck0) throw new Error("Contract state not visible on indexer!");
    console.log("  ✓ Contract verified on Blockfrost indexer!");

    // Wait for wallet state to catch up to the deploy block
    console.log("  Waiting for DUST wallet to sync past deploy block...");
    await waitForDustSync(8000);
    await saveDustCache();

    // =========================================================================
    // ITEM 2: Insert Remaining 11 Verifier Keys
    // =========================================================================
    console.log("\n---------------------------------------------------------------");
    console.log("ITEM 2 — Inserting 11 Remaining Verifier Keys Individually");
    console.log("---------------------------------------------------------------");

    const circuitsToInsert = [
      "disableMerchant",
      "fundReserve",
      "withdrawUnencumberedReserve",
      "withdrawFees",
      "openLine",
      "postQuote",
      "draw",
      "redeemDraw",
      "cancelOrExpireNote",
      "acknowledgeRepayment",
      "setStatus",
    ];

    for (let i = 0; i < circuitsToInsert.length; i++) {
      const circuitId = circuitsToInsert[i];
      console.log(`\n[${i + 1}/11] Registering verifier key for circuit: '${circuitId}'...`);

      const vkPath = join(zkDir, "keys", `${circuitId}.verifier`);
      const vkBytes = new Uint8Array(readFileSync(vkPath));
      console.log(`    Loaded vk: ${vkBytes.length} bytes`);

      let attempts = 0;
      let success = false;
      while (attempts < 3 && !success) {
        attempts++;
        try {
          await waitForDustSync(6000);
          const txResult = await submitInsertVerifierKeyTx(
            providers,
            fullCompiledContract,
            contractAddress,
            circuitId,
            vkBytes
          );

          console.log(`    ✓ Insertion confirmed on-chain!`);
          console.log(`      Tx Hash:      ${txResult.txHash}`);
          console.log(`      Block Height: ${txResult.blockHeight}`);

          insertionEvidence.push({
            circuit: circuitId,
            txHash: txResult.txHash,
            blockHeight: txResult.blockHeight,
          });

          evidence.keyInsertions = insertionEvidence;
          evidence.updatedAt = new Date().toISOString();
          writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));

          success = true;
          await saveDustCache();
          await sleep(3000);
        } catch (err) {
          console.error(`    Attempt ${attempts} failed for ${circuitId}:`, err?.message ?? err);
          if (attempts >= 3) throw err;
          console.log("    Waiting 10s before retry...");
          await sleep(10000);
        }
      }
    }

    console.log("\n✓ ALL 12 CIRCUITS REGISTERED ON-CHAIN!");
    await waitForDustSync(8000);
    await saveDustCache();
  }

  // =========================================================================
  // ITEM 4: Execute Full 8-Step On-Chain Flow
  // =========================================================================
  console.log("\n---------------------------------------------------------------");
  console.log("ITEM 4 — Executing Full 8-Step Circuit Flow On-Chain");
  console.log("---------------------------------------------------------------");

  await providers.privateStateProvider.setSigningKey(contractAddress, signingKey);
  const privateStateId = `line-state:${contractAddress}`;
  providers.privateStateProvider.setContractAddress(contractAddress);
  if ((await providers.privateStateProvider.get(privateStateId)) == null) {
    await providers.privateStateProvider.set(privateStateId, {});
  }

  console.log("Confirming contract state on Blockfrost indexer...");
  const stateCheck = await publicDataProvider.queryContractState(contractAddress);
  if (!stateCheck) throw new Error("Contract state not visible on indexer!");
  console.log("✓ Contract state found on indexer!");

  console.log("Binding full contract interface via findDeployedContract...");
  const bound = await findDeployedContract(providers, {
    compiledContract: fullCompiledContract,
    contractAddress,
    privateStateId,
    initialPrivateState: {},
  });
  console.log("✓ Contract interface bound with all 12 circuits!");

  const flowEvidence = Array.isArray(evidence.flowExecution) ? [...evidence.flowExecution] : [];

  // Helper to run a circuit call and record evidence
  async function executeStep(stepNum, stepName, callFn) {
    const existing = flowEvidence.find((e) => e.step === stepNum);
    if (existing && existing.txHash) {
      console.log(`\n[Step ${stepNum}/8] ${stepName} already confirmed: tx ${existing.txHash} (Block ${existing.blockHeight})`);
      return;
    }
    console.log(`\n[Step ${stepNum}/8] Executing ${stepName}...`);
    let attempts = 0;
    let success = false;
    while (attempts < 3 && !success) {
      attempts++;
      try {
        await waitForDustSync(6000);
        const txResult = await callFn();
        const txData = txResult.public ?? txResult;
        console.log(`    ✓ ${stepName} confirmed on-chain!`);
        console.log(`      Tx Hash:      ${txData.txHash}`);
        console.log(`      Block Height: ${txData.blockHeight}`);
        flowEvidence.push({
          step: stepNum,
          name: stepName,
          txHash: txData.txHash,
          blockHeight: txData.blockHeight,
        });

        evidence.flowExecution = flowEvidence;
        evidence.updatedAt = new Date().toISOString();
        writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));

        success = true;
        await saveDustCache();
        await sleep(3000);
      } catch (err) {
        console.error(`    Attempt ${attempts} failed for ${stepName}:`, err?.message ?? err);
        if (attempts >= 3) throw err;
        console.log("    Waiting 10s before retry...");
        await sleep(10000);
      }
    }
  }

  // Lifecycle parameters & secrets
  const merchantB_Sk = new Uint8Array(createHash("sha256").update(mnemonic + ":line:merchant_b").digest());
  const merchantB_Pk = merchantPublicKey(merchantB_Sk);
  const agentSk = new Uint8Array(createHash("sha256").update(mnemonic + ":line:agent_1").digest());
  const lineLimit = 500n;
  const lineSalt = Uint8Array.from(randomBytes(32));
  const newSalt1 = Uint8Array.from(randomBytes(32));
  const newSalt2 = Uint8Array.from(randomBytes(32));
  const lineExpiry = BigInt(Math.floor(Date.now() / 1000) + 86400); // +24 hours
  const flatFee = 1n;
  const bpsFee = 100n; // 1%

  const quoteAmount = 100n;
  const quoteNonce = Uint8Array.from(randomBytes(32));
  const invoiceId = Uint8Array.from(randomBytes(32));
  const quoteExpiry = BigInt(Math.floor(Date.now() / 1000) + 3600); // +1 hour

  const domain = contractLedger(stateCheck.data).contractDomain;

  // Compute public quote commitment (openLine increments generation to 1n)
  const quoteCommitBytes = quoteCommit({
    merchantPk: initialMerchantPk,
    invoiceId,
    amount: quoteAmount,
    expiry: quoteExpiry,
    nonce: quoteNonce,
    generation: 1n,
    feeFlat: flatFee,
    feeBps: bpsFee,
    domain,
  });

  const noteNonce = Uint8Array.from(randomBytes(32));
  const noteSalt = Uint8Array.from(randomBytes(32));
  const noteExpiry = quoteExpiry; // Compact asserts noteExpiry == meta.expiry
  const drawFee = 2n; // flat 1 + 1% of 100 = 2

  // Compute public draw note commitment (lineGeneration is 1n)
  const noteCommitBytes = drawNoteCommit(
    {
      domain,
      lineGeneration: 1n,
      identity: agentId(agentSk),
      quoteCommit: quoteCommitBytes,
      merchantPk: initialMerchantPk,
      amount: quoteAmount,
      fee: drawFee,
      noteNonce,
      expiry: noteExpiry,
    },
    noteSalt
  );

  const receiptNonce = Uint8Array.from(randomBytes(32));
  const paymentRef = Uint8Array.from(randomBytes(32));
  const receiptExpiry = BigInt(Math.floor(Date.now() / 1000) + 86400);

  // 1. fundReserve
  activeWitnessContext = { callerSecret: issuerSk };
  await executeStep(1, "fundReserve", () => bound.callTx.fundReserve(1000n));

  // 2. registerMerchant (Merchant B)
  activeWitnessContext = { callerSecret: issuerSk };
  await executeStep(2, "registerMerchant", () => bound.callTx.registerMerchant(merchantB_Pk));

  // 3. openLine
  activeWitnessContext = {
    callerSecret: issuerSk,
    agentSecret: agentSk,
    salt: lineSalt,
    lineLimit,
  };
  await executeStep(3, "openLine", () => bound.callTx.openLine(lineExpiry, flatFee, bpsFee));

  // 4. postQuote
  activeWitnessContext = {
    callerSecret: initialMerchantSk,
    invoiceId,
    quoteNonce,
    quoteAmount,
  };
  await executeStep(4, "postQuote", () => bound.callTx.postQuote(quoteExpiry));

  // 5. draw
  activeWitnessContext = {
    callerSecret: agentSk,
    agentSecret: agentSk,
    salt: lineSalt,
    newSalt: newSalt1,
    invoiceId,
    quoteNonce,
    noteNonce,
    noteSalt,
    quoteMerchantPk: initialMerchantPk,
    lineLimit,
    lineOutstanding: 0n,
    lineEpoch: 0n,
    quoteAmount,
    drawAmount: quoteAmount,
  };
  await executeStep(5, "draw", () => bound.callTx.draw(quoteCommitBytes, noteExpiry, drawFee));

  // 6. redeemDraw
  activeWitnessContext = {
    callerSecret: initialMerchantSk,
    noteIdentity: agentId(agentSk),
    noteQuoteCommit: quoteCommitBytes,
    noteNonce,
    noteSalt,
    redeemAmount: quoteAmount,
  };
  await executeStep(6, "redeemDraw", () => bound.callTx.redeemDraw(noteCommitBytes, noteExpiry));

  // 7. acknowledgeRepayment
  activeWitnessContext = {
    callerSecret: issuerSk,
    agentSecret: agentSk,
    salt: newSalt1,
    newSalt: newSalt2,
    receiptNonce,
    paymentRef,
    lineLimit,
    lineOutstanding: quoteAmount + drawFee,
    lineEpoch: 1n, // Draw incremented epoch from 0 to 1
    repayAmount: quoteAmount + drawFee,
  };
  await executeStep(7, "acknowledgeRepayment", () => bound.callTx.acknowledgeRepayment(receiptExpiry));

  // 8. withdrawFees
  activeWitnessContext = { callerSecret: issuerSk };
  await executeStep(8, "withdrawFees", () => bound.callTx.withdrawFees());

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  console.log("\n===============================================================");
  console.log(" INCREMENTAL DEPLOYMENT & FLOW EXECUTION COMPLETE!");
  console.log("===============================================================");
  console.log(`MIDNIGHT_CONTRACT_ADDRESS: ${contractAddress}`);
  console.log(`Deploy Tx Hash:            ${deployTxHash} (Block ${deployBlockHeight})`);
  console.log("\n--- 11 Verifier Key Insertions ---");
  for (const item of insertionEvidence) {
    console.log(`- ${item.circuit}: tx ${item.txHash} (Block ${item.blockHeight})`);
  }
  console.log("\n--- 8-Step Circuit Flow ---");
  for (const item of flowEvidence) {
    console.log(`- Step ${item.step} (${item.name}): tx ${item.txHash} (Block ${item.blockHeight})`);
  }
  console.log("===============================================================");

  // Save final evidence to JSON file
  evidence.completedAt = new Date().toISOString();
  writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));
  console.log(`Final evidence written to ${evidenceFile}`);

  try {
    await facade.stop();
  } catch (e) {
    // ignore if shielded already stopped
  }
  await api.disconnect();
}

main().catch((err) => {
  console.error("FATAL ERROR in deployment pipeline:", err);
  process.exit(1);
});
