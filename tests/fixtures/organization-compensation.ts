import { readFileSync } from "node:fs";
import * as L from "@midnight-ntwrk/ledger-v8";
import * as R from "@midnight-ntwrk/compact-runtime";
import { ledger } from "../../contracts/managed/organization/contract/index.js";
import { disableCandidateFixture } from "./organization-disable.ts";
import { agentId, drawNoteCommit, pad32, quoteCommit, toHex } from "../../src/lib/line/encoding.ts";
import type { OrganizationNote, OrganizationPending } from "../../src/lib/organization/account.ts";
import { EXPIRED_COMPENSATION as policy } from "../../src/lib/organization/expired-compensation-policy.ts";

/** Synthetic role secrets and generated transcripts; a mock proof exercises
 * serialization/replay only. No production signed bytes or private openings.
 */
export async function compensationCandidateFixture(mode = 1n, targetIndex = 0) {
  const f = await disableCandidateFixture(), address = f.pending.contractAddress!;
  let state = R.ContractState.deserialize(f.predecessor.serialize()), ps = { ...f.ps };
  const execute = (name: string, args: unknown[], now = 1000) => {
    const context = R.createCircuitContext(address, "0".repeat(64), state, ps, undefined, undefined, now);
    context.currentQueryContext.block = { ...context.currentQueryContext.block, balance: new Map([[{ tag: "unshielded", raw: "00".repeat(32) }, 1_000_000n]]) };
    const result = (f.contract.circuits as any)[name](context, ...args);
    const next = new R.ContractState(); next.data = result.context.currentQueryContext.state; state = next;
    return result;
  };
  execute("fundReserve", [1_000_000n]);
  const before = structuredClone(f.before), facility = before.facilities[0];
  const merchantPk = Buffer.from(facility.merchants[0].publicKey, "hex");
  for (let index = 0; index < 2; index++) {
    const invoiceId = pad32(`allocation-invoice-${index}`), quoteNonce = pad32(`allocation-quote-${index}`);
    const noteNonce = pad32(`allocation-note-${index}`), noteSalt = pad32(`allocation-salt-${index}`), newSalt = pad32(`allocation-book-${index}`);
    const book = ledger(state.data), expiry = 2000n;
    const quote = quoteCommit({ merchantPk, invoiceId, nonce: quoteNonce, amount: 100_000n, expiry, generation: 2n, domain: book.contractDomain, feeFlat: 1000n, feeBps: 100n });
    ps = { ...ps, callerSecret: Buffer.from(before.merchantSecret, "hex"), invoiceId, quoteNonce, quoteAmount: 100_000n };
    execute("postQuote", [expiry]);
    ps = { ...ps, callerSecret: Buffer.from(facility.agentSecret, "hex"), drawAmount: 100_000n, quoteMerchantPk: merchantPk, noteNonce, noteSalt, newSalt };
    execute("draw", [quote, expiry, 2000n]);
    const identity = agentId(Buffer.from(facility.agentSecret, "hex"));
    const commitment = drawNoteCommit({ domain: book.contractDomain, lineGeneration: 2n, identity, quoteCommit: quote, merchantPk, amount: 100_000n, fee: 2000n, noteNonce, expiry }, noteSalt);
    const note: OrganizationNote = { contractAddress: address, domain: toHex(book.contractDomain), identity: toHex(identity), merchantPk: toHex(merchantPk), quoteCommitment: toHex(quote), amount: 100_000n, fee: 2000n, expiry, generation: 2n, noteNonce: toHex(noteNonce), noteSalt: toHex(noteSalt), noteCommitment: toHex(commitment), redeemed: false };
    before.notes.push(note);
    facility.outstanding += 102_000n; facility.epoch++; facility.salt = toHex(newSalt);
    ps = { ...ps, salt: newSalt, lineOutstanding: facility.outstanding, lineEpoch: facility.epoch };
  }
  const predecessor = L.ContractState.deserialize(state.serialize()), chosen = before.notes[targetIndex], nextSalt = pad32("allocation-refund");
  ps = { ...ps, callerSecret: Buffer.from(before.issuerSecret, "hex"), noteIdentity: Buffer.from(chosen.identity, "hex"), noteQuoteCommit: Buffer.from(chosen.quoteCommitment, "hex"), quoteMerchantPk: Buffer.from(chosen.merchantPk, "hex"), noteNonce: Buffer.from(chosen.noteNonce, "hex"), noteSalt: Buffer.from(chosen.noteSalt, "hex"), newSalt: nextSalt };
  const result = execute("cancelOrExpireNote", [Buffer.from(chosen.noteCommitment, "hex"), mode, 4600n], 2100);
  const initial = new L.QueryContext(predecessor.data, address); initial.block = { ...initial.block, secondsSinceEpoch: 2100n, secondsSinceEpochErr: 30 };
  const partitioned = L.partitionTranscripts([new L.PreTranscript(initial, result.proofData.publicTranscript)], L.LedgerParameters.initialParameters())[0];
  const actual = L.ContractState.deserialize(Buffer.from(readFileSync(new URL("organization-merchant2-draw-state.hex", import.meta.url), "utf8"), "hex"));
  const prototype = new L.ContractCallPrototype(address, "cancelOrExpireNote", actual.operation("cancelOrExpireNote")!, partitioned[0], partitioned[1], result.proofData.privateTranscriptOutputs, result.proofData.input, result.proofData.output, L.communicationCommitmentRandomness(), "cancelOrExpireNote");
  const publicTx = L.Transaction.deserialize("signature", "proof", "binding", readFileSync(new URL("private-offer-public-pairs/3-openLine.proven-public-tx.bin", import.meta.url)));
  const proof = ([...publicTx.intents!.values()][0].actions[0] as L.ContractCall<L.Proof>).proof.serialize();
  const count = (partitioned[0]?.program.length ?? 0) + (partitioned[1]?.program.length ?? 0);
  const transaction = (await L.Transaction.fromParts("preprod", undefined, undefined, L.Intent.new(new Date(4600_000)).addCall(prototype)).prove({ check: async () => Array(count).fill(undefined), prove: async () => proof }, L.CostModel.initialCostModel())).bind();
  const after = structuredClone(before);
  after.notes[0].refund = { salt: toHex(nextSalt), amount: 0n, paid: true };
  Object.assign(after.facilities[0], { outstanding: facility.outstanding - 102_000n, epoch: facility.epoch + 1n, salt: toHex(nextSalt) });
  const pending: OrganizationPending = { id: "original-compensation", kind: "call", circuit: "cancelOrExpireNote", facilityId: facility.id, contractAddress: address, sourceFingerprint: policy.sourceFingerprint, after, txId: transaction.identifiers().at(-1)!, transaction: toHex(transaction.serialize()) };
  return { before, pending, predecessor, contract: f.contract, ps, target: before.notes[0].noteCommitment, allocated: state };
}
