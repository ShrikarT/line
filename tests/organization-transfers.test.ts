import test from "node:test";
import assert from "node:assert/strict";
import { bech32m } from "@scure/base";
import { organizationAccountKey, receivingAddressBytes, units, type OrganizationNote } from "../src/lib/organization/account.ts";
import { decodeMerchant, decodeNote, decodeQuote, encodeMerchant, encodeNote, encodeQuote } from "../src/lib/organization/transfers.ts";
const hex = (byte: string) => byte.repeat(64);
const receiving = bech32m.encodeFromBytes("mn_addr_preprod", new Uint8Array(32).fill(12));
const quote = { contractAddress: hex("a"), domain: hex("b"), merchantPk: hex("c"), invoiceId: hex("d"), quoteNonce: hex("e"), amount: 25n, expiry: 2000000000n, generation: 1n, feeFlat: 0n, feeBps: 0n, quoteCommitment: hex("f") };
test("wallet account scopes separate organizations and reject non-Preprod identities", () => {
  assert.notEqual(organizationAccountKey("preprod", hex("a")), organizationAccountKey("preprod", hex("b")));
  assert.throws(() => organizationAccountKey("mainnet", hex("a")));
  assert.throws(() => organizationAccountKey("preprod", "../other-account"));
});
test("receiving addresses are exact Preprod user addresses", () => {
  assert.deepEqual(receivingAddressBytes(receiving), new Uint8Array(32).fill(12));
  assert.throws(() => receivingAddressBytes(bech32m.encodeFromBytes("mn_addr_preview", new Uint8Array(32))));
  assert.throws(() => receivingAddressBytes(bech32m.encodeFromBytes("mn_addr_preprod", new Uint8Array(31))));
});
test("actual asset units retain Uint64 precision without floating point", () => {
  assert.equal(units("18446744073709551615"), 18446744073709551615n);
  for (const value of ["0", "-1", "1.5", "1e6", "18446744073709551616", " 25"]) assert.throws(() => units(value));
});
test("merchant profile transport preserves only public role identity and recipient", () => {
  const profile = { publicKey: hex("a"), name: "Independent supplier", address: receiving };
  assert.deepEqual(decodeMerchant(encodeMerchant(profile)), profile);
  assert.throws(() => decodeMerchant(JSON.stringify({ ...JSON.parse(encodeMerchant(profile)), merchantSecret: hex("b") })));
});
test("quote packages preserve authenticated terms and reject injected fields or invalid fees", () => {
  assert.deepEqual(decodeQuote(encodeQuote(quote)), quote);
  for (const patch of [{ feeBps: "10001" }, { amount: "0" }, { generation: "0" }, { amount: 25 }, { agentSecret: hex("a") }, { contractAddress: "invalid" }]) assert.throws(() => decodeQuote(JSON.stringify({ ...JSON.parse(encodeQuote(quote)), ...patch })));
});
test("claim transport excludes organization books, role secrets and refund openings", () => {
  const note: OrganizationNote = { contractAddress: hex("a"), domain: hex("b"), identity: hex("c"), merchantPk: hex("d"), quoteCommitment: hex("e"), amount: 25n, fee: 0n, expiry: 2000000000n, generation: 1n, noteNonce: hex("f"), noteSalt: hex("1"), noteCommitment: hex("2"), redeemed: false, refund: { salt: hex("3"), amount: 10n, paid: false } };
  const internal = { ...note, agentSecret: hex("4"), limit: 500n, outstanding: 30n };
  const text = encodeNote(internal);
  for (const excluded of ["refund", "agentSecret", "issuerSecret", "limit", "outstanding", hex("3"), hex("4")]) assert(!text.includes(excluded));
  const restored = decodeNote(text);
  assert.equal(restored.noteCommitment, note.noteCommitment);
  assert.equal(restored.amount, 25n);
  assert.equal(restored.refund, undefined);
  assert.throws(() => decodeNote(text.replace('"line:organization-note/v1"', '"unknown"')));
});
