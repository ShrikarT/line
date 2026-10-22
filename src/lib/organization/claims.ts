import type { ledger } from "../../../contracts/managed/organization/contract/index.js";
import { drawNoteCommit, toHex } from "../line/encoding.ts";
import { bytes32, receivingAddressBytes, type OrganizationNote } from "./account.ts";

export type MerchantClaimReview = {
  contractAddress: string; noteCommitment: string; assetColor: string;
  receivingAddress: string; amount: bigint; fee: bigint; expiry: bigint; generation: bigint;
  status: "unspent" | "redeemed" | "cancelled";
};

/** Inspect one provider-observed contract snapshot. This is neither finality nor
 * a promise of payout: Compact still checks time, custody and single use.
 * Older claims use their own generation and survive merchant disabling.
 */
export function inspectMerchantClaim(book: ReturnType<typeof ledger>, note: OrganizationNote, merchantPk: string, receivingAddress: string): MerchantClaimReview {
  bytes32(note.contractAddress);
  if (merchantPk !== note.merchantPk || toHex(book.contractDomain) !== note.domain) throw new Error("This claim belongs to another merchant or facility.");
  const commitment = drawNoteCommit({ domain: bytes32(note.domain), lineGeneration: note.generation, identity: bytes32(note.identity), quoteCommit: bytes32(note.quoteCommitment), merchantPk: bytes32(note.merchantPk), amount: note.amount, fee: note.fee, noteNonce: bytes32(note.noteNonce), expiry: note.expiry }, bytes32(note.noteSalt));
  if (toHex(commitment) !== note.noteCommitment) throw new Error("Claim opening does not match its commitment.");
  if (!book.notes.member(commitment)) throw new Error("This claim was not found in the observed facility state. Check its original purchase transaction.");
  const meta = book.notes.lookup(commitment);
  if (meta.amount !== note.amount || meta.fee !== note.fee || meta.expiry !== note.expiry || meta.lineGeneration !== note.generation) throw new Error("Claim terms differ from the observed facility state.");
  const key = bytes32(merchantPk);
  if (!book.merchantPayoutRecipients.member(key) || toHex(book.merchantPayoutRecipients.lookup(key).bytes) !== toHex(receivingAddressBytes(receivingAddress))) throw new Error("This facility would pay another receiving address. Redemption is blocked.");
  return {
    contractAddress: note.contractAddress, noteCommitment: note.noteCommitment,
    assetColor: toHex(book.settlementTokenColor), receivingAddress,
    amount: meta.amount, fee: meta.fee, expiry: meta.expiry, generation: meta.lineGeneration,
    status: meta.redeemed ? "redeemed" : meta.cancelled ? "cancelled" : "unspent",
  };
}
