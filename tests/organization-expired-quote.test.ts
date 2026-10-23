import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "@midnight-ntwrk/ledger-v8";
import * as R from "@midnight-ntwrk/compact-runtime";
import { EXPIRED_QUOTE as policy, matchesExpiredQuoteScope, type ExpiredQuoteEvidence } from "../src/lib/organization/expired-quote-policy.ts";
import { validateQuoteCandidate, validateQuoteExpiry, validateExpiredQuoteEvidence, verifyExpiredQuote } from "../src/lib/organization/expired-quote.ts";
import { quoteCandidateFixture } from "./fixtures/organization-quote.ts";
import type { OrganizationPending } from "../src/lib/organization/account.ts";
const state = readFileSync(new URL("fixtures/organization-compensated-state.hex", import.meta.url), "utf8");
const actual = L.ContractState.deserialize(Buffer.from(state, "hex"));
const key = async (name: string) => actual.operation(name)!.verifierKey;
const evidence = (): ExpiredQuoteEvidence => ({ schema: "line:expired-quote-evidence/v1", address: policy.address, genesisHash: policy.genesisHash, runtimeSpecVersion: policy.runtimeSpecVersion,
  baseline: { height: policy.baselineHeight, hash: policy.baselineHash, state }, finalized: { hash: "aa".repeat(32), height: 3105000, timestamp: 1792764600000, state } });

test("quote recovery admits only the exact signed quote, facility and release", () => {
  const pending = { kind: "call", circuit: "postQuote", txId: policy.txId, contractAddress: policy.address, sourceFingerprint: policy.sourceFingerprint };
  assert(matchesExpiredQuoteScope(pending));
  for (const change of [{ txId: "00" + "ff".repeat(32) }, { kind: "key" }, { circuit: "cancelOrExpireNote" }, { contractAddress: "ff".repeat(32) }, { sourceFingerprint: "ff".repeat(32) }]) assert.equal(matchesExpiredQuoteScope({ ...pending, ...change }), false);
});
test("quote evidence pins the complete absent-quote predecessor and excludes maintenance and release changes", async () => {
  assert.equal((await validateExpiredQuoteEvidence(evidence(), key)).state.maintenanceAuthority.counter, 11n);
  for (const mutate of [
    (e: any) => { e.schema = "line:expired-compensation-evidence/v1"; },
    (e: any) => { e.baseline.hash = "bb".repeat(32); },
    (e: any) => { e.genesisHash = "bb".repeat(32); },
    (e: any) => { e.runtimeSpecVersion++; },
    (e: any) => { e.finalized.state += "00"; },
    (e: any) => { e.finalized.height = e.baseline.height; },
    (e: any) => { const changed = L.ContractState.deserialize(Buffer.from(state, "hex")); changed.maintenanceAuthority = new L.ContractMaintenanceAuthority(changed.maintenanceAuthority.committee, changed.maintenanceAuthority.threshold, 12n); e.baseline.state = e.finalized.state = Buffer.from(changed.serialize()).toString("hex"); },
  ]) { const e = evidence(); mutate(e); await assert.rejects(validateExpiredQuoteEvidence(e, key)); }
  await assert.rejects(validateExpiredQuoteEvidence(evidence(), async () => new Uint8Array()));
});
test("canonical quote replay binds the merchant role, full quote opening and append-only private candidate", async () => {
  const f = await quoteCandidateFixture();
  assert.equal(validateQuoteCandidate(f.before, f.pending, f.predecessor, policy.sourceFingerprint), 4600_000);
  for (const mutate of [
    (p: OrganizationPending) => { p.after.quotes.at(-1)!.amount++; },
    (p: OrganizationPending) => { p.after.quotes.at(-1)!.quoteNonce = "cc".repeat(32); },
    (p: OrganizationPending) => { p.after.quotes.at(-1)!.merchantPk = policy.merchantPk; },
    (p: OrganizationPending) => { p.after.quotes.at(-1)!.generation++; },
    (p: OrganizationPending) => { p.after.quotes.at(-1)!.feeFlat++; },
    (p: OrganizationPending) => { p.after.quotes.at(-1)!.contractAddress = policy.address; },
    (p: OrganizationPending) => { p.after.facilities[0].outstanding++; },
    (p: OrganizationPending) => { p.after.merchantSecret = "cc".repeat(32); },
    (p: OrganizationPending) => { p.facilityId = "facility"; },
    (p: OrganizationPending) => { p.txId = policy.txId; },
  ]) { const p = structuredClone(f.pending); mutate(p); assert.throws(() => validateQuoteCandidate(f.before, p, f.predecessor, policy.sourceFingerprint)); }
  const wrong = await quoteCandidateFixture(true);
  assert.throws(() => validateQuoteCandidate(wrong.before, wrong.pending, wrong.predecessor, policy.sourceFingerprint));
  await assert.rejects(verifyExpiredQuote(f.before, { ...f.pending, txId: policy.txId, contractAddress: policy.address }, evidence(), policy.sourceFingerprint, key), /Saved transaction bytes differ/);
  assert.throws(() => f.contract.circuits.postQuote(R.createCircuitContext(f.pending.contractAddress!, "0".repeat(64), f.quoted, f.ps, undefined, undefined, 1000), f.q.expiry), /quote exists/);
});
test("shorter DUST expiry never admits quote archival before every intent TTL and uncertainty", () => {
  const ttl = Date.parse("2026-10-23T14:07:39Z");
  assert.throws(() => validateQuoteExpiry(ttl, Date.parse("2026-10-23T13:10:42Z")), /14:08:10.*shorter DUST/);
  assert.throws(() => validateQuoteExpiry(ttl, ttl + 30_000));
  assert.doesNotThrow(() => validateQuoteExpiry(ttl, ttl + 31_000));
});
