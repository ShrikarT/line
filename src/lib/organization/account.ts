import type { Configuration, ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { bech32m } from "@scure/base";
import { decodeWalletPublicKey, getConnectedWallet, getWalletConfiguration } from "../runtime/wallet.ts";
import { encodeVaultJson, encryptSecret, getVaultSessionPassphrase, getVaultSessionRevision, isVaultSessionUnlocked, loadEncryptedJson, lockVaultSession, saveEncryptedJson, unlockVaultSession } from "../security/vault.ts";
import { hexToBytes, randomBytes32, toHex } from "../line/encoding.ts";
import { decodeOrganizationBackup, isOrganizationEmpty } from "./backup.ts";
import { OrganizationTimeoutError, withinDeadline } from "./finality.ts";
import { ORGANIZATION_SESSION_MINUTES } from "./session-policy.ts";
import { matchesExpiredOpeningScope, type ExpiredOpeningEvidence } from "./expired-opening-policy.ts";
import { matchesExpiredDisableScope, type ExpiredDisableEvidence } from "./expired-disable-policy.ts";
import { matchesExpiredCompensationScope, type ExpiredCompensationEvidence } from "./expired-compensation-policy.ts";
import { matchesExpiredQuoteScope, type ExpiredQuoteEvidence } from "./expired-quote-policy.ts";
import { rememberOrganizationTabSession, forgetOrganizationTabSession, type OrganizationTabSession } from "./tab-session.ts";

function rateLimited(failure: unknown): boolean {
  if (!failure || typeof failure !== "object") return typeof failure === "string" && /rate[\s_-]*limit|too many requests/i.test(failure);
  const error = failure as { code?: unknown; status?: unknown; message?: unknown; reason?: unknown };
  return error.code === 429 || error.status === 429 || /rate[\s_-]*limit|too many requests/i.test(String(error.message ?? error.reason ?? ""));
}

/** Only these three read-only probes may retry. No proof, signature, balance or
 * submission request is admitted here. Every retry rechecks the caller's session.
 */
export async function readOrganizationWallet(wallet: ConnectedAPI, timeoutMs = 25_000, assertCurrent: () => void = () => {}, verifiedConfiguration?: Configuration) {
  const controller = new AbortController(), signal = controller.signal;
  const timeoutMessage = "The wallet is not responding. Reopen your wallet and try again; no transaction was submitted by this wallet check.";
  const expired = () => new OrganizationTimeoutError(timeoutMessage);
  const current = () => { if (signal.aborted) throw expired(); assertCurrent(); };
  async function pause(milliseconds: number) {
    current();
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(expired()); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
      signal.addEventListener("abort", abort, { once: true });
    });
    current();
  }
  async function read<T>(label: string, request: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      current();
      try { const value = await request(); current(); return value; }
      catch (failure) {
        current();
        if (!rateLimited(failure)) {
          const detail = typeof failure === "string" ? failure : failure && typeof failure === "object" ? (failure as { message?: unknown; reason?: unknown }).message ?? (failure as { reason?: unknown }).reason : undefined;
          if (typeof detail === "string" && /^request failed[.!]?$/i.test(detail.trim())) throw new Error(`Your wallet could not complete the ${label} check. Reopen your wallet and reconnect before trying again. No signature or payment was requested by this check.`);
          throw failure;
        }
        if (attempt === 2) throw new Error(`Your wallet rate limited the ${label} check. Wait before reopening the organization. No signature or payment was retried.`);
        await pause(attempt === 0 ? 500 : 1500);
      }
    }
  }
  const task = async () => {
    let configuration: Configuration;
    if (verifiedConfiguration) {
      if (verifiedConfiguration.networkId !== "preprod") throw new Error("Organization service settings belong to a different network.");
      if (typeof wallet.getConnectionStatus !== "function") throw new Error("Wallet does not implement connector v4 capability: getConnectionStatus.");
      const session = await read("network session", () => wallet.getConnectionStatus());
      if (session?.status !== "connected" || session.networkId !== "preprod") throw new Error("Your wallet has not established a preprod session. Reconnect your wallet before continuing.");
      configuration = structuredClone(verifiedConfiguration);
    } else {
      configuration = await read("network configuration", () => getWalletConfiguration(wallet, "preprod", signal));
    }
    const shielded = await read("shielded identity", () => wallet.getShieldedAddresses());
    const receiving = await read("receiving address", () => wallet.getUnshieldedAddress());
    return { configuration, shielded, receiving };
  };
  try { return await withinDeadline(task(), timeoutMs, timeoutMessage); }
  finally { controller.abort(); }
}

export type OrganizationReceipt = { kind: "deploy" | "key" | "call"; circuit: string; contractAddress: string; txId: string; txHash: string; blockHeight: number; recordedAt: string };
export type MerchantBinding = { publicKey: string; address: string; name: string; disabled?: boolean };
export type OrganizationFacility = {
  id: string; name: string; address: string | null; instanceNonce: string; maintenanceKey: string;
  assetColor: string; issuerRecipient: string; merchants: MerchantBinding[];
  agentSecret: string; salt: string; limit: bigint; outstanding: bigint; epoch: bigint; generation: bigint;
};
export type OrganizationQuote = { contractAddress: string; domain: string; merchantPk: string; invoiceId: string; quoteNonce: string; amount: bigint; expiry: bigint; generation: bigint; feeFlat: bigint; feeBps: bigint; quoteCommitment: string };
export type OrganizationNote = { contractAddress: string; domain: string; identity: string; merchantPk: string; quoteCommitment: string; amount: bigint; fee: bigint; expiry: bigint; generation: bigint; noteNonce: string; noteSalt: string; noteCommitment: string; redeemed: boolean; refund?: { salt: string; amount: bigint; paid: boolean } };
export type OrganizationServiceOrder = { id: string; facilityId: string; service: string; document: string; price: string; maxFee?: string; assetColor: string; merchantPk: string; merchantAddress: string; noteCommitment?: string; result?: Record<string, unknown>; delivered: boolean; cancelled?: boolean; requestId?: string; quoteCommitment?: string; quoteExpiry?: bigint; history?: { requestId: string; quoteCommitment?: string; noteCommitment?: string; retiredAt: string }[] };
export type OrganizationSnapshot = { schema: "line:organization-account/v1"; networkId: "preprod"; accountId: string; issuerSecret: string; merchantSecret: string; facilities: OrganizationFacility[]; quotes: OrganizationQuote[]; notes: OrganizationNote[]; receipts: OrganizationReceipt[]; serviceOrders?: OrganizationServiceOrder[]; failures?: OrganizationReceipt[] };
export type OrganizationPending = { id: string; kind: OrganizationReceipt["kind"]; circuit: string; facilityId: string | null; contractAddress: string | null; sourceFingerprint: string; after: OrganizationSnapshot; txId: string | null; transaction: string | null };
export type OrganizationExpiredRecovery = { disposition: "expired-opening-not-applied" | "expired-disable-not-applied" | "expired-compensation-not-applied" | "expired-quote-not-applied"; before: OrganizationSnapshot; original: OrganizationPending; evidence: ExpiredOpeningEvidence | ExpiredDisableEvidence | ExpiredCompensationEvidence | ExpiredQuoteEvidence; ttl: number; recordedAt: string };
export type OrganizationRecord = { snapshot: OrganizationSnapshot; pending: OrganizationPending | null; recoveries?: OrganizationExpiredRecovery[] };
export const ORGANIZATION_SCHEMA = "line:organization-account/v1";

export function organizationAccountKey(network: string, publicKey: string): string {
  if (network !== "preprod" || !/^[0-9a-f]{64}$/.test(publicKey)) throw new Error("Invalid organization wallet identity.");
  return `line:organization:${network}:${publicKey}`;
}
export function receivingAddressBytes(value: string): Uint8Array {
  const decoded = bech32m.decodeToBytes(value);
  if (decoded.prefix !== "mn_addr_preprod" || decoded.bytes.length !== 32) throw new Error("A Midnight Preprod receiving address is required.");
  return decoded.bytes;
}
export function units(value: string): bigint {
  if (!/^[0-9]{1,20}$/.test(value)) throw new Error("Enter a whole number of base units.");
  const amount = BigInt(value);
  if (amount <= 0n || amount > 18_446_744_073_709_551_615n) throw new Error("Amount must fit a positive Uint64.");
  return amount;
}
export function bytes32(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Expected 32 hexadecimal bytes.");
  return hexToBytes(value);
}
export function copyAccount<T>(value: T): T { return structuredClone(value); }

/** Encrypted custody belongs to one connected wallet. No operator credentials enter here. */
export class OrganizationAccount {
  readonly wallet: ConnectedAPI;
  readonly accountId: string;
  readonly receivingAddress: string;
  readonly revision: number;
  private readonly configuration: Configuration;
  private record: OrganizationRecord;
  private constructor(wallet: ConnectedAPI, accountId: string, receivingAddress: string, revision: number, record: OrganizationRecord, configuration: Configuration) {
    this.wallet = wallet; this.accountId = accountId; this.receivingAddress = receivingAddress; this.revision = revision; this.record = record;
    this.configuration = Object.freeze(structuredClone(configuration));
  }
  static async unlock(wallet: ConnectedAPI, passphrase: string, restored?: OrganizationTabSession): Promise<OrganizationAccount> {
    if (wallet !== getConnectedWallet()) throw new Error("Connect your wallet before opening an organization.");
    if (passphrase.length < 8) throw new Error("Use at least eight characters for the organization vault password.");
    const { configuration, shielded, receiving: unshielded } = await readOrganizationWallet(wallet, 25_000, () => {
      if (wallet !== getConnectedWallet()) throw new Error("Wallet changed while opening the organization.");
    }, restored?.configuration);
    const accountId = decodeWalletPublicKey(shielded.shieldedCoinPublicKey, "shield-cpk", "preprod");
    receivingAddressBytes(unshielded.unshieldedAddress);
    if (restored && (restored.accountId !== accountId || restored.receivingAddress !== unshielded.unshieldedAddress || restored.expiresAt <= Date.now())) { forgetOrganizationTabSession(); throw new Error("The saved tab session no longer matches this wallet. Open the selected account’s own vault."); }
    // Authenticate existing ciphertext before replacing any open vault session.
    const key = organizationAccountKey("preprod", accountId);
    if (!navigator.locks) throw new Error("Use a browser with account-lock support to protect organization transactions.");
    return navigator.locks.request(key, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new Error("This organization is busy in another tab.");
    const retained = await loadEncryptedJson<OrganizationRecord>(key, passphrase);
    if (restored && !retained) { forgetOrganizationTabSession(); throw new Error("The saved organization record is unavailable. Open the vault explicitly before creating any records."); }
    if (wallet !== getConnectedWallet()) throw new Error("Wallet changed while opening the organization.");
    if (retained && (retained.snapshot?.schema !== ORGANIZATION_SCHEMA || retained.snapshot.accountId !== accountId || retained.snapshot.networkId !== "preprod")) throw new Error("Organization record belongs to another wallet or schema.");
    if (restored && restored.expiresAt <= Date.now()) throw new Error("The organization session expired. Enter its password again.");
    unlockVaultSession(passphrase, ORGANIZATION_SESSION_MINUTES, restored?.expiresAt);
    const account = new OrganizationAccount(wallet, accountId, unshielded.unshieldedAddress, getVaultSessionRevision(), retained ?? {
      snapshot: { schema: ORGANIZATION_SCHEMA, networkId: "preprod", accountId, issuerSecret: toHex(randomBytes32()), merchantSecret: toHex(randomBytes32()), facilities: [], quotes: [], notes: [], receipts: [] }, pending: null,
    }, configuration);
    if (!retained) await account.save();
    await account.retainSessionForReload();
    return account;
    });
  }
  async retainSessionForReload() {
    this.assertSession();
    await rememberOrganizationTabSession(this.accountId, this.receivingAddress, this.configuration);
    this.assertSession();
  }
  assertSession = () => {
    if (this.wallet !== getConnectedWallet() || !isVaultSessionUnlocked() || getVaultSessionRevision() !== this.revision) throw new Error("Organization session changed. Reconnect and unlock your wallet’s organization vault.");
  };
  async assertWallet() {
    this.assertSession();
    // Service settings were verified at unlock and remain in memory for this
    // account only. Recheck the live network session and both identities on every
    // boundary; never use the settings as a fallback for a failed live check.
    const identity = await readOrganizationWallet(this.wallet, 25_000, this.assertSession, this.configuration);
    const { shielded, receiving } = identity;
    this.assertSession();
    if (decodeWalletPublicKey(shielded.shieldedCoinPublicKey, "shield-cpk", "preprod") !== this.accountId) { this.close(); throw new Error("Wallet account changed. Unlock the selected account’s own vault."); }
    if (receiving.unshieldedAddress !== this.receivingAddress) { this.close(); throw new Error("Wallet receiving account changed. Reopen its organization vault."); }
    this.assertSession();
    return identity;
  }
  private key() { return organizationAccountKey("preprod", this.accountId); }
  snapshot(): OrganizationSnapshot { this.assertSession(); return copyAccount(this.record.snapshot); }
  pending(): OrganizationPending | null { this.assertSession(); return copyAccount(this.record.pending); }
  recoveryHistory() { this.assertSession(); return (this.record.recoveries ?? []).map(entry => ({ txId: entry.original.txId, blockHeight: entry.evidence.finalized.height, recordedAt: entry.recordedAt })); }
  async save() {
    await this.commit(this.record);
  }
  private async commit(record: OrganizationRecord) {
    this.assertSession();
    const password = getVaultSessionPassphrase();
    if (!password) throw new Error("Organization vault is locked.");
    const next = copyAccount(record);
    // History lives outside candidate snapshots and survives every commit path.
    next.recoveries ??= copyAccount(this.record.recoveries);
    if ((next.recoveries?.length ?? 0) > 10 || this.record.recoveries?.some((entry, index) => encodeVaultJson(entry) !== encodeVaultJson(next.recoveries?.[index]))) throw new Error("Retained recovery history cannot be removed or replaced.");
    await saveEncryptedJson(this.key(), next, password, { beforeWrite: this.assertSession });
    this.assertSession();
    this.record = next;
  }
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    return this.withAccountLock(action, true);
  }
  private async withAccountLock<T>(action: () => Promise<T>, verifyWallet: boolean): Promise<T> {
    this.assertSession();
    if (!navigator.locks) throw new Error("This browser does not support the account lock required for safe transactions.");
    return navigator.locks.request(this.key(), { mode: "exclusive", ifAvailable: true }, async lock => {
      if (!lock) throw new Error("This organization is active in another tab. Wait for its operation to finish.");
      if (verifyWallet) await this.assertWallet();
      this.assertSession();
      const password = getVaultSessionPassphrase()!;
      const current = await loadEncryptedJson<OrganizationRecord>(this.key(), password);
      this.assertSession();
      if (!current || current.snapshot.accountId !== this.accountId) throw new Error("Organization account cannot be recovered.");
      this.record = current;
      return action();
    });
  }
  async prepare(pending: OrganizationPending) {
    this.assertSession();
    if (this.record.pending) throw new Error("Reconcile the existing signed operation before starting another one.");
    await this.commit({ snapshot: this.record.snapshot, pending });
  }
  async submitted(txId: string, transaction: string, address: string) {
    this.assertSession();
    const record = copyAccount(this.record), pending = record.pending;
    if (!pending || pending.txId || !transaction || !/^[0-9a-f]{64}$/.test(address)) throw new Error("Invalid organization submission state.");
    if (pending.contractAddress && pending.contractAddress !== address) throw new Error("Transaction targets another facility.");
    pending.txId = txId; pending.transaction = transaction; pending.contractAddress = address;
    if (pending.kind === "deploy") {
      const facility = pending.after.facilities.find(f => f.id === pending.facilityId);
      if (!facility) throw new Error("Deployment has no retained organization facility.");
      facility.address = address;
    }
    await this.commit(record);
  }
  async complete(receipt: OrganizationReceipt) {
    this.assertSession();
    const pending = this.record.pending;
    if (!pending || !pending.txId || pending.txId !== receipt.txId || pending.contractAddress !== receipt.contractAddress || pending.circuit !== receipt.circuit || !receipt.txHash || !Number.isSafeInteger(receipt.blockHeight) || receipt.blockHeight <= 0) throw new Error("Finalized receipt differs from the saved organization operation.");
    const snapshot = copyAccount(pending.after); snapshot.receipts.push(receipt);
    await this.commit({ snapshot, pending: null });
  }
  async rejectFinalized(receipt: OrganizationReceipt) {
    this.assertSession();
    const pending = this.record.pending;
    if (!pending?.txId || pending.txId !== receipt.txId || pending.contractAddress !== receipt.contractAddress || pending.circuit !== receipt.circuit || !receipt.txHash || !Number.isSafeInteger(receipt.blockHeight) || receipt.blockHeight <= 0) throw new Error("Failure receipt differs from the saved organization operation.");
    const snapshot = copyAccount(this.record.snapshot);
    snapshot.failures ??= []; snapshot.failures.push(receipt);
    await this.commit({ snapshot, pending: null });
  }
  async archiveExpiredOpening(expected: OrganizationPending, evidence: ExpiredOpeningEvidence, ttl: number) {
    this.assertSession();
    if (!matchesExpiredOpeningScope(expected)) throw new Error("Only the explicitly scoped openings can use this recovery path.");
    if (!this.record.pending?.txId || encodeVaultJson(this.record.pending) !== encodeVaultJson(expected)) throw new Error("The saved operation changed. Review its recovery again.");
    const recoveries = copyAccount(this.record.recoveries ?? []);
    if (recoveries.some(entry => entry.original.txId === expected.txId)) throw new Error("This original operation already has recovery history.");
    recoveries.push({ disposition: "expired-opening-not-applied", before: copyAccount(this.record.snapshot), original: copyAccount(expected), evidence: copyAccount(evidence), ttl, recordedAt: new Date().toISOString() });
    await this.commit({ snapshot: this.record.snapshot, pending: null, recoveries });
  }
  async archiveExpiredDisable(expected: OrganizationPending, evidence: ExpiredDisableEvidence, ttl: number) {
    this.assertSession();
    if (!matchesExpiredDisableScope(expected)) throw new Error("Only the explicitly scoped merchant disable can use this recovery path.");
    if (!this.record.pending?.txId || encodeVaultJson(this.record.pending) !== encodeVaultJson(expected)) throw new Error("The saved operation changed. Review its recovery again.");
    const recoveries = copyAccount(this.record.recoveries ?? []);
    if (recoveries.some(entry => entry.original.txId === expected.txId)) throw new Error("This original operation already has recovery history.");
    recoveries.push({ disposition: "expired-disable-not-applied", before: copyAccount(this.record.snapshot), original: copyAccount(expected), evidence: copyAccount(evidence), ttl, recordedAt: new Date().toISOString() });
    await this.commit({ snapshot: this.record.snapshot, pending: null, recoveries });
  }
  async archiveExpiredCompensation(expected: OrganizationPending, evidence: ExpiredCompensationEvidence, ttl: number) {
    this.assertSession();
    if (!matchesExpiredCompensationScope(expected)) throw new Error("Only the explicitly scoped claim compensation can use this recovery path.");
    if (!this.record.pending?.txId || encodeVaultJson(this.record.pending) !== encodeVaultJson(expected)) throw new Error("The saved operation changed. Review its recovery again.");
    const recoveries = copyAccount(this.record.recoveries ?? []);
    if (recoveries.some(entry => entry.original.txId === expected.txId)) throw new Error("This original operation already has recovery history.");
    recoveries.push({ disposition: "expired-compensation-not-applied", before: copyAccount(this.record.snapshot), original: copyAccount(expected), evidence: copyAccount(evidence), ttl, recordedAt: new Date().toISOString() });
    await this.commit({ snapshot: this.record.snapshot, pending: null, recoveries });
  }
  async archiveExpiredQuote(expected: OrganizationPending, evidence: ExpiredQuoteEvidence, ttl: number) {
    this.assertSession();
    if (!matchesExpiredQuoteScope(expected)) throw new Error("Only the explicitly scoped merchant quote can use this recovery path.");
    if (!this.record.pending?.txId || encodeVaultJson(this.record.pending) !== encodeVaultJson(expected)) throw new Error("The saved operation changed. Review its recovery again.");
    const recoveries = copyAccount(this.record.recoveries ?? []);
    if (recoveries.some(entry => entry.original.txId === expected.txId)) throw new Error("This original operation already has recovery history.");
    recoveries.push({ disposition: "expired-quote-not-applied", before: copyAccount(this.record.snapshot), original: copyAccount(expected), evidence: copyAccount(evidence), ttl, recordedAt: new Date().toISOString() });
    await this.commit({ snapshot: this.record.snapshot, pending: null, recoveries });
  }
  async discardUnsubmitted() {
    this.assertSession();
    if (this.record.pending?.txId) throw new Error("A signed submission must be reconciled against its exact transaction.");
    await this.commit({ snapshot: this.record.snapshot, pending: null });
  }
  async savedSubmissionDetails(sourceFingerprint: string) {
    return this.withAccountLock(async () => {
      const pending = this.pending();
      if (!pending?.txId) throw new Error("No original signed transaction is saved.");
      const { originalOrganizationSubmissionDetails } = await import("./transactions.ts");
      this.assertSession();
      const details = originalOrganizationSubmissionDetails(pending, sourceFingerprint);
      this.assertSession();
      return details;
    }, false);
  }
  async encryptedBackup() {
    // Recovery must remain available when the wallet's remote API is offline.
    // Keep the session guard, durable reload and lock; only omit the RPC check.
    return this.withAccountLock(async () => {
      this.assertSession();
      const backup = await encryptSecret(this.key(), encodeVaultJson(this.record), getVaultSessionPassphrase()!);
      this.assertSession();
      return backup;
    }, false);
  }
  async restoreBackup(file: string, backupPassword: string, verify: (record: OrganizationRecord) => Promise<void>) {
    // Authenticate before taking the write lock. Decryption never changes the
    // active vault password; a restored record is encrypted with this session.
    const restored = await decodeOrganizationBackup(file, backupPassword, this.key(), this.accountId);
    return this.exclusive(async () => {
      if (!isOrganizationEmpty(this.record)) throw new Error("Restore into a fresh organization workspace. Existing facilities, claims and pending transactions cannot be overwritten by a backup.");
      for (const facility of restored.snapshot.facilities) {
        if (facility.issuerRecipient !== this.receivingAddress) throw new Error("The restored facility belongs to another receiving wallet.");
      }
      await verify(copyAccount(restored));
      await this.assertWallet();
      await this.commit(restored);
    });
  }
  async edit(action: (snapshot: OrganizationSnapshot) => void) {
    return this.exclusive(async () => {
      if (this.record.pending) throw new Error("Resolve the pending network transaction before updating the organization.");
      const after = copyAccount(this.record.snapshot); action(after);
      await this.commit({ snapshot: after, pending: null });
    });
  }
  close() { lockVaultSession(); }
}
