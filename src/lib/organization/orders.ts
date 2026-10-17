import type { OrganizationNote, OrganizationServiceOrder, OrganizationSnapshot } from "./account.ts";

export const supplierRequestId = (order: OrganizationServiceOrder) => order.requestId ?? order.id;

export function activeServiceOrder(snapshot: OrganizationSnapshot, id: string, requestId: string) {
  const order = snapshot.serviceOrders?.find(item => item.id === id);
  if (!order || order.cancelled || order.delivered || supplierRequestId(order) !== requestId) throw new Error("This purchase changed in another tab. Open its current saved request before continuing.");
  return order;
}

/** Include a claim saved before an older client linked it back to its API order. */
export function serviceOrderNote(snapshot: OrganizationSnapshot, order: OrganizationServiceOrder, knownQuote?: string): OrganizationNote | undefined {
  const address = snapshot.facilities.find(f => f.id === order.facilityId)?.address;
  return snapshot.notes.find(note => note.contractAddress === address && (note.noteCommitment === order.noteCommitment || note.quoteCommitment === (order.quoteCommitment ?? knownQuote)));
}

export function requireReplaceableOrder(snapshot: OrganizationSnapshot, order: OrganizationServiceOrder, knownQuote: string | undefined, settled: ReadonlySet<string>) {
  const note = serviceOrderNote(snapshot, order, knownQuote);
  if (note && !settled.has(note.noteCommitment)) throw new Error("This purchase already has an authorized claim. Recover its delivery or expired-claim refund before requesting another payment.");
  if (order.noteCommitment && !note) throw new Error("The original claim record is missing. Recover it before replacing this purchase.");
}

export function retireServiceAttempt(order: OrganizationServiceOrder) {
  order.history ??= [];
  if (order.history.length >= 100) throw new Error("This purchase reached its quote history limit. Retain its records and start a separate task.");
  order.history.push({ requestId: supplierRequestId(order), ...(order.quoteCommitment ? { quoteCommitment: order.quoteCommitment } : {}), ...(order.noteCommitment ? { noteCommitment: order.noteCommitment } : {}), retiredAt: new Date().toISOString() });
}
