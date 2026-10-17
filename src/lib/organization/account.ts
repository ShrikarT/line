import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { bech32m } from "@scure/base";
import { decodeWalletPublicKey, getConnectedWallet, getWalletConfiguration } from "../runtime/wallet.ts";
import { encodeVaultJson, encryptSecret, getVaultSessionPassphrase, getVaultSessionRevision, isVaultSessionUnlocked, loadEncryptedJson, lockVaultSession, saveEncryptedJson, unlockVaultSession } from "../security/vault.ts";
import { hexToBytes, randomBytes32, toHex } from "../line/encoding.ts";

export type OrganizationReceipt = { kind: "deploy" | "key" | "call"; circuit: string; contractAddress: string; txId: string; txHash: string; blockHeight: number; recordedAt: string };
export type MerchantBinding = { publicKey: string; address: string; name: string; disabled?: boolean };
export type OrganizationFacility = {
  id: string; name: string; address: string | null; instanceNonce: string; maintenanceKey: string;
  assetColor: string; issuerRecipient: string; merchants: MerchantBinding[];
  agentSecret: string; salt: string; limit: bigint; outstanding: bigint; epoch: bigint; generation: bigint;
};
export type OrganizationQuote = { contractAddress: string; domain: string; merchantPk: string; invoiceId: string; quoteNonce: string; amount: bigint; expiry: bigint; generation: bigint; feeFlat: bigint; feeBps: bigint; quoteCommitment: string };
export type OrganizationNote = { contractAddress: string; domain: string; identity: string; merchantPk: string; quoteCommitment: string; amount: bigint; fee: bigint; expiry: bigint; generation: bigint; noteNonce: string; noteSalt: string; noteCommitment: string; redeemed: boolean; refund?: { salt: string; amount: bigint; paid: boolean } };
export type OrganizationServiceOrder = { id: string; facilityId: string; service: string; document: string; price: string; assetColor: string; merchantPk: string; merchantAddress: string; noteCommitment?: string; result?: Record<string, unknown>; delivered: boolean };
export type OrganizationSnapshot = { schema: "line:organization-account/v1"; networkId: "preprod"; accountId: string; issuerSecret: string; merchantSecret: string; facilities: OrganizationFacility[]; quotes: OrganizationQuote[]; notes: OrganizationNote[]; receipts: OrganizationReceipt[]; serviceOrders?: OrganizationServiceOrder[]; failures?: OrganizationReceipt[] };
export type OrganizationPending = { id: string; kind: OrganizationReceipt["kind"]; circuit: string; facilityId: string | null; contractAddress: string | null; sourceFingerprint: string; after: OrganizationSnapshot; txId: string | null; transaction: string | null };
export type OrganizationRecord = { snapshot: OrganizationSnapshot; pending: OrganizationPending | null };
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
  private record: OrganizationRecord;
  private constructor(wallet: ConnectedAPI, accountId: string, receivingAddress: string, revision: number, record: OrganizationRecord) {
    this.wallet = wallet; this.accountId = accountId; this.receivingAddress = receivingAddress; this.revision = revision; this.record = record;
  }
  static async unlock(wallet: ConnectedAPI, passphrase: string): Promise<OrganizationAccount> {
    if (wallet !== getConnectedWallet()) throw new Error("Connect your wallet before opening an organization.");
    if (passphrase.length < 8) throw new Error("Use at least eight characters for the organization vault password.");
    await getWalletConfiguration(wallet, "preprod");
    const [shielded, unshielded] = await Promise.all([wallet.getShieldedAddresses(), wallet.getUnshieldedAddress()]);
    const accountId = decodeWalletPublicKey(shielded.shieldedCoinPublicKey, "shield-cpk", "preprod");
    receivingAddressBytes(unshielded.unshieldedAddress);
    // Authenticate existing ciphertext before replacing any open vault session.
    const key = organizationAccountKey("preprod", accountId);
    if (!navigator.locks) throw new Error("Use a browser with account-lock support to protect organization transactions.");
    return navigator.locks.request(key, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new Error("This organization is busy in another tab.");
    const retained = await loadEncryptedJson<OrganizationRecord>(key, passphrase);
    if (wallet !== getConnectedWallet()) throw new Error("Wallet changed while opening the organization.");
    if (retained && (retained.snapshot?.schema !== ORGANIZATION_SCHEMA || retained.snapshot.accountId !== accountId || retained.snapshot.networkId !== "preprod")) throw new Error("Organization record belongs to another wallet or schema.");
    unlockVaultSession(passphrase);
    const account = new OrganizationAccount(wallet, accountId, unshielded.unshieldedAddress, getVaultSessionRevision(), retained ?? {
      snapshot: { schema: ORGANIZATION_SCHEMA, networkId: "preprod", accountId, issuerSecret: toHex(randomBytes32()), merchantSecret: toHex(randomBytes32()), facilities: [], quotes: [], notes: [], receipts: [] }, pending: null,
    });
    if (!retained) await account.save();
    return account;
    });
  }
  assertSession = () => {
    if (this.wallet !== getConnectedWallet() || !isVaultSessionUnlocked() || getVaultSessionRevision() !== this.revision) throw new Error("Organization session changed. Reconnect and unlock your wallet’s organization vault.");
  };
  async assertWallet() {
    this.assertSession();
    const shielded = await this.wallet.getShieldedAddresses();
    this.assertSession();
    if (decodeWalletPublicKey(shielded.shieldedCoinPublicKey, "shield-cpk", "preprod") !== this.accountId) { this.close(); throw new Error("Wallet account changed. Unlock the selected account’s own vault."); }
    const config = await this.wallet.getConfiguration();
    if (config.networkId !== "preprod") { this.close(); throw new Error("Switch your wallet back to Midnight Preprod."); }
    const receiving = await this.wallet.getUnshieldedAddress();
    if (receiving.unshieldedAddress !== this.receivingAddress) { this.close(); throw new Error("Wallet receiving account changed. Reopen its organization vault."); }
    this.assertSession();
  }
  private key() { return organizationAccountKey("preprod", this.accountId); }
  snapshot(): OrganizationSnapshot { this.assertSession(); return copyAccount(this.record.snapshot); }
  pending(): OrganizationPending | null { this.assertSession(); return copyAccount(this.record.pending); }
  async save() {
    await this.commit(this.record);
  }
  private async commit(record: OrganizationRecord) {
    this.assertSession();
    const password = getVaultSessionPassphrase();
    if (!password) throw new Error("Organization vault is locked.");
    const next = copyAccount(record);
    await saveEncryptedJson(this.key(), next, password, { beforeWrite: this.assertSession });
    this.assertSession();
    this.record = next;
  }
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    this.assertSession();
    if (!navigator.locks) throw new Error("This browser does not support the account lock required for safe transactions.");
    return navigator.locks.request(this.key(), { mode: "exclusive", ifAvailable: true }, async lock => {
      if (!lock) throw new Error("This organization is active in another tab. Wait for its operation to finish.");
      await this.assertWallet();
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
  async discardUnsubmitted() {
    this.assertSession();
    if (this.record.pending?.txId) throw new Error("A signed submission must be reconciled against its exact transaction.");
    await this.commit({ snapshot: this.record.snapshot, pending: null });
  }
  async encryptedBackup() {
    return this.exclusive(async () => {
      this.assertSession();
      return encryptSecret(this.key(), encodeVaultJson(this.record), getVaultSessionPassphrase()!);
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
