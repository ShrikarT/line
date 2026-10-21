import { readFileSync } from "node:fs";
import * as L from "@midnight-ntwrk/ledger-v8";
import * as R from "@midnight-ntwrk/compact-runtime";
import { bech32m } from "@scure/base";
import { Contract } from "../../contracts/managed/organization/contract/index.js";
import { blankPrivate, WITNESSES } from "../../src/lib/line/compact-harness.ts";
import { issuerPublicKey, merchantPublicKey, pad32, toHex } from "../../src/lib/line/encoding.ts";
import { EXPIRED_OPENING as policy } from "../../src/lib/organization/expired-opening-policy.ts";
import type { OrganizationPending, OrganizationSnapshot } from "../../src/lib/organization/account.ts";
const actual = L.ContractState.deserialize(Buffer.from(readFileSync(new URL("organization-closed-state.hex", import.meta.url), "utf8"), "hex"));

/** Generated contract + real ledger partitioning/serialization; mock proof only.
 * This fixture exercises transcript binding, never network proof acceptance.
 */
export async function candidateFixture() {
  const issuer = pad32("expiry-issuer"), agent = pad32("expiry-agent"), merchant = pad32("expiry-merchant"), nonce = pad32("expiry-domain"), salt = pad32("expiry-book"), nextSalt = pad32("expiry-next");
  const address = "ab".repeat(32), recipient = { bytes: pad32("expiry-recipient") }, contract = new Contract(WITNESSES);
  const ps = blankPrivate({ callerSecret: issuer, agentSecret: agent, salt, lineLimit: 1_000_000n });
  let state = contract.initialState(R.createConstructorContext(ps, "0".repeat(64)), issuerPublicKey(issuer), merchantPublicKey(merchant), nonce, recipient, recipient, new Uint8Array(32)).currentContractState;
  const call = (name: "openLine" | "setStatus", args: bigint[] | number[]) => {
    const result = (contract.circuits[name] as Function)(R.createCircuitContext(address, "0".repeat(64), state, ps, undefined, undefined, 1000), ...args);
    const next = new R.ContractState(); next.data = result.context.currentQueryContext.state; state = next;
  };
  call("openLine", [900000n, 0n, 0n]); call("setStatus", [3]);
  const predecessor = L.ContractState.deserialize(state.serialize());
  const facility = { id: "facility", name: "Fixture", address, instanceNonce: toHex(nonce), maintenanceKey: "12".repeat(32), assetColor: "00".repeat(32), issuerRecipient: bech32m.encodeFromBytes("mn_addr_preprod", recipient.bytes), merchants: [{ publicKey: toHex(merchantPublicKey(merchant)), address: bech32m.encodeFromBytes("mn_addr_preprod", recipient.bytes), name: "Fixture merchant" }], agentSecret: toHex(agent), salt: toHex(salt), limit: 1_000_000n, outstanding: 0n, epoch: 0n, generation: 1n };
  const before: OrganizationSnapshot = { schema: "line:organization-account/v1", networkId: "preprod", accountId: "13".repeat(32), issuerSecret: toHex(issuer), merchantSecret: toHex(merchant), facilities: [facility], quotes: [], notes: [], receipts: [] };
  const context = R.createCircuitContext(address, "0".repeat(64), state, { ...ps, salt: nextSalt }, undefined, undefined, 1000);
  const result = contract.circuits.openLine(context, 1000n + 7n * 86400n, 1000n, 100n);
  const initial = new L.QueryContext(predecessor.data, address);
  initial.block = { ...initial.block, secondsSinceEpoch: 1000n, secondsSinceEpochErr: 30 };
  const partitioned = L.partitionTranscripts([new L.PreTranscript(initial, result.proofData.publicTranscript)], L.LedgerParameters.initialParameters())[0];
  const op = actual.operation("openLine")!;
  const prototype = new L.ContractCallPrototype(address, "openLine", op, partitioned[0], partitioned[1], result.proofData.privateTranscriptOutputs, result.proofData.input, result.proofData.output, L.communicationCommitmentRandomness(), "openLine");
  const publicTransaction = L.Transaction.deserialize("signature", "proof", "binding", readFileSync(new URL("private-offer-public-pairs/3-openLine.proven-public-tx.bin", import.meta.url)));
  const publicProof = ([...publicTransaction.intents!.values()][0].actions[0] as L.ContractCall<L.Proof>).proof.serialize();
  const operationCount = (partitioned[0]?.program.length ?? 0) + (partitioned[1]?.program.length ?? 0);
  const transaction = (await L.Transaction.fromParts("preprod", undefined, undefined, L.Intent.new(new Date(4600_000)).addCall(prototype)).prove({ check: async () => Array(operationCount).fill(undefined), prove: async () => publicProof }, L.CostModel.initialCostModel())).bind();
  const after = structuredClone(before); Object.assign(after.facilities[0], { salt: toHex(nextSalt), generation: 2n });
  const pending: OrganizationPending = { id: "original", kind: "call", circuit: "openLine", facilityId: "facility", contractAddress: address, sourceFingerprint: policy.sourceFingerprint, after, txId: transaction.identifiers().at(-1)!, transaction: toHex(transaction.serialize()) };
  return { before, pending, predecessor, context, contract, ps };
}
