import test from "node:test";
import assert from "node:assert/strict";
import { activeServiceOrder, requireReplaceableOrder, retireServiceAttempt, serviceOrderNote, supplierRequestId } from "../src/lib/organization/orders.ts";
import type { OrganizationNote, OrganizationServiceOrder, OrganizationSnapshot } from "../src/lib/organization/account.ts";

const order: OrganizationServiceOrder = { id: "original", facilityId: "facility", service: "text-metrics", document: "Actual content", price: "25000", assetColor: "00".repeat(32), merchantPk: "11".repeat(32), merchantAddress: "recipient", delivered: false };
const note: OrganizationNote = { contractAddress: "address", domain: "22".repeat(32), identity: "33".repeat(32), merchantPk: order.merchantPk, quoteCommitment: "44".repeat(32), amount: 25000n, fee: 0n, expiry: 1n, generation: 1n, noteNonce: "55".repeat(32), noteSalt: "66".repeat(32), noteCommitment: "77".repeat(32), redeemed: false };
const snapshot = () => ({ facilities: [{ id: "facility", address: "address" }], serviceOrders: [structuredClone(order)], notes: [] } as unknown as OrganizationSnapshot);

test("cancelled, delivered and superseded requests cannot authorize a late draw", () => {
  const state = snapshot(); assert.equal(activeServiceOrder(state, "original", "original").id, "original");
  state.serviceOrders![0].requestId = "replacement";
  assert.throws(() => activeServiceOrder(state, "original", "original"), /changed/);
  state.serviceOrders![0].cancelled = true;
  assert.throws(() => activeServiceOrder(state, "original", "replacement"));
  state.serviceOrders![0].cancelled = false; state.serviceOrders![0].delivered = true;
  assert.throws(() => activeServiceOrder(state, "original", "replacement"));
});
test("an unlinked original quote claim blocks cancellation and replacement", () => {
  const state = snapshot(), current = state.serviceOrders![0]; state.notes.push(structuredClone(note));
  assert.equal(serviceOrderNote(state, current, note.quoteCommitment)?.noteCommitment, note.noteCommitment);
  assert.throws(() => requireReplaceableOrder(state, current, note.quoteCommitment, new Set()), /authorized claim/);
  state.notes[0].refund = { salt: "88".repeat(32), amount: 0n, paid: true };
  assert.throws(() => requireReplaceableOrder(state, current, note.quoteCommitment, new Set()), /authorized claim/);
  assert.doesNotThrow(() => requireReplaceableOrder(state, current, note.quoteCommitment, new Set([note.noteCommitment])));
});
test("replacement never forgets the original request or claim history", () => {
  const current = structuredClone(order); current.noteCommitment = note.noteCommitment; current.quoteCommitment = note.quoteCommitment;
  retireServiceAttempt(current); current.requestId = "new-uuid"; delete current.noteCommitment;
  assert.equal(supplierRequestId(current), "new-uuid"); assert.equal(current.id, "original");
  assert.equal(current.history![0].requestId, "original"); assert.equal(current.history![0].noteCommitment, note.noteCommitment);
  assert(Number.isFinite(Date.parse(current.history![0].retiredAt)));
});
test("a missing original claim record cannot be treated as an uncharged purchase", () => {
  const state = snapshot(), current = state.serviceOrders![0]; current.noteCommitment = note.noteCommitment;
  assert.throws(() => requireReplaceableOrder(state, current, undefined, new Set()), /missing/);
});
