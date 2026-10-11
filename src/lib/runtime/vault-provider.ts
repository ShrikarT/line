/** Encrypted private-state and signing-key storage. No plaintext read cache. */
import type {
  PrivateStateProvider, PrivateStateId, ExportPrivateStatesOptions, PrivateStateExport,
  ImportPrivateStatesOptions, ImportPrivateStatesResult, SigningKeyExport,
  ExportSigningKeysOptions, ImportSigningKeysOptions, ImportSigningKeysResult,
} from "@midnight-ntwrk/midnight-js-types";
import {
  saveEncryptedSecret, loadEncryptedJson, removeEncryptedSecret, removeEncryptedPrefix,
  getVaultSessionPassphrase, isVaultSessionUnlocked, getVaultSessionRevision,
  onVaultSessionLock, encryptSecret, decryptSecret, encodeVaultJson, decodeVaultJson,
  loadEncryptedSecret, listEncryptedKeys,
  type EncryptedEnvelope,
} from "../security/vault.ts";
import {
  ContractNotConfiguredError, VaultLockedError, VaultPersistenceError, UnsupportedOperationError,
} from "./errors.ts";

export interface VaultPrivateStateProviderConfig {
  passwordProvider?: () => string | Promise<string>;
  networkId?: string;
  /** Explicit account scope. Omitted/default retains the legacy namespace; key segments are escaped. */
  accountId?: string;
  /** Opt-in encrypted, volatile storage on persistence failure, never on authentication failure. */
  allowEphemeralFallback?: boolean;
}

interface Authorization {
  passphrase: string;
  revision: number;
  sessionBound: boolean;
}

export class VaultPrivateStateProvider<PS = unknown> implements PrivateStateProvider<PrivateStateId, PS> {
  private currentContractAddress: string | null = null;
  private ephemeral = new Map<string, EncryptedEnvelope>();
  private readonly passwordProvider?: () => string | Promise<string>;
  private readonly networkScope: string;
  private readonly accountScope: string | null;
  private readonly stopLockListener?: () => void;
  private disposed = false;
  readonly allowEphemeralFallback: boolean;

  constructor(config?: VaultPrivateStateProviderConfig) {
    this.passwordProvider = config?.passwordProvider;
    const account = config?.accountId ?? "default";
    this.networkScope = encodeURIComponent(config?.networkId ?? "preprod");
    this.accountScope = account === "default" ? null : encodeURIComponent(account);
    this.allowEphemeralFallback = config?.allowEphemeralFallback ?? false;
    if (this.allowEphemeralFallback) {
      this.stopLockListener = onVaultSessionLock(() => this.ephemeral.clear());
    }
  }

  /** Dispose opt-in ephemeral state and its lock listener when replacing a provider. */
  dispose(): void {
    this.disposed = true;
    this.ephemeral.clear();
    this.stopLockListener?.();
  }

  setContractAddress(address: string): void {
    if (!address.trim()) throw new ContractNotConfiguredError();
    this.currentContractAddress = address;
  }

  private ensureContractConfigured(): string {
    if (!this.currentContractAddress) {
      throw new ContractNotConfiguredError("setContractAddress must be called before accessing private state.");
    }
    return this.currentContractAddress;
  }

  private assertAuthorized(auth: Authorization): void {
    if (this.disposed) throw new VaultLockedError("Private storage provider was revoked.");
    if (auth.sessionBound &&
      (!isVaultSessionUnlocked() || getVaultSessionRevision() !== auth.revision)) {
      throw new VaultLockedError("Vault session changed while private storage was in use. Unlock and retry.");
    }
  }

  private async authorize(): Promise<Authorization> {
    if (this.disposed) throw new VaultLockedError("Private storage provider was revoked.");
    // A browser password callback is not a second means of bypassing a locked UI vault.
    const unlocked = isVaultSessionUnlocked();
    if (typeof window !== "undefined" && !unlocked) throw new VaultLockedError();
    const revision = getVaultSessionRevision();
    const passphrase = this.passwordProvider
      ? await this.passwordProvider()
      : getVaultSessionPassphrase();
    if (!passphrase) throw new VaultLockedError();
    const auth = { passphrase, revision, sessionBound: unlocked || typeof window !== "undefined" };
    this.assertAuthorized(auth);
    return auth;
  }

  private statePrefix(): string {
    return this.storagePrefix("ps") + `${encodeURIComponent(this.ensureContractConfigured())}:`;
  }

  private storagePrefix(kind: "ps" | "sk"): string {
    // A distinct namespace also prevents a legacy/default network named "account"
    // from clearing explicit-account records via a matching prefix.
    const prefix = this.accountScope === null ? `midnight:${kind}:` : `midnight:${kind}-account:${this.accountScope}:`;
    return `${prefix}${this.networkScope}:`;
  }

  private stateKey(privateStateId: string): string {
    return this.statePrefix() + encodeURIComponent(privateStateId);
  }

  private signingPrefix(): string { return this.storagePrefix("sk"); }
  private signingKey(address: string): string { return this.signingPrefix() + encodeURIComponent(address); }

  private canFallback(err: unknown): boolean {
    return this.allowEphemeralFallback && err instanceof VaultPersistenceError;
  }

  private async read<T>(key: string): Promise<T | null> {
    const auth = await this.authorize();
    let durable: T | null = null;
    try {
      durable = await loadEncryptedJson<T>(key, auth.passphrase);
      this.assertAuthorized(auth);
      // Only a failed durable write creates an ephemeral record. Durable authentication
      // must still be attempted on every read; MAC/codec failures never fall through.
    } catch (err) {
      this.assertAuthorized(auth);
      if (!this.canFallback(err)) throw err;
    }
    const envelope = this.ephemeral.get(key);
    if (!envelope) return durable;
    const value = decodeVaultJson(await decryptSecret(envelope, auth.passphrase)) as T;
    this.assertAuthorized(auth);
    return value;
  }

  private async write<T>(key: string, value: T): Promise<void> {
    const auth = await this.authorize();
    // Serialize outside the fallback catch: unsupported/cyclic data must never become
    // an apparent successful write, regardless of persistence configuration.
    const serialized = encodeVaultJson(value);
    const existingEphemeral = this.ephemeral.get(key);
    if (existingEphemeral) await decryptSecret(existingEphemeral, auth.passphrase);
    this.assertAuthorized(auth);
    try {
      // A non-empty callback password is not proof it owns an existing record.
      await loadEncryptedSecret(key, auth.passphrase);
      this.assertAuthorized(auth);
      await saveEncryptedSecret(key, serialized, auth.passphrase, { beforeWrite: () => this.assertAuthorized(auth) });
      this.assertAuthorized(auth);
      this.ephemeral.delete(key);
    } catch (err) {
      this.assertAuthorized(auth);
      if (!this.canFallback(err)) throw err;
      const envelope = await encryptSecret(key, serialized, auth.passphrase);
      this.assertAuthorized(auth);
      this.ephemeral.set(key, envelope);
    }
  }

  private async delete(key: string): Promise<void> {
    const auth = await this.authorize();
    await loadEncryptedSecret(key, auth.passphrase);
    const ephemeral = this.ephemeral.get(key);
    if (ephemeral) await decryptSecret(ephemeral, auth.passphrase);
    this.assertAuthorized(auth);
    // A failed delete cannot hide a still-durable record by deleting only a cache.
    await removeEncryptedSecret(key, { beforeWrite: () => this.assertAuthorized(auth) });
    this.assertAuthorized(auth);
    this.ephemeral.delete(key);
  }

  private async deletePrefix(prefix: string): Promise<void> {
    const auth = await this.authorize();
    const keys = await listEncryptedKeys(prefix);
    for (const key of keys) {
      await loadEncryptedSecret(key, auth.passphrase);
      this.assertAuthorized(auth);
    }
    for (const [key, envelope] of this.ephemeral) {
      if (key.startsWith(prefix)) await decryptSecret(envelope, auth.passphrase);
      this.assertAuthorized(auth);
    }
    this.assertAuthorized(auth);
    await removeEncryptedPrefix(prefix, { beforeWrite: () => this.assertAuthorized(auth) });
    this.assertAuthorized(auth);
    for (const key of this.ephemeral.keys()) if (key.startsWith(prefix)) this.ephemeral.delete(key);
  }

  async get(privateStateId: PrivateStateId): Promise<PS | null> { return this.read<PS>(this.stateKey(privateStateId)); }
  async set(privateStateId: PrivateStateId, state: PS): Promise<void> { return this.write(this.stateKey(privateStateId), state); }
  async remove(privateStateId: PrivateStateId): Promise<void> { return this.delete(this.stateKey(privateStateId)); }
  async clear(): Promise<void> { return this.deletePrefix(this.statePrefix()); }
  async setSigningKey(address: string, signingKey: string): Promise<void> { return this.write(this.signingKey(address), signingKey); }
  async getSigningKey(address: string): Promise<string | null> { return this.read<string>(this.signingKey(address)); }
  async removeSigningKey(address: string): Promise<void> { return this.delete(this.signingKey(address)); }
  async clearSigningKeys(): Promise<void> { return this.deletePrefix(this.signingPrefix()); }

  async exportPrivateStates(_options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
    throw new UnsupportedOperationError("exportPrivateStates");
  }
  async importPrivateStates(_data: PrivateStateExport, _options?: ImportPrivateStatesOptions): Promise<ImportPrivateStatesResult> {
    throw new UnsupportedOperationError("importPrivateStates");
  }
  async exportSigningKeys(_options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
    throw new UnsupportedOperationError("exportSigningKeys");
  }
  async importSigningKeys(_data: SigningKeyExport, _options?: ImportSigningKeysOptions): Promise<ImportSigningKeysResult> {
    throw new UnsupportedOperationError("importSigningKeys");
  }
}
