import test from "node:test";
import assert from "node:assert/strict";
import { bech32m } from "@scure/base";
import { decodeOrganizationBackup, isOrganizationEmpty, validateOrganizationRecord } from "../src/lib/organization/backup.ts";
import { organizationAccountKey, type OrganizationRecord } from "../src/lib/organization/account.ts";
import { encryptSecret, encodeVaultJson } from "../src/lib/security/vault.ts";
import { readFileSync } from "node:fs";
import { EXPIRED_OPENING as policy } from "../src/lib/organization/expired-opening-policy.ts";
import { EXPIRED_DISABLE as disablePolicy } from "../src/lib/organization/expired-disable-policy.ts";
import { EXPIRED_COMPENSATION as compensationPolicy } from "../src/lib/organization/expired-compensation-policy.ts";

const accountId = "11".repeat(32), key = organizationAccountKey("preprod", accountId);
const address = bech32m.encodeFromBytes("mn_addr_preprod", new Uint8Array(32).fill(4));
const initial = (): OrganizationRecord => ({ snapshot: { schema: "line:organization-account/v1", networkId: "preprod", accountId, issuerSecret: "22".repeat(32), merchantSecret: "33".repeat(32), facilities: [], quotes: [], notes: [], receipts: [] }, pending: null });
const withPending = () => {
  const record = initial(), after = structuredClone(record.snapshot);
  after.facilities.push({ id: "restored-facility", name: "Real organization", address: "44".repeat(32), instanceNonce: "55".repeat(32), maintenanceKey: "66".repeat(32), assetColor: "00".repeat(32), issuerRecipient: address, merchants: [], agentSecret: "77".repeat(32), salt: "88".repeat(32), limit: 0n, outstanding: 0n, epoch: 0n, generation: 0n });
  record.pending = { id: "original-operation", kind: "deploy", circuit: "deploy", facilityId: "restored-facility", contractAddress: "44".repeat(32), sourceFingerprint: "99".repeat(32), after, txId: "00" + "aa".repeat(32), transaction: "abcd" };
  return record;
};
test("encrypted backup round-trip preserves exact pending bytes, role keys and Uint64 books", async () => {
  const record = withPending(), envelope = await encryptSecret(key, encodeVaultJson(record), "BackupControl123!");
  assert.deepEqual(await decodeOrganizationBackup(JSON.stringify(envelope), "BackupControl123!", key, accountId), record);
  assert.equal(isOrganizationEmpty(record), false);
  assert.equal(isOrganizationEmpty(initial()), true);
});
test("backup rejects wrong password, another wallet, relocation and authenticated-data tampering", async () => {
  const envelope = await encryptSecret(key, encodeVaultJson(initial()), "BackupControl123!");
  await assert.rejects(decodeOrganizationBackup(JSON.stringify(envelope), "WrongPassword123!", key, accountId));
  await assert.rejects(decodeOrganizationBackup(JSON.stringify(envelope), "BackupControl123!", organizationAccountKey("preprod", "ff".repeat(32)), "ff".repeat(32)));
  const changed = { ...envelope, id: organizationAccountKey("preprod", "ff".repeat(32)) };
  await assert.rejects(decodeOrganizationBackup(JSON.stringify(changed), "BackupControl123!", changed.id, "ff".repeat(32)));
  // Flip a bit: replacing the first byte with 00 is a no-op in 1/256 runs.
  const ciphertextHex = (parseInt(envelope.ciphertextHex.slice(0, 2), 16) ^ 1).toString(16).padStart(2, "0") + envelope.ciphertextHex.slice(2);
  assert.notEqual(ciphertextHex, envelope.ciphertextHex);
  await assert.rejects(decodeOrganizationBackup(JSON.stringify({ ...envelope, ciphertextHex }), "BackupControl123!", key, accountId));
  await assert.rejects(decodeOrganizationBackup(JSON.stringify({ ...envelope, version: undefined }), "BackupControl123!", key, accountId));
});
test("decrypted malformed books cannot cross restore validation", () => {
  const record = withPending();
  for (const change of [
    (r: OrganizationRecord) => { r.snapshot.accountId = "ff".repeat(32); },
    (r: OrganizationRecord) => { r.pending!.after.issuerSecret = "ff".repeat(32); },
    (r: OrganizationRecord) => { r.pending!.transaction = null; },
    (r: OrganizationRecord) => { r.pending!.after.facilities[0].outstanding = 1n; },
    (r: OrganizationRecord) => { r.pending!.after.facilities[0].limit = 2n ** 64n; },
    (r: OrganizationRecord) => { r.pending!.after.facilities.push(structuredClone(r.pending!.after.facilities[0])); },
  ]) {
    const invalid = structuredClone(record); change(invalid); assert.throws(() => validateOrganizationRecord(invalid, accountId));
  }
});

test("backup preserves reviewed service fee ceilings and rejects invalid limits while accepting legacy orders", async () => {
  const record = initial();
  record.snapshot.facilities = withPending().pending!.after.facilities;
  const order = { id: "11111111-1111-4111-8111-111111111111", facilityId: "restored-facility", service: "text-metrics", document: "Content", price: "25", maxFee: "3", assetColor: "0".repeat(64), merchantPk: "11".repeat(32), merchantAddress: address, delivered: false };
  record.snapshot.serviceOrders = [order];
  const envelope = await encryptSecret(key, encodeVaultJson(record), "BackupControl123!");
  assert.equal((await decodeOrganizationBackup(JSON.stringify(envelope), "BackupControl123!", key, accountId)).snapshot.serviceOrders![0].maxFee, "3");
  for (const value of ["-1", "3.5", "0x3", "18446744073709551616"]) {
    const invalid = structuredClone(record); invalid.snapshot.serviceOrders![0].maxFee = value;
    assert.throws(() => validateOrganizationRecord(invalid, accountId));
  }
  delete record.snapshot.serviceOrders![0].maxFee;
  assert.doesNotThrow(() => validateOrganizationRecord(record, accountId));
});

test("backup preserves both scoped expired openings, disable and compensation without nesting archives inside candidates", async () => {
  const base = withPending(), original = base.pending!;
  Object.assign(original, { kind: "call", circuit: "openLine", contractAddress: policy.address, txId: policy.txId, sourceFingerprint: policy.sourceFingerprint });
  original.after.facilities[0].address = policy.address;
  const state = readFileSync(new URL("fixtures/organization-closed-state.hex", import.meta.url), "utf8");
  const record: OrganizationRecord = { snapshot: structuredClone(original.after), pending: null, recoveries: [{ disposition: "expired-opening-not-applied", original, before: structuredClone(original.after), ttl: 1792500000000, recordedAt: "2026-10-21T15:00:00.000Z", evidence: { schema: "line:expired-opening-evidence/v1", address: policy.address, genesisHash: policy.genesisHash, runtimeSpecVersion: policy.runtimeSpecVersion, baseline: { hash: policy.baselineHash, height: policy.baselineHeight, state }, finalized: { hash: "aa".repeat(32), height: 3077281, timestamp: 1792598700000, state } } }] };
  const second = structuredClone(record.recoveries![0]);
  second.original.id = "second-owner-reviewed-opening";
  second.original.txId = "00abb757c332b831dd25c7640f417d50323639ede3361893571e361ec8eae44813";
  record.recoveries!.push(second);
  const disable = structuredClone(second), disableState = readFileSync(new URL("fixtures/organization-merchant2-draw-state.hex", import.meta.url), "utf8");
  disable.disposition = "expired-disable-not-applied"; disable.original.id = "owner-reviewed-disable";
  disable.original.circuit = "disableMerchant"; disable.original.txId = disablePolicy.txId;
  disable.evidence = { schema: "line:expired-disable-evidence/v1", address: disablePolicy.address, genesisHash: disablePolicy.genesisHash, runtimeSpecVersion: disablePolicy.runtimeSpecVersion,
    baseline: { hash: disablePolicy.baselineHash, height: disablePolicy.baselineHeight, state: disableState }, finalized: { hash: "bb".repeat(32), height: 3102500, timestamp: 1792755000000, state: disableState } };
  record.recoveries!.push(disable);
  const compensation = structuredClone(disable);
  compensation.disposition = "expired-compensation-not-applied"; compensation.original.id = "owner-reviewed-compensation";
  compensation.original.circuit = "cancelOrExpireNote"; compensation.original.txId = compensationPolicy.txId;
  compensation.evidence.schema = "line:expired-compensation-evidence/v1";
  record.recoveries!.push(compensation);
  const backup = await encryptSecret(key, encodeVaultJson(record), "BackupControl123!");
  assert.deepEqual(await decodeOrganizationBackup(JSON.stringify(backup), "BackupControl123!", key, accountId), record);
  assert.equal(isOrganizationEmpty({ ...initial(), recoveries: record.recoveries }), false);
  for (const mutate of [
    (r: OrganizationRecord) => { r.recoveries!.push(structuredClone(r.recoveries![0])); },
    (r: OrganizationRecord) => { r.recoveries![0].original.txId = "00" + "ff".repeat(32); },
    (r: OrganizationRecord) => { r.recoveries![0].evidence.finalized.state = "abcd"; },
    (r: OrganizationRecord) => { r.recoveries![0].ttl = r.recoveries![0].evidence.finalized.timestamp; },
    (r: OrganizationRecord) => { (r.recoveries![0].original.after as any).recoveries = []; },
    (r: OrganizationRecord) => { (r.recoveries![0].before as any).recoveries = []; },
    (r: OrganizationRecord) => { (r.recoveries![0] as any).disposition = "FailEntirely"; },
    (r: OrganizationRecord) => { r.pending = structuredClone(r.recoveries![0].original); },
    (r: OrganizationRecord) => { r.recoveries![2].evidence.schema = "line:expired-opening-evidence/v1"; },
    (r: OrganizationRecord) => { r.recoveries![2].evidence.baseline.hash = policy.baselineHash; },
    (r: OrganizationRecord) => { r.recoveries![2].disposition = "expired-opening-not-applied"; },
    (r: OrganizationRecord) => { r.recoveries![2].original.circuit = "draw"; },
    (r: OrganizationRecord) => { r.recoveries![3].evidence.schema = "line:expired-disable-evidence/v1"; },
    (r: OrganizationRecord) => { r.recoveries![3].disposition = "expired-disable-not-applied"; },
    (r: OrganizationRecord) => { r.recoveries![3].original.txId = disablePolicy.txId; },
  ]) { const invalid = structuredClone(record); mutate(invalid); assert.throws(() => validateOrganizationRecord(invalid, accountId)); }
});
