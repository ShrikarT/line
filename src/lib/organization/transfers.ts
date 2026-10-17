import { receivingAddressBytes, type MerchantBinding, type OrganizationNote, type OrganizationQuote } from "./account.ts";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid transfer package.");
  return value as Record<string, unknown>;
}
function hex(value: unknown): string { if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error("Transfer contains invalid commitment bytes."); return value; }
function uint(value: unknown, positive = false): bigint {
  if (typeof value !== "string" || !/^[0-9]{1,20}$/.test(value)) throw new Error("Transfer contains an invalid amount or deadline.");
  const result = BigInt(value); if (result > 18_446_744_073_709_551_615n || positive && result === 0n) throw new Error("Transfer value is outside its range."); return result;
}
function parse(text: string, schema: string, keys: string[]): Record<string, unknown> {
  if (text.length > 16_384) throw new Error("Transfer package is too large.");
  const value = object(JSON.parse(text));
  if (value.schema !== schema || Object.keys(value).sort().join() !== ["schema", ...keys].sort().join()) throw new Error("Transfer schema or fields differ from this product version.");
  return value;
}
const quoteKeys = ["contractAddress", "domain", "merchantPk", "invoiceId", "quoteNonce", "amount", "expiry", "generation", "feeFlat", "feeBps", "quoteCommitment"];
const noteKeys = ["contractAddress", "domain", "identity", "merchantPk", "quoteCommitment", "amount", "fee", "expiry", "generation", "noteNonce", "noteSalt", "noteCommitment"];
export function encodeMerchant(value: MerchantBinding): string { return JSON.stringify({ schema: "line:organization-merchant/v1", name: value.name, publicKey: value.publicKey, address: value.address }, null, 2); }
export function decodeMerchant(text: string): MerchantBinding {
  const value = parse(text, "line:organization-merchant/v1", ["name", "publicKey", "address"]);
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 || typeof value.address !== "string") throw new Error("Invalid merchant profile.");
  receivingAddressBytes(value.address);
  return { name: value.name, publicKey: hex(value.publicKey), address: value.address };
}
export function encodeQuote(value: OrganizationQuote): string {
  return JSON.stringify({ schema: "line:organization-quote/v1", ...Object.fromEntries(quoteKeys.map(key => [key, value[key as keyof OrganizationQuote]])) }, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
}
export function decodeQuote(text: string): OrganizationQuote {
  const value = parse(text, "line:organization-quote/v1", quoteKeys);
  const quote = { contractAddress: hex(value.contractAddress), domain: hex(value.domain), merchantPk: hex(value.merchantPk), invoiceId: hex(value.invoiceId), quoteNonce: hex(value.quoteNonce), amount: uint(value.amount, true), expiry: uint(value.expiry, true), generation: uint(value.generation, true), feeFlat: uint(value.feeFlat), feeBps: uint(value.feeBps), quoteCommitment: hex(value.quoteCommitment) };
  if (quote.feeBps > 10000n) throw new Error("Invalid quoted fee policy.");
  return quote;
}
export function encodeNote(value: OrganizationNote): string {
  return JSON.stringify({ schema: "line:organization-note/v1", ...Object.fromEntries(noteKeys.map(key => [key, value[key as keyof OrganizationNote]])) }, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
}
export function decodeNote(text: string): OrganizationNote {
  const value = parse(text, "line:organization-note/v1", noteKeys);
  return { contractAddress: hex(value.contractAddress), domain: hex(value.domain), identity: hex(value.identity), merchantPk: hex(value.merchantPk), quoteCommitment: hex(value.quoteCommitment), amount: uint(value.amount, true), fee: uint(value.fee), expiry: uint(value.expiry, true), generation: uint(value.generation, true), noteNonce: hex(value.noteNonce), noteSalt: hex(value.noteSalt), noteCommitment: hex(value.noteCommitment), redeemed: false };
}
