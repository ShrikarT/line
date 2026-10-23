import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "@midnight-ntwrk/ledger-v8";
import * as R from "@midnight-ntwrk/compact-runtime";
import { ledger } from "../contracts/managed/organization/contract/index.js";
import { EXPIRED_DISABLE as policy, matchesExpiredDisableScope, type ExpiredDisableEvidence } from "../src/lib/organization/expired-disable-policy.ts";
import { validateDisableCandidate, validateExpiredDisableEvidence, verifyExpiredDisable } from "../src/lib/organization/expired-disable.ts";
import { disableCandidateFixture } from "./fixtures/organization-disable.ts";
import type { OrganizationPending } from "../src/lib/organization/account.ts";
const state = readFileSync(new URL("fixtures/organization-merchant2-draw-state.hex", import.meta.url), "utf8");
const actual = L.ContractState.deserialize(Buffer.from(state, "hex"));
const key = async (name: string) => actual.operation(name)!.verifierKey;
export const disableEvidenceFixture = (): ExpiredDisableEvidence => ({ schema: "line:expired-disable-evidence/v1", address: policy.address, genesisHash: policy.genesisHash, runtimeSpecVersion: policy.runtimeSpecVersion,
  baseline: { height: policy.baselineHeight, hash: policy.baselineHash, state }, finalized: { hash: "aa".repeat(32), height: 3102500, timestamp: 1792755000000, state } });

test("disable recovery admits only its named identifier/action/facility/release", () => {
  const pending = { kind: "call", circuit: "disableMerchant", txId: policy.txId, contractAddress: policy.address, sourceFingerprint: policy.sourceFingerprint };
  assert.equal(matchesExpiredDisableScope(pending), true);
  for (const change of [{ txId: "00" + "ff".repeat(32) }, { kind: "key" }, { circuit: "openLine" }, { contractAddress: "ff".repeat(32) }, { sourceFingerprint: "ff".repeat(32) }]) assert.equal(matchesExpiredDisableScope({ ...pending, ...change }), false);
  assert.equal(matchesExpiredDisableScope(null), false);
});

test("disable evidence pins the complete active-merchant predecessor and rejects changed state, maintenance, chain, runtime and keys", async () => {
  assert.equal((await validateExpiredDisableEvidence(disableEvidenceFixture(), key)).state.maintenanceAuthority.counter, 11n);
  for (const change of [
    (e: any) => { e.schema = "line:expired-opening-evidence/v1"; },
    (e: any) => { e.baseline.hash = "bb".repeat(32); },
    (e: any) => { e.baseline.height--; },
    (e: any) => { e.address = "bb".repeat(32); },
    (e: any) => { e.genesisHash = "bb".repeat(32); },
    (e: any) => { e.runtimeSpecVersion++; },
    (e: any) => { e.finalized.state += "00"; },
    (e: any) => { e.baseline.state += "00"; e.finalized.state += "00"; },
    (e: any) => { e.finalized.height = e.baseline.height; },
    (e: any) => { e.finalized.timestamp = NaN; },
  ]) { const e = disableEvidenceFixture(); change(e); await assert.rejects(validateExpiredDisableEvidence(e, key), /recovery/i); }
  await assert.rejects(validateExpiredDisableEvidence(disableEvidenceFixture(), async () => new Uint8Array()), /recovery/i);
  await assert.rejects(validateExpiredDisableEvidence(null, key), /recovery/i);
});

test("canonical disable replay binds the retained candidate to the actual target key", async () => {
  const f = await disableCandidateFixture();
  assert.equal(validateDisableCandidate(f.before, f.pending, f.predecessor, policy.sourceFingerprint), 4600_000);
  for (const change of [
    (p: OrganizationPending) => { p.after.facilities[0].merchants[1].disabled = false; },
    (p: OrganizationPending) => { p.after.facilities[0].merchants[0].disabled = true; },
    (p: OrganizationPending) => { p.after.facilities[0].salt = "cc".repeat(32); },
    (p: OrganizationPending) => { p.after.facilities[0].outstanding++; },
    (p: OrganizationPending) => { p.after.merchantSecret = "cc".repeat(32); },
    (p: OrganizationPending) => { p.txId = policy.txId; },
    (p: OrganizationPending) => { p.circuit = "openLine"; },
    (p: OrganizationPending) => { p.contractAddress = policy.address; },
  ]) { const pending = structuredClone(f.pending); change(pending); assert.throws(() => validateDisableCandidate(f.before, pending, f.predecessor, policy.sourceFingerprint)); }
  const other = await disableCandidateFixture(f.before.facilities[0].merchants[0].publicKey);
  assert.throws(() => validateDisableCandidate(other.before, other.pending, other.predecessor, policy.sourceFingerprint), /recovery/i);
  await assert.rejects(verifyExpiredDisable(f.before, { ...f.pending, txId: policy.txId, contractAddress: policy.address }, disableEvidenceFixture(), policy.sourceFingerprint, key), /Saved transaction bytes differ/);
});

test("the generated release preserves disabled membership and cannot re-register a disabled key", async () => {
  const f = await disableCandidateFixture(), state = R.ContractState.deserialize(f.predecessor.serialize());
  const bytes = Buffer.from(policy.merchantPk, "hex");
  const disabled = f.contract.circuits.disableMerchant(R.createCircuitContext(f.pending.contractAddress!, "0".repeat(64), state, f.ps, undefined, undefined, 1000), bytes);
  const next = new R.ContractState(); next.data = disabled.context.currentQueryContext.state;
  assert.equal(ledger(next.data).registeredMerchants.member(bytes), true);
  assert.equal(ledger(next.data).registeredMerchants.lookup(bytes), false);
  assert.throws(() => f.contract.circuits.registerMerchant(R.createCircuitContext(f.pending.contractAddress!, "0".repeat(64), next, f.ps, undefined, undefined, 1000), bytes, { bytes: new Uint8Array(32) }), /merchant already registered/);
});
