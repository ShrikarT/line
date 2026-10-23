import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { ContractDeploy, ContractMaintenanceAuthority, ContractState, CostModel, Intent, MaintenanceUpdate, Transaction, sampleSigningKey, signatureVerifyingKey, type UnprovenTransaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import type { ContractProviders } from "@midnight-ntwrk/midnight-js-contracts";
import { Contract } from "../contracts/managed/organization/contract/index.js";
import { WITNESSES } from "../src/lib/line/compact-harness.ts";
import { OrganizationTransactions, originalOrganizationTransaction, originalOrganizationSubmissionDetails } from "../src/lib/organization/transactions.ts";
import type { OrganizationPending } from "../src/lib/organization/account.ts";
import { organizationProofProvider } from "../src/lib/organization/proving.ts";

const fingerprint = "12".repeat(32);
async function originalFixture(kind: "deploy" | "key" = "key") {
  const intent = Intent.new(new Date(Date.now() + 3600_000));
  const action = kind === "deploy" ? new ContractDeploy(new ContractState()) : new MaintenanceUpdate("ab".repeat(32), [], 0n);
  const unproven = Transaction.fromParts("preprod", undefined, undefined, action instanceof ContractDeploy ? intent.addDeploy(action) : intent.addMaintenanceUpdate(action));
  const unexpected = async () => { throw Error("Serialization fixtures must not generate a circuit proof"); };
  const transaction = (await unproven.prove({ check: unexpected, prove: unexpected }, CostModel.initialCostModel())).bind();
  const pending: OrganizationPending = {
    id: "original", kind, circuit: kind === "deploy" ? "deploy" : "draw", facilityId: null, contractAddress: action.address,
    sourceFingerprint: fingerprint, after: { schema: "line:organization-account/v1", networkId: "preprod", accountId: "13".repeat(32), issuerSecret: "14".repeat(32), merchantSecret: "15".repeat(32), facilities: [], quotes: [], notes: [], receipts: [] },
    txId: transaction.identifiers().at(-1)!, transaction: Buffer.from(transaction.serialize()).toString("hex"),
  };
  return { pending, transaction };
}

test("original submission validation preserves exact public bytes and every action kind", async () => {
  for (const kind of ["deploy", "key"] as const) {
    const { pending } = await originalFixture(kind), before = structuredClone(pending);
    assert.equal(Buffer.from(originalOrganizationTransaction(pending, fingerprint).serialize()).toString("hex"), pending.transaction);
    assert.deepEqual(pending, before);
  }
  // Previously published public proof bytes establish call decoding, not this release's validity.
  const raw = readFileSync(new URL("fixtures/private-offer-public-pairs/3-openLine.proven-public-tx.bin", import.meta.url));
  const transaction = Transaction.deserialize("signature", "proof", "binding", raw);
  const action = [...transaction.intents!.values()].flatMap(intent => intent.actions)[0];
  const { pending } = await originalFixture();
  Object.assign(pending, { kind: "call", circuit: "openLine", contractAddress: action.address, transaction: raw.toString("hex"), txId: transaction.identifiers().at(-1) });
  assert.equal(Buffer.from(originalOrganizationTransaction(pending, fingerprint, 0).serialize()).toString("hex"), raw.toString("hex"));
});

test("submission diagnostics export only canonical public bytes and exact TTLs without private candidates", async () => {
  const { pending, transaction } = await originalFixture(), before = structuredClone(pending);
  const details = originalOrganizationSubmissionDetails(pending, fingerprint);
  assert.deepEqual(Object.keys(details).sort(), ["schema", "operationId", "identifier", "transactionHash", "kind", "circuit", "contractAddress", "sourceFingerprint", "intentTtls", "transaction"].sort());
  assert.equal(details.identifier, pending.txId); assert.equal(details.transaction, pending.transaction);
  assert.equal(details.transactionHash, transaction.transactionHash());
  assert.deepEqual(details.intentTtls, [...transaction.intents!.values()].map(intent => intent.ttl.toISOString()).sort());
  assert(!JSON.stringify(details).includes(pending.after.issuerSecret)); assert(!JSON.stringify(details).includes(pending.after.merchantSecret));
  assert.deepEqual(pending, before);
  for (const change of [{ txId: "00" + "ff".repeat(32) }, { kind: "call" as const }, { sourceFingerprint: "ff".repeat(32) }]) assert.throws(() => originalOrganizationSubmissionDetails({ ...pending, ...change }, fingerprint));
  const raw = readFileSync(new URL("fixtures/private-offer-public-pairs/3-openLine.proven-public-tx.bin", import.meta.url));
  const expired = Transaction.deserialize("signature", "proof", "binding", raw), action = [...expired.intents!.values()].flatMap(intent => intent.actions)[0];
  Object.assign(pending, { kind: "call", circuit: "openLine", contractAddress: action.address, transaction: raw.toString("hex"), txId: expired.identifiers().at(-1) });
  assert.equal(originalOrganizationSubmissionDetails(pending, fingerprint).transaction, raw.toString("hex"));
});

test("original submission rejects changed bytes, identity, release and action metadata", async () => {
  const { pending } = await originalFixture();
  for (const change of [
    { transaction: null }, { txId: null }, { txId: "00" + "ff".repeat(32) },
    { transaction: pending.transaction! + "00" }, { transaction: "abcd" },
    { contractAddress: "cd".repeat(32) }, { sourceFingerprint: "ff".repeat(32) },
    { kind: "call" as const }, { kind: "deploy" as const },
  ]) assert.throws(() => originalOrganizationTransaction({ ...pending, ...change }, fingerprint));
  const raw = readFileSync(new URL("fixtures/private-offer-public-pairs/3-openLine.proven-public-tx.bin", import.meta.url));
  const transaction = Transaction.deserialize("signature", "proof", "binding", raw);
  const action = [...transaction.intents!.values()].flatMap(intent => intent.actions)[0];
  assert.throws(() => originalOrganizationTransaction({ ...pending, kind: "call", circuit: "draw", contractAddress: action.address, transaction: raw.toString("hex"), txId: transaction.identifiers().at(-1)! }, fingerprint, 0), /prepared organization action/);
});

test("an expired original transaction cannot be resubmitted or treated as failed", async () => {
  const { pending, transaction } = await originalFixture(), before = structuredClone(pending);
  const expiry = Math.min(...[...transaction.intents!.values()].map(intent => intent.ttl.getTime()));
  assert.throws(() => originalOrganizationTransaction(pending, fingerprint, expiry), /expired.*reconciliation/i);
  assert.deepEqual(pending, before);
});

test("resubmission rejects an original containing more than one contract action", async () => {
  const { pending } = await originalFixture();
  const intent = Intent.new(new Date(Date.now() + 3600_000))
    .addMaintenanceUpdate(new MaintenanceUpdate(pending.contractAddress!, [], 0n))
    .addMaintenanceUpdate(new MaintenanceUpdate("cd".repeat(32), [], 0n));
  const unproven = Transaction.fromParts("preprod", undefined, undefined, intent);
  const unexpected = async () => { throw Error("No circuit proof is needed"); };
  const transaction = (await unproven.prove({ check: unexpected, prove: unexpected }, CostModel.initialCostModel())).bind();
  Object.assign(pending, { transaction: Buffer.from(transaction.serialize()).toString("hex"), txId: transaction.identifiers().at(-1) });
  assert.throws(() => originalOrganizationTransaction(pending, fingerprint), /prepared organization action/);
});

test("actual SDK maintenance construction signs and proves before wallet rejection, without submitting", async () => {
  setNetworkId("preprod");
  const address = "ab".repeat(32), signingKey = sampleSigningKey(), state = new ContractState();
  state.maintenanceAuthority = new ContractMaintenanceAuthority([signatureVerifyingKey(signingKey)], 1);
  // A real public verifier fixture establishes SDK key/transaction encoding only;
  // exact organization release identity is verified by the separate release check.
  const fixture = JSON.parse(readFileSync(new URL("fixtures/line-public-verifiers.json", import.meta.url), "utf8"));
  const key = new Uint8Array(Buffer.from(fixture.keys.draw, "base64"));
  const compiled = CompiledContract.make("line-organization", Contract).pipe(CompiledContract.withWitnesses(WITNESSES), CompiledContract.withCompiledFileAssets("unused-by-maintenance"));
  let balanced = 0, submissions = 0, observations = 0, provingRequests = 0;
  let prepared: UnprovenTransaction | undefined;
  const walletProver = organizationProofProvider({ getProvingProvider: async keys => {
    provingRequests++; assert.equal((await keys.getVerifierKey("draw")).length, key.length);
    return {
      check: async () => { throw Error("Maintenance has no circuit proof to check"); },
      prove: async () => { throw Error("Maintenance has no circuit proof to generate"); },
    };
  } }, { getVerifierKey: async () => key, getProverKey: async () => { throw Error("No circuit proof required"); }, getZKIR: async () => { throw Error("No circuit proof required"); } }, () => {});
  const providers = {
    publicDataProvider: { queryContractState: async () => state, watchForTxData: async () => { observations++; throw Error("No submission may be observed"); } },
    zkConfigProvider: { getVerifierKey: async (name: string) => { assert.equal(name, "draw"); return key; } },
    proofProvider: { proveTx: async (tx: UnprovenTransaction) => { prepared = tx; return walletProver.proveTx(tx); } },
    walletProvider: { getCoinPublicKey: () => "00".repeat(32), balanceTx: async (tx: { intents?: Map<unknown, { actions: unknown[] }>; serialize(): Uint8Array }) => {
      balanced++; const actions = [...tx.intents!.values()].flatMap(intent => intent.actions);
      assert.equal(actions.length, 1); assert(actions[0] instanceof MaintenanceUpdate); assert.equal(actions[0].address, address);
      assert(tx.serialize().length > 0); throw Error("Deliberate wallet rejection");
    } },
    midnightProvider: { submitTx: async () => { submissions++; throw Error("A rejected approval must not submit"); } },
  } as unknown as ContractProviders<InstanceType<typeof Contract>>;
  const transactions = new OrganizationTransactions(providers, () => compiled);
  await assert.rejects(transactions.insert(address, "draw", signingKey), /Deliberate wallet rejection/);
  assert.equal(balanced, 1); assert.equal(submissions, 0); assert.equal(observations, 0);
  assert.equal(provingRequests, 1);
  assert.equal(state.operation("draw"), undefined);

  assert(prepared);
  const keys = { getZKIR: async () => key, getProverKey: async () => key, getVerifierKey: async () => key };
  let resolveProvider!: (value: Awaited<ReturnType<Parameters<typeof organizationProofProvider>[0]["getProvingProvider"]>>) => void;
  let resumed = false;
  const unavailable = organizationProofProvider({ getProvingProvider: () => new Promise(resolve => { resolveProvider = resolve; }) }, keys, () => {}, () => {}, 5);
  await assert.rejects((async () => { await unavailable.proveTx(prepared!); resumed = true; })(), /not responding/);
  resolveProvider({ check: async () => [], prove: async () => new Uint8Array() });
  await Promise.resolve(); await Promise.resolve(); assert.equal(resumed, false);
  assert.equal(submissions, 0); assert.equal(balanced, 1);

  const denied = organizationProofProvider({ getProvingProvider: async () => { throw Error("Wallet declined proving"); } }, keys, () => {});
  await assert.rejects(denied.proveTx(prepared), /Wallet declined/);
  assert.equal(submissions, 0); assert.equal(balanced, 1);
});
