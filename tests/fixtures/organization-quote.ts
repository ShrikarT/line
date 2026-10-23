import { readFileSync } from "node:fs";
import * as L from "@midnight-ntwrk/ledger-v8";
import * as R from "@midnight-ntwrk/compact-runtime";
import { ledger } from "../../contracts/managed/organization/contract/index.js";
import { disableCandidateFixture } from "./organization-disable.ts";
import { canonicalInvoiceIdBytes, pad32, quoteCommit, toHex } from "../../src/lib/line/encoding.ts";
import type { OrganizationPending, OrganizationQuote } from "../../src/lib/organization/account.ts";
import { EXPIRED_QUOTE as policy } from "../../src/lib/organization/expired-quote-policy.ts";

/** Synthetic merchant role, generated transcript and mock proof. */
export async function quoteCandidateFixture(wrongTranscript = false) {
  const f = await disableCandidateFixture(), before = structuredClone(f.before), address = f.pending.contractAddress!;
  const state = R.ContractState.deserialize(f.predecessor.serialize()), book = ledger(state.data);
  const merchantPk = Buffer.from(before.facilities[0].merchants[0].publicKey, "hex"), invoiceId = canonicalInvoiceIdBytes(policy.invoice), nonce = pad32("retained-quote");
  const q: OrganizationQuote = { contractAddress: address, domain: toHex(book.contractDomain), merchantPk: toHex(merchantPk), invoiceId: toHex(invoiceId), quoteNonce: toHex(nonce), amount: 100_000n, expiry: 10000n, generation: 2n, feeFlat: 1000n, feeBps: 100n, quoteCommitment: "" };
  q.quoteCommitment = toHex(quoteCommit({ domain: book.contractDomain, merchantPk, invoiceId, nonce, amount: q.amount, expiry: q.expiry, generation: q.generation, feeFlat: q.feeFlat, feeBps: q.feeBps }));
  const ps = { ...f.ps, callerSecret: Buffer.from(before.merchantSecret, "hex"), quoteAmount: q.amount, invoiceId, quoteNonce: wrongTranscript ? pad32("another-quote") : nonce };
  const result = f.contract.circuits.postQuote(R.createCircuitContext(address, "0".repeat(64), state, ps, undefined, undefined, 1000), q.expiry);
  const initial = new L.QueryContext(f.predecessor.data, address); initial.block = { ...initial.block, secondsSinceEpoch: 1000n, secondsSinceEpochErr: 30 };
  const partitioned = L.partitionTranscripts([new L.PreTranscript(initial, result.proofData.publicTranscript)], L.LedgerParameters.initialParameters())[0];
  const actual = L.ContractState.deserialize(Buffer.from(readFileSync(new URL("organization-compensated-state.hex", import.meta.url), "utf8"), "hex"));
  const prototype = new L.ContractCallPrototype(address, "postQuote", actual.operation("postQuote")!, partitioned[0], partitioned[1], result.proofData.privateTranscriptOutputs, result.proofData.input, result.proofData.output, L.communicationCommitmentRandomness(), "postQuote");
  const publicTx = L.Transaction.deserialize("signature", "proof", "binding", readFileSync(new URL("private-offer-public-pairs/3-openLine.proven-public-tx.bin", import.meta.url)));
  const proof = ([...publicTx.intents!.values()][0].actions[0] as L.ContractCall<L.Proof>).proof.serialize();
  const count = (partitioned[0]?.program.length ?? 0) + (partitioned[1]?.program.length ?? 0);
  const transaction = (await L.Transaction.fromParts("preprod", undefined, undefined, L.Intent.new(new Date(4600_000)).addCall(prototype)).prove({ check: async () => Array(count).fill(undefined), prove: async () => proof }, L.CostModel.initialCostModel())).bind();
  const after = structuredClone(before); after.quotes.push(q);
  const pending: OrganizationPending = { id: "original-quote", kind: "call", circuit: "postQuote", facilityId: null, contractAddress: address, sourceFingerprint: policy.sourceFingerprint, after, txId: transaction.identifiers().at(-1)!, transaction: toHex(transaction.serialize()) };
  const quoted = new R.ContractState(); quoted.data = result.context.currentQueryContext.state;
  return { before, pending, predecessor: f.predecessor, quoted, contract: f.contract, ps, q };
}
