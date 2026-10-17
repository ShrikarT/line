import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import * as C from '@midnight-ntwrk/compact-runtime';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { firstValueFrom, filter, timeout } from 'rxjs';
import { PreprodLive } from './preprod-live.mjs';
import { resolveContractRelease, validateContractArtifacts } from '../scripts/contract-artifacts.mjs';
import { issuerPublicKey, merchantPublicKey, toHex } from '../src/lib/line/encoding.ts';

const bytes = () => new Uint8Array(randomBytes(32));

/** Separate contract/controller; shares one fee wallet and the HTTP operation lock.
 * Recipient seeds stay in the encrypted controller. This is operator-run test
 * custody, not separately administered merchant custody or private settlement.
 */
export class TestSettlementLive extends PreprodLive {
  static async fromCanonical(parent) {
    const live = new TestSettlementLive();
    await live.initializeSettlement(parent);
    return live;
  }
  async initializeSettlement(parent) {
    this.parent = parent;
    this.directory = '.midnight-cache/test-settlement';
    mkdirSync(this.directory, { recursive: true });
    this.release = validateContractArtifacts({ artifactDir: resolveContractRelease({ profile: 'test-settlement' }), profile: 'test-settlement' });
    const generated = await import(pathToFileURL(join(this.release.artifactDir, 'contract/index.js')).href);
    this.contractType = generated.Contract;
    this.decodeLedger = generated.ledger;
    for (const name of ['keys','endpoints','facade','shieldedKeys','dustKey','keystore','api','publicProvider','reader']) this[name] = parent[name];
    const privateOptions = { ...parent.privateStorageOptions, midnightDbName: `${this.directory}/private-db` };
    this.control = levelPrivateStateProvider({ ...privateOptions, privateStateStoreName: 'controller', signingKeyStoreName: 'controller-signing' });
    this.control.setContractAddress('00'.repeat(32));
    this.privateProvider = levelPrivateStateProvider({ ...privateOptions, privateStateStoreName: 'sdk-states', signingKeyStoreName: 'sdk-signing' });
    this.state = await this.control.get('application');
    if (!this.state) {
      this.state = { version: 1, profile: 'test-settlement', sourceSha256: this.release.inputs.source.sha256, instanceNonce: bytes(), maintenanceKey: C.sampleSigningKey(), contractAddress: null, limit: 60n, outstanding: 0n, epoch: 0n, salt: bytes(), receipts: [], orders: [], phase: 'not-deployed', pending: null, merchantSeeds: { A: bytes(), B: bytes() }, tokenObservation: null };
      await this.save();
    }
    if (this.state.profile !== 'test-settlement' || this.state.sourceSha256 !== this.release.inputs.source.sha256) throw Error('Test-token state belongs to another profile or source.');
    this.recipients = Object.fromEntries(['A','B'].map(name => [name, PublicKey.fromKeyStore(createKeystore(this.state.merchantSeeds[name], 'preprod'))]));
    const recipient = publicKey => ({ bytes: C.encodeUserAddress(publicKey.addressHex) });
    this.constructorArgs = [issuerPublicKey(this.keys.issuer), merchantPublicKey(this.keys.merchantA), this.state.instanceNonce, recipient(PublicKey.fromKeyStore(this.keystore)), recipient(this.recipients.A)];
    this.merchantRegistrationArgs = [merchantPublicKey(this.keys.merchantB), recipient(this.recipients.B)];
    const witnesses = Object.fromEntries(this.release.compilerInfo.witnesses.map(witness => [witness.name, context => [context.privateState, this.input?.[witness.name] ?? (witness['result type']['type-name'] === 'Bytes' ? new Uint8Array(32) : 0n)]]));
    this.compiled = CompiledContract.make('line-test-settlement', generated.Contract).pipe(CompiledContract.withWitnesses(witnesses), CompiledContract.withCompiledFileAssets(this.release.artifactDir));
    const zk = new NodeZkConfigProvider(this.release.artifactDir);
    const proof = httpClientProofProvider(this.endpoints.proofServerUri, zk);
    this.providers = {
      ...parent.providers,
      privateStateProvider: this.privateProvider,
      zkConfigProvider: zk,
      proofProvider: { proveTx: async tx => { this.progress = 'Generating test-token Compact proof'; return proof.proveTx(tx); } },
      walletProvider: {
        ...parent.providers.walletProvider,
        balanceTx: async (tx, ttl) => {
          this.progress = 'Balancing test-token transaction fees';
          return parent.providers.walletProvider.balanceTx(tx, ttl);
        },
      },
      midnightProvider: { submitTx: tx => this.journalAndSubmit(tx) },
    };
    // A status read must not recover/submit this second profile outside the
    // shared HTTP job guard. Setup, purchase and explicit reconcile do so.
  }
  async setup() {
    await super.setup();
    await this.observeRecipients();
    return this.summary();
  }
  async purchase(id, document) {
    await super.purchase(id, document);
    await this.observeRecipients();
    return this.summary();
  }
  async observeRecipients() {
    if (!this.state.contractAddress) return;
    const contractState = await this.publicProvider.queryContractState(this.state.contractAddress);
    const color = toHex(this.decodeLedger(contractState.data).settlementTokenColor);
    this.progress = 'Checking the merchant wallets for received test tokens';
    const balances = {};
    for (const name of ['A','B']) {
      const wallet = UnshieldedWallet(this.parent.walletConfiguration).startWithPublicKey(this.recipients[name]);
      const service = name === 'A' ? 'text-analysis' : 'cost-report';
      const expected = this.state.orders.filter(order => order.service === service && ['redeemed','delivered'].includes(order.status)).reduce((sum, order) => sum + order.amount, 0n);
      try {
        await wallet.start();
        const current = await firstValueFrom(wallet.state.pipe(filter(state => state.progress.isStrictlyComplete() && (state.balances[color] ?? 0n) >= expected), timeout({ first: 120000 })));
        balances[name] = { address: this.recipients[name].address, addressHex: this.recipients[name].addressHex, units: String(current.balances[color] ?? 0n), expectedUnits: String(expected) };
      } finally { await wallet.stop(); }
    }
    this.state.tokenObservation = { color, balances, verifiedAt: new Date().toISOString(), transparent: true, monetaryValue: false };
    await this.save();
    this.progress = 'Test-token merchant balances verified';
  }
  summary() {
    return { ...super.summary(), profile: 'test-settlement', settlement: 'Actual unshielded test-token payouts; no monetary value; repayment remains issuer-reported', tokenObservation: this.state.tokenObservation, custody: 'One local operator controls issuer, agent and both merchant wallets' };
  }
  async close() { /* Parent owns the shared fee wallet and network connection. */ }
}
