import { CompiledContract, ContractExecutable } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { ProvableCircuitId, VerifierKey, type Contract as CompactContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js/effect/Contract";
import { Intent, Transaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { createUnprovenDeployTx, submitCallTxAsync, submitTxAsync, type ContractProviders } from "@midnight-ntwrk/midnight-js-contracts";
import { asContractAddress, makeContractExecutableRuntime, type FinalizedTxData } from "@midnight-ntwrk/midnight-js-types";
import { ttlOneHour } from "@midnight-ntwrk/midnight-js-utils";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import type { Contract } from "../../../contracts/managed/organization/contract/index.js";
import type { LinePrivateWitnessContext } from "../runtime/network.ts";
import { OrganizationFinality } from "./finality.ts";

type LineContract = Contract<LinePrivateWitnessContext>;
type Circuit = keyof LineContract["provableCircuits"];
type Compiled = CompiledContract.CompiledContract<LineContract, LinePrivateWitnessContext>;

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
