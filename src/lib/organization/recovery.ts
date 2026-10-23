import { Status, type ledger } from "../../../contracts/managed/organization/contract/index.js";
import { agentId, contractDomain, drawNoteCommit, issuerPublicKey, lineStateCommit, refundCommit, toHex } from "../line/encoding.ts";
import { bytes32, receivingAddressBytes, type OrganizationFacility, type OrganizationNote } from "./account.ts";

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);
/** A backup is usable only at its committed book, or its exact pending candidate. */
export function matchesRestoredFacility(book: ReturnType<typeof ledger>, facility: OrganizationFacility, issuerSecret: string): boolean {
  if (!facility.merchants[0] || !same(book.issuerPayoutRecipient.bytes, receivingAddressBytes(facility.issuerRecipient)) || toHex(book.settlementTokenColor) !== facility.assetColor || book.lineGeneration !== facility.generation) return false;
  const issuer = issuerPublicKey(bytes32(issuerSecret));
  if (!same(issuer, book.issuer)) return false;
  const domain = contractDomain(issuer, bytes32(facility.merchants[0].publicKey), bytes32(facility.instanceNonce));
  if (!same(domain, book.contractDomain)) return false;
  if (facility.generation === 0n) return book.status === Status.NONE;
  const identity = agentId(bytes32(facility.agentSecret));
  return same(identity, book.identityCommit) && same(lineStateCommit({ domain, identity, limit: facility.limit, outstanding: facility.outstanding, epoch: facility.epoch }, bytes32(facility.salt)), book.lineCommit);
}

/** Compensation can change an old claim without changing today's line book. */
export function matchesRestoredNotes(book: ReturnType<typeof ledger>, notes: OrganizationNote[]): boolean {
  return notes.every(note => {
    const commitment = bytes32(note.noteCommitment);
    if (!same(bytes32(note.domain), book.contractDomain) || !book.notes.member(commitment)) return false;
    const observed = book.notes.lookup(commitment);
    if (note.expiryRecorded && !observed.cancelled) return false;
    if (observed.amount !== note.amount || observed.fee !== note.fee || observed.expiry !== note.expiry || observed.lineGeneration !== note.generation || note.redeemed && !observed.redeemed) return false;
    const opening = drawNoteCommit({ domain: bytes32(note.domain), lineGeneration: note.generation, identity: bytes32(note.identity), quoteCommit: bytes32(note.quoteCommitment), merchantPk: bytes32(note.merchantPk), amount: note.amount, fee: note.fee, noteNonce: bytes32(note.noteNonce), expiry: note.expiry }, bytes32(note.noteSalt));
    if (!same(opening, commitment) || observed.compensationAllocated !== !!note.refund) return false;
    if (!note.refund) return true;
    const refund = refundCommit({ domain: bytes32(note.domain), lineGeneration: note.generation, identity: bytes32(note.identity), noteCommit: commitment, amount: note.refund.amount }, bytes32(note.refund.salt));
    return same(refund, observed.refundCommitment) && observed.cashRefundOwed === (note.refund.amount > 0n) && note.refund.paid === (!observed.cashRefundOwed || observed.refundAcknowledged);
  });
}
