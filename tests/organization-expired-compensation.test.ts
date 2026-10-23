import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "@midnight-ntwrk/ledger-v8";
import * as R from "@midnight-ntwrk/compact-runtime";
import { ledger } from "../contracts/managed/organization/contract/index.js";
import { EXPIRED_COMPENSATION as policy, matchesExpiredCompensationScope, type ExpiredCompensationEvidence } from "../src/lib/organization/expired-compensation-policy.ts";
import { validateCompensationCandidate, validateExpiredCompensationEvidence, verifyExpiredCompensation } from "../src/lib/organization/expired-compensation.ts";
import { compensationCandidateFixture } from "./fixtures/organization-compensation.ts";
import type { OrganizationPending } from "../src/lib/organization/account.ts";
import { validateOpeningExpiry } from "../src/lib/organization/expired-opening.ts";
const state = readFileSync(new URL("fixtures/organization-merchant2-draw-state.hex", import.meta.url), "utf8");
const actual = L.ContractState.deserialize(Buffer.from(state, "hex"));
const key = async (name: string) => actual.operation(name)!.verifierKey;
const evidence = (): ExpiredCompensationEvidence => ({ schema: "line:expired-compensation-evidence/v1", address: policy.address, genesisHash: policy.genesisHash, runtimeSpecVersion: policy.runtimeSpecVersion,
  baseline: { height: policy.baselineHeight, hash: policy.baselineHash, state }, finalized: { hash: "aa".repeat(32), height: 3104000, timestamp: 1792760400000, state } });

test("compensation recovery admits only the exact signed action, facility and release", () => {
  const pending = { kind: "call", circuit: "cancelOrExpireNote", txId: policy.txId, contractAddress: policy.address, sourceFingerprint: policy.sourceFingerprint };
  assert(matchesExpiredCompensationScope(pending));
  for (const change of [{ txId: "00" + "ff".repeat(32) }, { kind: "key" }, { circuit: "disableMerchant" }, { contractAddress: "ff".repeat(32) }, { sourceFingerprint: "ff".repeat(32) }]) assert.equal(matchesExpiredCompensationScope({ ...pending, ...change }), false);
  assert.equal(matchesExpiredCompensationScope(null), false);
});

test("compensation evidence rejects changed state, allocation, chain, runtime, keys and maintenance", async () => {
  assert.equal((await validateExpiredCompensationEvidence(evidence(), key)).state.maintenanceAuthority.counter, 11n);
  for (const change of [
    (e: any) => { e.schema = "line:expired-disable-evidence/v1"; },
    (e: any) => { e.baseline.hash = "bb".repeat(32); },
    (e: any) => { e.address = "bb".repeat(32); },
    (e: any) => { e.genesisHash = "bb".repeat(32); },
    (e: any) => { e.runtimeSpecVersion++; },
    (e: any) => { e.finalized.state += "00"; },
    (e: any) => { const changed = L.ContractState.deserialize(Buffer.from(state, "hex")); changed.maintenanceAuthority = new L.ContractMaintenanceAuthority(changed.maintenanceAuthority.committee, changed.maintenanceAuthority.threshold, 12n); e.baseline.state = e.finalized.state = Buffer.from(changed.serialize()).toString("hex"); },
    (e: any) => { e.finalized.height = e.baseline.height; },
    (e: any) => { e.finalized.timestamp = NaN; },
  ]) { const e = evidence(); change(e); await assert.rejects(validateExpiredCompensationEvidence(e, key)); }
  await assert.rejects(validateExpiredCompensationEvidence(evidence(), async () => new Uint8Array()));
  await assert.rejects(validateExpiredCompensationEvidence(null, key));
});

test("canonical compensation replay binds claim, refund opening and complete retained candidate", async () => {
  const f = await compensationCandidateFixture();
  assert.equal(validateCompensationCandidate(f.before, f.pending, f.predecessor, policy.sourceFingerprint, f.target), 4600_000);
  for (const change of [
    (p: OrganizationPending) => { p.after.notes[0].refund!.salt = "cc".repeat(32); },
    (p: OrganizationPending) => { p.after.notes[0].refund!.amount = 1n; },
    (p: OrganizationPending) => { p.after.notes[0].refund!.paid = false; },
    (p: OrganizationPending) => { delete p.after.notes[0].refund; },
    (p: OrganizationPending) => { p.after.notes[1].refund = p.after.notes[0].refund; },
    (p: OrganizationPending) => { p.after.facilities[0].salt = "cc".repeat(32); },
    (p: OrganizationPending) => { p.after.facilities[0].outstanding++; },
    (p: OrganizationPending) => { p.after.facilities[0].epoch--; },
    (p: OrganizationPending) => { p.after.merchantSecret = "cc".repeat(32); },
    (p: OrganizationPending) => { p.txId = policy.txId; },
    (p: OrganizationPending) => { p.circuit = "disableMerchant"; },
    (p: OrganizationPending) => { p.contractAddress = policy.address; },
  ]) { const p = structuredClone(f.pending); change(p); assert.throws(() => validateCompensationCandidate(f.before, p, f.predecessor, policy.sourceFingerprint, f.target)); }
  for (const args of [[0n, 0], [1n, 1]] as const) {
    const other = await compensationCandidateFixture(...args);
    assert.throws(() => validateCompensationCandidate(other.before, other.pending, other.predecessor, policy.sourceFingerprint, other.target));
  }
  assert.throws(() => validateCompensationCandidate(f.before, f.pending, f.predecessor, policy.sourceFingerprint, policy.noteCommitment));
  await assert.rejects(verifyExpiredCompensation(f.before, { ...f.pending, txId: policy.txId, contractAddress: policy.address }, evidence(), policy.sourceFingerprint, key), /Saved transaction bytes differ/);
});

test("allocated notes cannot be reset by expiry or allocation in the generated release", async () => {
  const f = await compensationCandidateFixture(), target = Buffer.from(f.target, "hex");
  assert.equal(ledger(f.allocated.data).notes.lookup(target).compensationAllocated, true);
  for (const mode of [0n, 1n]) assert.throws(() => f.contract.circuits.cancelOrExpireNote(R.createCircuitContext(f.pending.contractAddress!, "0".repeat(64), f.allocated, f.ps, undefined, undefined, 2200), target, mode, 4600n), /already cancelled|already allocated/);
  // The shorter DUST deadline cannot admit archival before the final action TTL.
  const latest = Date.parse("2026-10-23T12:35:23Z");
  assert.throws(() => validateOpeningExpiry(latest, Date.parse("2026-10-23T11:38:47Z")));
  assert.throws(() => validateOpeningExpiry(latest, latest + 30_000));
  assert.doesNotThrow(() => validateOpeningExpiry(latest, latest + 31_000));
});
