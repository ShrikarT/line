/**
 * VaultPrivateStateProvider
 *
 * Official implementation of PrivateStateProvider backed by WebCrypto AES-GCM 256-bit
 * encryption and IndexedDB persistence via src/lib/security/vault.ts.
 *
 * Scopes private states by contract address and privateStateId.
 * Complies with @midnight-ntwrk/midnight-js-types.
 */
import type {
  PrivateStateProvider,
  PrivateStateId,
  ExportPrivateStatesOptions,
  PrivateStateExport,
  ImportPrivateStatesOptions,
  ImportPrivateStatesResult,
  SigningKeyExport,
  ExportSigningKeysOptions,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
} from "@midnight-ntwrk/midnight-js-types";
import {
  saveEncryptedJson,
  loadEncryptedJson,
  removeEncryptedSecret,
  removeEncryptedPrefix,
  getVaultSessionPassphrase,
  isVaultSessionUnlocked,
} from "../security/vault.ts";
import {
  ContractNotConfiguredError,
  VaultLockedError,
  VaultPassphraseError,
  VaultTamperedError,
  VaultPersistenceError,
  UnsupportedOperationError,
} from "./errors.ts";

export interface VaultPrivateStateProviderConfig {
  passwordProvider?: () => string | Promise<string>;
  networkId?: string;
  allowEphemeralFallback?: boolean;
}

export class VaultPrivateStateProvider<PS = unknown> implements PrivateStateProvider<PrivateStateId, PS> {
  private currentContractAddress: string | null = null;
  private inMemoryFallback = new Map<string, PS>();
  private signingKeys = new Map<string, unknown>();
  private passwordProvider?: () => string | Promise<string>;
  private networkId: string;
  readonly allowEphemeralFallback: boolean;

  constructor(config?: VaultPrivateStateProviderConfig) {
    this.passwordProvider = config?.passwordProvider;
    this.networkId = config?.networkId ?? "midnight-testnet";
    this.allowEphemeralFallback = config?.allowEphemeralFallback ?? false;
  }

  setContractAddress(address: string): void {
    this.currentContractAddress = address;
  }

  private ensureContractConfigured(): string {
    if (!this.currentContractAddress) {
      throw new ContractNotConfiguredError("setContractAddress must be called before accessing private state.");
    }
    return this.currentContractAddress;
  }

  private async getPassphrase(): Promise<string> {
    if (this.passwordProvider) {
      const p = await this.passwordProvider();
      if (p) return p;
    }
    const sessionPassphrase = getVaultSessionPassphrase();
    if (sessionPassphrase) return sessionPassphrase;
    throw new VaultLockedError("Private state storage locked: Passphrase or active vault session required.");
  }

  private storageKey(privateStateId: string): string {
    const contract = this.ensureContractConfigured();
    return `midnight:ps:${this.networkId}:${contract}:${privateStateId}`;
  }

  async get(privateStateId: PrivateStateId): Promise<PS | null> {
    const contract = this.ensureContractConfigured();
    const key = this.storageKey(privateStateId);

    try {
      const passphrase = await this.getPassphrase();
      const data = await loadEncryptedJson<PS>(key, passphrase);
      if (data !== null && data !== undefined) {
        return data;
      }
    } catch (err) {
      if (!this.allowEphemeralFallback) {
        throw err;
      }
    }

    const memKey = `${contract}:${privateStateId}`;
    return this.inMemoryFallback.get(memKey) ?? null;
  }

  async set(privateStateId: PrivateStateId, state: PS): Promise<void> {
    const contract = this.ensureContractConfigured();
    const memKey = `${contract}:${privateStateId}`;
    this.inMemoryFallback.set(memKey, state);

    try {
      const passphrase = await this.getPassphrase();
      const key = this.storageKey(privateStateId);
      await saveEncryptedJson(key, state, passphrase);
    } catch (err) {
      if (!this.allowEphemeralFallback) {
        if (err instanceof VaultLockedError) {
          throw err;
        }
        throw new VaultPersistenceError(err instanceof Error ? err.message : String(err), { privateStateId });
      }
    }
  }

  async remove(privateStateId: PrivateStateId): Promise<void> {
    const contract = this.ensureContractConfigured();
    const memKey = `${contract}:${privateStateId}`;
    this.inMemoryFallback.delete(memKey);
    const key = this.storageKey(privateStateId);
    try {
      await removeEncryptedSecret(key);
    } catch (err) {
      if (!this.allowEphemeralFallback) {
        throw new VaultPersistenceError(err instanceof Error ? err.message : String(err), { privateStateId });
      }
    }
  }

  async clear(): Promise<void> {
    this.inMemoryFallback.clear();
    if (this.currentContractAddress) {
      const prefix = `midnight:ps:${this.networkId}:${this.currentContractAddress}:`;
      await removeEncryptedPrefix(prefix);
    }
  }

  async setSigningKey(address: string, signingKey: string): Promise<void> {
    this.signingKeys.set(address, signingKey);
    try {
      const passphrase = await this.getPassphrase();
      await saveEncryptedJson(`midnight:sk:${this.networkId}:${address}`, signingKey, passphrase);
    } catch (err) {
      if (!this.allowEphemeralFallback) {
        if (err instanceof VaultLockedError) {
          throw err;
        }
        throw new VaultPersistenceError(err instanceof Error ? err.message : String(err), { address });
      }
    }
  }

  async getSigningKey(address: string): Promise<string | null> {
    const cached = this.signingKeys.get(address) as string | undefined;
    if (cached !== undefined) {
      return cached;
    }
    try {
      const passphrase = await this.getPassphrase();
      const loaded = await loadEncryptedJson<string>(`midnight:sk:${this.networkId}:${address}`, passphrase);
      if (loaded !== null) {
        this.signingKeys.set(address, loaded);
        return loaded;
      }
    } catch (err) {
      if (!this.allowEphemeralFallback) {
        throw err;
      }
    }
    return null;
  }

  async removeSigningKey(address: string): Promise<void> {
    this.signingKeys.delete(address);
    try {
      await removeEncryptedSecret(`midnight:sk:${this.networkId}:${address}`);
    } catch (err) {
      if (!this.allowEphemeralFallback) {
        throw new VaultPersistenceError(err instanceof Error ? err.message : String(err), { address });
      }
    }
  }

  async clearSigningKeys(): Promise<void> {
    this.signingKeys.clear();
    const prefix = `midnight:sk:${this.networkId}:`;
    await removeEncryptedPrefix(prefix);
  }

  async exportPrivateStates(_options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
    throw new UnsupportedOperationError("exportPrivateStates");
  }

  async importPrivateStates(_exportData: PrivateStateExport, _options?: ImportPrivateStatesOptions): Promise<ImportPrivateStatesResult> {
    throw new UnsupportedOperationError("importPrivateStates");
  }

  async exportSigningKeys(_options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
    throw new UnsupportedOperationError("exportSigningKeys");
  }

  async importSigningKeys(_exportData: SigningKeyExport, _options?: ImportSigningKeysOptions): Promise<ImportSigningKeysResult> {
    throw new UnsupportedOperationError("importSigningKeys");
  }
}
