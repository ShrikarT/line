import test from "node:test";
import assert from "node:assert/strict";
import { bech32m } from "@scure/base";
import { decodeOrganizationBackup, isOrganizationEmpty, validateOrganizationRecord } from "../src/lib/organization/backup.ts";
import { organizationAccountKey, type OrganizationRecord } from "../src/lib/organization/account.ts";
import { encryptSecret, encodeVaultJson } from "../src/lib/security/vault.ts";

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
