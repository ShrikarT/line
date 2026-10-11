/**
 * Production Line Product Store
 *
 * All state transitions and operations are asynchronous and route strictly through LineRuntime.
 * Private credentials, line commitments, and witness secrets are encrypted at rest using WebCrypto AES-GCM.
 * Zero fixture keys, fabricated nonces, or hardcoded amounts are used.
 */
import { create } from "zustand";
import { createOperationJournal, type OperationJournalLease } from "../lib/security/operation-journal.ts";
import { consoleJournalScope, journaledRuntime, recoveredConsole, snapshotConsole,
  type ConsoleMutationContext, type ConsolePrivateState } from "./console-recovery.ts";
import { reconcileConsole } from "./reconcile-console.ts";
import {
  getRuntime,
  type LedgerPublicStatus,
  type RuntimeMode,
  type RuntimeTransactionResult,
} from "../lib/runtime/index.ts";
import {
  isVaultSessionUnlocked,
  unlockVaultSession,
  lockVaultSession,
  saveEncryptedJson,
  loadEncryptedJson,
  getVaultSessionPassphrase,
  purgeLegacyPlaintextStorage,
  onVaultSessionLock,
  getVaultSessionRevision,
} from "../lib/security/vault.ts";
import type {
  DrawNote,
  MerchantInvoice,
  AgentLineRecord,
  MerchantQuoteRecord,
  DrawNoteRecord,
  RepaymentRecord,
  RefundRecord,
  QuoteTransferPackage,
  DrawNoteTransferPackage,
} from "../lib/line/types.ts";
import {
  validateQuoteTransferPackage,
  validateDrawNoteTransferPackage,
  validateAgentLineRecord,
  validateMerchantQuoteRecord,
  validateDrawNoteRecord,
  validateRefundRecord,
} from "../lib/line/types.ts";
import {
  randomBytes32,
  toHex,
  hexToBytes,
  canonicalInvoiceIdBytes,
  agentId,
  lineStateCommit,
  quoteCommit,
  drawNoteCommit,
  merchantPublicKey,
  requiredDrawFee,
  refundCommit,
  canonicalPaymentReferenceBytes,
} from "../lib/line/encoding.ts";

// Ensure legacy plaintext localStorage keys are eradicated on startup
purgeLegacyPlaintextStorage();

export type TxLifecycle = "idle" | "wallet-approval" | "proving" | "submitted" | "confirmed" | "failed";

export type Flash = {
  tone: "ok" | "fail" | "info";
  text: string;
};

export interface PrivateAgentRecord {
  agentSecret: string;
  identityCommitment: string;
  lineCommitment: string;
  L: number;
  B: number;
  epoch: number;
  salt: string;
}

export interface PrivateMerchantRecord {
  merchantSecret: string;
  merchantPk: string;
}

export interface PrivateIssuerRecord {
  issuerSecret: string;
}

export function quoteRecordToInvoice(q: MerchantQuoteRecord): MerchantInvoice {
  return {
    invoiceId: q.displayInvoiceId,
    amount: q.amount,
    Q: q.quoteCommitment,
    used: q.status === "consumed",
    preimage: {
      merchantCommitment: q.merchantPublicKey,
      amount: q.amount,
      invoiceId: q.displayInvoiceId,
      expiry: q.expiry,
      nonce: q.quoteNonce,
      generation: q.lineGeneration,
      feeFlat: q.feeFlat,
      feeBps: q.feeBps,
    },
  };
}

export function drawNoteRecordToNote(n: DrawNoteRecord): DrawNote {
  return {
    D: n.noteCommitment,
    preimage: {
      domain: n.contractDomain,
      lineGeneration: n.lineGeneration,
      identity: n.identityCommitment,
      quoteCommit: n.quoteCommitment,
      merchantPk: n.merchantPublicKey,
      amount: n.amount,
      fee: n.fee,
      noteNonce: n.noteNonce,
      expiry: n.expiry,
    },
    salt: n.noteSalt,
  };
}

function verifiedDrawNoteRecord(value: unknown): DrawNoteRecord {
  const note = validateDrawNoteRecord(value);
  const commitment = toHex(drawNoteCommit({ domain: hexToBytes(note.contractDomain), lineGeneration: BigInt(note.lineGeneration),
    identity: hexToBytes(note.identityCommitment), quoteCommit: hexToBytes(note.quoteCommitment), merchantPk: hexToBytes(note.merchantPublicKey),
    amount: BigInt(note.amount), fee: BigInt(note.fee), noteNonce: hexToBytes(note.noteNonce), expiry: BigInt(note.expiry) }, hexToBytes(note.noteSalt)));
  if (commitment !== note.noteCommitment) throw new Error("Draw note opening does not match its commitment.");
  return note;
}

function verifiedHistoricalAgentKey(value: unknown): { identityCommitment: string; agentSecret: string } {
  const key = value as { identityCommitment?: unknown; agentSecret?: unknown } | null;
  if (!key || typeof key.agentSecret !== "string" || !/^[a-fA-F0-9]{64}$/.test(key.agentSecret) ||
      typeof key.identityCommitment !== "string" || !/^[a-fA-F0-9]{64}$/.test(key.identityCommitment) ||
      toHex(agentId(hexToBytes(key.agentSecret))) !== key.identityCommitment.toLowerCase()) {
    throw new Error("Invalid encrypted historical agent authorization.");
  }
  return { identityCommitment: key.identityCommitment.toLowerCase(), agentSecret: key.agentSecret.toLowerCase() };
}

export type ProductStoreState = {
  // Public ledger status from runtime
  ledger: LedgerPublicStatus;
  runtimeMode: RuntimeMode;
  isWalletConnected: boolean;
  txLifecycle: TxLifecycle;
  lastTxHash: string | null;
  lastBlockHeight: number | null;
  flash: Flash | null;
  dual: { circuit: string; publicView: string; privateView: string; ok: boolean } | null;

  // Vault custody status (IndexedDB AES-GCM)
  isVaultUnlocked: boolean;
  recoveryRequired: boolean;
  operationBusy: boolean;
  activeMerchant: "A" | "B";

  // In-memory typed private operational states (cleared on vault lock / session timeout)
  agentLineRecord: AgentLineRecord | null;
  merchantQuotes: MerchantQuoteRecord[];
  drawNotes: DrawNoteRecord[];
  repayments: RepaymentRecord[];
  refunds: RefundRecord[];
  historicalAgentKeys: { identityCommitment: string; agentSecret: string }[];

  // Legacy compatibility fields for UI views
  agentRecord: PrivateAgentRecord | null;
  issuerRecord: PrivateIssuerRecord | null;
  merchantRecord: PrivateMerchantRecord | null;
  invoices: MerchantInvoice[];
  notes: DrawNote[];

  // Actions
  setFlash: (flash: Flash | null) => void;
  setActiveMerchant: (m: "A" | "B") => void;
  refreshStatus: () => Promise<void>;

  // Vault lifecycle
  unlockVault: (passphrase: string) => Promise<boolean>;
  lockVault: () => void;
  recoverOperations: () => Promise<boolean>;
  saveAgentRecord: (rec: PrivateAgentRecord) => Promise<void>;
  saveIssuerRecord: (rec: PrivateIssuerRecord) => Promise<void>;
  saveMerchantRecord: (rec: PrivateMerchantRecord) => Promise<void>;
  generateIdentity: (role: "issuer" | "agent" | "merchant") => Promise<string>;
  importIdentity: (role: "issuer" | "agent" | "merchant", secretHex: string) => Promise<void>;

  // Asynchronous mutations via LineRuntime
  doFundReserve: (amount?: number) => Promise<boolean>;
  doWithdrawReserve: (amount?: number) => Promise<boolean>;
  doWithdrawFees: () => Promise<boolean>;
  doRegisterMerchant: (merchantPk?: string) => Promise<boolean>;
  doDisableMerchant: (merchantPk: string) => Promise<boolean>;
  doOpen: (limit?: number, policy?: { feeFlat: number; feeBps: number }) => Promise<boolean>;
  doQuote: (amount: number, invoiceId?: string, merchant?: "A" | "B") => Promise<boolean>;
  doDraw: (quoteCommitOrPackage: string | QuoteTransferPackage) => Promise<boolean>;
  doRedeem: (noteCommitOrPackage: string | DrawNoteTransferPackage, merchant?: "A" | "B") => Promise<boolean>;
  doExpireNote: (noteCommit: string) => Promise<boolean>;
  doRefundAck: (noteCommit: string, paymentReference: string) => Promise<boolean>;
  doAck: (amount?: number, paymentReference?: string) => Promise<boolean>;
  doStatus: (status: "open" | "defaulted" | "closed") => Promise<boolean>;

  // Transfer packages
  exportQuotePackage: (quoteCommit: string) => QuoteTransferPackage | null;
  importQuotePackage: (pkg: unknown) => boolean;
  exportDrawNotePackage: (noteCommit: string) => DrawNoteTransferPackage | null;
  importDrawNotePackage: (pkg: unknown) => boolean;
};

const initialPublicLedger: LedgerPublicStatus = {
  contractDomain: "0x0000000000000000000000000000000000000000000000000000000000000000",
  contractAddress: null,
  networkId: "midnight-testnet",
  status: "none",
  actionClock: 0,
  lineGeneration: 0,
  identityCommitment: null,
  lineCommitment: null,
  totalReserve: 0,
  encumberedReserve: 0,
  redeemedReserve: 0,
  feeFlat: 0,
  feeBps: 0,
  withdrawableReserve: 0,
  quoteCount: 0,
  noteCount: 0,
  nullifierCount: 0,
  runtime: "network",
};

const privateStateKeys = ["agentLineRecord", "agentRecord", "issuerRecord", "merchantRecord", "merchantQuotes", "drawNotes", "repayments", "refunds", "historicalAgentKeys", "invoices", "notes", "dual"] as const;

function emptyPrivateState() {
  return { isVaultUnlocked: false, agentLineRecord: null, agentRecord: null,
    issuerRecord: null, merchantRecord: null, merchantQuotes: [], drawNotes: [],
    repayments: [], refunds: [], historicalAgentKeys: [], invoices: [], notes: [], dual: null };
}

function isCurrentSession(revision: number): boolean {
  return getVaultSessionPassphrase() !== null && getVaultSessionRevision() === revision;
}

export const useAppStore = create<ProductStoreState>((set, get) => {
  let mutation: ConsoleMutationContext | null = null;
  let busy = false;
  let enteringAction = false;
  const runtimeForMutation = () => {
    if (!mutation) throw new Error("Operation must acquire its durable journal lease.");
    return journaledRuntime(mutation);
  };
  const privateVaultPrefix = (runtime: ReturnType<typeof getRuntime>) =>
    `line:vault:${runtime.networkId}:${mutation?.address ?? runtime.getContractAddress() ?? "unconfigured"}`;
  const restorePrivate = (state: ConsolePrivateState) => set({ ...state, refunds: state.refunds ?? [], historicalAgentKeys: state.historicalAgentKeys ?? [], isVaultUnlocked: true,
    invoices: state.merchantQuotes.map(quoteRecordToInvoice), notes: state.drawNotes.map(drawNoteRecordToNote), dual: null });
  // Check the vault itself rather than the UI flag. Session expiry is synchronous
  // even if the timer was delayed while the browser was suspended.
  const requireSession = (draw = false) => {
    if (busy && !enteringAction) {
      set({ flash: { tone: "fail", text: draw ? "Clearance could not be proven." : "An operation is in progress. Wait for its outcome before changing private records." } });
      return false;
    }
    if (getVaultSessionPassphrase() !== null && get().isVaultUnlocked) return true;
    set({ ...emptyPrivateState(), flash: { tone: "fail", text: draw ? "Clearance could not be proven." : "Vault is locked. Unlock vault to continue." } });
    return false;
  };
  const publish = (revision: number, patch: Partial<ProductStoreState>, draw = false) => {
    if (isCurrentSession(revision) && (!mutation ||
        (getRuntime() === mutation.runtime && getRuntime().getContractAddress() === mutation.address))) {
      set(patch);
      return;
    }
    // A transaction already submitted may finish after lock. Retain its public
    // outcome, but never repopulate decrypted books or credential-bearing views.
    const publicPatch = { ...patch };
    for (const key of privateStateKeys) delete publicPatch[key];
    delete publicPatch.isVaultUnlocked;
    publicPatch.flash = draw && (patch.txLifecycle === "failed" || patch.flash?.tone === "fail")
      ? { tone: "fail", text: "Clearance could not be proven." }
      : { tone: "info", text: "Vault session changed. Unlock to recover encrypted operation records." };
    set(publicPatch);
  };
  const actions: ProductStoreState = ({
  ledger: initialPublicLedger,
  runtimeMode: getRuntime().mode,
  isWalletConnected: getRuntime().isConnected(),
  txLifecycle: "idle",
  lastTxHash: null,
  lastBlockHeight: null,
  flash: null,
  dual: null,

  isVaultUnlocked: isVaultSessionUnlocked(),
  recoveryRequired: false,
  operationBusy: false,
  activeMerchant: "A",

  agentLineRecord: null,
  merchantQuotes: [],
  drawNotes: [],
  repayments: [],
  refunds: [],
  historicalAgentKeys: [],

  agentRecord: null,
  issuerRecord: null,
  merchantRecord: null,
  invoices: [],
  notes: [],

  setFlash: (flash) => set({ flash }),
  setActiveMerchant: (m) => set({ activeMerchant: m }),

  refreshStatus: async () => {
    try {
      const runtime = getRuntime();
      const status = await runtime.getStatus();
      set({
        ledger: status,
        runtimeMode: runtime.mode,
        isWalletConnected: runtime.isConnected(),
      });
    } catch (err) {
      set({
        flash: {
          tone: "fail",
          text: `Status query failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
  },

  unlockVault: async (passphrase: string) => {
    if (busy) return false;
    if (!passphrase || passphrase.length < 8) {
      set({ flash: { tone: "fail", text: "Passphrase must be at least 8 characters." } });
      return false;
    }
    let revision: number | null = null;
    try {
      unlockVaultSession(passphrase, 15);
      revision = getVaultSessionRevision();
      const unlockRevision = revision;
      const load = async <T,>(id: string): Promise<T | null> => {
        if (!isCurrentSession(unlockRevision)) throw new Error("Vault session changed.");
        const record = await loadEncryptedJson<T>(id, passphrase);
        if (!isCurrentSession(unlockRevision)) throw new Error("Vault session changed.");
        return record;
      };
      const runtime = getRuntime();
      const contractAddr = runtime.getContractAddress() ?? "unconfigured";
      const networkId = runtime.networkId;
      const prefix = `line:vault:${networkId}:${contractAddr}`;

      // A confirmed journal is the atomic private snapshot. Prefer it over legacy
      // per-record mirrors, which may have been interrupted between writes.
      if (runtime.getContractAddress()) {
        const ledger = await runtime.getStatus();
        const assertCurrent = () => {
          if (!isCurrentSession(unlockRevision) || getRuntime() !== runtime || runtime.getContractAddress() !== contractAddr)
            throw new Error("Vault or contract context changed during recovery.");
        };
        assertCurrent();
        const scope = consoleJournalScope(runtime, ledger);
        const journal = createOperationJournal(scope, passphrase, { assertSession: assertCurrent });
        const recovered = await journal.withExclusive(async lease => {
          const result = await reconcileConsole(lease, scope, runtime, ledger, assertCurrent, { restoreAcknowledged: true });
          assertCurrent();
          if (result.privateState) {
            // Credentials and imported packages may have been saved after the
            // latest circuit. Preserve those later encrypted records, while the
            // reconciled journal controls confirmed openings and terminal status.
            const recovered = result.privateState;
            const issuer = await load<PrivateIssuerRecord>(`${prefix}:issuer`);
            const merchant = await load<PrivateMerchantRecord>(`${prefix}:merchant`);
            const agent = recovered.agentLineRecord || (recovered.historicalAgentKeys ?? []).length > 0
              ? null : await load<PrivateAgentRecord>(`${prefix}:agent`);
            const quotes = (await load<MerchantQuoteRecord[]>(`${prefix}:quotes`) ?? []).map(validateMerchantQuoteRecord);
            const notes = (await load<DrawNoteRecord[]>(`${prefix}:notes`) ?? []).map(verifiedDrawNoteRecord);
            const refunds = (await load<RefundRecord[]>(`${prefix}:refunds`) ?? []).map(validateRefundRecord);
            const historicalAgentKeys = (await load<unknown[]>(`${prefix}:historical-agent-keys`) ?? []).map(verifiedHistoricalAgentKey);
            const quoteKeys = new Set(recovered.merchantQuotes.map(quote => quote.quoteCommitment));
            const noteKeys = new Set(recovered.drawNotes.map(note => note.noteCommitment));
            const merged = { ...recovered, issuerRecord: issuer ?? recovered.issuerRecord,
              merchantRecord: merchant ?? recovered.merchantRecord, agentRecord: agent ?? recovered.agentRecord,
              merchantQuotes: [...recovered.merchantQuotes, ...quotes.filter(quote => !quoteKeys.has(quote.quoteCommitment))],
              drawNotes: [...recovered.drawNotes, ...notes.filter(note => !noteKeys.has(note.noteCommitment))],
              refunds: [...(recovered.refunds ?? []), ...refunds.filter(refund => !(recovered.refunds ?? []).some(item => item.noteCommitment === refund.noteCommitment))] };
            restorePrivate(merged);
            if (merged.agentLineRecord) await saveEncryptedJson(`${prefix}:agent-line`, merged.agentLineRecord, passphrase);
            if (merged.refunds?.length) await saveEncryptedJson(`${prefix}:refunds`, merged.refunds, passphrase);
            if (merged.drawNotes?.length) await saveEncryptedJson(`${prefix}:notes`, merged.drawNotes, passphrase);
            if (result.confirmedId && !result.blocked) await lease.acknowledgeConfirmed(result.confirmedId);
          }
          return result;
        });
        assertCurrent();
        const recoveredLedger = await runtime.getStatus();
        assertCurrent();
        set({ ledger: recoveredLedger, recoveryRequired: recovered.blocked });
        if (recovered.privateState && !recovered.blocked) {
          set({ flash: { tone: "ok", text: "Encrypted operation state recovered. Vault unlocked." } });
          return true;
        }
      }

      const rawAgentLine = await load<AgentLineRecord>(`${prefix}:agent-line`);
      const agentLineRec = rawAgentLine === null ? null : validateAgentLineRecord(rawAgentLine);
      const agentRec = await load<PrivateAgentRecord>(`${prefix}:agent`);
      const issuerRec = await load<PrivateIssuerRecord>(`${prefix}:issuer`);
      const merchantRec = await load<PrivateMerchantRecord>(`${prefix}:merchant`);
      const quotes = ((await load<MerchantQuoteRecord[]>(`${prefix}:quotes`)) ?? []).map(validateMerchantQuoteRecord);
      const notes = ((await load<DrawNoteRecord[]>(`${prefix}:notes`)) ?? []).map(verifiedDrawNoteRecord);
      const refunds = ((await load<RefundRecord[]>(`${prefix}:refunds`)) ?? []).map(validateRefundRecord);
      const historicalAgentKeys = ((await load<unknown[]>(`${prefix}:historical-agent-keys`)) ?? []).map(verifiedHistoricalAgentKey);
      const repayments = (await load<RepaymentRecord[]>(`${prefix}:repayments`)) ?? [];

      const activeAgentRec: PrivateAgentRecord | null = agentLineRec
        ? {
            agentSecret: agentLineRec.agentSecret,
            identityCommitment: agentLineRec.identityCommitment,
            lineCommitment: agentLineRec.lineCommitment,
            L: agentLineRec.limit,
            B: agentLineRec.outstanding,
            epoch: agentLineRec.epoch,
            salt: agentLineRec.salt,
          }
        : agentRec ?? null;

      const uiInvoices: MerchantInvoice[] = quotes.map(quoteRecordToInvoice);
      const uiNotes: DrawNote[] = notes.map(drawNoteRecordToNote);

      if (revision === null || !isCurrentSession(revision)) return false;
      const isBlocked = get().recoveryRequired;
      set({
        isVaultUnlocked: true,
        agentLineRecord: agentLineRec ?? null,
        agentRecord: activeAgentRec,
        issuerRecord: issuerRec ?? null,
        merchantRecord: merchantRec ?? null,
        merchantQuotes: quotes,
        drawNotes: notes,
        repayments,
        refunds,
        historicalAgentKeys,
        invoices: uiInvoices,
        notes: uiNotes,
        flash: { tone: isBlocked ? "info" : "ok", text: isBlocked ? "A submitted operation requires reconciliation. New operations are blocked." : "Encrypted vault unlocked. Ephemeral session active." },
      });
      return !isBlocked;
    } catch (err) {
      // An older decrypt failure must not lock a newer successful unlock.
      if (revision !== null && getVaultSessionRevision() !== revision) return false;
      lockVaultSession();
      set({
        isVaultUnlocked: false,
        flash: { tone: "fail", text: `Vault unlock failed: ${err instanceof Error ? err.message : "Decryption error"}` },
      });
      return false;
    }
  },

  lockVault: () => {
    lockVaultSession();
  },

  recoverOperations: async () => {
    const passphrase = getVaultSessionPassphrase();
    return passphrase !== null && !busy ? (await get().unlockVault(passphrase)) && !get().recoveryRequired : false;
  },

  saveAgentRecord: async (rec) => {
    if (!requireSession()) throw new Error("Vault is locked.");
    if (get().agentLineRecord || get().agentRecord?.lineCommitment) {
      throw new Error("An issued line opening already exists. Preserve its encrypted recovery record.");
    }
    const revision = getVaultSessionRevision();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const passphrase = getVaultSessionPassphrase();
    if (!passphrase) throw new Error("Vault is locked.");
    const runtime = getRuntime();
    const prefix = privateVaultPrefix(runtime);
    await saveEncryptedJson(`${prefix}:agent`, rec, passphrase);
    set({ agentRecord: rec });
  },

  saveIssuerRecord: async (rec) => {
    if (!requireSession()) throw new Error("Vault is locked.");
    const revision = getVaultSessionRevision();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const passphrase = getVaultSessionPassphrase();
    if (!passphrase) throw new Error("Vault is locked.");
    const runtime = getRuntime();
    const prefix = privateVaultPrefix(runtime);
    await saveEncryptedJson(`${prefix}:issuer`, rec, passphrase);
    set({ issuerRecord: rec });
  },

  saveMerchantRecord: async (rec) => {
    if (!requireSession()) throw new Error("Vault is locked.");
    const revision = getVaultSessionRevision();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const passphrase = getVaultSessionPassphrase();
    if (!passphrase) throw new Error("Vault is locked.");
    const runtime = getRuntime();
    const prefix = privateVaultPrefix(runtime);
    await saveEncryptedJson(`${prefix}:merchant`, rec, passphrase);
    set({ merchantRecord: rec });
  },

  generateIdentity: async (role: "issuer" | "agent" | "merchant"): Promise<string> => {
    if (!requireSession()) throw new Error("Vault is locked.");
    const revision = getVaultSessionRevision();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    if (role === "agent" && (get().agentLineRecord || get().agentRecord?.lineCommitment)) {
      throw new Error("An issued line opening already exists. Preserve its encrypted recovery record.");
    }
    const passphrase = getVaultSessionPassphrase();
    if (!passphrase) throw new Error("Vault is locked. Unlock vault to generate identity.");
    const secret = toHex(randomBytes32());
    if (role === "issuer") {
      await get().saveIssuerRecord({ issuerSecret: secret });
    } else if (role === "merchant") {
      const pk = toHex(merchantPublicKey(hexToBytes(secret)));
      await get().saveMerchantRecord({ merchantSecret: secret, merchantPk: pk });
    } else if (role === "agent") {
      const idBytes = agentId(hexToBytes(secret));
      const identityCommitment = toHex(idBytes);
      await get().saveAgentRecord({
        agentSecret: secret,
        identityCommitment,
        lineCommitment: "",
        L: 0,
        B: 0,
        epoch: 0,
        salt: "",
      });
    }
    set({ flash: { tone: "ok", text: `Generated and secured ${role} credentials in encrypted vault.` } });
    if (!isCurrentSession(revision)) throw new Error("Vault session changed.");
    return secret;
  },

  importIdentity: async (role: "issuer" | "agent" | "merchant", secretHex: string): Promise<void> => {
    if (!requireSession()) throw new Error("Vault is locked.");
    const revision = getVaultSessionRevision();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const clean = secretHex.trim().replace(/^0x/, "");
    if (clean.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(clean)) {
      throw new Error("Expected 32-byte hexadecimal secret key (64 hex characters).");
    }
    if (role === "agent" && (get().agentLineRecord || get().agentRecord?.lineCommitment)) {
      throw new Error("An issued line opening already exists. Preserve its encrypted recovery record.");
    }
    const passphrase = getVaultSessionPassphrase();
    if (!passphrase) throw new Error("Vault is locked. Unlock vault to import identity.");
    if (role === "issuer") {
      await get().saveIssuerRecord({ issuerSecret: clean });
    } else if (role === "merchant") {
      const pk = toHex(merchantPublicKey(hexToBytes(clean)));
      await get().saveMerchantRecord({ merchantSecret: clean, merchantPk: pk });
    } else if (role === "agent") {
      const idBytes = agentId(hexToBytes(clean));
      const identityCommitment = toHex(idBytes);
      await get().saveAgentRecord({
        agentSecret: clean,
        identityCommitment,
        lineCommitment: "",
        L: 0,
        B: 0,
        epoch: 0,
        salt: "",
      });
    }
    set({ flash: { tone: "ok", text: `Imported and secured ${role} credentials in encrypted vault.` } });
    if (!isCurrentSession(revision)) throw new Error("Vault session changed.");
  },

  doFundReserve: async (amount?: number) => {
    if (!requireSession()) return false;
    const revision = getVaultSessionRevision();
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const runtime = runtimeForMutation();
    const callerSk = operationState.issuerRecord?.issuerSecret;
    if (!callerSk) {
      set({
        flash: {
          tone: "fail",
          text: "Reserve funding refused: Issuer private key record missing from vault. Unlock vault or save issuer key.",
        },
      });
      return false;
    }

    if (!amount || amount <= 0) {
      set({
        flash: { tone: "fail", text: "Reserve funding refused: Provide a positive amount." },
      });
      return false;
    }

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Requesting wallet approval..." } });
    try {
      set({ txLifecycle: "proving" });
      if (!isCurrentSession(revision)) { set({ txLifecycle: "failed" }); return false; }
      const res: RuntimeTransactionResult = await runtime.fundReserve(amount, callerSk);
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: `Fund reserve rejected: ${res.error}` },
        });
        return false;
      }
      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: `Settlement capacity recorded: +${amount}. Tx: ${res.txHash?.slice(0, 14)}...` },
      });
      await get().refreshStatus();
      return true;
    } catch (err) {
      set({
        txLifecycle: "failed",
        flash: { tone: "fail", text: `Fund reserve failed: ${err instanceof Error ? err.message : String(err)}` },
      });
      return false;
    }
  },

  doWithdrawReserve: async (amount?: number) => {
    if (!requireSession()) return false;
    const revision = getVaultSessionRevision();
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const runtime = runtimeForMutation();
    const total = operationState.ledger.totalReserve ?? 0;
    const locked = (operationState.ledger.encumberedReserve ?? 0) + (operationState.ledger.redeemedReserve ?? 0);
    const withdrawable = Math.max(0, total - locked);
    const amt = amount ?? withdrawable;
    const callerSk = operationState.issuerRecord?.issuerSecret;
    if (!callerSk) {
      set({
        flash: {
          tone: "fail",
          text: "Withdrawal refused: Issuer private key record missing from vault. Unlock vault or save issuer key.",
        },
      });
      return false;
    }

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Requesting wallet approval..." } });
    try {
      set({ txLifecycle: "proving" });
      if (!isCurrentSession(revision)) { set({ txLifecycle: "failed" }); return false; }
      const res = await runtime.withdrawReserve(amt, callerSk);
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: `Withdrawal rejected: ${res.error}` },
        });
        return false;
      }
      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: `Settlement reserve withdrawn: ${amt} units.` },
      });
      await get().refreshStatus();
      return true;
    } catch (err) {
      set({
        txLifecycle: "failed",
        flash: { tone: "fail", text: `Withdrawal failed: ${err instanceof Error ? err.message : String(err)}` },
      });
      return false;
    }
  },

  doWithdrawFees: async () => {
    if (!requireSession()) return false;
    const revision = getVaultSessionRevision();
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const runtime = runtimeForMutation();
    const callerSk = operationState.issuerRecord?.issuerSecret;
    if (!callerSk) {
      set({ flash: { tone: "fail", text: "Fee withdrawal refused: Issuer private key record missing from vault." } });
      return false;
    }
    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Requesting wallet approval..." } });
    try {
      set({ txLifecycle: "proving" });
      if (!isCurrentSession(revision)) { set({ txLifecycle: "failed" }); return false; }
      const res = await runtime.withdrawFees(callerSk);
      if (!res.ok) {
        set({ txLifecycle: "failed", flash: { tone: "fail", text: `Fee withdrawal rejected: ${res.error}` } });
        return false;
      }
      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: `Accrued issuer fees withdrawn.` },
      });
      await get().refreshStatus();
      return true;
    } catch (err) {
      set({ txLifecycle: "failed", flash: { tone: "fail", text: `Fee withdrawal failed: ${err instanceof Error ? err.message : String(err)}` } });
      return false;
    }
  },

  doRegisterMerchant: async (merchantPk?: string) => {
    if (!requireSession()) return false;
    const revision = getVaultSessionRevision();
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const runtime = runtimeForMutation();
    const callerSk = operationState.issuerRecord?.issuerSecret;
    if (!callerSk) {
      set({
        flash: {
          tone: "fail",
          text: "Merchant registration refused: Issuer private key record missing from vault.",
        },
      });
      return false;
    }

    const pk = merchantPk ?? operationState.merchantRecord?.merchantPk;
    if (!pk) {
      set({
        flash: {
          tone: "fail",
          text: "Merchant registration refused: Merchant public key missing from vault. Unlock vault or specify merchant key.",
        },
      });
      return false;
    }

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Requesting wallet approval..." } });
    try {
      set({ txLifecycle: "proving" });
      if (!isCurrentSession(revision)) { set({ txLifecycle: "failed" }); return false; }
      const res = await runtime.registerMerchant(pk, callerSk);
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: `Merchant registration rejected: ${res.error}` },
        });
        return false;
      }
      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: `Merchant registered in Compact registry. Tx: ${res.txHash?.slice(0, 14)}...` },
      });
      await get().refreshStatus();
      return true;
    } catch (err) {
      set({
        txLifecycle: "failed",
        flash: { tone: "fail", text: `Registration failed: ${err instanceof Error ? err.message : String(err)}` },
      });
      return false;
    }
  },

  doDisableMerchant: async (merchantPk: string) => {
    if (!requireSession()) return false;
    const revision = getVaultSessionRevision();
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const runtime = runtimeForMutation();
    const callerSk = operationState.issuerRecord?.issuerSecret;
    if (!callerSk) {
      set({ flash: { tone: "fail", text: "Disable merchant refused: Issuer private key record missing from vault." } });
      return false;
    }
    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Requesting wallet approval..." } });
    try {
      set({ txLifecycle: "proving" });
      if (!isCurrentSession(revision)) { set({ txLifecycle: "failed" }); return false; }
      const res = await runtime.disableMerchant(merchantPk, callerSk);
      if (!res.ok) {
        set({ txLifecycle: "failed", flash: { tone: "fail", text: `Disable merchant rejected: ${res.error}` } });
        return false;
      }
      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: `Merchant disabled in registry.` },
      });
      await get().refreshStatus();
      return true;
    } catch (err) {
      set({ txLifecycle: "failed", flash: { tone: "fail", text: `Disable merchant failed: ${err instanceof Error ? err.message : String(err)}` } });
      return false;
    }
  },

  doOpen: async (limit?: number, policy = { feeFlat: 0, feeBps: 0 }) => {
    if (!requireSession()) return false;
    const revision = getVaultSessionRevision();
    const passphrase = getVaultSessionPassphrase()!;
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const runtime = runtimeForMutation();
    const callerSk = operationState.issuerRecord?.issuerSecret;
    if (!callerSk) {
      set({
        flash: {
          tone: "fail",
          text: "Open line refused: Issuer secret missing from vault. Unlock vault or save issuer key.",
        },
      });
      return false;
    }

    if (!limit || !Number.isSafeInteger(limit) || limit <= 0 ||
        !Number.isSafeInteger(policy.feeFlat) || policy.feeFlat < 0 ||
        !Number.isSafeInteger(policy.feeBps) || policy.feeBps < 0 || policy.feeBps > 10_000) {
      set({
        flash: { tone: "fail", text: "Open line refused: Provide a positive integer limit, a nonnegative integer flat fee, and a rate from 0 to 10000 basis points." },
      });
      return false;
    }

    const agentSecret = operationState.agentLineRecord?.agentSecret ?? operationState.agentRecord?.agentSecret;
    if (!agentSecret) {
      set({
        flash: {
          tone: "fail",
          text: "Open line refused: Agent private key record missing from vault. Unlock vault or save agent key.",
        },
      });
      return false;
    }

    const salt = toHex(randomBytes32());
    const idBytes = agentId(hexToBytes(agentSecret));
    const identityCommitment = toHex(idBytes);
    const c0Bytes = lineStateCommit(
      {
        domain: hexToBytes(operationState.ledger.contractDomain),
        identity: idBytes,
        limit: BigInt(limit),
        outstanding: 0n,
        epoch: 0n,
      },
      hexToBytes(salt)
    );
    const lineCommitment = toHex(c0Bytes);

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Requesting wallet approval..." } });
    try {
      set({ txLifecycle: "proving" });
      if (!isCurrentSession(revision)) { set({ txLifecycle: "failed" }); return false; }
      const res = await runtime.openLine({
        limit,
        feeFlat: policy.feeFlat,
        feeBps: policy.feeBps,
        expiry: Math.floor(Date.now() / 1000) + 10_000,
        callerSk,
        agentSecret,
        salt,
      });
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: `Open line rejected: ${res.error}` },
        });
        return false;
      }

      const newAgentLine: AgentLineRecord = {
        version: 1,
        networkId: operationState.ledger.networkId,
        contractAddress: operationState.ledger.contractAddress ?? "",
        contractDomain: operationState.ledger.contractDomain,
        agentSecret,
        identityCommitment,
        lineCommitment,
        limit,
        outstanding: 0,
        feeFlat: policy.feeFlat,
        feeBps: policy.feeBps,
        epoch: 0,
        salt,
        lineGeneration: operationState.ledger.lineGeneration,
        updatedAt: Date.now(),
      };

      if (passphrase) {
        const prefix = privateVaultPrefix(runtime);
        await saveEncryptedJson(`${prefix}:agent-line`, newAgentLine, passphrase);
      }

      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        agentLineRecord: newAgentLine,
        agentRecord: {
          agentSecret,
          identityCommitment,
          lineCommitment,
          L: limit,
          B: 0,
          epoch: 0,
          salt,
        },
        flash: { tone: "ok", text: "Credit line opened. Encrypted opening saved." },
      });
      await get().refreshStatus();
      return true;
    } catch (err) {
      set({
        txLifecycle: "failed",
        flash: { tone: "fail", text: `Open line failed: ${err instanceof Error ? err.message : String(err)}` },
      });
      return false;
    }
  },

  doQuote: async (amount: number, invoiceId?: string, merchant?: "A" | "B") => {
    if (!requireSession()) return false;
    const revision = getVaultSessionRevision();
    const passphrase = getVaultSessionPassphrase()!;
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const runtime = runtimeForMutation();
    const chosenMerchant = merchant ?? operationState.activeMerchant;
    const merchantSk = operationState.merchantRecord?.merchantSecret;
    if (!merchantSk) {
      set({
        flash: {
          tone: "fail",
          text: "Quote posting refused: Merchant credentials missing from vault. Unlock vault or save merchant key.",
        },
      });
      return false;
    }

    if (!Number.isSafeInteger(amount) || amount <= 0 ||
        !Number.isSafeInteger(operationState.ledger.feeFlat) || !Number.isSafeInteger(operationState.ledger.feeBps)) {
      set({ flash: { tone: "fail", text: "Quote posting refused: Amount must be greater than zero." } });
      return false;
    }

    let fee: number;
    try {
      fee = Number(requiredDrawFee(BigInt(amount), BigInt(operationState.ledger.feeFlat!), BigInt(operationState.ledger.feeBps!)));
      if (!Number.isSafeInteger(fee) || !Number.isSafeInteger(amount + fee)) throw new Error("Unsupported accounting amount.");
    } catch {
      set({ flash: { tone: "fail", text: "Quote posting refused: A valid issuer fee policy and bounded integer price are required." } });
      return false;
    }

    const displayInvoiceId = invoiceId ?? `inv-${chosenMerchant}-${amount}`;
    const invBytes = canonicalInvoiceIdBytes(displayInvoiceId);
    const quoteNonce = toHex(randomBytes32());
    const expiry = Math.floor(Date.now() / 1000) + 10_000;
    const merchantPkBytes = hexToBytes(
      operationState.merchantRecord?.merchantPk || toHex(merchantPublicKey(hexToBytes(merchantSk)))
    );
    const domainBytes = hexToBytes(operationState.ledger.contractDomain);
    const qBytes = quoteCommit({
      merchantPk: merchantPkBytes,
      invoiceId: invBytes,
      amount: BigInt(amount),
      expiry: BigInt(expiry),
      nonce: hexToBytes(quoteNonce),
      generation: BigInt(operationState.ledger.lineGeneration),
      domain: domainBytes,
      feeFlat: BigInt(operationState.ledger.feeFlat!),
      feeBps: BigInt(operationState.ledger.feeBps!),
    });
    const quoteCommitment = toHex(qBytes);

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Posting quote on Midnight network..." } });
    try {
      set({ txLifecycle: "proving" });
      if (!isCurrentSession(revision)) { set({ txLifecycle: "failed" }); return false; }
      const res = await runtime.postQuote({
        amount,
        expiry,
        merchantSk,
        invoiceId: displayInvoiceId,
        nonce: quoteNonce,
      });
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: `Quote rejected: ${res.error}` },
        });
        return false;
      }

      const newQuote: MerchantQuoteRecord = {
        version: 1,
        networkId: operationState.ledger.networkId,
        contractAddress: operationState.ledger.contractAddress ?? "",
        merchantPublicKey: toHex(merchantPkBytes),
        invoiceIdBytes: toHex(invBytes),
        displayInvoiceId,
        amount,
        expiry,
        quoteNonce,
        quoteCommitment,
        lineGeneration: operationState.ledger.lineGeneration,
        feePolicy: "flat-plus-ceil-bps-v1",
        feeFlat: operationState.ledger.feeFlat!,
        feeBps: operationState.ledger.feeBps!,
        fee,
        status: "open",
        transactionId: res.txHash ?? undefined,
        updatedAt: Date.now(),
      };

      const updatedQuotes = [...operationState.merchantQuotes, newQuote];
      if (passphrase) {
        const prefix = privateVaultPrefix(runtime);
        await saveEncryptedJson(`${prefix}:quotes`, updatedQuotes, passphrase);
      }

      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        merchantQuotes: updatedQuotes,
        invoices: updatedQuotes.map(quoteRecordToInvoice),
        flash: { tone: "ok", text: `Quote posted by Merchant ${chosenMerchant} for ${amount} units.` },
      });
      await get().refreshStatus();
      return true;
    } catch (err) {
      set({
        txLifecycle: "failed",
        flash: { tone: "fail", text: `Quote failed: ${err instanceof Error ? err.message : String(err)}` },
      });
      return false;
    }
  },

  doDraw: async (quoteCommitOrPackage: string | QuoteTransferPackage) => {
    if (!requireSession(true)) return false;
    const revision = getVaultSessionRevision();
    const passphrase = getVaultSessionPassphrase()!;
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch, true);
    const runtime = runtimeForMutation();
    let quote: MerchantQuoteRecord | null = null;

    if (typeof quoteCommitOrPackage === "string") {
      quote = operationState.merchantQuotes.find((q) => q.quoteCommitment === quoteCommitOrPackage) ?? null;
      if (!quote) {
        const inv = operationState.invoices.find((i) => i.Q === quoteCommitOrPackage);
        if (inv) {
          try {
          if (!inv.preimage) {
            set({ flash: { tone: "fail", text: "Clearance could not be proven." } });
            return false;
          }
          quote = {
            version: 1,
            networkId: operationState.ledger.networkId,
            contractAddress: operationState.ledger.contractAddress ?? "",
            merchantPublicKey: inv.preimage.merchantCommitment,
            invoiceIdBytes: toHex(canonicalInvoiceIdBytes(inv.invoiceId)),
            displayInvoiceId: inv.invoiceId,
            amount: inv.amount,
            expiry: inv.preimage.expiry,
            quoteNonce: inv.preimage.nonce,
            quoteCommitment: inv.Q,
            lineGeneration: inv.preimage.generation,
            feePolicy: "flat-plus-ceil-bps-v1",
            feeFlat: inv.preimage.feeFlat,
            feeBps: inv.preimage.feeBps,
            fee: Number(requiredDrawFee(BigInt(inv.amount), BigInt(inv.preimage.feeFlat), BigInt(inv.preimage.feeBps))),
            status: inv.used ? "consumed" : "open",
            updatedAt: Date.now(),
          };
          } catch {
            set({ flash: { tone: "fail", text: "Clearance could not be proven." } });
            return false;
          }
        }
      }
    } else {
      let pkg: QuoteTransferPackage;
      try {
        pkg = validateQuoteTransferPackage(quoteCommitOrPackage, operationState.ledger.networkId, operationState.ledger.contractAddress ?? undefined);
      } catch {
        set({ txLifecycle: "failed", flash: { tone: "fail", text: "Clearance could not be proven." } });
        return false;
      }
      quote = {
        version: 1,
        networkId: pkg.networkId,
        contractAddress: pkg.contractAddress,
        merchantPublicKey: pkg.merchantPublicKey,
        invoiceIdBytes: pkg.invoiceIdBytes,
        displayInvoiceId: pkg.displayInvoiceId,
        amount: pkg.amount,
        expiry: pkg.expiry,
        quoteNonce: pkg.quoteNonce,
        quoteCommitment: pkg.quoteCommitment,
        lineGeneration: pkg.lineGeneration,
        feePolicy: pkg.feePolicy,
        feeFlat: pkg.feeFlat,
        feeBps: pkg.feeBps,
        fee: pkg.fee,
        status: "open",
        updatedAt: Date.now(),
      };
    }

    if (!quote || quote.status === "consumed" || operationState.drawNotes.some(note => note.quoteCommitment === quote!.quoteCommitment)) {
      set({ flash: { tone: "fail", text: "Clearance could not be proven." } });
      return false;
    }

    const agentRec = operationState.agentLineRecord;
    const legacyAgent = operationState.agentRecord;
    if (!agentRec && !legacyAgent) {
      set({ flash: { tone: "fail", text: "Clearance could not be proven." } });
      return false;
    }
    const agentSecret = agentRec?.agentSecret ?? legacyAgent?.agentSecret;
    const limit = agentRec?.limit ?? legacyAgent?.L ?? 0;
    const outstanding = agentRec?.outstanding ?? legacyAgent?.B ?? 0;
    const epoch = agentRec?.epoch ?? legacyAgent?.epoch ?? 0;
    const salt = agentRec?.salt ?? legacyAgent?.salt;

    if (!agentSecret || !salt || limit <= 0) {
      set({ flash: { tone: "fail", text: "Clearance could not be proven." } });
      return false;
    }

    const fee = quote.fee;
    try {
      if (quote.feePolicy !== "flat-plus-ceil-bps-v1" || quote.feeFlat !== operationState.ledger.feeFlat ||
          quote.feeBps !== operationState.ledger.feeBps || quote.lineGeneration !== operationState.ledger.lineGeneration ||
          !Number.isSafeInteger(fee) || fee < 0 ||
          BigInt(fee) !== requiredDrawFee(BigInt(quote.amount), BigInt(quote.feeFlat), BigInt(quote.feeBps))) throw new Error("Invalid fee terms.");
    } catch {
      set({ flash: { tone: "fail", text: "Clearance could not be proven." } });
      return false;
    }

    if (!Number.isSafeInteger(outstanding + quote.amount + fee) || outstanding + quote.amount + fee > limit) {
      set({ flash: { tone: "fail", text: "Clearance could not be proven." } });
      return false;
    }

    const newSalt = toHex(randomBytes32());
    const noteNonce = toHex(randomBytes32());
    const noteSalt = toHex(randomBytes32());

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Proving confidential credit clearance in ZK..." } });
    try {
      set({ txLifecycle: "proving" });
      if (!isCurrentSession(revision)) { set({ txLifecycle: "failed" }); return false; }
      const res = await runtime.draw({
        quoteCommit: quote.quoteCommitment,
        limit,
        outstanding,
        epoch,
        amount: quote.amount,
        expiry: quote.expiry,
        callerSk: agentSecret,
        agentSecret,
        salt,
        newSalt,
        invoiceId: quote.displayInvoiceId,
        quoteNonce: quote.quoteNonce,
        noteNonce,
        noteSalt,
        merchantPk: quote.merchantPublicKey,
        fee,
        noteExpiry: quote.expiry,
      });
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: "Clearance could not be proven." },
        });
        return false;
      }

      const idBytes = agentId(hexToBytes(agentSecret));
      const identityCommitment = toHex(idBytes);
      const newOutstanding = outstanding + quote.amount + fee;
      const newEpoch = epoch + 1;
      const newCBytes = lineStateCommit(
        {
          domain: hexToBytes(operationState.ledger.contractDomain),
          identity: idBytes,
          limit: BigInt(limit),
          outstanding: BigInt(newOutstanding),
          epoch: BigInt(newEpoch),
        },
        hexToBytes(newSalt)
      );
      const newLineCommitment = toHex(newCBytes);

      const updatedAgentLine: AgentLineRecord = {
        version: 1,
        networkId: operationState.ledger.networkId,
        contractAddress: operationState.ledger.contractAddress ?? "",
        contractDomain: operationState.ledger.contractDomain,
        agentSecret,
        identityCommitment,
        lineCommitment: newLineCommitment,
        limit,
        outstanding: newOutstanding,
        feeFlat: operationState.ledger.feeFlat!,
        feeBps: operationState.ledger.feeBps!,
        epoch: newEpoch,
        salt: newSalt,
        lineGeneration: operationState.ledger.lineGeneration,
        updatedAt: Date.now(),
      };

      const domainBytes = hexToBytes(operationState.ledger.contractDomain);
      const dPreimage = {
        domain: domainBytes,
        lineGeneration: BigInt(operationState.ledger.lineGeneration),
        identity: idBytes,
        quoteCommit: hexToBytes(quote.quoteCommitment),
        merchantPk: hexToBytes(quote.merchantPublicKey),
        amount: BigInt(quote.amount),
        fee: BigInt(fee),
        noteNonce: hexToBytes(noteNonce),
        expiry: BigInt(quote.expiry),
      };
      const dBytes = drawNoteCommit(dPreimage, hexToBytes(noteSalt));
      const noteCommitment = toHex(dBytes);

      const newDrawNote: DrawNoteRecord = {
        version: 1,
        networkId: operationState.ledger.networkId,
        contractAddress: operationState.ledger.contractAddress ?? "",
        noteCommitment,
        contractDomain: operationState.ledger.contractDomain,
        lineGeneration: operationState.ledger.lineGeneration,
        identityCommitment,
        quoteCommitment: quote.quoteCommitment,
        merchantPublicKey: quote.merchantPublicKey,
        amount: quote.amount,
        fee,
        noteNonce,
        noteSalt,
        expiry: quote.expiry,
        status: "active",
        drawTransactionId: res.txHash ?? undefined,
        updatedAt: Date.now(),
      };

      const updatedNotes = [...operationState.drawNotes, newDrawNote];
      const updatedQuotes = operationState.merchantQuotes.map((q) =>
        q.quoteCommitment === quote.quoteCommitment ? { ...q, status: "consumed" as const } : q
      );

      if (passphrase) {
        const prefix = privateVaultPrefix(runtime);
        await saveEncryptedJson(`${prefix}:agent-line`, updatedAgentLine, passphrase);
        await saveEncryptedJson(`${prefix}:notes`, updatedNotes, passphrase);
        await saveEncryptedJson(`${prefix}:quotes`, updatedQuotes, passphrase);
      }

      set({
        agentLineRecord: updatedAgentLine,
        agentRecord: {
          agentSecret,
          identityCommitment,
          lineCommitment: newLineCommitment,
          L: limit,
          B: newOutstanding,
          epoch: newEpoch,
          salt: newSalt,
        },
        drawNotes: updatedNotes,
        merchantQuotes: updatedQuotes,
        invoices: updatedQuotes.map(quoteRecordToInvoice),
        notes: updatedNotes.map(drawNoteRecordToNote),
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: "Draw cleared. Private merchant-bound settlement note issued." },
      });
      await get().refreshStatus();
      return true;
    } catch {
      set({
        txLifecycle: "failed",
        flash: { tone: "fail", text: "Clearance could not be proven." },
      });
      return false;
    }
  },

  doRedeem: async (noteCommitOrPackage: string | DrawNoteTransferPackage, merchant?: "A" | "B") => {
    if (!requireSession()) return false;
    const revision = getVaultSessionRevision();
    const passphrase = getVaultSessionPassphrase()!;
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const runtime = runtimeForMutation();
    const chosen = merchant ?? operationState.activeMerchant;
    const merchantSk = operationState.merchantRecord?.merchantSecret;
    if (!merchantSk) {
      set({
        flash: {
          tone: "fail",
          text: "Redemption refused: Merchant credentials missing from vault. Unlock vault or save merchant key.",
        },
      });
      return false;
    }

    let note: DrawNoteRecord | null = null;
    if (typeof noteCommitOrPackage === "string") {
      note = operationState.drawNotes.find((n) => n.noteCommitment === noteCommitOrPackage) ?? null;
      if (!note) {
        const uiN = operationState.notes.find((n) => n.D === noteCommitOrPackage);
        if (uiN) {
          if (!uiN.salt) {
            set({ flash: { tone: "fail", text: "Redemption refused: Note opening salt missing. Import full draw note package." } });
            return false;
          }
          note = {
            version: 1,
            networkId: operationState.ledger.networkId,
            contractAddress: operationState.ledger.contractAddress ?? "",
            noteCommitment: uiN.D,
            contractDomain: uiN.preimage.domain,
            lineGeneration: uiN.preimage.lineGeneration,
            identityCommitment: uiN.preimage.identity,
            quoteCommitment: uiN.preimage.quoteCommit,
            merchantPublicKey: uiN.preimage.merchantPk,
            amount: uiN.preimage.amount,
            fee: uiN.preimage.fee,
            noteNonce: uiN.preimage.noteNonce,
            noteSalt: uiN.salt,
            expiry: uiN.preimage.expiry,
            status: "active",
            updatedAt: Date.now(),
          };
        }
      }
    } else {
      const pkg = validateDrawNoteTransferPackage(
        noteCommitOrPackage,
        operationState.ledger.networkId,
        operationState.ledger.contractAddress ?? undefined
      );
      note = {
        version: 1,
        networkId: pkg.networkId,
        contractAddress: pkg.contractAddress,
        noteCommitment: pkg.noteCommitment,
        contractDomain: pkg.contractDomain,
        lineGeneration: pkg.lineGeneration,
        identityCommitment: pkg.identityCommitment,
        quoteCommitment: pkg.quoteCommitment,
        merchantPublicKey: pkg.merchantPublicKey,
        amount: pkg.amount,
        fee: pkg.fee,
        noteNonce: pkg.noteNonce,
        noteSalt: pkg.noteSalt,
        expiry: pkg.expiry,
        status: "active",
        updatedAt: Date.now(),
      };
    }

    if (!note) {
      set({ flash: { tone: "fail", text: "Redemption refused: Draw note record not found in vault." } });
      return false;
    }

    try { verifiedDrawNoteRecord(note); } catch {
      set({ flash: { tone: "fail", text: "Redemption refused: Note opening does not match its commitment." } });
      return false;
    }

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Redeeming settlement note against reserve..." } });
    try {
      set({ txLifecycle: "proving" });
      if (!isCurrentSession(revision)) { set({ txLifecycle: "failed" }); return false; }
      const res = await runtime.redeemDraw({
        noteCommit: note.noteCommitment,
        amount: note.amount,
        fee: note.fee,
        noteGeneration: note.lineGeneration,
        expiry: note.expiry,
        noteExpiry: note.expiry,
        merchantSk,
        noteIdentity: note.identityCommitment,
        noteQuoteCommit: note.quoteCommitment,
        noteNonce: note.noteNonce,
        noteSalt: note.noteSalt,
      });
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: `Redemption rejected: ${res.error}` },
        });
        return false;
      }

      const updatedNotes = operationState.drawNotes.map((n) =>
        n.noteCommitment === note.noteCommitment
          ? { ...n, status: "redeemed" as const, redemptionTransactionId: res.txHash ?? undefined }
          : n
      );

      if (passphrase) {
        const prefix = privateVaultPrefix(runtime);
        await saveEncryptedJson(`${prefix}:notes`, updatedNotes, passphrase);
      }

      set({
        drawNotes: updatedNotes,
        notes: updatedNotes.map(drawNoteRecordToNote),
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: `Claim marked redeemed for Merchant ${chosen}. No token movement occurred.` },
      });
      await get().refreshStatus();
      return true;
    } catch (err) {
      set({
        txLifecycle: "failed",
        flash: { tone: "fail", text: `Redemption failed: ${err instanceof Error ? err.message : String(err)}` },
      });
      return false;
    }
  },

  doExpireNote: async (noteCommit: string) => {
    if (!requireSession()) return false;
    const revision = getVaultSessionRevision();
    const passphrase = getVaultSessionPassphrase()!;
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const runtime = runtimeForMutation();
    if (operationState.refunds.some(item => item.noteCommitment === noteCommit)) {
      set({ flash: { tone: "ok", text: "Compensation was already allocated for this note." } });
      return true;
    }
    const note = operationState.drawNotes.find(item => item.noteCommitment === noteCommit);
    const line = operationState.agentLineRecord;
    const legacy = operationState.agentRecord;
    const originalKey = note ? operationState.historicalAgentKeys.find(key => key.identityCommitment === note.identityCommitment)?.agentSecret
      ?? [line?.agentSecret, legacy?.agentSecret].find(key => key && toHex(agentId(hexToBytes(key))) === note.identityCommitment) : undefined;
    const callerSk = operationState.issuerRecord?.issuerSecret ?? originalKey;
    if (!note || !callerSk || note.status === "redeemed" || note.contractDomain !== operationState.ledger.contractDomain) {
      set({ flash: { tone: "fail", text: "Compensation requires the original unredeemed note opening and issuer or original agent authorization." } });
      return false;
    }
    const currentGeneration = note.lineGeneration === operationState.ledger.lineGeneration;
    const book = currentGeneration ? line ? { limit: line.limit, outstanding: line.outstanding, epoch: line.epoch, salt: line.salt }
      : legacy ? { limit: legacy.L, outstanding: legacy.B, epoch: legacy.epoch, salt: legacy.salt } : undefined : undefined;
    if (currentGeneration && (!book || note.identityCommitment !== operationState.ledger.identityCommitment)) {
      set({ flash: { tone: "fail", text: "Current private credit opening is required to allocate compensation." } });
      return false;
    }
    set({ txLifecycle: "proving", flash: { tone: "info", text: "Proving expiry and allocating debt credit or a private refund obligation..." } });
    try {
      if (!isCurrentSession(revision)) return false;
      const res = await runtime.cancelOrExpireNote(noteCommit, callerSk, { compensation: {
        note: { identity: note.identityCommitment, quoteCommit: note.quoteCommitment, merchantPk: note.merchantPublicKey,
          amount: note.amount, fee: note.fee, noteNonce: note.noteNonce, expiry: note.expiry, lineGeneration: note.lineGeneration },
        noteSalt: note.noteSalt, newSalt: toHex(randomBytes32()), book,
      } });
      if (!res.ok) {
        set({ txLifecycle: "failed", flash: { tone: "fail", text: `Compensation rejected: ${res.error ?? "Reconcile the operation before retrying."}` } });
        return false;
      }
      const candidate = recoveredConsole(mutation!.operation!, runtime, operationState.ledger.contractDomain);
      const prefix = privateVaultPrefix(runtime);
      await saveEncryptedJson(`${prefix}:notes`, candidate.drawNotes, passphrase);
      await saveEncryptedJson(`${prefix}:refunds`, candidate.refunds ?? [], passphrase);
      await saveEncryptedJson(`${prefix}:historical-agent-keys`, candidate.historicalAgentKeys ?? [], passphrase);
      if (candidate.agentLineRecord) await saveEncryptedJson(`${prefix}:agent-line`, candidate.agentLineRecord, passphrase);
      set({ ...candidate, refunds: candidate.refunds ?? [], historicalAgentKeys: candidate.historicalAgentKeys ?? [], notes: candidate.drawNotes.map(drawNoteRecordToNote),
        txLifecycle: "confirmed", lastTxHash: res.txHash ?? null, lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: "Expired claim compensated. Any private cash refund remains due until separately reported by the issuer." } });
      await get().refreshStatus();
      return true;
    } catch (error) {
      set({ txLifecycle: "failed", flash: { tone: "fail", text: `Compensation paused: ${error instanceof Error ? error.message : String(error)}` } });
      return false;
    }
  },

  doRefundAck: async (noteCommit: string, paymentReference: string) => {
    if (!requireSession()) return false;
    const revision = getVaultSessionRevision();
    const passphrase = getVaultSessionPassphrase()!;
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const runtime = runtimeForMutation();
    const refund = operationState.refunds.find(item => item.noteCommitment === noteCommit);
    if (refund?.status === "issuer-reported") {
      const same = refund.paymentReference === paymentReference;
      set({ flash: { tone: same ? "ok" : "fail", text: same ? "This refund reference was already reported."
        : "This refund already has a different issuer report." } });
      return same;
    }
    const callerSk = operationState.issuerRecord?.issuerSecret;
    if (!refund || !callerSk || refund.amount <= 0 || refund.issuerReportObserved) {
      set({ flash: { tone: "fail", text: "A positive allocated refund and issuer authorization are required." } });
      return false;
    }
    try {
      validateRefundRecord(refund);
      canonicalPaymentReferenceBytes(paymentReference);
      const commitment = toHex(refundCommit({ domain: hexToBytes(refund.contractDomain), lineGeneration: BigInt(refund.lineGeneration),
        identity: hexToBytes(refund.identityCommitment), noteCommit: hexToBytes(noteCommit), amount: BigInt(refund.amount) }, hexToBytes(refund.salt)));
      if (refund.contractDomain !== operationState.ledger.contractDomain || commitment !== refund.refundCommitment) throw new Error("Refund opening does not match this contract obligation.");
      const receiptExpiry = Math.floor(Date.now() / 1000) + 600;
      set({ txLifecycle: "proving", flash: { tone: "info", text: "Recording the issuer's off-chain refund report..." } });
      if (!isCurrentSession(revision)) return false;
      const res = await runtime.cancelOrExpireNote(noteCommit, callerSk, { refundAck: {
        identity: refund.identityCommitment, amount: refund.amount, salt: refund.salt, paymentRef: paymentReference, receiptExpiry,
      } });
      if (!res.ok) {
        set({ txLifecycle: "failed", flash: { tone: "fail", text: `Refund report rejected: ${res.error ?? "Reconcile before retrying."}` } });
        return false;
      }
      const candidate = recoveredConsole(mutation!.operation!, runtime, operationState.ledger.contractDomain);
      await saveEncryptedJson(`${privateVaultPrefix(runtime)}:refunds`, candidate.refunds ?? [], passphrase);
      set({ refunds: candidate.refunds ?? [], txLifecycle: "confirmed", lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null, flash: { tone: "ok", text: "Issuer refund report recorded. This does not verify a cash transfer; its full backing remains locked." } });
      await get().refreshStatus();
      return true;
    } catch (error) {
      set({ txLifecycle: "failed", flash: { tone: "fail", text: `Refund report paused: ${error instanceof Error ? error.message : String(error)}` } });
      return false;
    }
  },

  doAck: async (amount?: number, paymentReference?: string) => {
    if (!requireSession()) return false;
    const revision = getVaultSessionRevision();
    const passphrase = getVaultSessionPassphrase()!;
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const runtime = runtimeForMutation();
    const priorReceipt = paymentReference ? operationState.repayments.find(record => record.paymentReference === paymentReference) : null;
    if (priorReceipt) {
      const sameAmount = priorReceipt.amount === amount;
      set({ flash: { tone: sameAmount ? "ok" : "fail", text: sameAmount
        ? "This payment reference was already acknowledged."
        : "This payment reference is already assigned to another amount." } });
      return sameAmount;
    }
    const callerSk = operationState.issuerRecord?.issuerSecret;
    if (!callerSk) {
      set({
        flash: {
          tone: "fail",
          text: "Repayment acknowledgement refused: Issuer secret missing from vault. Unlock vault or save issuer key.",
        },
      });
      return false;
    }

    if (!amount || amount <= 0) {
      set({
        flash: { tone: "fail", text: "Repayment acknowledgement refused: Provide a positive repayment amount." },
      });
      return false;
    }

    const agentRec = operationState.agentLineRecord;
    const legacyAgent = operationState.agentRecord;
    if (!agentRec && !legacyAgent) {
      set({ flash: { tone: "fail", text: "Repay ack refused: vault record missing for this agent." } });
      return false;
    }
    const agentSecret = agentRec?.agentSecret ?? legacyAgent?.agentSecret;
    const limit = agentRec?.limit ?? legacyAgent?.L ?? 0;
    const outstanding = agentRec?.outstanding ?? legacyAgent?.B ?? 0;
    const epoch = agentRec?.epoch ?? legacyAgent?.epoch ?? 0;
    const salt = agentRec?.salt ?? legacyAgent?.salt;

    if (!agentSecret || !salt || limit <= 0) {
      set({
        flash: {
          tone: "fail",
          text: "Repayment acknowledgement refused: Agent line record missing from vault. Open a line first.",
        },
      });
      return false;
    }

    if (amount > outstanding) {
      set({
        flash: {
          tone: "fail",
          text: `Repayment refused: Amount (${amount}) exceeds outstanding balance (${outstanding}).`,
        },
      });
      return false;
    }

    const newSalt = toHex(randomBytes32());
    const receiptNonce = toHex(randomBytes32());
    const paymentRef = paymentReference ?? toHex(randomBytes32());
    const receiptExpiry = Math.floor(Date.now() / 1000) + 10_000;

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Acknowledging repayment..." } });
    try {
      set({ txLifecycle: "proving" });
      if (!isCurrentSession(revision)) { set({ txLifecycle: "failed" }); return false; }
      const res = await runtime.acknowledgeRepayment({
        limit,
        outstanding,
        epoch,
        amount,
        receiptExpiry,
        callerSk,
        agentSecret,
        salt,
        newSalt,
        receiptNonce,
        paymentRef,
      });
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: `Acknowledge rejected: ${res.error}` },
        });
        return false;
      }

      const idBytes = agentId(hexToBytes(agentSecret));
      const identityCommitment = toHex(idBytes);
      const newOutstanding = Math.max(0, outstanding - amount);
      const newEpoch = epoch + 1;
      const newCBytes = lineStateCommit(
        {
          domain: hexToBytes(operationState.ledger.contractDomain),
          identity: idBytes,
          limit: BigInt(limit),
          outstanding: BigInt(newOutstanding),
          epoch: BigInt(newEpoch),
        },
        hexToBytes(newSalt)
      );
      const newLineCommitment = toHex(newCBytes);

      const updatedAgentLine: AgentLineRecord = {
        version: 1,
        networkId: operationState.ledger.networkId,
        contractAddress: operationState.ledger.contractAddress ?? "",
        contractDomain: operationState.ledger.contractDomain,
        agentSecret,
        identityCommitment,
        lineCommitment: newLineCommitment,
        limit,
        outstanding: newOutstanding,
        feeFlat: operationState.ledger.feeFlat!,
        feeBps: operationState.ledger.feeBps!,
        epoch: newEpoch,
        salt: newSalt,
        lineGeneration: operationState.ledger.lineGeneration,
        updatedAt: Date.now(),
      };

      const repayRecord: RepaymentRecord = {
        version: 1,
        networkId: operationState.ledger.networkId,
        contractAddress: operationState.ledger.contractAddress ?? "",
        identityCommitment,
        currentLineCommitment: newLineCommitment,
        amount,
        receiptNonce,
        paymentReference: paymentRef,
        expiry: receiptExpiry,
        status: "acknowledged",
        transactionId: res.txHash ?? undefined,
        updatedAt: Date.now(),
      };

      const updatedRepayments = [...operationState.repayments, repayRecord];
      if (passphrase) {
        const prefix = privateVaultPrefix(runtime);
        await saveEncryptedJson(`${prefix}:agent-line`, updatedAgentLine, passphrase);
        await saveEncryptedJson(`${prefix}:repayments`, updatedRepayments, passphrase);
      }

      set({
        agentLineRecord: updatedAgentLine,
        agentRecord: {
          agentSecret,
          identityCommitment,
          lineCommitment: newLineCommitment,
          L: limit,
          B: newOutstanding,
          epoch: newEpoch,
          salt: newSalt,
        },
        repayments: updatedRepayments,
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: runtime.mode === "network" ? "Repayment acknowledgement confirmed. Credit capacity restored."
          : "Evaluation repayment acknowledged. Local credit capacity restored." },
      });
      await get().refreshStatus();
      return true;
    } catch (err) {
      set({
        txLifecycle: "failed",
        flash: { tone: "fail", text: `Ack failed: ${err instanceof Error ? err.message : String(err)}` },
      });
      return false;
    }
  },

  doStatus: async (status: "open" | "defaulted" | "closed") => {
    if (!requireSession()) return false;
    const revision = getVaultSessionRevision();
    const operationState = get();
    const set = (patch: Partial<ProductStoreState>) => publish(revision, patch);
    const runtime = runtimeForMutation();
    const callerSk = operationState.issuerRecord?.issuerSecret;
    if (!callerSk) {
      set({
        flash: {
          tone: "fail",
          text: "Status update refused: Issuer private key missing from vault. Unlock vault or save issuer key.",
        },
      });
      return false;
    }

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: `Setting line status to ${status}...` } });
    try {
      set({ txLifecycle: "proving" });
      if (!isCurrentSession(revision)) { set({ txLifecycle: "failed" }); return false; }
      const line = operationState.agentLineRecord;
      const legacy = operationState.agentRecord;
      const res = await runtime.setStatus(status, callerSk, status === "closed" ? { closingBook: line ? {
        limit: line.limit, outstanding: line.outstanding, epoch: line.epoch, salt: line.salt,
      } : legacy ? { limit: legacy.L, outstanding: legacy.B, epoch: legacy.epoch, salt: legacy.salt } : undefined } : undefined);
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: `Status update rejected: ${res.error}` },
        });
        return false;
      }
      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: `Line status updated to ${status}.` },
      });
      await get().refreshStatus();
      return true;
    } catch (err) {
      set({
        txLifecycle: "failed",
        flash: { tone: "fail", text: `Status update failed: ${err instanceof Error ? err.message : String(err)}` },
      });
      return false;
    }
  },

  exportQuotePackage: (quoteCommit: string): QuoteTransferPackage | null => {
    if (!requireSession()) return null;
    const q = get().merchantQuotes.find((m) => m.quoteCommitment === quoteCommit);
    if (!q) return null;
    return {
      format: "line:quote-package:v3",
      deadlineUnits: "unix-seconds",
      networkId: q.networkId,
      contractAddress: q.contractAddress,
      contractDomain: get().ledger.contractDomain,
      lineGeneration: q.lineGeneration,
      quoteCommitment: q.quoteCommitment,
      merchantPublicKey: q.merchantPublicKey,
      invoiceIdBytes: q.invoiceIdBytes,
      displayInvoiceId: q.displayInvoiceId,
      amount: q.amount,
      expiry: q.expiry,
      quoteNonce: q.quoteNonce,
      fee: q.fee,
      feePolicy: q.feePolicy,
      feeFlat: q.feeFlat,
      feeBps: q.feeBps,
      issuedAt: q.updatedAt,
    };
  },

  importQuotePackage: (pkg: unknown): boolean => {
    if (!requireSession()) return false;
    try {
      const valid = validateQuoteTransferPackage(
        pkg,
        get().ledger.networkId,
        get().ledger.contractAddress ?? undefined
      );
      const ledger = get().ledger;
      if (valid.contractDomain.replace(/^0x/, "").toLowerCase() !== ledger.contractDomain.replace(/^0x/, "").toLowerCase() ||
          valid.lineGeneration !== ledger.lineGeneration || valid.feeFlat !== ledger.feeFlat || valid.feeBps !== ledger.feeBps ||
          toHex(quoteCommit({ merchantPk: hexToBytes(valid.merchantPublicKey), invoiceId: hexToBytes(valid.invoiceIdBytes),
            amount: BigInt(valid.amount), expiry: BigInt(valid.expiry), nonce: hexToBytes(valid.quoteNonce),
            generation: BigInt(valid.lineGeneration), domain: hexToBytes(valid.contractDomain),
            feeFlat: BigInt(valid.feeFlat), feeBps: BigInt(valid.feeBps) })) !== valid.quoteCommitment.replace(/^0x/, "").toLowerCase()) {
        throw new Error("Quote terms do not match the current issuer-approved policy and commitment.");
      }
      const existing = get().merchantQuotes.find((q) => q.quoteCommitment === valid.quoteCommitment);
      if (existing) return true;
      const quoteRec: MerchantQuoteRecord = {
        version: 1,
        networkId: valid.networkId,
        contractAddress: valid.contractAddress,
        merchantPublicKey: valid.merchantPublicKey,
        invoiceIdBytes: valid.invoiceIdBytes,
        displayInvoiceId: valid.displayInvoiceId,
        amount: valid.amount,
        expiry: valid.expiry,
        quoteNonce: valid.quoteNonce,
        quoteCommitment: valid.quoteCommitment,
        lineGeneration: valid.lineGeneration,
        feePolicy: valid.feePolicy,
        feeFlat: valid.feeFlat,
        feeBps: valid.feeBps,
        fee: valid.fee,
        status: "open",
        updatedAt: valid.issuedAt,
      };
      const updated = [...get().merchantQuotes, quoteRec];
      const passphrase = getVaultSessionPassphrase();
      if (passphrase) {
        const runtime = getRuntime();
        const prefix = privateVaultPrefix(runtime);
        saveEncryptedJson(`${prefix}:quotes`, updated, passphrase).catch(() => {});
      }
      set({
        merchantQuotes: updated,
        invoices: updated.map(quoteRecordToInvoice),
        flash: { tone: "ok", text: `Imported quote package for ${quoteRec.amount} units.` },
      });
      return true;
    } catch (err) {
      set({ flash: { tone: "fail", text: `Import failed: ${err instanceof Error ? err.message : String(err)}` } });
      return false;
    }
  },

  exportDrawNotePackage: (noteCommit: string): DrawNoteTransferPackage | null => {
    if (!requireSession()) return null;
    const n = get().drawNotes.find((d) => d.noteCommitment === noteCommit);
    if (!n) return null;
    return {
      format: "line:note-package:v3",
      deadlineUnits: "unix-seconds",
      networkId: n.networkId,
      contractAddress: n.contractAddress,
      contractDomain: n.contractDomain,
      lineGeneration: n.lineGeneration,
      noteCommitment: n.noteCommitment,
      quoteCommitment: n.quoteCommitment,
      identityCommitment: n.identityCommitment,
      merchantPublicKey: n.merchantPublicKey,
      amount: n.amount,
      fee: n.fee,
      noteNonce: n.noteNonce,
      noteSalt: n.noteSalt,
      expiry: n.expiry,
      issuedAt: n.updatedAt,
    };
  },

  importDrawNotePackage: (pkg: unknown): boolean => {
    if (!requireSession()) return false;
    try {
      const valid = validateDrawNoteTransferPackage(
        pkg,
        get().ledger.networkId,
        get().ledger.contractAddress ?? undefined
      );
      const existing = get().drawNotes.find((n) => n.noteCommitment === valid.noteCommitment);
      if (existing) return true;
      const noteRec: DrawNoteRecord = {
        version: 1,
        networkId: valid.networkId,
        contractAddress: valid.contractAddress,
        noteCommitment: valid.noteCommitment,
        contractDomain: valid.contractDomain,
        lineGeneration: valid.lineGeneration,
        identityCommitment: valid.identityCommitment,
        quoteCommitment: valid.quoteCommitment,
        merchantPublicKey: valid.merchantPublicKey,
        amount: valid.amount,
        fee: valid.fee,
        noteNonce: valid.noteNonce,
        noteSalt: valid.noteSalt,
        expiry: valid.expiry,
        status: "active",
        updatedAt: valid.issuedAt,
      };
      verifiedDrawNoteRecord(noteRec);
      if (noteRec.contractDomain !== get().ledger.contractDomain) throw new Error("Note belongs to another contract instance.");
      const updated = [...get().drawNotes, noteRec];
      const passphrase = getVaultSessionPassphrase();
      if (passphrase) {
        const runtime = getRuntime();
        const prefix = privateVaultPrefix(runtime);
        saveEncryptedJson(`${prefix}:notes`, updated, passphrase).catch(() => {});
      }
      set({
        drawNotes: updated,
        notes: updated.map(drawNoteRecordToNote),
        flash: { tone: "ok", text: `Imported draw note package for ${noteRec.amount} units.` },
      });
      return true;
    } catch (err) {
      set({ flash: { tone: "fail", text: `Import failed: ${err instanceof Error ? err.message : String(err)}` } });
      return false;
    }
  },
  });
  const mutationActions = ["doFundReserve", "doWithdrawReserve", "doWithdrawFees", "doRegisterMerchant", "doDisableMerchant",
    "doOpen", "doQuote", "doDraw", "doRedeem", "doExpireNote", "doRefundAck", "doAck", "doStatus"] as const;
  for (const name of mutationActions) {
    const original = actions[name] as (...args: any[]) => Promise<boolean>;
    (actions[name] as (...args: any[]) => Promise<boolean>) = async (...args: any[]) => {
      const draw = name === "doDraw";
      if (busy) {
        set({ flash: { tone: "fail", text: draw ? "Clearance could not be proven." : "An operation is already in progress." } });
        return false;
      }
      if (!requireSession(draw)) return false;
      busy = true;
      set({ operationBusy: true });
      const runtime = getRuntime();
      const address = runtime.getContractAddress();
      const revision = getVaultSessionRevision();
      const passphrase = getVaultSessionPassphrase()!;
      const assertCurrent = () => {
        if (!isCurrentSession(revision) || getRuntime() !== runtime || runtime.getContractAddress() !== address)
          throw new Error("Vault or contract context changed during the operation.");
      };
      try {
        const ledger = await runtime.getStatus();
        assertCurrent();
        const scope = consoleJournalScope(runtime, ledger);
        const journal = createOperationJournal(scope, passphrase, { assertSession: assertCurrent });
        return await journal.withExclusive(async (lease: OperationJournalLease) => {
          const recovered = await reconcileConsole(lease, scope, runtime, ledger, assertCurrent,
            name === "doExpireNote" ? { historicalNoteCommitment: args[0] as string } : undefined);
          assertCurrent();
          if (recovered.privateState) {
            restorePrivate(recovered.privateState);
            if (recovered.confirmedId && !recovered.blocked) await lease.acknowledgeConfirmed(recovered.confirmedId);
          }
          set({ recoveryRequired: recovered.blocked });
          if (recovered.blocked) {
            set({ flash: { tone: "fail", text: draw ? "Clearance could not be proven."
              : "A previous operation has an unresolved outcome. Reconcile it before submitting another." } });
            return false;
          }
          const currentLedger = await runtime.getStatus();
          assertCurrent();
          set({ ledger: currentLedger });
          mutation = { runtime, address: address!, ledger: currentLedger, scope, lease,
            before: snapshotConsole(get(), currentLedger, address!), assertCurrent, operation: null };
          enteringAction = true;
          let pending: Promise<boolean>;
          try { pending = original(...args); } finally { enteringAction = false; }
          const ok = await pending;
          const operation = mutation.operation;
          if (operation?.status === "confirmed") {
            // The journal committed before these optional legacy mirrors. A mirror
            // failure must not turn a confirmed purchase into a fresh retry.
            if (!isCurrentSession(revision) || getRuntime() !== runtime || runtime.getContractAddress() !== address) {
              set({ recoveryRequired: true, txLifecycle: "confirmed", flash: { tone: "info",
                text: "Operation confirmed. Unlock the original contract vault to recover its encrypted state." } });
              return true;
            }
            assertCurrent();
            restorePrivate(recoveredConsole(operation, runtime, currentLedger.contractDomain));
            await lease.acknowledgeConfirmed(operation.id);
            assertCurrent();
            set({ recoveryRequired: false, txLifecycle: "confirmed", lastTxHash: operation.receipt?.txHash ?? operation.transactionId,
              flash: ok ? get().flash : { tone: "ok", text: "Operation confirmed. Private state restored from its encrypted journal." } });
            return true;
          }
          const record = await lease.read();
          set({ recoveryRequired: record.operations.some(op => ["prepared", "submitting", "uncertain"].includes(op.status) ||
            (op.status === "confirmed" && !op.acknowledged)) });
          return ok;
        });
      } catch (error) {
        set({ recoveryRequired: mutation?.operation !== null && mutation?.operation !== undefined,
          txLifecycle: "failed", flash: { tone: "fail", text: draw ? "Clearance could not be proven."
            : `Operation paused: ${error instanceof Error ? error.message : "Recovery unavailable"}` } });
        return false;
      } finally {
        mutation = null;
        busy = false;
        enteringAction = false;
        set({ operationBusy: false });
      }
    };
  }
  return actions;
});

// Includes direct session locks and automatic timeout, not only the UI action.
onVaultSessionLock(() => useAppStore.setState({
  ...emptyPrivateState(),
  flash: { tone: "info", text: "Encrypted vault locked. Ephemeral credentials wiped from memory." },
}));

/**
 * Backward compatibility alias for components expecting useLine.
 * Pure production store with zero fixture keys or simulator code.
 */
export const useLine = useAppStore;
