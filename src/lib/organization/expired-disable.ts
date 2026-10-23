import { ContractState, CostModel, QueryContext, ContractCall } from "@midnight-ntwrk/ledger-v8";
import { ContractState as CompactState } from "@midnight-ntwrk/compact-runtime";
import { ledger, Status } from "../../../contracts/managed/organization/contract/index.js";
import { EXPIRED_DISABLE as policy, matchesExpiredDisableScope, type ExpiredDisableEvidence } from "./expired-disable-policy.ts";
import { validatePinnedExpiryEvidence, validateOpeningExpiry } from "./expired-opening.ts";
import { copyAccount, receivingAddressBytes, type OrganizationPending, type OrganizationSnapshot } from "./account.ts";
import { decodeOriginalOrganizationTransaction } from "./transactions.ts";
import { matchesRestoredFacility } from "./recovery.ts";
import { encodeVaultJson } from "../security/vault.ts";
import { hexToBytes, toHex } from "../bytes.ts";

function need(condition: unknown): asserts condition { if (!condition) throw Error("The expired merchant disable recovery assumptions could not be verified. Keep the original operation saved."); }
const bookOf = (state: ContractState) => ledger(CompactState.deserialize(state.serialize()).data);

/** An active registered key cannot return after disable: register requires absent
 * membership, and no release circuit removes membership. Unchanged nonsaturated
 * maintenance counter excludes verifier/authority replacement in the interval.
 */
export async function validateExpiredDisableEvidence(value: unknown, verifierKey: (name: string) => Promise<Uint8Array>) {
  const result = await validatePinnedExpiryEvidence<ExpiredDisableEvidence>(value, verifierKey, policy, "line:expired-disable-evidence/v1", Status.OPEN, 2n);
  const book = bookOf(result.state), key = hexToBytes(policy.merchantPk);
  need(book.registeredMerchants.member(key) && book.registeredMerchants.lookup(key));
  need(toHex(book.merchantPayoutRecipients.lookup(key).bytes) === toHex(receivingAddressBytes(policy.merchantAddress)));
  return result;
}

/** Replay canonical retained bytes to bind the actual disabled key and candidate.
 * This validates the transcript/state binding, not the zero-knowledge proof.
 */
export function validateDisableCandidate(before: OrganizationSnapshot, pending: OrganizationPending, state: ContractState, sourceFingerprint: string) {
  need(pending.kind === "call" && pending.circuit === "disableMerchant" && !!pending.facilityId);
  const transaction = decodeOriginalOrganizationTransaction(pending, sourceFingerprint);
  const intents = [...transaction.intents!.values()], ttl = Math.max(...intents.map(intent => intent.ttl.getTime()));
  const action = intents.flatMap(intent => intent.actions)[0]; need(action instanceof ContractCall);
  const facility = before.facilities.find(f => f.id === pending.facilityId);
  const candidate = pending.after.facilities.find(f => f.id === pending.facilityId);
  need(facility && candidate && facility.address === pending.contractAddress && candidate.address === facility.address);
  const predecessor = bookOf(state), key = hexToBytes(policy.merchantPk);
  need(predecessor.status === Status.OPEN && predecessor.lineGeneration === 2n && matchesRestoredFacility(predecessor, facility, before.issuerSecret));
  need(predecessor.registeredMerchants.member(key) && predecessor.registeredMerchants.lookup(key));
  need(toHex(predecessor.merchantPayoutRecipients.lookup(key).bytes) === toHex(receivingAddressBytes(policy.merchantAddress)));
  const expected = copyAccount(before), next = expected.facilities.find(f => f.id === pending.facilityId)!;
  const merchant = next.merchants.find(m => m.publicKey === policy.merchantPk);
  need(merchant && !merchant.disabled && merchant.address === policy.merchantAddress);
  merchant.disabled = true;
  need(encodeVaultJson(expected) === encodeVaultJson(pending.after));
  let context = new QueryContext(state.data, pending.contractAddress!);
  context.block = { ...context.block, secondsSinceEpoch: BigInt(Math.floor(ttl / 1000) - 60), secondsSinceEpochErr: 30, balance: state.balance };
  need(action.guaranteedTranscript || action.fallibleTranscript);
  for (const transcript of [action.guaranteedTranscript, action.fallibleTranscript]) if (transcript) context = context.runTranscript(transcript, CostModel.initialCostModel());
  const result = new ContractState(); result.data = context.state;
  const disabled = bookOf(result);
  need(disabled.registeredMerchants.member(key) && !disabled.registeredMerchants.lookup(key));
  need(disabled.status === Status.OPEN && disabled.lineGeneration === 2n && matchesRestoredFacility(disabled, candidate, before.issuerSecret));
  return ttl;
}

export async function verifyExpiredDisable(before: OrganizationSnapshot, pending: OrganizationPending, value: unknown, sourceFingerprint: string, verifierKey: (name: string) => Promise<Uint8Array>) {
  need(sourceFingerprint === policy.sourceFingerprint && matchesExpiredDisableScope(pending));
  const { evidence, state } = await validateExpiredDisableEvidence(value, verifierKey);
  const ttl = validateDisableCandidate(before, pending, state, sourceFingerprint);
  validateOpeningExpiry(ttl, evidence.finalized.timestamp);
  return { evidence, ttl };
}
export type ExpiredDisableReview = { operationId: string; txId: string; operationDigest: string; snapshotDigest: string; checkedAt: number; evidence: ExpiredDisableEvidence; ttl: number };
