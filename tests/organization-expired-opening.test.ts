import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "@midnight-ntwrk/ledger-v8";
import * as R from "@midnight-ntwrk/compact-runtime";
import { validateExpiredOpeningEvidence, validateOpeningCandidate, validateOpeningExpiry, verifyExpiredOpening } from "../src/lib/organization/expired-opening.ts";
import { EXPIRED_OPENING as policy, EXPIRED_OPENING_TRANSACTION_IDS, matchesExpiredOpeningScope, type ExpiredOpeningEvidence } from "../src/lib/organization/expired-opening-policy.ts";
import { ledger } from "../contracts/managed/organization/contract/index.js";
import type { OrganizationPending } from "../src/lib/organization/account.ts";

import { candidateFixture } from "./fixtures/organization-opening.ts";

export const closedState = readFileSync(new URL("fixtures/organization-closed-state.hex", import.meta.url), "utf8");
export const evidenceFixture = (): ExpiredOpeningEvidence => ({ schema: "line:expired-opening-evidence/v1", address: policy.address, genesisHash: policy.genesisHash, runtimeSpecVersion: policy.runtimeSpecVersion,
  baseline: { height: policy.baselineHeight, hash: policy.baselineHash, state: closedState }, finalized: { hash: "aa".repeat(32), height: 3077281, timestamp: 1792598700000, state: closedState } });
const actual = L.ContractState.deserialize(Buffer.from(closedState, "hex"));
const key = async (name: string) => actual.operation(name)!.verifierKey;

test("recovery scope admits only the two named openings at the audited facility and release", () => {
  assert.equal(EXPIRED_OPENING_TRANSACTION_IDS.length, 2);
  for (const txId of EXPIRED_OPENING_TRANSACTION_IDS) {
    const pending = { kind: "call", circuit: "openLine", txId, contractAddress: policy.address, sourceFingerprint: policy.sourceFingerprint };
    assert.equal(matchesExpiredOpeningScope(pending), true);
    for (const change of [{ txId: "00" + "ff".repeat(32) }, { kind: "deploy" }, { circuit: "draw" }, { contractAddress: "ff".repeat(32) }, { sourceFingerprint: "ff".repeat(32) }]) {
      assert.equal(matchesExpiredOpeningScope({ ...pending, ...change }), false);
    }
  }
  assert.equal(matchesExpiredOpeningScope(null), false);
});

test("expired-opening recovery rejects absent, unrelated or unpinned evidence", async () => {
  for (const evidence of [null, {}, { schema: "line:expired-opening-evidence/v1", address: "aa".repeat(32) }]) {
    await assert.rejects(validateExpiredOpeningEvidence(evidence, async () => new Uint8Array()), /recovery/i);
  }
});

test("pinned public closure and finalized state pass; changed chain, runtime, state, keys and time metadata fail closed", async () => {
  assert.equal((await validateExpiredOpeningEvidence(evidenceFixture(), key)).state.maintenanceAuthority.counter, 11n);
  for (const mutate of [
    (e: ExpiredOpeningEvidence) => { e.genesisHash = "bb".repeat(32); },
    (e: ExpiredOpeningEvidence) => { e.runtimeSpecVersion++; },
    (e: ExpiredOpeningEvidence) => { e.baseline.hash = "bb".repeat(32); },
    (e: ExpiredOpeningEvidence) => { e.baseline.state += "00"; e.finalized.state += "00"; },
    (e: ExpiredOpeningEvidence) => { e.finalized.state = "abcd"; },
    (e: ExpiredOpeningEvidence) => { e.finalized.height = e.baseline.height; },
    (e: ExpiredOpeningEvidence) => { e.finalized.timestamp = NaN; },
  ]) { const evidence = evidenceFixture(); mutate(evidence); await assert.rejects(validateExpiredOpeningEvidence(evidence, key), /recovery/i); }
  await assert.rejects(validateExpiredOpeningEvidence(evidenceFixture(), async () => new Uint8Array()), /recovery/i);
});


test("recovery binds the exact serialized opening transcript to predecessor and retained private candidate", async () => {
  const f = await candidateFixture();
  assert.equal(validateOpeningCandidate(f.before, f.pending, f.predecessor, policy.sourceFingerprint), 4600_000);
  for (const mutate of [
    (p: OrganizationPending) => { p.after.facilities[0].salt = "cc".repeat(32); },
    (p: OrganizationPending) => { p.after.facilities[0].generation = 3n; },
    (p: OrganizationPending) => { p.after.facilities[0].limit = 2_000_000n; },
    (p: OrganizationPending) => { p.after.merchantSecret = "cc".repeat(32); },
    (p: OrganizationPending) => { p.after.facilities[0].agentSecret = "cc".repeat(32); },
    (p: OrganizationPending) => { p.txId = policy.txId; },
    (p: OrganizationPending) => { p.txId = EXPIRED_OPENING_TRANSACTION_IDS[1]; },
    (p: OrganizationPending) => { p.contractAddress = policy.address; },
  ]) { const pending = structuredClone(f.pending); mutate(pending); assert.throws(() => validateOpeningCandidate(f.before, pending, f.predecessor, policy.sourceFingerprint)); }
});

test("a different expired opening can never use this facility's recovery authorization", async () => {
  const f = await candidateFixture();
  await assert.rejects(verifyExpiredOpening(f.before, f.pending, evidenceFixture(), policy.sourceFingerprint, key), /recovery/i);
});

test("a named identifier cannot authorize unrelated canonical bytes", async () => {
  const f = await candidateFixture();
  for (const txId of EXPIRED_OPENING_TRANSACTION_IDS) {
    const pending = { ...f.pending, txId, contractAddress: policy.address };
    await assert.rejects(verifyExpiredOpening(f.before, pending, evidenceFixture(), policy.sourceFingerprint, key), /Saved transaction bytes differ/);
  }
});

test("only pinned block time strictly beyond TTL plus uncertainty admits recovery", () => {
  const ttl = 1792500000000;
  for (const timestamp of [ttl - 1, ttl, ttl + 30_000, ttl + 30_999, NaN]) assert.throws(() => validateOpeningExpiry(ttl, timestamp), /recovery/i);
  assert.doesNotThrow(() => validateOpeningExpiry(ttl, ttl + 31_000));
});

test("generated opening rejects generation overflow instead of wrapping to a predecessor", async () => {
  const f = await candidateFixture();
  const state = R.ContractState.deserialize(f.predecessor.serialize());
  const root = state.data.state.asArray()!, branch = root[1].asArray()!;
  const uint = new R.CompactTypeUnsignedInteger((1n << 64n) - 1n, 8);
  branch[10] = R.StateValue.newCell({ value: uint.toValue((1n << 64n) - 1n), alignment: uint.alignment() });
  const array = (items: R.StateValue[]) => items.reduce((result, item) => result.arrayPush(item), R.StateValue.newArray());
  root[1] = array(branch); state.data = new R.ChargedState(array(root));
  assert.equal(ledger(state.data).lineGeneration, (1n << 64n) - 1n);
  assert.throws(() => f.contract.circuits.openLine(R.createCircuitContext(f.pending.contractAddress!, "0".repeat(64), state, f.ps, undefined, undefined, 1000), 900000n, 1000n, 100n), /cast.*smaller Uint.*failed/);
});
