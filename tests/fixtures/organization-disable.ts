import { readFileSync } from "node:fs";
import * as L from "@midnight-ntwrk/ledger-v8";
import * as R from "@midnight-ntwrk/compact-runtime";
import { candidateFixture } from "./organization-opening.ts";
import { EXPIRED_DISABLE as policy } from "../../src/lib/organization/expired-disable-policy.ts";
import { receivingAddressBytes, type OrganizationPending } from "../../src/lib/organization/account.ts";
import { toHex } from "../../src/lib/line/encoding.ts";
const actual = L.ContractState.deserialize(Buffer.from(readFileSync(new URL("organization-merchant2-draw-state.hex", import.meta.url), "utf8"), "hex"));

/** Real generated disable transcript + canonical ledger serialization; mock proof
 * only. No owner secret or signed production transaction is used by this fixture.
 */
export async function disableCandidateFixture(target = policy.merchantPk) {
  const f = await candidateFixture(), address = f.pending.contractAddress!;
  let state = R.ContractState.deserialize(f.predecessor.serialize());
  const apply = (name: "openLine" | "registerMerchant", args: unknown[]) => {
    const result = (f.contract.circuits[name] as Function)(R.createCircuitContext(address, "0".repeat(64), state, f.ps, undefined, undefined, 1000), ...args);
    const next = new R.ContractState(); next.data = result.context.currentQueryContext.state; state = next;
  };
  apply("openLine", [1000n + 7n * 86400n, 1000n, 100n]);
  apply("registerMerchant", [Buffer.from(policy.merchantPk, "hex"), { bytes: receivingAddressBytes(policy.merchantAddress) }]);
  const before = structuredClone(f.before); before.facilities[0].generation = 2n;
  before.facilities[0].merchants.push({ name: "Merchant 2", publicKey: policy.merchantPk, address: policy.merchantAddress });
  const predecessor = L.ContractState.deserialize(state.serialize());
  const result = f.contract.circuits.disableMerchant(R.createCircuitContext(address, "0".repeat(64), state, f.ps, undefined, undefined, 1000), Buffer.from(target, "hex"));
  const initial = new L.QueryContext(predecessor.data, address);
  initial.block = { ...initial.block, secondsSinceEpoch: 1000n, secondsSinceEpochErr: 30 };
  const partitioned = L.partitionTranscripts([new L.PreTranscript(initial, result.proofData.publicTranscript)], L.LedgerParameters.initialParameters())[0];
  const prototype = new L.ContractCallPrototype(address, "disableMerchant", actual.operation("disableMerchant")!, partitioned[0], partitioned[1], result.proofData.privateTranscriptOutputs, result.proofData.input, result.proofData.output, L.communicationCommitmentRandomness(), "disableMerchant");
  const publicTransaction = L.Transaction.deserialize("signature", "proof", "binding", readFileSync(new URL("private-offer-public-pairs/3-openLine.proven-public-tx.bin", import.meta.url)));
  const proof = ([...publicTransaction.intents!.values()][0].actions[0] as L.ContractCall<L.Proof>).proof.serialize();
  const count = (partitioned[0]?.program.length ?? 0) + (partitioned[1]?.program.length ?? 0);
  const transaction = (await L.Transaction.fromParts("preprod", undefined, undefined, L.Intent.new(new Date(4600_000)).addCall(prototype)).prove({ check: async () => Array(count).fill(undefined), prove: async () => proof }, L.CostModel.initialCostModel())).bind();
  const after = structuredClone(before); after.facilities[0].merchants[1].disabled = true;
  const pending: OrganizationPending = { id: "original-disable", kind: "call", circuit: "disableMerchant", facilityId: before.facilities[0].id, contractAddress: address, sourceFingerprint: policy.sourceFingerprint, after, txId: transaction.identifiers().at(-1)!, transaction: toHex(transaction.serialize()) };
  return { before, pending, predecessor, contract: f.contract, ps: f.ps };
}
