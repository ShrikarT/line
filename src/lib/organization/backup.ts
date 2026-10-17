import { decodeVaultJson, decryptSecret, type EncryptedEnvelope } from "../security/vault.ts";
import type { OrganizationRecord, OrganizationSnapshot } from "./account.ts";
import { receivingAddressBytes } from "./account.ts";

export const MAX_ORGANIZATION_BACKUP_BYTES = 64 * 1024 * 1024;
const UINT64 = 18_446_744_073_709_551_615n;
const circuits = new Set(["registerMerchant", "disableMerchant", "fundReserve", "withdrawUnencumberedReserve", "withdrawFees", "openLine", "postQuote", "draw", "redeemDraw", "cancelOrExpireNote", "acknowledgeRepayment", "setStatus"]);
function need(condition: unknown): asserts condition { if (!condition) throw new Error("The organization backup has invalid or inconsistent records."); }
const object = (value: unknown): Record<string, unknown> => { need(value !== null && typeof value === "object" && !Array.isArray(value)); return value as Record<string, unknown>; };
const text = (value: unknown, max = 200) => { need(typeof value === "string" && value.length > 0 && value.length <= max); return value; };
const hex = (value: unknown) => { need(typeof value === "string" && /^[0-9a-f]{64}$/.test(value)); return value; };
const uint = (value: unknown) => { need(typeof value === "bigint" && value >= 0n && value <= UINT64); return value; };
const bool = (value: unknown) => { need(typeof value === "boolean"); };
const array = (value: unknown, max: number) => { need(Array.isArray(value) && value.length <= max); return value; };
const unique = (values: unknown[]) => { need(new Set(values).size === values.length); };
const recipient = (value: unknown) => { receivingAddressBytes(text(value)); };
function receipt(value: unknown) {
  const row = object(value); need(["deploy", "key", "call"].includes(text(row.kind)));
  text(row.circuit); hex(row.contractAddress); text(row.txId, 132); hex(row.txHash);
  need(Number.isSafeInteger(row.blockHeight) && (row.blockHeight as number) > 0);
  need(Number.isFinite(Date.parse(text(row.recordedAt))));
}
function snapshot(value: unknown, accountId: string): OrganizationSnapshot {
  const row = object(value);
  need(row.schema === "line:organization-account/v1" && row.networkId === "preprod" && row.accountId === accountId);
  hex(row.issuerSecret); hex(row.merchantSecret);
  const facilities = array(row.facilities, 50), quotes = array(row.quotes, 10_000), notes = array(row.notes, 10_000);
  const receipts = array(row.receipts, 30_000), orders = row.serviceOrders === undefined ? [] : array(row.serviceOrders, 10_000);
  const ids = new Set<string>();
  for (const item of facilities) {
    const f = object(item); need(!ids.has(text(f.id))); ids.add(text(f.id)); text(f.name, 80);
    need(f.address === null || hex(f.address)); hex(f.instanceNonce); hex(f.maintenanceKey); hex(f.assetColor); recipient(f.issuerRecipient);
    hex(f.agentSecret); hex(f.salt); need(uint(f.outstanding) <= uint(f.limit)); uint(f.epoch); uint(f.generation);
    const merchants = array(f.merchants, 1000); unique(merchants.map(item => object(item).publicKey));
    for (const item of merchants) { const m = object(item); hex(m.publicKey); recipient(m.address); text(m.name, 80); if (m.disabled !== undefined) bool(m.disabled); }
  }
  unique(facilities.filter(item => object(item).address !== null).map(item => object(item).address));
  for (const item of quotes) {
    const q = object(item); for (const key of ["contractAddress", "domain", "merchantPk", "invoiceId", "quoteNonce", "quoteCommitment"]) hex(q[key]);
    for (const key of ["amount", "expiry", "generation", "feeFlat", "feeBps"]) uint(q[key]); need((q.amount as bigint) > 0n && (q.feeBps as bigint) <= 10000n);
  }
  unique(notes.map(item => object(item).noteCommitment));
  for (const item of notes) {
    const n = object(item); for (const key of ["contractAddress", "domain", "identity", "merchantPk", "quoteCommitment", "noteNonce", "noteSalt", "noteCommitment"]) hex(n[key]);
    for (const key of ["amount", "fee", "expiry", "generation"]) uint(n[key]); need((n.amount as bigint) > 0n); bool(n.redeemed);
    if (n.refund !== undefined) { const r = object(n.refund); hex(r.salt); uint(r.amount); bool(r.paid); }
  }
  unique(receipts.map(item => object(item).txId)); receipts.forEach(receipt);
  if (row.failures !== undefined) array(row.failures, 30_000).forEach(receipt);
  unique(orders.map(item => object(item).id));
  for (const item of orders) {
    const o = object(item); text(o.id); need(ids.has(text(o.facilityId))); text(o.service, 80); text(o.document, 5000);
    const request = (id: unknown) => { need(typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)); };
    request(o.id); if (o.requestId !== undefined) request(o.requestId);
    need(typeof o.price === "string" && /^[0-9]{1,20}$/.test(o.price) && BigInt(o.price) > 0n && BigInt(o.price) <= UINT64);
    hex(o.assetColor); hex(o.merchantPk); recipient(o.merchantAddress); bool(o.delivered);
    if (o.noteCommitment !== undefined) need(notes.some(item => object(item).noteCommitment === hex(o.noteCommitment)));
    if (o.result !== undefined) object(o.result);
    if (o.cancelled !== undefined) bool(o.cancelled);
    if (o.quoteCommitment !== undefined) hex(o.quoteCommitment);
    if (o.quoteExpiry !== undefined) uint(o.quoteExpiry);
    if (o.history !== undefined) for (const item of array(o.history, 100)) {
      const h = object(item); request(h.requestId); need(Number.isFinite(Date.parse(text(h.retiredAt))));
      if (h.quoteCommitment !== undefined) hex(h.quoteCommitment);
      if (h.noteCommitment !== undefined) hex(h.noteCommitment);
    }
  }
  return value as OrganizationSnapshot;
}

export function validateOrganizationRecord(value: unknown, accountId: string): OrganizationRecord {
  hex(accountId); const record = object(value), current = snapshot(record.snapshot, accountId);
  if (record.pending !== null) {
    const p = object(record.pending); text(p.id); need(["deploy", "key", "call"].includes(text(p.kind)));
    need(p.circuit === "deploy" && p.kind === "deploy" || circuits.has(text(p.circuit)));
    need(p.facilityId === null || typeof p.facilityId === "string"); need(p.contractAddress === null || hex(p.contractAddress)); hex(p.sourceFingerprint);
    const candidate = snapshot(p.after, accountId);
    need(candidate.issuerSecret === current.issuerSecret && candidate.merchantSecret === current.merchantSecret);
    if (p.facilityId !== null) need(candidate.facilities.some(f => f.id === p.facilityId));
    need((p.txId === null) === (p.transaction === null));
    if (p.txId !== null) { text(p.txId, 132); need(typeof p.transaction === "string" && /^(?:[0-9a-f]{2})+$/.test(p.transaction)); hex(p.contractAddress); }
  }
  return structuredClone(value as OrganizationRecord);
}

export function isOrganizationEmpty(record: OrganizationRecord): boolean {
  const s = record.snapshot;
  return !record.pending && !s.facilities.length && !s.quotes.length && !s.notes.length && !s.receipts.length && !s.failures?.length && !s.serviceOrders?.length;
}

/** Authenticate the entire original envelope before accepting its wallet scope. */
export async function decodeOrganizationBackup(file: string, password: string, expectedId: string, accountId: string): Promise<OrganizationRecord> {
  if (file.length > MAX_ORGANIZATION_BACKUP_BYTES) throw new Error("The backup exceeds the supported size.");
  const envelope = object(JSON.parse(file)) as unknown as EncryptedEnvelope;
  if (envelope.version !== 2 || envelope.id !== expectedId) throw new Error("This backup belongs to another wallet or an unsupported backup version.");
  return validateOrganizationRecord(decodeVaultJson(await decryptSecret(envelope, password)), accountId);
}
