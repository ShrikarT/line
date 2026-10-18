import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { ContractMaintenanceAuthority, ContractState, MaintenanceUpdate, sampleSigningKey, signatureVerifyingKey, type UnprovenTransaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import type { ContractProviders } from "@midnight-ntwrk/midnight-js-contracts";
import { Contract } from "../contracts/managed/organization/contract/index.js";
import { WITNESSES } from "../src/lib/line/compact-harness.ts";
import { OrganizationTransactions } from "../src/lib/organization/transactions.ts";
import { organizationProofProvider } from "../src/lib/organization/proving.ts";

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
