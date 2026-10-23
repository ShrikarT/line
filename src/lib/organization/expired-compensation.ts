import { ContractState, CostModel, QueryContext, ContractCall } from "@midnight-ntwrk/ledger-v8";
import { ContractState as CompactState } from "@midnight-ntwrk/compact-runtime";
import { ledger, Status } from "../../../contracts/managed/organization/contract/index.js";
import { EXPIRED_COMPENSATION as policy, matchesExpiredCompensationScope, type ExpiredCompensationEvidence } from "./expired-compensation-policy.ts";
import { validatePinnedExpiryEvidence, validateOpeningExpiry } from "./expired-opening.ts";
import { bytes32, copyAccount, type OrganizationPending, type OrganizationSnapshot } from "./account.ts";
import { decodeOriginalOrganizationTransaction } from "./transactions.ts";
import { matchesRestoredFacility, matchesRestoredNotes } from "./recovery.ts";
import { encodeVaultJson } from "../security/vault.ts";
import { hexToBytes } from "../bytes.ts";

function need(condition: unknown): asserts condition { if (!condition) throw Error("The expired claim recovery assumptions could not be verified. Keep the original operation saved."); }
const bookOf = (state: ContractState) => ledger(CompactState.deserialize(state.serialize()).data);

/** Allocation sets compensationAllocated permanently. Draw rejects an existing
 * note; expiry/redemption cannot reset an allocated claim. The pinned complete
 * predecessor and unchanged nonsaturated maintenance counter exclude replacement
 * semantics. This is provider-backed evidence, not a failed transaction receipt.
 */
export async function validateExpiredCompensationEvidence(value: unknown, verifierKey: (name: string) => Promise<Uint8Array>) {
  const result = await validatePinnedExpiryEvidence<ExpiredCompensationEvidence>(value, verifierKey, policy, "line:expired-compensation-evidence/v1", Status.OPEN, 2n);
  const book = bookOf(result.state), key = hexToBytes(policy.noteCommitment);
  need(book.notes.member(key));
  const note = book.notes.lookup(key);
  need(note.amount === 100_000n && note.fee === 2000n && note.lineGeneration === 2n && !note.redeemed && !note.cancelled && !note.compensationAllocated);
  return result;
}

/** Replay binds the exact claim, mode-1 effect, rotated book and refund opening.
 * Only the fixed policy supplies target in production. Synthetic generated
 * transcripts exercise this binding without exporting an owner's private state.
 */
export function validateCompensationCandidate(before: OrganizationSnapshot, pending: OrganizationPending, state: ContractState, sourceFingerprint: string, target: string) {
  need(pending.kind === "call" && pending.circuit === "cancelOrExpireNote" && !!pending.facilityId);
  const transaction = decodeOriginalOrganizationTransaction(pending, sourceFingerprint);
  const intents = [...transaction.intents!.values()], ttl = Math.max(...intents.map(intent => intent.ttl.getTime()));
  const action = intents.flatMap(intent => intent.actions)[0]; need(action instanceof ContractCall);
  const facility = before.facilities.find(f => f.id === pending.facilityId);
  const candidate = pending.after.facilities.find(f => f.id === pending.facilityId);
  need(facility && candidate && facility.address === pending.contractAddress && candidate.address === facility.address);
  const predecessor = bookOf(state), key = bytes32(target);
  need(predecessor.status === Status.OPEN && predecessor.lineGeneration === 2n && matchesRestoredFacility(predecessor, facility, before.issuerSecret));
  need(predecessor.notes.member(key));
  const observed = predecessor.notes.lookup(key);
  need(!observed.redeemed && !observed.cancelled && !observed.compensationAllocated && observed.amount === 100_000n && observed.fee === 2000n && observed.lineGeneration === facility.generation);
  const note = before.notes.find(n => n.contractAddress === facility.address && n.noteCommitment === target);
  const nextNote = pending.after.notes.find(n => n.contractAddress === facility.address && n.noteCommitment === target);
  need(note && !note.refund && !note.redeemed && nextNote?.refund && facility.outstanding >= note.amount + note.fee);
  need(matchesRestoredNotes(predecessor, before.notes.filter(n => n.contractAddress === facility.address)));
  const expected = copyAccount(before), next = expected.facilities.find(f => f.id === pending.facilityId)!;
  const expectedNote = expected.notes.find(n => n.contractAddress === facility.address && n.noteCommitment === target)!;
  bytes32(nextNote.refund.salt);
  expectedNote.refund = { salt: nextNote.refund.salt, amount: 0n, paid: true };
  next.outstanding -= note.amount + note.fee; next.epoch++; next.salt = nextNote.refund.salt;
  need(encodeVaultJson(expected) === encodeVaultJson(pending.after));
  let context = new QueryContext(state.data, pending.contractAddress!);
  context.block = { ...context.block, secondsSinceEpoch: BigInt(Math.floor(ttl / 1000) - 60), secondsSinceEpochErr: 30, balance: state.balance };
  need(action.guaranteedTranscript || action.fallibleTranscript);
  for (const transcript of [action.guaranteedTranscript, action.fallibleTranscript]) if (transcript) context = context.runTranscript(transcript, CostModel.initialCostModel());
  const result = new ContractState(); result.data = context.state;
  const allocated = bookOf(result), recovered = allocated.notes.lookup(key);
  need(recovered.cancelled && recovered.compensationAllocated && !recovered.redeemed && !recovered.cashRefundOwed && !recovered.refundAcknowledged);
  need(allocated.encumberedReserve === predecessor.encumberedReserve - note.amount && allocated.pendingFeeReserve === predecessor.pendingFeeReserve - note.fee && allocated.refundReserve === predecessor.refundReserve);
  need(allocated.status === Status.OPEN && allocated.lineGeneration === 2n && matchesRestoredFacility(allocated, candidate, before.issuerSecret));
  need(matchesRestoredNotes(allocated, pending.after.notes.filter(n => n.contractAddress === facility.address)));
  return ttl;
}

export async function verifyExpiredCompensation(before: OrganizationSnapshot, pending: OrganizationPending, value: unknown, sourceFingerprint: string, verifierKey: (name: string) => Promise<Uint8Array>) {
  need(sourceFingerprint === policy.sourceFingerprint && matchesExpiredCompensationScope(pending));
  const { evidence, state } = await validateExpiredCompensationEvidence(value, verifierKey);
  const ttl = validateCompensationCandidate(before, pending, state, sourceFingerprint, policy.noteCommitment);
  // Deliberately wait past every intent, not just the shorter DUST fee deadline.
  validateOpeningExpiry(ttl, evidence.finalized.timestamp);
  return { evidence, ttl };
}
export type ExpiredCompensationReview = { operationId: string; txId: string; operationDigest: string; snapshotDigest: string; checkedAt: number; evidence: ExpiredCompensationEvidence; ttl: number };
