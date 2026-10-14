#!/usr/bin/env node
/** Synthetic local ledger/prover diagnostic. Never submits, balances a wallet,
 * reads wallet credentials, or moves assets. Private proof data remains in memory.
 */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import * as RT from "@midnight-ntwrk/compact-runtime";
import * as L from "@midnight-ntwrk/ledger-v8";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { createUnprovenCallTxFromInitialStates } from "@midnight-ntwrk/midnight-js-contracts";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { Contract, ledger } from "../contracts/managed/line/contract/index.js";
import { blankPrivate, WITNESSES } from "../src/lib/line/compact-harness.ts";
import { issuerPublicKey, merchantPublicKey, agentId, lineStateCommit } from "../src/lib/line/encoding.ts";
import { resolveContractRelease, validateContractArtifacts } from "./contract-artifacts.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const secret = () => new Uint8Array(randomBytes(32));
const ZERO = "0".repeat(64);

async function main() {
  const url = "http://127.0.0.1:6301";
  const version = (await (await fetch(`${url}/version`, { signal: AbortSignal.timeout(5000) })).text()).trim().replace(/^"|"$/g, "");
  assert.equal(version, "8.1.3", "This experiment requires the supported loopback proof server.");
  const artifactDir = resolveContractRelease();
  const release = validateContractArtifacts({ artifactDir });
  const zk = new NodeZkConfigProvider(artifactDir);
  const proofProvider = httpClientProofProvider(url, zk, { timeout: 300_000 });
  setNetworkId("preview"); // Synthetic local network label, never a remote submission.
  const issuer = secret(), agent = secret(), merchant = secret(), merchantB = secret();
  const ps = blankPrivate({ callerSecret: issuer, agentSecret: agent, lineLimit: 40n, salt: secret(), newSalt: secret() });
  const compiled = CompiledContract.make("line", Contract).pipe(
    CompiledContract.withWitnesses(WITNESSES), CompiledContract.withCompiledFileAssets(artifactDir));
  const initial = new Contract(WITNESSES).initialState(RT.createConstructorContext(ps, ZERO),
    issuerPublicKey(issuer), merchantPublicKey(merchant), secret());
  const state = initial.currentContractState;
  for (const { name } of release.compilerInfo.circuits) {
    const op = new RT.ContractOperation(); op.verifierKey = await zk.getVerifierKey(name); state.setOperation(name, op);
  }
  const deploy = new L.ContractDeploy(L.ContractState.deserialize(state.serialize()));
  let local = L.LedgerState.blank("preview");
  const strict = new L.WellFormedStrictness();
  strict.enforceBalancing = false; // No DUST fee funding; never network-validity evidence.
  strict.verifyNativeProofs = true;
  strict.verifyContractProofs = true;
  strict.enforceLimits = true;
  strict.verifySignatures = true;
  const traces = [];
  const negativeChecks = [];
  let independentVerification = false;
  mkdirSync(".compact-keys", { recursive: true });
  const work = mkdtempSync(".compact-keys/local-proof-");
  const executable = join(".compact-keys", "native-proof-target", "debug", process.platform === "win32" ? "line-native-proof-verifier.exe" : "line-native-proof-verifier");
  const nativeAvailable = existsSync(executable);
  assert(nativeAvailable || process.argv.includes("--allow-wasm-only"), "Build the native verifier first; --allow-wasm-only is diagnostic and cannot pass the verification gate.");
  const nativeVerify = (tx, label) => {
    if (!nativeAvailable) return null;
    // These files are public state/proven transaction bytes, never a preimage.
    const statePath = join(work, `${label}.public-state.bin`), txPath = join(work, `${label}.proven-tx.bin`);
    writeFileSync(statePath, local.serialize()); writeFileSync(txPath, tx.serialize());
    const result = spawnSync(executable, [statePath, txPath, String(Math.floor(Date.now() / 1000))], { encoding: "utf8", timeout: 60_000 });
    if (result.error) throw result.error;
    return { status: result.status, output: result.stdout + result.stderr };
  };
  const verifyAndApply = tx => {
    const now = new Date(), seconds = BigInt(Math.floor(now.getTime() / 1000));
    const verified = tx.wellFormed(local, strict, now);
    return local.apply(verified, new L.TransactionContext(local, {
      secondsSinceEpoch: seconds, secondsSinceEpochErr: 0, parentBlockHash: ZERO, lastBlockTime: seconds - 1n }));
  };
  const apply = (tx, name) => {
    const independent = nativeVerify(tx, `${traces.length}-${name}`);
    if (independent) assert.equal(independent.status, 0, independent.output);
    const [next, result] = verifyAndApply(tx);
    assert.equal(result.type, "success", result.error);
    local = next;
    const publicBook = ledger(RT.ContractState.deserialize(local.index(deploy.address).serialize()).data);
    traces.push({ circuit: name, nativeLedgerApplied: true, contractProofVerificationRequested: true,
      independentCryptographicVerificationPassed: independent?.status === 0,
      transactionSha256: digest(tx.serialize()), bytes: tx.serialize().length, totalReserve: publicBook.totalReserve.toString(),
      encumberedReserve: publicBook.encumberedReserve.toString(), redeemedReserve: publicBook.redeemedReserve.toString() });
    console.log(JSON.stringify({ stage: name, result: "native-ledger-executed", bytes: tx.serialize().length }));
  };
  const deployTx = L.Transaction.fromParts("preview", undefined, undefined,
    L.Intent.new(new Date(Date.now() + 3_600_000)).addDeploy(deploy));
  apply((await proofProvider.proveTx(deployTx)).bind(), "syntheticDeployment");
  const construct = async (name, args, privateState) => {
    const current = RT.ContractState.deserialize(local.index(deploy.address).serialize());
    return createUnprovenCallTxFromInitialStates(zk, { compiledContract: compiled, circuitId: name,
      contractAddress: deploy.address, coinPublicKey: ZERO, initialContractState: current,
      initialZswapChainState: local.zswap, ledgerParameters: local.parameters, initialPrivateState: privateState, args }, ZERO);
  };
  const execute = async (name, args, privateState) => {
    const call = await construct(name, args, privateState);
    console.log(JSON.stringify({ stage: name, result: "constructed", next: "real-proof-generation" }));
    const proven = (await proofProvider.proveTx(call.private.unprovenTx)).bind();
    if (name === "draw") {
      // Alter only serialized proof bytes, retaining decodable transaction structure.
      const proof = [...proven.intents.values()].flatMap(intent => intent.actions).find(action => action.entryPoint === "draw").proof.serialize();
      const raw = Buffer.from(proven.serialize());
      assert(proof.length > 64, "Proof must contain enough bytes for the negative control.");
      // The standalone serializer includes a type/version envelope omitted by
      // transaction serialization. Locate a unique interior block of proof data.
      const interior = Buffer.from(proof.slice(Math.floor(proof.length / 2), Math.floor(proof.length / 2) + 32));
      const offset = raw.indexOf(interior);
      assert(offset >= 0 && raw.indexOf(interior, offset + 1) < 0, "An unambiguous proof block must be located.");
      raw[offset] ^= 1;
      const tampered = L.Transaction.deserialize("signature", "proof", "binding", raw);
      const alteredProof = [...tampered.intents.values()].flatMap(intent => intent.actions).find(action => action.entryPoint === "draw").proof.serialize();
      assert(!Buffer.from(alteredProof).equals(Buffer.from(proof)), "The negative control must change the call's actual proof.");
      let rejected = false;
      try {
        const [, result] = verifyAndApply(tampered);
        rejected = result.type !== "success" && /proof|verify|verif/i.test(result.error ?? "");
      } catch (error) { rejected = /proof|verify|verif/i.test(error.message); }
      const independent = nativeVerify(tampered, `${traces.length}-corrupted-${name}`);
      if (independent) {
        assert.equal(independent.status, 1, "Corrupted proofs must be rejected by the independent verifier.");
        assert.match(independent.output, /NATIVE_WELL_FORMED_REJECTED:.*proof/i, "The negative control must reach native proof verification.");
      }
      independentVerification = independent?.status === 1;
      negativeChecks.push({ check: "decodable-draw-proof-corruption", wasmRejected: rejected,
        independentVerifierRejected: independent?.status === 1, acceptanceGatePassed: independentVerification });
      console.log(JSON.stringify({ stage: "invalid-proof-control", cryptographicVerificationGatePassed: independentVerification }));
    }
    apply(proven, name);
  };
  const reject = async (label, name, args, privateState, expected) => {
    await assert.rejects(() => construct(name, args, privateState), expected);
    negativeChecks.push({ check: label, rejectedBeforeProving: true });
  };
  const book = () => ledger(RT.ContractState.deserialize(local.index(deploy.address).serialize()).data);
  await execute("registerMerchant", [merchantPublicKey(merchantB)], ps);
  await execute("fundReserve", [100n], ps);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 86_400);
  await execute("openLine", [expiry, 1n, 0n], ps);
  const invoice = secret(), quoteNonce = secret(), noteNonce = secret(), noteSalt = secret();
  await execute("postQuote", [expiry], { ...ps, callerSecret: merchant, invoiceId: invoice, quoteNonce, quoteAmount: 25n });
  const Q = [...book().quotes][0][0];
  const drawn = { ...ps, drawAmount: 25n, invoiceId: invoice, quoteNonce, quoteMerchantPk: merchantPublicKey(merchant), noteNonce, noteSalt };
  await execute("draw", [Q, expiry, 1n], drawn);
  await reject("draw-replay", "draw", [Q, expiry, 1n], drawn, /stale|used|book/i);
  const invoiceB = secret(), quoteNonceB = secret();
  await execute("postQuote", [expiry], { ...ps, callerSecret: merchantB, invoiceId: invoiceB, quoteNonce: quoteNonceB, quoteAmount: 20n });
  const QB = [...book().quotes].find(([key]) => !Buffer.from(key).equals(Buffer.from(Q)))[0];
  await reject("over-limit-draw", "draw", [QB, expiry, 1n], { ...drawn, salt: ps.newSalt, lineOutstanding: 26n,
    lineEpoch: 1n, drawAmount: 20n, invoiceId: invoiceB, quoteNonce: quoteNonceB, quoteMerchantPk: merchantPublicKey(merchantB) }, /capacity/i);
  const D = [...book().notes][0][0];
  const redeem = { ...ps, callerSecret: merchant, redeemAmount: 25n, noteIdentity: agentId(agent), noteQuoteCommit: Q, noteNonce, noteSalt };
  await reject("wrong-merchant-redemption", "redeemDraw", [D, expiry], { ...redeem, callerSecret: merchantB }, /note|merchant/i);
  await execute("redeemDraw", [D, expiry], redeem);
  await reject("redemption-replay", "redeemDraw", [D, expiry], redeem, /status|redeem|spent/i);
  const repaidSalt = secret();
  const repaid = { ...ps, salt: ps.newSalt, newSalt: repaidSalt, lineOutstanding: 26n, lineEpoch: 1n,
    repayAmount: 26n, paymentRef: secret(), receiptNonce: secret() };
  await execute("acknowledgeRepayment", [expiry], repaid);
  await reject("repayment-on-zero-debt", "acknowledgeRepayment", [expiry], { ...repaid, salt: repaidSalt,
    lineOutstanding: 0n, lineEpoch: 2n }, /range/i);
  const secondSalt = secret(), secondNoteNonce = secret(), secondNoteSalt = secret();
  await execute("draw", [QB, expiry, 1n], { ...drawn, salt: repaidSalt, newSalt: secondSalt, lineOutstanding: 0n,
    lineEpoch: 2n, drawAmount: 20n, invoiceId: invoiceB, quoteNonce: quoteNonceB, quoteMerchantPk: merchantPublicKey(merchantB),
    noteNonce: secondNoteNonce, noteSalt: secondNoteSalt });
  const DB = [...book().notes].find(([key]) => !Buffer.from(key).equals(Buffer.from(D)))[0];
  await execute("redeemDraw", [DB, expiry], { ...ps, callerSecret: merchantB, redeemAmount: 20n, noteIdentity: agentId(agent),
    noteQuoteCommit: QB, noteNonce: secondNoteNonce, noteSalt: secondNoteSalt });
  const closingSalt = secret();
  const secondRepay = { ...repaid, salt: secondSalt, newSalt: closingSalt, lineOutstanding: 21n, lineEpoch: 3n, repayAmount: 21n };
  await reject("repayment-reference-replay-after-new-draw", "acknowledgeRepayment", [expiry], secondRepay, /payment used/i);
  await execute("acknowledgeRepayment", [expiry], { ...secondRepay, paymentRef: secret(), receiptNonce: secret() });
  const cancelExpiry = BigInt(Math.floor(Date.now() / 1000) + 90);
  const cancelInvoice = secret(), cancelQuoteNonce = secret(), cancelNoteNonce = secret(), cancelNoteSalt = secret();
  const cancelSalt = secret(), finalSalt = secret();
  await execute("postQuote", [cancelExpiry], { ...ps, callerSecret: merchant, invoiceId: cancelInvoice, quoteNonce: cancelQuoteNonce, quoteAmount: 5n });
  const QC = [...book().quotes].find(([key]) => !Buffer.from(key).equals(Buffer.from(Q)) && !Buffer.from(key).equals(Buffer.from(QB)))[0];
  await execute("draw", [QC, cancelExpiry, 1n], { ...drawn, salt: closingSalt, newSalt: cancelSalt, lineEpoch: 4n,
    invoiceId: cancelInvoice, quoteNonce: cancelQuoteNonce, drawAmount: 5n, noteNonce: cancelNoteNonce, noteSalt: cancelNoteSalt });
  const DC = [...book().notes].find(([key]) => !Buffer.from(key).equals(Buffer.from(D)) && !Buffer.from(key).equals(Buffer.from(DB)))[0];
  await reject("premature-note-expiry", "cancelOrExpireNote", [DC, 0n, 0n], ps, /not expired/i);
  await execute("withdrawFees", [], ps);
  await execute("withdrawUnencumberedReserve", [10n], ps);
  await execute("disableMerchant", [merchantPublicKey(merchantB)], ps);
  console.log(JSON.stringify({ stage: "expiry-boundary", result: "waiting-for-actual-wall-clock-deadline" }));
  while (BigInt(Math.floor(Date.now() / 1000)) <= cancelExpiry) await new Promise(resolve => setTimeout(resolve, 1000));
  await execute("cancelOrExpireNote", [DC, 0n, 0n], ps);
  await execute("cancelOrExpireNote", [DC, 1n, 0n], { ...ps, salt: cancelSalt, newSalt: finalSalt, lineOutstanding: 6n,
    lineEpoch: 5n, noteIdentity: agentId(agent), noteQuoteCommit: QC, quoteMerchantPk: merchantPublicKey(merchant),
    noteNonce: cancelNoteNonce, noteSalt: cancelNoteSalt });
  await execute("setStatus", [3], { ...ps, salt: finalSalt, lineOutstanding: 0n, lineEpoch: 6n });
  assert.deepEqual([...new Set(traces.filter(t => t.circuit !== "syntheticDeployment").map(t => t.circuit))].sort(),
    release.compilerInfo.circuits.map(c => c.name).sort(), "Every canonical circuit must produce an actual proof.");
  const finalBook = book();
  assert.equal(finalBook.totalReserve, 88n); assert.equal(finalBook.encumberedReserve, 0n); assert.equal(finalBook.redeemedReserve, 45n);
  assert.equal(finalBook.feeReserve, 0n); assert.equal(finalBook.pendingFeeReserve, 0n); assert.equal(finalBook.refundReserve, 0n);
  assert.equal(finalBook.reportedRefundReserve, 0n); assert.equal(finalBook.status, 3);
  assert.deepEqual(finalBook.lineCommit, lineStateCommit({ domain: finalBook.contractDomain, identity: agentId(agent),
    limit: 40n, outstanding: 0n, epoch: 6n }, finalSalt));
  const report = { schema: "line-local-proof-verification/v1", createdAt: new Date().toISOString(), proofServerVersion: version,
    sourceSha256: release.inputs.source.sha256, releaseDirectory: relative(process.cwd(), artifactDir).replaceAll("\\", "/"), cryptographicContractProofsGenerated: true,
    nativeLedgerExecution: true, independentCryptographicVerification: independentVerification,
    strictnessRequested: { enforceBalancing: false, verifyNativeProofs: true, verifyContractProofs: true,
      enforceLimits: true, verifySignatures: true }, canonicalCustodyStillSharedForOpening: true,
    allSigningKeysInOneProcess: true, proofServerReceivesPrivatePreimages: true,
    historicalPrivacyPassed: false, networkSubmitted: false, networkFinalityConfirmed: false, assetTransfers: false,
    repaymentAuthenticityVerified: false, circuitsNotProved: [], refundReportActionNotProved: true, traces, negativeChecks };
  writeFileSync(join(work, "evidence.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: independentVerification ? "LOCAL PROOF GENERATION AND VERIFICATION PASS" :
    "LOCAL PROOF GENERATION PASS; INDEPENDENT VERIFICATION UNMET", evidence: join(work, "evidence.json") }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
