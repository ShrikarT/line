import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { ContractCall, ContractDeploy, MaintenanceUpdate } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { sampleSigningKey, ContractState } from "@midnight-ntwrk/compact-runtime";
import type { ContractProviders } from "@midnight-ntwrk/midnight-js-contracts";
import { FailEntirely, SucceedEntirely, type FinalizedTxData } from "@midnight-ntwrk/midnight-js-types";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { Contract, Status, ledger, type Witnesses } from "../../../contracts/managed/organization/contract/index.js";
import generatedJavascript from "../../../contracts/managed/organization/contract/index.js?raw";
import { createWalletProviders, getWalletConfiguration } from "../runtime/wallet";
import { VaultPrivateStateProvider } from "../runtime/vault-provider";
import type { LinePrivateWitnessContext } from "../runtime/network";
import { agentId, canonicalInvoiceIdBytes, drawNoteCommit, issuerPublicKey, merchantPublicKey, quoteCommit, randomBytes32, toHex } from "../line/encoding";
import { decodeMerchant, decodeQuote, encodeNote } from "./transfers";
import { OrganizationAccount, bytes32, copyAccount, receivingAddressBytes, type MerchantBinding, type OrganizationFacility, type OrganizationNote, type OrganizationQuote, type OrganizationReceipt, type OrganizationSnapshot } from "./account";
import { OrganizationTransactions } from "./transactions";
import { withinDeadline } from "./finality";
import { activeServiceOrder, requireReplaceableOrder, retireServiceAttempt, serviceOrderNote, supplierRequestId } from "./orders";
import { matchesRestoredFacility, matchesRestoredNotes } from "./recovery";
import { organizationProofProvider } from "./proving";
import { OrganizationSupplierClient } from "./supplier-client";
import { organizationReadEndpoints } from "./read-endpoints";
import { authenticatedOrganizationReads } from "./authenticated-reads";

type Circuit = keyof Contract<LinePrivateWitnessContext>["provableCircuits"];
type Providers = ContractProviders<Contract<LinePrivateWitnessContext>>;
export type OrganizationCatalog = { network: "preprod"; assetColor: string; decimals: number; sourceFingerprint: string; services: { id: string; name: string; price: string; description: string; profile: MerchantBinding }[] };
type SupplierOrder = { id: string; contractAddress: string; service: string; status: string; quotePackage: string | null; result: Record<string, unknown> | null; receipts: { circuit: string; contractAddress: string; txHash: string; blockHeight: number }[] };
const CIRCUITS: Circuit[] = ["registerMerchant", "disableMerchant", "fundReserve", "withdrawUnencumberedReserve", "withdrawFees", "openLine", "postQuote", "draw", "redeemDraw", "cancelOrExpireNote", "acknowledgeRepayment", "setStatus"];
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const fingerprint = async (bytes: Uint8Array) => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
const asAddress = (value: string) => ({ bytes: receivingAddressBytes(value) });

/** Actual wallet -> Compact -> proof -> wallet signature -> finalized receipt. */
export class OrganizationNetwork {
  private constructor(readonly account: OrganizationAccount, private providers: Providers, private release: { sourceFingerprint: string; files: Record<string, { sha256: string }> }, private report: (message: string) => void, private supplier: OrganizationSupplierClient) {}
  private input: LinePrivateWitnessContext | null = null;
  private verifierKeys = new Map<Circuit, Uint8Array>();
  private transactions: OrganizationTransactions | null = null;
  private tx() { if (!this.transactions) throw new Error("Organization network is not initialized."); return this.transactions; }
  private byteWitness(name: keyof LinePrivateWitnessContext): Witnesses<LinePrivateWitnessContext>["callerSecret"] {
    return context => { const value = this.input?.[name]; if (!(value instanceof Uint8Array) || value.length !== 32) throw new Error(`Missing private byte witness: ${name}.`); return [context.privateState, value]; };
  }
  private unitWitness(name: keyof LinePrivateWitnessContext): Witnesses<LinePrivateWitnessContext>["lineLimit"] {
    return context => { const value = this.input?.[name]; if (typeof value !== "bigint" || value < 0n || value > 18_446_744_073_709_551_615n) throw new Error(`Invalid private amount witness: ${name}.`); return [context.privateState, value]; };
  }
  private witnesses: Witnesses<LinePrivateWitnessContext> = {
    callerSecret: this.byteWitness("callerSecret"), agentSecret: this.byteWitness("agentSecret"), salt: this.byteWitness("salt"), newSalt: this.byteWitness("newSalt"), invoiceId: this.byteWitness("invoiceId"), quoteNonce: this.byteWitness("quoteNonce"), receiptNonce: this.byteWitness("receiptNonce"), paymentRef: this.byteWitness("paymentRef"), noteNonce: this.byteWitness("noteNonce"), noteSalt: this.byteWitness("noteSalt"), noteIdentity: this.byteWitness("noteIdentity"), noteQuoteCommit: this.byteWitness("noteQuoteCommit"), quoteMerchantPk: this.byteWitness("quoteMerchantPk"),
    lineLimit: this.unitWitness("lineLimit"), lineOutstanding: this.unitWitness("lineOutstanding"), lineEpoch: this.unitWitness("lineEpoch"), quoteAmount: this.unitWitness("quoteAmount"), drawAmount: this.unitWitness("drawAmount"), redeemAmount: this.unitWitness("redeemAmount"), repayAmount: this.unitWitness("repayAmount"),
  };
  private compiled() { return CompiledContract.make("line-organization", Contract).pipe(CompiledContract.withWitnesses(this.witnesses), CompiledContract.withCompiledFileAssets("/organization-zk")); }

  static async connect(account: OrganizationAccount, report: (message: string) => void = () => {}): Promise<OrganizationNetwork> {
    await account.assertWallet();
    const configuration = await withinDeadline(getWalletConfiguration(account.wallet, "preprod"), 25_000, "The wallet configuration is unavailable. Reopen Lace and try again.");
    const supplier = new OrganizationSupplierClient(account, location.origin, report);
    const endpoints = await organizationReadEndpoints(configuration, supplier, location.origin);
    await account.assertWallet(); setNetworkId("preprod");
    const response = await fetch("/organization-zk/release.json", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("The verified organization contract release is unavailable. Do not deposit into another contract version.");
    const release = await response.json();
    if (release.profile !== "organization" || !/^[0-9a-f]{64}$/.test(release.inputs?.source?.sha256 ?? "") || release.files?.["contract/index.js"]?.sha256 !== await fingerprint(new TextEncoder().encode(generatedJavascript))) throw new Error("Organization contract bindings do not match the published proving release.");
    const zkConfigProvider = new FetchZkConfigProvider<Circuit>(new URL("/organization-zk", location.origin).href, (url, init) => globalThis.fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) }));
    const privateStateProvider = new VaultPrivateStateProvider<LinePrivateWitnessContext>({ networkId: "preprod", accountId: account.accountId });
    const wallet = await withinDeadline(createWalletProviders(account.wallet, "preprod"), 25_000, "The wallet is not responding. Reopen Lace and try again.");
    await account.assertWallet();
    const publicData = authenticatedOrganizationReads(indexerPublicDataProvider(endpoints.indexerUri, endpoints.indexerWsUri, globalThis.WebSocket), endpoints.authorize);
    const client = new OrganizationNetwork(account, {
      ...wallet, zkConfigProvider, privateStateProvider,
      publicDataProvider: { ...publicData,
        queryContractState: (...args) => withinDeadline(publicData.queryContractState(...args), 25_000, "The contract state service is unavailable. No replacement payment was submitted."),
        queryZSwapAndContractState: (...args) => withinDeadline(publicData.queryZSwapAndContractState(...args), 25_000, "The contract state service is unavailable. Try again after it recovers."),
        queryUnshieldedBalances: (...args) => withinDeadline(publicData.queryUnshieldedBalances(...args), 25_000, "The asset balance service is unavailable."),
      },
      proofProvider: organizationProofProvider(account.wallet, zkConfigProvider.asKeyMaterialProvider(), () => account.assertSession(), report),
    }, { sourceFingerprint: release.inputs.source.sha256, files: release.files }, report, supplier);
    const baseWallet = client.providers.walletProvider;
    client.providers = { ...client.providers,
      walletProvider: { ...baseWallet, balanceTx: async (tx, ttl) => { await account.assertWallet(); report("Approve the transaction in your wallet"); const balanced = await withinDeadline(baseWallet.balanceTx(tx, ttl), 180_000, "Wallet approval timed out. No transaction was submitted by Line. Close the old wallet prompt before trying again."); await account.assertWallet(); return balanced; } },
      midnightProvider: { submitTx: async tx => {
        await account.assertWallet();
        const pending = account.pending();
        if (!pending || pending.sourceFingerprint !== client.release.sourceFingerprint) throw new Error("No durable organization operation is prepared.");
        const actions = [...(tx.intents?.values() ?? [])].flatMap(intent => intent.actions);
        if (actions.length !== 1) throw new Error("Expected exactly one organization contract action.");
        const action = actions[0];
        if (pending.kind === "deploy" ? !(action instanceof ContractDeploy) : pending.kind === "key" ? !(action instanceof MaintenanceUpdate) : !(action instanceof ContractCall) || (typeof action.entryPoint === "string" ? action.entryPoint : new TextDecoder().decode(action.entryPoint)) !== pending.circuit) throw new Error("Wallet transaction differs from the prepared organization action.");
        const id = tx.identifiers().at(-1);
        const feeActions = [...(tx.intents?.values() ?? [])].map(intent => intent.dustActions).filter(action => !!action);
        if (!feeActions.some(action => action.spends.length > 0) || feeActions.some(action => action.spends.length === 0 && action.registrations.length === 0)) throw new Error("The wallet returned an empty DUST fee section. Synchronize or update the wallet before retrying.");
        if (!id) throw new Error("Transaction has no identifier.");
        await account.submitted(id, toHex(tx.serialize()), action.address);
        report("Submitted to Midnight. Waiting for the finalized receipt");
        return withinDeadline(wallet.midnightProvider.submitTx(tx), 30_000, "The submission acknowledgement timed out. The original signed transaction is saved; check its status before doing anything else.");
      } },
    };
    client.transactions = new OrganizationTransactions(client.providers, () => client.compiled());
    return client;
  }
  private facility(id: string): OrganizationFacility {
    const facility = this.account.snapshot().facilities.find(f => f.id === id);
    if (!facility?.address) throw new Error("Choose a deployed organization facility.");
    return facility;
  }
  async inspect(address: string, requireAllKeys = true) {
    bytes32(address); await this.account.assertWallet();
    const state = await this.providers.publicDataProvider.queryContractState(address);
    if (!state) throw new Error("Organization facility was not found on Midnight Preprod.");
    if (state.operations().some(name => !CIRCUITS.includes(name as Circuit))) throw new Error("Facility has operations outside the organization contract release.");
    for (const name of CIRCUITS) {
      const operation = state.operation(name);
      if (!operation) { if (requireAllKeys) throw new Error("Facility setup is incomplete. Resume registering its verifier keys."); else continue; }
      let expected = this.verifierKeys.get(name);
      if (!expected) { expected = await this.providers.zkConfigProvider.getVerifierKey(name); this.verifierKeys.set(name, expected); }
      if (!same(operation.verifierKey, expected)) throw new Error("Facility verifier keys differ from the organization contract release.");
    }
    const book = ledger(state.data);
    if (!same(book.issuer, issuerPublicKey(bytes32(this.account.snapshot().issuerSecret))) && this.account.snapshot().facilities.some(f => f.address === address)) throw new Error("This wallet does not own the selected organization facility.");
    return { state, book };
  }
  async restoreBackup(file: string, password: string) {
    this.report("Authenticating the backup and checking its facilities on Midnight");
    await this.account.restoreBackup(file, password, async record => {
      if (record.pending && record.pending.sourceFingerprint !== this.release.sourceFingerprint) throw new Error("Restore the pending operation with its original contract release.");
      const snapshots = [record.snapshot, ...(record.pending ? [record.pending.after] : [])];
      const facilities = snapshots.flatMap(snapshot => snapshot.facilities);
      const addresses = [...new Set([...facilities.flatMap(f => f.address ? [f.address] : []), ...snapshots.flatMap(snapshot => snapshot.notes.map(note => note.contractAddress))])];
      for (const address of addresses) {
        const state = await this.providers.publicDataProvider.queryContractState(address);
        if (!state && record.pending?.kind === "deploy" && record.pending.contractAddress === address) continue;
        const { book } = await this.inspect(address, false);
        const expectedIssuer = issuerPublicKey(bytes32(record.snapshot.issuerSecret));
        const owned = facilities.some(f => f.address === address);
        if (owned && !same(book.issuer, expectedIssuer)) throw new Error("A restored facility has another issuer key.");
        const matches = snapshots.some(snapshot => {
          const facility = snapshot.facilities.find(f => f.address === address);
          return (!owned || !!facility && matchesRestoredFacility(book, facility, snapshot.issuerSecret)) && matchesRestoredNotes(book, snapshot.notes.filter(note => note.contractAddress === address));
        });
        if (!matches) throw new Error("This backup's private book or refund openings are stale or belong to another facility. Recover a newer backup; no records were replaced.");
      }
    });
    this.report("Organization restored. Any saved transaction must be reconciled before spending");
  }
  async facilitySummary(id: string) {
    const facility = this.facility(id), { state, book } = await this.inspect(facility.address!, false);
    const balances = await this.providers.publicDataProvider.queryUnshieldedBalances(facility.address!);
    return { status: Status[book.status], registeredCircuits: state.operations().length, assetColor: toHex(book.settlementTokenColor), reserve: book.totalReserve.toString(), encumbered: book.encumberedReserve.toString(), paid: book.redeemedReserve.toString(), domain: toHex(book.contractDomain), balances: balances?.map(balance => ({ color: balance.tokenType, units: balance.balance.toString() })) ?? [] };
  }
  private async finish(receipt: FinalizedTxData) {
    const pending = this.account.pending();
    if (!pending?.txId || !pending.contractAddress || !receipt.identifiers.includes(pending.txId) || !Number.isSafeInteger(receipt.blockHeight) || receipt.blockHeight <= 0 || !receipt.txHash) throw new Error("The exact organization transaction has not been observed in a finalized block. Reconcile it before proceeding.");
    const saved = { kind: pending.kind, circuit: pending.circuit, contractAddress: pending.contractAddress, txId: pending.txId, txHash: receipt.txHash, blockHeight: receipt.blockHeight, recordedAt: new Date().toISOString() };
    if (receipt.status === FailEntirely) {
      await this.account.rejectFinalized(saved);
      throw new Error("The original transaction failed in a finalized block. Its contract changes were not applied; network fees may have been charged. You can retry the operation.");
    }
    if (receipt.status !== SucceedEntirely) throw new Error("The original transaction has a partial failure. Its saved operation is retained for investigation; no replacement payment will be made.");
    await this.account.complete(saved);
    this.tx().finality.forget(pending.txId);
    this.report("Confirmed on Midnight Preprod");
  }
  private async operation(kind: OrganizationReceipt["kind"], circuit: string, facilityId: string | null, address: string | null, after: OrganizationSnapshot, action: () => Promise<FinalizedTxData>) {
    await this.account.prepare({ id: crypto.randomUUID(), kind, circuit, facilityId, contractAddress: address, sourceFingerprint: this.release.sourceFingerprint, after, txId: null, transaction: null });
    try { await this.finish(await action()); }
    catch (failure) { if (!this.account.pending()?.txId) await this.account.discardUnsubmitted(); throw failure; }
  }
  async createFacility(name: string, assetColor: string, initialMerchant: MerchantBinding) {
    this.report("Checking your connected wallet before facility deployment");
    return this.account.exclusive(async () => {
      if (!name.trim() || name.length > 80) throw new Error("Enter an organization or agent name of up to 80 characters.");
      bytes32(assetColor); bytes32(initialMerchant.publicKey); receivingAddressBytes(initialMerchant.address);
      const after = this.account.snapshot();
      if (after.facilities.length >= 50) throw new Error("This organization has reached its browser facility limit.");
      const facility: OrganizationFacility = { id: crypto.randomUUID(), name: name.trim(), address: null, instanceNonce: toHex(randomBytes32()), maintenanceKey: sampleSigningKey(), assetColor, issuerRecipient: this.account.receivingAddress, merchants: [copyAccount(initialMerchant)], agentSecret: toHex(randomBytes32()), salt: toHex(randomBytes32()), limit: 0n, outstanding: 0n, epoch: 0n, generation: 0n };
      after.facilities.push(facility);
      const ContractType = Contract;
      class InitialContract extends ContractType<LinePrivateWitnessContext> {
        constructor(w: Witnesses<LinePrivateWitnessContext>) { super(w); this.circuits = { registerMerchant: this.circuits.registerMerchant } as typeof this.circuits; this.provableCircuits = { registerMerchant: this.provableCircuits.registerMerchant } as typeof this.provableCircuits; }
        initialState(...args: Parameters<Contract<LinePrivateWitnessContext>["initialState"]>) { const result = super.initialState(...args), state = new ContractState(); state.data = result.currentContractState.data; const operation = result.currentContractState.operation("registerMerchant"); if (!operation) throw new Error("Initial organization verifier is missing."); state.setOperation("registerMerchant", operation); return { ...result, currentContractState: state }; }
      }
      const compiled = CompiledContract.make("line-organization", InitialContract).pipe(CompiledContract.withWitnesses(this.witnesses), CompiledContract.withCompiledFileAssets("/organization-zk"));
      this.providers.privateStateProvider.setContractAddress(`creating:${facility.id}`);
      this.report("Preparing your facility deployment transaction");
      await this.operation("deploy", "deploy", facility.id, null, after, () => this.tx().deploy(compiled, facility.maintenanceKey, [issuerPublicKey(bytes32(after.issuerSecret)), bytes32(initialMerchant.publicKey), bytes32(facility.instanceNonce), asAddress(facility.issuerRecipient), asAddress(initialMerchant.address), bytes32(assetColor)]));
    });
  }
  async registerVerifierKeys(id: string) {
    return this.account.exclusive(async () => {
      const facility = this.facility(id), address = facility.address!;
      await this.inspect(address, false);
      this.providers.privateStateProvider.setContractAddress(address);
      await this.providers.privateStateProvider.setSigningKey(address, facility.maintenanceKey);
      for (const name of CIRCUITS) {
        const state = await this.providers.publicDataProvider.queryContractState(address);
        if (state?.operation(name)) continue;
        this.report(`Registering ${name}. Approve its network transaction`);
        await this.operation("key", name, id, address, this.account.snapshot(), () => this.tx().insert(address, name, facility.maintenanceKey));
      }
      await this.inspect(address);
    });
  }
  async reserve(id: string, action: "fundReserve" | "withdrawUnencumberedReserve" | "withdrawFees", amount: bigint = 0n) {
    return this.account.exclusive(async () => {
      const facility = this.facility(id); await this.inspect(facility.address!);
      const snapshot = this.account.snapshot();
      this.input = { callerSecret: bytes32(snapshot.issuerSecret) };
      try { await this.operation("call", action, id, facility.address, snapshot, () => this.tx().call(facility.address!, action, action === "withdrawFees" ? [] : [amount])); }
      finally { this.input = null; }
    });
  }
  async openAllowance(id: string, limit: bigint, expiry: bigint) {
    return this.account.exclusive(async () => {
      const facility = this.facility(id); const { book } = await this.inspect(facility.address!);
      if (limit <= 0n || expiry <= BigInt(Math.floor(Date.now() / 1000))) throw new Error("Use a positive allowance and a future expiry.");
      const after = this.account.snapshot(), next = after.facilities.find(f => f.id === id)!;
      next.limit = limit; next.outstanding = 0n; next.epoch = 0n; next.generation = book.lineGeneration + 1n; next.salt = toHex(randomBytes32());
      this.input = { callerSecret: bytes32(after.issuerSecret), agentSecret: bytes32(next.agentSecret), salt: bytes32(next.salt), lineLimit: limit };
      try { await this.operation("call", "openLine", id, facility.address, after, () => this.tx().call(facility.address!, "openLine", [expiry, 0n, 0n])); }
      finally { this.input = null; }
    });
  }
  async replenish(id: string, amount: bigint) {
    return this.account.exclusive(async () => {
      const facility = this.facility(id); await this.inspect(facility.address!);
      if (amount <= 0n || amount > facility.outstanding) throw new Error("Replenishment must fit the agent’s current spending balance.");
      const after = this.account.snapshot(), next = after.facilities.find(f => f.id === id)!;
      next.outstanding -= amount; next.epoch++; next.salt = toHex(randomBytes32());
      this.input = { callerSecret: bytes32(after.issuerSecret), salt: bytes32(facility.salt), newSalt: bytes32(next.salt), lineLimit: facility.limit, lineOutstanding: facility.outstanding, lineEpoch: facility.epoch, repayAmount: amount, paymentRef: randomBytes32(), receiptNonce: randomBytes32() };
      try { await this.operation("call", "acknowledgeRepayment", id, facility.address, after, () => this.tx().call(facility.address!, "acknowledgeRepayment", [BigInt(Math.floor(Date.now() / 1000) + 3600)])); }
      finally { this.input = null; }
    });
  }
  merchantProfile(name: string): MerchantBinding {
    return { name: name.trim().slice(0, 80) || "Merchant", publicKey: toHex(merchantPublicKey(bytes32(this.account.snapshot().merchantSecret))), address: this.account.receivingAddress };
  }
  async registerMerchant(id: string, merchant: MerchantBinding) {
    return this.account.exclusive(async () => {
      const facility = this.facility(id); await this.inspect(facility.address!);
      bytes32(merchant.publicKey); receivingAddressBytes(merchant.address);
      const after = this.account.snapshot(); after.facilities.find(f => f.id === id)!.merchants.push(copyAccount(merchant));
      this.input = { callerSecret: bytes32(after.issuerSecret) };
      try { await this.operation("call", "registerMerchant", id, facility.address, after, () => this.tx().call(facility.address!, "registerMerchant", [bytes32(merchant.publicKey), asAddress(merchant.address)])); }
      finally { this.input = null; }
    });
  }
  async disableMerchant(id: string, publicKey: string) {
    return this.account.exclusive(async () => {
      const facility = this.facility(id); await this.inspect(facility.address!);
      const after = this.account.snapshot();
      const merchant = after.facilities.find(item => item.id === id)!.merchants.find(item => item.publicKey === publicKey);
      if (!merchant || merchant.disabled) throw new Error("Choose an active registered merchant.");
      merchant.disabled = true;
      this.input = { callerSecret: bytes32(after.issuerSecret) };
      try { await this.operation("call", "disableMerchant", id, facility.address, after, () => this.tx().call(facility.address!, "disableMerchant", [bytes32(publicKey)])); }
      finally { this.input = null; }
    });
  }
  async postQuote(address: string, invoice: string, amount: bigint, expiry: bigint): Promise<OrganizationQuote> {
    return this.account.exclusive(async () => {
      const { book } = await this.inspect(address), after = this.account.snapshot();
      const merchantPk = merchantPublicKey(bytes32(after.merchantSecret)), invoiceId = canonicalInvoiceIdBytes(invoice), nonce = randomBytes32();
      if (!same(book.merchantPayoutRecipients.lookup(merchantPk).bytes, receivingAddressBytes(this.account.receivingAddress))) throw new Error("The facility’s merchant recipient is not this wallet. Do not quote for it.");
      if (amount <= 0n || !invoice.trim() || invoice.length > 500 || expiry <= BigInt(Math.floor(Date.now() / 1000))) throw new Error("Supply an invoice, positive amount and future quote expiry.");
      const Q = quoteCommit({ merchantPk, invoiceId, nonce, amount, expiry, generation: book.lineGeneration, domain: book.contractDomain, feeFlat: book.feeFlat, feeBps: book.feeBps });
      const quote: OrganizationQuote = { contractAddress: address, domain: toHex(book.contractDomain), merchantPk: toHex(merchantPk), invoiceId: toHex(invoiceId), quoteNonce: toHex(nonce), amount, expiry, generation: book.lineGeneration, feeFlat: book.feeFlat, feeBps: book.feeBps, quoteCommitment: toHex(Q) };
      after.quotes.push(quote);
      this.input = { callerSecret: bytes32(after.merchantSecret), invoiceId, quoteNonce: nonce, quoteAmount: amount };
      try { await this.operation("call", "postQuote", null, address, after, () => this.tx().call(address, "postQuote", [expiry])); return quote; }
      finally { this.input = null; }
    });
  }
  async purchase(id: string, quote: OrganizationQuote, binding?: { orderId: string; requestId: string }): Promise<OrganizationNote> {
    return this.account.exclusive(async () => {
      try {
        const facility = this.facility(id), { book } = await this.inspect(facility.address!);
        if (quote.contractAddress !== facility.address || quote.domain !== toHex(book.contractDomain) || quote.generation !== book.lineGeneration || quote.feeFlat !== book.feeFlat || quote.feeBps !== book.feeBps || quote.amount <= 0n) throw new Error("Quote terms differ.");
        const quoteBytes = quoteCommit({ merchantPk: bytes32(quote.merchantPk), invoiceId: bytes32(quote.invoiceId), nonce: bytes32(quote.quoteNonce), amount: quote.amount, expiry: quote.expiry, generation: quote.generation, domain: bytes32(quote.domain), feeFlat: quote.feeFlat, feeBps: quote.feeBps });
        if (toHex(quoteBytes) !== quote.quoteCommitment) throw new Error("Quote opening differs.");
        const fee = quote.feeFlat + (quote.amount * quote.feeBps + 9999n) / 10000n;
        const after = this.account.snapshot(), next = after.facilities.find(f => f.id === id)!;
        const service = binding ? activeServiceOrder(after, binding.orderId, binding.requestId) : null;
        if (service && (service.facilityId !== id || service.quoteCommitment !== quote.quoteCommitment)) throw new Error("The saved API purchase changed.");
        const retained = after.notes.find(note => note.contractAddress === facility.address && note.quoteCommitment === quote.quoteCommitment);
        if (retained) return retained;
        next.outstanding += quote.amount + fee; next.epoch++; next.salt = toHex(randomBytes32());
        if (next.outstanding > next.limit) throw new Error("Allowance exceeded.");
        const note: OrganizationNote = { contractAddress: facility.address!, domain: quote.domain, identity: toHex(agentId(bytes32(facility.agentSecret))), merchantPk: quote.merchantPk, quoteCommitment: quote.quoteCommitment, amount: quote.amount, fee, expiry: quote.expiry, generation: quote.generation, noteNonce: toHex(randomBytes32()), noteSalt: toHex(randomBytes32()), noteCommitment: "", redeemed: false };
        note.noteCommitment = toHex(drawNoteCommit({ domain: bytes32(note.domain), lineGeneration: note.generation, identity: bytes32(note.identity), quoteCommit: quoteBytes, merchantPk: bytes32(note.merchantPk), amount: note.amount, fee, noteNonce: bytes32(note.noteNonce), expiry: note.expiry }, bytes32(note.noteSalt)));
        after.notes.push(note);
        if (service) service.noteCommitment = note.noteCommitment;
        this.input = { callerSecret: bytes32(facility.agentSecret), agentSecret: bytes32(facility.agentSecret), salt: bytes32(facility.salt), newSalt: bytes32(next.salt), lineLimit: facility.limit, lineOutstanding: facility.outstanding, lineEpoch: facility.epoch, quoteMerchantPk: bytes32(quote.merchantPk), invoiceId: bytes32(quote.invoiceId), quoteNonce: bytes32(quote.quoteNonce), quoteAmount: quote.amount, drawAmount: quote.amount, noteNonce: bytes32(note.noteNonce), noteSalt: bytes32(note.noteSalt) };
        await this.operation("call", "draw", id, facility.address, after, () => this.tx().call(facility.address!, "draw", [quoteBytes, quote.expiry, fee]));
        return note;
      } catch { throw new Error("Clearance could not be proven."); }
      finally { this.input = null; }
    });
  }
  async redeem(note: OrganizationNote) {
    return this.account.exclusive(async () => {
      const { book } = await this.inspect(note.contractAddress), after = this.account.snapshot();
      if (toHex(merchantPublicKey(bytes32(after.merchantSecret))) !== note.merchantPk || toHex(book.contractDomain) !== note.domain) throw new Error("This claim belongs to another merchant or facility.");
      if (!same(book.merchantPayoutRecipients.lookup(bytes32(note.merchantPk)).bytes, receivingAddressBytes(this.account.receivingAddress))) throw new Error("This facility would pay another receiving address. Redemption is blocked.");
      const commitment = drawNoteCommit({ domain: bytes32(note.domain), lineGeneration: note.generation, identity: bytes32(note.identity), quoteCommit: bytes32(note.quoteCommitment), merchantPk: bytes32(note.merchantPk), amount: note.amount, fee: note.fee, noteNonce: bytes32(note.noteNonce), expiry: note.expiry }, bytes32(note.noteSalt));
      if (toHex(commitment) !== note.noteCommitment) throw new Error("Claim opening does not match its commitment.");
      const existing = after.notes.find(n => n.noteCommitment === note.noteCommitment);
      if (existing) existing.redeemed = true; else after.notes.push({ ...copyAccount(note), redeemed: true });
      this.input = { callerSecret: bytes32(after.merchantSecret), noteIdentity: bytes32(note.identity), noteQuoteCommit: bytes32(note.quoteCommitment), noteNonce: bytes32(note.noteNonce), noteSalt: bytes32(note.noteSalt), redeemAmount: note.amount };
      try { await this.operation("call", "redeemDraw", null, note.contractAddress, after, () => this.tx().call(note.contractAddress, "redeemDraw", [commitment, note.expiry])); }
      finally { this.input = null; }
    });
  }
  async status(id: string, status: "pause" | "resume" | "close") {
    return this.account.exclusive(async () => {
      const facility = this.facility(id); await this.inspect(facility.address!);
      const after = this.account.snapshot();
      if (status === "close" && after.serviceOrders?.some(order => order.facilityId === id && !order.delivered && !order.cancelled)) throw new Error("Complete or cancel the saved API purchases before closing this allowance.");
      this.input = { callerSecret: bytes32(after.issuerSecret), salt: bytes32(facility.salt), lineLimit: facility.limit, lineOutstanding: facility.outstanding, lineEpoch: facility.epoch };
      try { await this.operation("call", "setStatus", id, facility.address, after, () => this.tx().call(facility.address!, "setStatus", [status === "pause" ? Status.DEFAULTED : status === "resume" ? Status.OPEN : Status.CLOSED])); }
      finally { this.input = null; }
    });
  }
  async cancelExpired(id: string, commitment: string) {
    return this.account.exclusive(async () => {
      const facility = this.facility(id), { book } = await this.inspect(facility.address!), after = this.account.snapshot();
      const note = after.notes.find(n => n.noteCommitment === commitment && n.contractAddress === facility.address);
      if (!note || note.refund) throw new Error("Select an expired, unallocated claim belonging to this facility.");
      const next = after.facilities.find(f => f.id === id)!, salt = toHex(randomBytes32()), cost = note.amount + note.fee;
      const credit = note.generation === book.lineGeneration ? (facility.outstanding < cost ? facility.outstanding : cost) : 0n;
      note.refund = { salt, amount: cost - credit, paid: cost === credit };
      if (note.generation === book.lineGeneration) { next.outstanding -= credit; next.epoch++; next.salt = salt; }
      this.input = { callerSecret: bytes32(after.issuerSecret), noteIdentity: bytes32(note.identity), noteQuoteCommit: bytes32(note.quoteCommitment), quoteMerchantPk: bytes32(note.merchantPk), noteNonce: bytes32(note.noteNonce), noteSalt: bytes32(note.noteSalt), newSalt: bytes32(salt), salt: bytes32(facility.salt), lineLimit: facility.limit, lineOutstanding: facility.outstanding, lineEpoch: facility.epoch };
      try { await this.operation("call", "cancelOrExpireNote", id, facility.address, after, () => this.tx().call(facility.address!, "cancelOrExpireNote", [bytes32(commitment), 1n, BigInt(Math.floor(Date.now() / 1000) + 3600)])); }
      finally { this.input = null; }
    });
  }
  async refund(id: string, commitment: string) {
    return this.account.exclusive(async () => {
      const facility = this.facility(id); await this.inspect(facility.address!);
      const after = this.account.snapshot(), note = after.notes.find(n => n.noteCommitment === commitment && n.contractAddress === facility.address);
      if (!note?.refund || note.refund.paid || note.refund.amount <= 0n) throw new Error("This claim has no pending asset refund.");
      note.refund.paid = true;
      this.input = { callerSecret: bytes32(after.issuerSecret), noteIdentity: bytes32(note.identity), salt: bytes32(note.refund.salt), repayAmount: note.refund.amount, paymentRef: randomBytes32() };
      try { await this.operation("call", "cancelOrExpireNote", id, facility.address, after, () => this.tx().call(facility.address!, "cancelOrExpireNote", [bytes32(commitment), 2n, BigInt(Math.floor(Date.now() / 1000) + 3600)])); }
      finally { this.input = null; }
    });
  }
  private async supplierRequest(path: string, body?: object): Promise<unknown> {
    return this.supplier.request(path, body);
  }
  async catalog(): Promise<OrganizationCatalog> {
    const value = await this.supplierRequest("catalog") as OrganizationCatalog;
    if (value.network !== "preprod" || value.sourceFingerprint !== this.release.sourceFingerprint || !Array.isArray(value.services) || !value.services.length || value.services.length > 20 || !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 18) throw new Error("The supplier catalog does not match your organization contract release.");
    bytes32(value.assetColor);
    for (const service of value.services) {
      if (!/^[a-z-]{1,80}$/.test(service.id) || typeof service.name !== "string" || service.name.length > 100 || typeof service.description !== "string" || !/^[0-9]{1,20}$/.test(service.price) || BigInt(service.price) <= 0n || BigInt(service.price) > 18_446_744_073_709_551_615n) throw new Error("Invalid supplier price or description.");
      decodeMerchant(JSON.stringify({ schema: "line:organization-merchant/v1", ...service.profile }));
    }
    return value;
  }
  private async waitForSupplier(id: string, delivered = false): Promise<SupplierOrder> {
    const end = Date.now() + 10 * 60_000;
    while (Date.now() < end) {
      const status = await this.supplierRequest(`orders/${id}`) as { order: SupplierOrder | null; error: string | null };
      if (status.error) throw new Error(status.error);
      if (status.order && (delivered ? status.order.status === "delivered" && status.order.result : status.order.quotePackage)) return status.order;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error("The supplier is still confirming its transaction. Resume this saved purchase; do not create a replacement payment.");
  }
  async purchaseService(id: string, serviceId: string, document: string) {
    if (!document.trim() || document.length > 5000) throw new Error("Enter a document of up to 5000 characters.");
    const facility = this.facility(id), catalog = await this.catalog(), service = catalog.services.find(service => service.id === serviceId);
    if (!service || catalog.assetColor !== facility.assetColor) throw new Error("Choose a supplier that accepts this facility’s settlement asset.");
    const observed = await this.inspect(facility.address!);
    if (observed.book.status !== Status.OPEN || observed.book.lineGeneration !== facility.generation) throw new Error("Open this agent’s allowance before requesting a paid API quote.");
    if (!facility.merchants.some(merchant => merchant.publicKey === service.profile.publicKey && merchant.address === service.profile.address && !merchant.disabled)) throw new Error("Authorize this supplier before requesting a quote.");
    if (facility.outstanding + BigInt(service.price) > facility.limit) throw new Error("Clearance could not be proven.");
    let order = this.account.snapshot().serviceOrders?.find(order => order.facilityId === id && order.service === serviceId && !order.delivered && !order.cancelled);
    if (order && order.document !== document) throw new Error("Resume the saved document purchase before starting a different task.");
    if (!order) {
      const proposed = { id: crypto.randomUUID(), facilityId: id, service: serviceId, document, price: service.price, assetColor: catalog.assetColor, merchantPk: service.profile.publicKey, merchantAddress: service.profile.address, delivered: false };
      await this.account.edit(snapshot => {
        snapshot.serviceOrders ??= [];
        const existing = snapshot.serviceOrders.find(item => item.facilityId === id && item.service === serviceId && !item.delivered && !item.cancelled);
        if (existing && existing.document !== document) throw new Error("Resume the saved document purchase before starting a different task.");
        if (!existing) snapshot.serviceOrders.push(proposed);
        order = existing ?? proposed;
      });
    }
    if (!order) throw new Error("The purchase request could not be saved.");
    await this.continueService(order.id);
  }
  async continueService(orderId: string) {
    const order = this.account.snapshot().serviceOrders?.find(order => order.id === orderId);
    if (!order) throw new Error("This API purchase is not in the connected organization’s account.");
    if (order.delivered) return order.result;
    if (order.cancelled) throw new Error("This saved request was cancelled. Start a new purchase for a new task.");
    const requestId = supplierRequestId(order);
    const facility = this.facility(order.facilityId);
    this.report("The supplier is posting your exact service quote on Midnight");
    await this.supplierRequest("orders", { id: requestId, contractAddress: facility.address, service: order.service, document: order.document });
    const supplier = await this.waitForSupplier(requestId), quote = decodeQuote(supplier.quotePackage!);
    if (quote.contractAddress !== facility.address || quote.merchantPk !== order.merchantPk || quote.amount !== BigInt(order.price)) throw new Error("Supplier quote differs from the accepted purchase terms.");
    const { book } = await this.inspect(facility.address!);
    if (!same(book.merchantPayoutRecipients.lookup(bytes32(order.merchantPk)).bytes, receivingAddressBytes(order.merchantAddress))) throw new Error("The registered supplier recipient differs from the accepted purchase.");
    await this.account.edit(snapshot => { const current = activeServiceOrder(snapshot, orderId, requestId); current.quoteCommitment = quote.quoteCommitment; current.quoteExpiry = quote.expiry; });
    let note = this.account.snapshot().notes.find(note => note.contractAddress === facility.address && note.quoteCommitment === quote.quoteCommitment);
    if (!note) {
      if (quote.expiry <= BigInt(Math.floor(Date.now() / 1000)) || quote.generation !== book.lineGeneration) throw new Error("This uncharged quote expired or belongs to an earlier allowance. Request a fresh quote for the saved purchase.");
      note = await this.purchase(order.facilityId, quote, { orderId, requestId });
    }
    const claim = note;
    await this.account.edit(snapshot => { activeServiceOrder(snapshot, orderId, requestId).noteCommitment = claim.noteCommitment; });
    this.report("The supplier is redeeming its claim and receiving the asset payout");
    await this.supplierRequest(`orders/${requestId}/redeem`, { claim: encodeNote(claim) });
    const delivered = await this.waitForSupplier(requestId, true);
    if (delivered.contractAddress !== facility.address || delivered.service !== order.service || !delivered.result) throw new Error("Supplier response is for another purchase.");
    const observed = await this.inspect(facility.address!);
    const redeemed = observed.book.notes.lookup(bytes32(claim.noteCommitment));
    if (!redeemed.redeemed || redeemed.amount !== claim.amount || redeemed.fee !== claim.fee) throw new Error("The merchant payout has not been observed for this exact claim.");
    await this.account.edit(snapshot => {
      const saved = activeServiceOrder(snapshot, orderId, requestId);
      saved.delivered = true; saved.result = delivered.result!;
      const retained = snapshot.notes.find(item => item.noteCommitment === claim.noteCommitment); if (retained) retained.redeemed = true;
    });
    this.report("Service delivered after the merchant’s on-chain payout");
    return delivered.result;
  }
  private async replacementEvidence(orderId: string) {
    const snapshot = this.account.snapshot(), order = snapshot.serviceOrders?.find(item => item.id === orderId);
    if (!order || order.delivered || order.cancelled) throw new Error("Choose an unfinished saved API purchase.");
    const requestId = supplierRequestId(order), facility = this.facility(order.facilityId);
    let quote = order.quoteCommitment;
    if (!quote) {
      const status = await this.supplierRequest(`orders/${requestId}`) as { order: SupplierOrder | null };
      if (status.order?.quotePackage) {
        const observed = decodeQuote(status.order.quotePackage);
        if (observed.contractAddress !== facility.address || observed.merchantPk !== order.merchantPk || observed.amount !== BigInt(order.price)) throw new Error("The original supplier request differs from this saved purchase.");
        quote = observed.quoteCommitment;
      }
    }
    const settled = new Set<string>(), note = serviceOrderNote(snapshot, order, quote);
    if (note) {
      const { book } = await this.inspect(facility.address!);
      const observed = book.notes.lookup(bytes32(note.noteCommitment));
      if (note.refund?.paid && observed.compensationAllocated && (!observed.cashRefundOwed || observed.refundAcknowledged)) settled.add(note.noteCommitment);
    }
    return { order, requestId, quote, settled };
  }
  async cancelService(orderId: string) {
    const evidence = await this.replacementEvidence(orderId);
    await this.account.edit(snapshot => {
      const order = activeServiceOrder(snapshot, orderId, evidence.requestId);
      requireReplaceableOrder(snapshot, order, evidence.quote, evidence.settled);
      retireServiceAttempt(order); order.cancelled = true;
    });
    this.report("Saved request cancelled. Its history is retained; no replacement payment was created");
  }
  async requoteService(orderId: string) {
    const evidence = await this.replacementEvidence(orderId), catalog = await this.catalog();
    const service = catalog.services.find(service => service.id === evidence.order.service);
    if (!service || catalog.assetColor !== evidence.order.assetColor) throw new Error("This supplier no longer accepts the saved settlement asset.");
    await this.account.edit(snapshot => {
      const order = activeServiceOrder(snapshot, orderId, evidence.requestId);
      requireReplaceableOrder(snapshot, order, evidence.quote, evidence.settled); retireServiceAttempt(order);
      order.requestId = crypto.randomUUID(); order.price = service.price; order.merchantPk = service.profile.publicKey; order.merchantAddress = service.profile.address;
      delete order.noteCommitment; delete order.quoteCommitment; delete order.quoteExpiry;
    });
    await this.continueService(orderId);
  }
  async reconcile() {
    return this.account.exclusive(async () => {
      const pending = this.account.pending();
      if (!pending) return;
      if (!pending.txId) { await this.account.discardUnsubmitted(); return; }
      if (pending.sourceFingerprint !== this.release.sourceFingerprint) throw new Error("Recover with the original organization contract release.");
      this.report("Checking the original signed transaction. No replacement will be created");
      await this.finish(await this.tx().finality.wait(pending.txId));
    });
  }
}
