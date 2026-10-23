import { CompiledContract, ContractExecutable } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { ProvableCircuitId, VerifierKey, type Contract as CompactContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js/effect/Contract";
import { ContractCall, ContractDeploy, Intent, MaintenanceUpdate, Transaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { createUnprovenDeployTx, submitCallTxAsync, submitTxAsync, type ContractProviders } from "@midnight-ntwrk/midnight-js-contracts";
import { asContractAddress, makeContractExecutableRuntime, type FinalizedTxData } from "@midnight-ntwrk/midnight-js-types";
import { ttlOneHour } from "@midnight-ntwrk/midnight-js-utils";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import type { Contract } from "../../../contracts/managed/organization/contract/index.js";
import type { LinePrivateWitnessContext } from "../runtime/network.ts";
import { OrganizationFinality } from "./finality.ts";
import type { OrganizationPending } from "./account.ts";
import { hexToBytes, toHex } from "../bytes.ts";

type LineContract = Contract<LinePrivateWitnessContext>;
type Circuit = keyof LineContract["provableCircuits"];
type Compiled = CompiledContract.CompiledContract<LineContract, LinePrivateWitnessContext>;

/** Decode only the immutable transaction already retained at the submission boundary. */
export function decodeOriginalOrganizationTransaction(pending: OrganizationPending, sourceFingerprint: string) {
  if (pending.sourceFingerprint !== sourceFingerprint) throw new Error("Recover with the original organization contract release.");
  if (!pending.txId || !pending.transaction || !pending.contractAddress) throw new Error("No signed organization transaction is saved for resubmission.");
  const transaction = Transaction.deserialize("signature", "proof", "binding", hexToBytes(pending.transaction));
  if (toHex(transaction.serialize()) !== pending.transaction || transaction.identifiers().at(-1) !== pending.txId) throw new Error("Saved transaction bytes differ from the original signed identifier.");
  const intents = [...(transaction.intents?.values() ?? [])], actions = intents.flatMap(intent => intent.actions);
  if (actions.length !== 1 || actions[0].address !== pending.contractAddress) throw new Error("Saved transaction differs from the prepared organization action.");
  const action = actions[0];
  if (pending.kind === "deploy" ? !(action instanceof ContractDeploy) : pending.kind === "key" ? !(action instanceof MaintenanceUpdate) : pending.kind !== "call" || !(action instanceof ContractCall) || (typeof action.entryPoint === "string" ? action.entryPoint : new TextDecoder().decode(action.entryPoint)) !== pending.circuit) throw new Error("Saved transaction differs from the prepared organization action.");
  if (!intents.length || intents.some(intent => !Number.isFinite(intent.ttl.getTime()))) throw new Error("Saved transaction has invalid intent expiry.");
  return transaction;
}

/** Public signed bytes only. No snapshot, candidate, private key or provider URL
 * enters this allowlist. Decoding remains available after TTL for diagnosis.
 */
export function originalOrganizationSubmissionDetails(pending: OrganizationPending, sourceFingerprint: string) {
  const transaction = decodeOriginalOrganizationTransaction(pending, sourceFingerprint);
  const expiries = [...transaction.intents!.values()].map(intent => intent.ttl.getTime()).sort((a, b) => a - b);
  return {
    schema: "line:organization-submission-diagnostics/v1" as const,
    operationId: pending.id, identifier: pending.txId!, transactionHash: transaction.transactionHash(),
    kind: pending.kind, circuit: pending.circuit, contractAddress: pending.contractAddress!, sourceFingerprint,
    intentTtls: expiries.map(ttl => new Date(ttl).toISOString()),
    transaction: pending.transaction!,
  };
}
export type OriginalOrganizationSubmissionDetails = ReturnType<typeof originalOrganizationSubmissionDetails>;

export function originalOrganizationTransaction(pending: OrganizationPending, sourceFingerprint: string, now = Date.now()) {
  const transaction = decodeOriginalOrganizationTransaction(pending, sourceFingerprint);
  if ([...transaction.intents!.values()].some(intent => intent.ttl.getTime() <= now)) throw new Error("The original signed transaction has expired. Keep it for reconciliation; expiry alone does not prove it was never applied.");
  return transaction;
}

/** SDK asynchronous submission, with application-owned durable finality handling.
 * No SDK continuation writes private state after a timed-out observation.
 * This contract's SDK private state is empty; books and maintenance keys live in
 * the organization's encrypted account and are promoted by its receipt journal.
 */
export class OrganizationTransactions {
  private readonly providers: ContractProviders<LineContract>;
  private readonly compiled: () => Compiled;
  readonly finality: OrganizationFinality<FinalizedTxData>;
  constructor(providers: ContractProviders<LineContract>, compiled: () => Compiled) {
    this.providers = providers; this.compiled = compiled;
    this.finality = new OrganizationFinality(id => providers.publicDataProvider.watchForTxData(id));
  }
  async call<C extends Circuit>(address: string, circuit: C, args: CompactContract.CircuitParameters<LineContract, C>) {
    const privateStateId = `organization-state:${address}`;
    this.providers.privateStateProvider.setContractAddress(address);
    if (await this.providers.privateStateProvider.get(privateStateId) === null) await this.providers.privateStateProvider.set(privateStateId, {});
    const submitted = await submitCallTxAsync(this.providers, { compiledContract: this.compiled(), contractAddress: address, circuitId: circuit, privateStateId, args });
    return this.finality.wait(submitted.txId);
  }
  async deploy(compiledContract: Compiled, signingKey: string, args: CompactContract.InitializeParameters<LineContract>) {
    const prepared = await createUnprovenDeployTx(this.providers, { compiledContract, signingKey, initialPrivateState: {}, args });
    const id = await submitTxAsync(this.providers, { unprovenTx: prepared.private.unprovenTx });
    return this.finality.wait(id);
  }
  async insert(address: string, circuit: Circuit, signingKey: string) {
    const state = await this.providers.publicDataProvider.queryContractState(address);
    if (!state || state.operation(circuit)) throw new Error("The facility verifier state changed. Refresh and resume setup.");
    const key = await this.providers.zkConfigProvider.getVerifierKey(circuit);
    // Same official effect construction used by submitInsertVerifierKeyTx,
    // followed by submitTxAsync instead of its indefinite finality wait.
    const runtime = makeContractExecutableRuntime(this.providers.zkConfigProvider, { coinPublicKey: this.providers.walletProvider.getCoinPublicKey(), signingKey });
    const result = await runtime.runPromise(ContractExecutable.make(this.compiled()).addOrReplaceContractOperation(ProvableCircuitId<LineContract>(circuit), VerifierKey(key), { address: asContractAddress(address), contractState: state }));
    const unprovenTx = Transaction.fromParts(getNetworkId(), undefined, undefined, Intent.new(ttlOneHour()).addMaintenanceUpdate(result.public.maintenanceUpdate));
    return this.finality.wait(await submitTxAsync(this.providers, { unprovenTx }));
  }
}
