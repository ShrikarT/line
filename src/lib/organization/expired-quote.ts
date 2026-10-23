import { ContractState, CostModel, QueryContext, ContractCall } from "@midnight-ntwrk/ledger-v8";
import { ContractState as CompactState } from "@midnight-ntwrk/compact-runtime";
import { ledger, Status } from "../../../contracts/managed/organization/contract/index.js";
import { EXPIRED_QUOTE as policy, matchesExpiredQuoteScope, type ExpiredQuoteEvidence } from "./expired-quote-policy.ts";
import { validatePinnedExpiryEvidence, validateOpeningExpiry } from "./expired-opening.ts";
import { bytes32, copyAccount, receivingAddressBytes, type OrganizationPending, type OrganizationSnapshot } from "./account.ts";
import { decodeOriginalOrganizationTransaction } from "./transactions.ts";
import { canonicalInvoiceIdBytes, merchantPublicKey, quoteCommit, toHex } from "../line/encoding.ts";
import { encodeVaultJson } from "../security/vault.ts";

function need(condition: unknown): asserts condition { if (!condition) throw Error("The expired quote recovery assumptions could not be verified. Keep the original operation saved."); }
const bookOf = (state: ContractState) => ledger(CompactState.deserialize(state.serialize()).data);

/** Quote membership never disappears: postQuote requires absent membership and
 * draw preserves it while marking used. The unchanged maintenance counter and
 * release exclude intervening replacement rules. Absence is checked at a pinned
 * post-expiry state; an absent receipt or fee TTL alone never admits archival.
 */
export async function validateExpiredQuoteEvidence(value: unknown, verifierKey: (name: string) => Promise<Uint8Array>) {
  const result = await validatePinnedExpiryEvidence<ExpiredQuoteEvidence>(value, verifierKey, policy, "line:expired-quote-evidence/v1", Status.OPEN, 2n);
  const b = bookOf(result.state);
  need(!b.quotes.member(bytes32(policy.quoteCommitment)) && b.registeredMerchants.lookup(bytes32(policy.merchantPk)));
  need(toHex(b.merchantPayoutRecipients.lookup(bytes32(policy.merchantPk)).bytes) === toHex(receivingAddressBytes(policy.merchantAddress)));
  return result;
}

/** Merchant accounts need not own the facility. Bind their actual private role
 * key and the complete appended quote opening to canonical signed replay.
 */
export function validateQuoteCandidate(before: OrganizationSnapshot, pending: OrganizationPending, state: ContractState, sourceFingerprint: string) {
  need(pending.kind === "call" && pending.circuit === "postQuote" && pending.facilityId === null);
  const transaction = decodeOriginalOrganizationTransaction(pending, sourceFingerprint);
  const intents = [...transaction.intents!.values()], ttl = Math.max(...intents.map(i => i.ttl.getTime()));
  const action = intents.flatMap(i => i.actions)[0]; need(action instanceof ContractCall);
  need(pending.after.quotes.length === before.quotes.length + 1);
  const q = pending.after.quotes.at(-1)!;
  const b = bookOf(state), key = bytes32(q.quoteCommitment);
  need(q.contractAddress === pending.contractAddress && q.merchantPk === toHex(merchantPublicKey(bytes32(before.merchantSecret))));
  need(q.domain === toHex(b.contractDomain) && q.generation === b.lineGeneration && q.feeFlat === b.feeFlat && q.feeBps === b.feeBps && q.amount > 0n);
  need(b.registeredMerchants.member(bytes32(q.merchantPk)) && b.registeredMerchants.lookup(bytes32(q.merchantPk)) && !b.quotes.member(key));
  need(q.quoteCommitment === toHex(quoteCommit({ domain: bytes32(q.domain), merchantPk: bytes32(q.merchantPk), invoiceId: bytes32(q.invoiceId), nonce: bytes32(q.quoteNonce), amount: q.amount, expiry: q.expiry, generation: q.generation, feeFlat: q.feeFlat, feeBps: q.feeBps })));
  const expected = copyAccount(before); expected.quotes.push(copyAccount(q));
  need(encodeVaultJson(expected) === encodeVaultJson(pending.after));
  let context = new QueryContext(state.data, pending.contractAddress!);
  context.block = { ...context.block, secondsSinceEpoch: BigInt(Math.floor(ttl / 1000) - 60), secondsSinceEpochErr: 30, balance: state.balance };
  need(action.guaranteedTranscript || action.fallibleTranscript);
  for (const transcript of [action.guaranteedTranscript, action.fallibleTranscript]) if (transcript) context = context.runTranscript(transcript, CostModel.initialCostModel());
  const next = new ContractState(); next.data = context.state;
  const quoted = bookOf(next); need(quoted.quotes.member(key));
  const meta = quoted.quotes.lookup(key);
  need(!meta.used && meta.expiry === q.expiry && meta.lineGeneration === q.generation && [...quoted.quotes].length === [...b.quotes].length + 1);
  need(toHex(quoted.lineCommit) === toHex(b.lineCommit) && quoted.status === b.status && quoted.lineGeneration === b.lineGeneration);
  return ttl;
}

export async function verifyExpiredQuote(before: OrganizationSnapshot, pending: OrganizationPending, value: unknown, sourceFingerprint: string, verifierKey: (name: string) => Promise<Uint8Array>) {
  need(sourceFingerprint === policy.sourceFingerprint && matchesExpiredQuoteScope(pending));
  const { evidence, state } = await validateExpiredQuoteEvidence(value, verifierKey);
  const ttl = validateQuoteCandidate(before, pending, state, sourceFingerprint), q = pending.after.quotes.at(-1)!;
  need(q.quoteCommitment === policy.quoteCommitment && q.merchantPk === policy.merchantPk && q.invoiceId === toHex(canonicalInvoiceIdBytes(policy.invoice)) && q.amount === 100_000n && q.feeFlat === 1000n && q.feeBps === 100n);
  validateQuoteExpiry(ttl, evidence.finalized.timestamp);
  return { evidence, ttl };
}
export function validateQuoteExpiry(ttl: number, timestamp: number) {
  if (Math.floor(timestamp / 1000) <= Math.floor(ttl / 1000) + 30) throw Error(`Keep this quote pending until finalized ledger time passes ${new Date(ttl + 31_000).toISOString()}. The shorter DUST deadline alone cannot authorize archival.`);
  validateOpeningExpiry(ttl, timestamp);
}
export type ExpiredQuoteReview = { operationId: string; txId: string; operationDigest: string; snapshotDigest: string; checkedAt: number; evidence: ExpiredQuoteEvidence; ttl: number };
