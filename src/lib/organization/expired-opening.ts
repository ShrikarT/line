import { ContractState, CostModel, QueryContext, ContractCall } from "@midnight-ntwrk/ledger-v8";
import { ContractState as CompactState } from "@midnight-ntwrk/compact-runtime";
import { ledger, Status } from "../../../contracts/managed/organization/contract/index.js";
import { EXPIRED_OPENING as policy, matchesExpiredOpeningScope, type ExpiredOpeningEvidence } from "./expired-opening-policy.ts";
import { copyAccount, type OrganizationPending, type OrganizationSnapshot } from "./account.ts";
import { decodeOriginalOrganizationTransaction } from "./transactions.ts";
import { matchesRestoredFacility } from "./recovery.ts";
import { encodeVaultJson } from "../security/vault.ts";
import { hexToBytes, toHex } from "../bytes.ts";

const CIRCUITS = ["registerMerchant", "disableMerchant", "fundReserve", "withdrawUnencumberedReserve", "withdrawFees", "openLine", "postQuote", "draw", "redeemDraw", "cancelOrExpireNote", "acknowledgeRepayment", "setStatus"];
function need(condition: unknown): asserts condition { if (!condition) throw Error("The expired opening recovery assumptions could not be verified. Keep the original operation saved."); }
export const recoveryDigest = async (value: unknown) => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encodeVaultJson(value)))));
const sha256 = async (bytes: Uint8Array) => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
const bookOf = (state: ContractState) => ledger(CompactState.deserialize(state.serialize()).data);

/** Provider-backed evidence, deliberately limited to the audited predecessor. */
export async function validateExpiredOpeningEvidence(value: unknown, verifierKey: (name: string) => Promise<Uint8Array>) {
  const e = value as ExpiredOpeningEvidence | null;
  need(e?.schema === "line:expired-opening-evidence/v1" && e.address === policy.address && e.genesisHash === policy.genesisHash && e.runtimeSpecVersion === policy.runtimeSpecVersion);
  need(e.baseline?.hash === policy.baselineHash && e.baseline.height === policy.baselineHeight);
  need(/^[0-9a-f]{64}$/.test(e.finalized?.hash) && Number.isSafeInteger(e.finalized.height) && e.finalized.height > policy.baselineHeight && Number.isSafeInteger(e.finalized.timestamp) && e.finalized.timestamp > 0);
  for (const state of [e.baseline.state, e.finalized.state]) need(typeof state === "string" && /^(?:[0-9a-f]{2})+$/.test(state) && state.length <= 256000);
  need(await sha256(hexToBytes(e.baseline.state)) === policy.baselineStateSha256);
  // Stronger than generation equality: the entire pinned contract is unchanged.
  need(e.baseline.state === e.finalized.state);
  const state = ContractState.deserialize(hexToBytes(e.baseline.state));
  need(toHex(state.serialize()) === e.baseline.state && state.maintenanceAuthority.counter === 11n && state.maintenanceAuthority.counter < 0xffff_ffffn);
  const names = state.operations();
  need(names.length === CIRCUITS.length && names.every(name => typeof name === "string" && CIRCUITS.includes(name)));
  for (const name of CIRCUITS) need(toHex(state.operation(name)!.verifierKey) === toHex(await verifierKey(name)));
  const book = bookOf(state); need(book.status === Status.CLOSED && book.lineGeneration === 1n);
  return { evidence: copyAccount(e), state };
}

/** Replay the exact public action, rather than trusting candidate generation metadata.
 * This checks transcript/state binding, not the network's zero-knowledge proof.
 */
export function validateOpeningCandidate(before: OrganizationSnapshot, pending: OrganizationPending, state: ContractState, sourceFingerprint: string) {
  need(pending.kind === "call" && pending.circuit === "openLine" && !!pending.facilityId);
  const transaction = decodeOriginalOrganizationTransaction(pending, sourceFingerprint);
  const intents = [...transaction.intents!.values()];
  const ttl = Math.max(...intents.map(intent => intent.ttl.getTime()));
  const action = intents.flatMap(intent => intent.actions)[0];
  need(action instanceof ContractCall);
  const facility = before.facilities.find(f => f.id === pending.facilityId);
  const candidate = pending.after.facilities.find(f => f.id === pending.facilityId);
  need(facility && candidate && facility.address === pending.contractAddress && candidate.address === facility.address);
  const predecessor = bookOf(state);
  need(predecessor.status === Status.CLOSED && predecessor.lineGeneration === 1n && matchesRestoredFacility(predecessor, facility, before.issuerSecret));
  need(candidate.generation === 2n && candidate.limit === 1_000_000n && candidate.outstanding === 0n && candidate.epoch === 0n);
  const expected = copyAccount(before), next = expected.facilities.find(f => f.id === pending.facilityId)!;
  Object.assign(next, { salt: candidate.salt, limit: candidate.limit, outstanding: 0n, epoch: 0n, generation: 2n });
  need(encodeVaultJson(expected) === encodeVaultJson(pending.after));
  let context = new QueryContext(state.data, pending.contractAddress!);
  context.block = { ...context.block, secondsSinceEpoch: BigInt(Math.floor(ttl / 1000) - 60), secondsSinceEpochErr: 30, balance: state.balance };
  need(action.guaranteedTranscript || action.fallibleTranscript);
  for (const transcript of [action.guaranteedTranscript, action.fallibleTranscript]) if (transcript) context = context.runTranscript(transcript, CostModel.initialCostModel());
  const result = new ContractState(); result.data = context.state;
  const opened = bookOf(result);
  need(opened.status === Status.OPEN && opened.lineGeneration === 2n && opened.feeFlat === 1000n && opened.feeBps === 100n && matchesRestoredFacility(opened, candidate, before.issuerSecret));
  const ttlSeconds = BigInt(Math.floor(ttl / 1000));
  need(opened.lineExpiry > ttlSeconds + 6n * 86400n && opened.lineExpiry <= ttlSeconds + 7n * 86400n);
  return ttl;
}

export async function verifyExpiredOpening(before: OrganizationSnapshot, pending: OrganizationPending, value: unknown, sourceFingerprint: string, verifierKey: (name: string) => Promise<Uint8Array>) {
  need(sourceFingerprint === policy.sourceFingerprint && matchesExpiredOpeningScope(pending));
  const { evidence, state } = await validateExpiredOpeningEvidence(value, verifierKey);
  const ttl = validateOpeningCandidate(before, pending, state, sourceFingerprint);
  // Ledger 8 rejects ttl < tblock, with tblock=floor(Timestamp.Now/1000).
  // Strictly pass the boundary, including the node's 30-second uncertainty.
  validateOpeningExpiry(ttl, evidence.finalized.timestamp);
  return { evidence, ttl };
}

export function validateOpeningExpiry(ttl: number, finalizedTimestamp: number) {
  need(Number.isSafeInteger(ttl) && ttl > 0 && Number.isSafeInteger(finalizedTimestamp) && Math.floor(finalizedTimestamp / 1000) > Math.floor(ttl / 1000) + 30);
}

export type ExpiredOpeningReview = { operationId: string; txId: string; operationDigest: string; snapshotDigest: string; checkedAt: number; evidence: ExpiredOpeningEvidence; ttl: number };
