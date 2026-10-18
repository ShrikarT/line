import '@midnight-ntwrk/wallet-sdk-node-client';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDWallet, Roles, ShieldedWallet, UnshieldedWallet, DustWallet, createKeystore, PublicKey, WalletFacade, WalletEntrySchema, InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk';
import * as L from '@midnight-ntwrk/ledger-v8';
import { ApiPromise, HttpProvider } from '@polkadot/api';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { EncryptedCheckoutStore } from './checkout-storage.ts';
import { OrganizationMerchants } from './organization-merchants.mjs';
import { assertFundedFeeTransaction } from './preprod-fees.mjs';
import { resolveMidnightEndpoints, assertEndpointCredentials } from '../src/lib/runtime/endpoints.ts';
import { withinDeadline } from '../src/lib/organization/finality.ts';
import { createFinalizedReceiptReader } from '../scripts/finalized-contract-receipt.mjs';
import { resolveContractRelease, validateContractArtifacts } from '../scripts/contract-artifacts.mjs';

const CACHE_ID = '31eec72a-f297-4a70-9df2-19d3b2a09cf7';
const PROFILE = 'line:organization-supplier-wallet/v1';

/** One process owns this supplier fee wallet and its encrypted cache.
 * Opening storage never starts a facade or submits a transaction. The production
 * entry point explicitly starts synchronization after it has exclusive custody.
 */
export class OrganizationWallet {
  static async open(env = process.env) {
    const mnemonic = env.MIDNIGHT_SUPPLIER_MNEMONIC;
    if (!mnemonic || !validateMnemonic(mnemonic, wordlist)) throw Error('Configure a valid supplier wallet mnemonic.');
    if (!env.LINE_SUPPLIER_DATA_DIR || !env.MIDNIGHT_STORAGE_PASSWORD) throw Error('Configure the persistent supplier data directory and storage password.');
    const storagePassword = env.MIDNIGHT_STORAGE_PASSWORD;
    const owner = new OrganizationWallet();
    owner.endpoints = resolveMidnightEndpoints({ networkId: 'preprod', blockfrostProjectId: env.MIDNIGHT_BLOCKFROST_PROJECT_ID, proofServerUri: env.MIDNIGHT_PROOF_SERVER_URI });
    assertEndpointCredentials(owner.endpoints);
    const derived = HDWallet.fromSeed(await mnemonicToSeed(mnemonic));
    if (derived.type !== 'seedOk') throw Error('Supplier wallet derivation failed.');
    const account = derived.hdWallet.selectAccount(0);
    const external = account.selectRole(Roles.NightExternal);
    owner.shieldedKeys = L.ZswapSecretKeys.fromSeed(account.selectRole(Roles.Zswap).deriveKeyAt(0).key);
    owner.dustKey = L.DustSecretKey.fromSeed(account.selectRole(Roles.Dust).deriveKeyAt(0).key);
    owner.keystore = createKeystore(external.deriveKeyAt(0).key, 'preprod');
    owner.recipients = { A: PublicKey.fromKeyStore(createKeystore(external.deriveKeyAt(1).key, 'preprod')), B: PublicKey.fromKeyStore(createKeystore(external.deriveKeyAt(2).key, 'preprod')) };
    owner.keys = Object.fromEntries(['A', 'B'].map((name, index) => ['merchant' + name, new Uint8Array(createHash('sha256').update(account.selectRole(Roles.NightExternal).deriveKeyAt(index + 3).key).update('line:merchant:role:v1').digest())]));
    owner.dataDirectory = resolve(env.LINE_SUPPLIER_DATA_DIR);
    mkdirSync(owner.dataDirectory, { recursive: true, mode: 0o700 });
    const walletId = PublicKey.fromKeyStore(owner.keystore).address;
    const binding = createHash('sha256').update(PROFILE + '\0preprod\0' + walletId).digest('hex');
    owner.store = await EncryptedCheckoutStore.openBound(join(owner.dataDirectory, 'wallet-owner'), storagePassword, binding);
    try {
      const retained = await owner.store.loadAll();
      if (retained.length > 1) throw Error('The supplier wallet has incompatible retained records.');
      owner.record = retained[0] ?? { schema: PROFILE, networkId: 'preprod', walletId, dust: null, unshielded: null };
      const record = owner.record;
      if (record.schema !== PROFILE || record.networkId !== 'preprod' || record.walletId !== walletId || (record.dust === null) !== (record.unshielded === null) || record.dust !== null && (typeof record.dust !== 'string' || typeof record.unshielded !== 'string')) throw Error('The supplier wallet cache belongs to another identity or schema.');
      if (record.dust) {
        const cached = JSON.parse(record.dust);
        if (cached.networkId !== 'preprod' || BigInt(cached.publicKey.publicKey) !== owner.dustKey.publicKey) throw Error('The supplier DUST cache belongs to another wallet.');
      }
      if (!retained.length) await owner.store.save(CACHE_ID, record);
      owner.privateStorageOptions = { midnightDbName: join(owner.dataDirectory, 'private-db'), accountId: walletId, privateStoragePasswordProvider: () => storagePassword };
      owner.walletConfiguration = { networkId: 'preprod', txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema), indexerClientConnection: { indexerHttpUrl: owner.endpoints.indexerUri, indexerWsUrl: owner.endpoints.indexerWsUri }, relayURL: new URL(owner.endpoints.nodeUri.replace(/^http/, 'ws')), provingServerUrl: new URL(owner.endpoints.proofServerUri), batchUpdates: { size: 5000, timeout: 50, spacing: 0 }, costParameters: { feeBlocksMargin: 5, additionalFeeOverhead: 1n } };
      return owner;
    } catch (error) { await owner.store.close(); throw error; }
  }
  assertOpen() {
    if (this.closed || this.closing || this.uncertain) throw Error('The supplier wallet must be stopped and reopened before further work.');
  }
  async start() {
    this.assertOpen();
    if (this.started) throw Error('This supplier wallet has already started.');
    this.started = true;
    setNetworkId('preprod');
    this.facade = await WalletFacade.init({ configuration: this.walletConfiguration, submissionService: () => ({ submitTransaction: async () => { throw Error('Supplier transactions require the durable journal.'); }, close: async () => {} }),
      shielded: config => ShieldedWallet(config).startWithSecretKeys(this.shieldedKeys),
      unshielded: config => this.record.unshielded ? UnshieldedWallet(config).restore(this.record.unshielded) : UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(this.keystore)),
      dust: config => this.record.dust ? DustWallet(config).restore(this.record.dust) : DustWallet(config).startWithSecretKey(this.dustKey, L.LedgerParameters.initialParameters().dust),
    });
    await this.facade.start(this.shieldedKeys, this.dustKey);
    await this.facade.shielded.stop();
    await withinDeadline(this.facade.dust.waitForSyncedState(5n), 180_000, 'Supplier wallet synchronization is incomplete. Its storage remains retained.');
    this.api = await ApiPromise.create({ provider: new HttpProvider(this.endpoints.nodeUri), noInitWarn: true });
    this.publicProvider = indexerPublicDataProvider(this.endpoints.indexerUri, this.endpoints.indexerWsUri);
    this.reader = createFinalizedReceiptReader({ endpoints: this.endpoints });
    this.providers = { publicDataProvider: this.publicProvider, walletProvider: {
      getCoinPublicKey: () => this.shieldedKeys.coinPublicKey, getEncryptionPublicKey: () => this.shieldedKeys.encryptionPublicKey,
      balanceTx: async (tx, ttl) => {
        this.assertOpen();
        await this.facade.dust.waitForSyncedState(0n);
        const recipe = await this.facade.balanceUnboundTransaction(tx, { shieldedSecretKeys: this.shieldedKeys, dustSecretKey: this.dustKey }, { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000), tokenKindsToBalance: ['dust'] });
        return assertFundedFeeTransaction(await this.facade.finalizeRecipe(recipe));
      },
    }, midnightProvider: { submitTx: async () => { throw Error('Supplier transactions require the durable journal.'); } } };
    await this.persistWallet();
  }
  async persistWallet() {
    if (!this.facade) return;
    const next = { ...this.record, dust: await this.facade.dust.serializeState(), unshielded: await this.facade.unshielded.serializeState() };
    try { await this.store.save(CACHE_ID, next); this.record = next; }
    catch (error) { this.uncertain = true; throw error; }
  }
  close() {
    if (this.closeTask) return this.closeTask;
    this.closeTask = (async () => {
      this.closing = true;
      let failure;
      if (this.facade) {
        try { await this.persistWallet(); } catch (error) { failure = error; }
        // Never release ownership if a potentially active facade cannot stop.
        await this.facade.stop();
      }
      await this.api?.disconnect();
      await this.store?.close();
      this.closed = true;
      if (failure) throw failure;
    })().catch(error => { if (!this.closed) this.closeTask = undefined; throw error; });
    return this.closeTask;
  }
}

/** Independent production supplier runtime; no historical issuer facility loads. */
export async function createStandaloneOrganizationMerchants(env = process.env) {
  validateContractArtifacts({ artifactDir: resolveContractRelease({ profile: 'organization' }), profile: 'organization' });
  const owner = await OrganizationWallet.open(env);
  try {
    await owner.start();
    const service = await OrganizationMerchants.create(owner, owner.recipients);
    service.ownsParent = true;
    await service.recoverPending();
    return service;
  } catch (error) {
    try { await owner.close(); }
    catch { throw new Error('Supplier startup failed and cleanup is incomplete. Stop the owning process before reopening its retained storage.', { cause: error }); }
    throw error;
  }
}
