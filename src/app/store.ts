/**
 * Production Line Product Store
 *
 * All state transitions and operations are asynchronous and route strictly through LineRuntime.
 * Private credentials, line commitments, and witness secrets are encrypted at rest using WebCrypto AES-GCM.
 * Zero fixture keys, fabricated nonces, or hardcoded amounts are used.
 */
import { create } from "zustand";
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
} from "../lib/security/vault.ts";
import type {
  DrawNote,
  MerchantInvoice,
  AgentLineRecord,
  MerchantQuoteRecord,
  DrawNoteRecord,
  RepaymentRecord,
  QuoteTransferPackage,
  DrawNoteTransferPackage,
} from "../lib/line/types.ts";
import {
  validateQuoteTransferPackage,
  validateDrawNoteTransferPackage,
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
      noteNonce: n.noteNonce,
      expiry: n.expiry,
    },
    salt: n.noteSalt,
  };
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
  activeMerchant: "A" | "B";

  // In-memory typed private operational states (cleared on vault lock / session timeout)
  agentLineRecord: AgentLineRecord | null;
  merchantQuotes: MerchantQuoteRecord[];
  drawNotes: DrawNoteRecord[];
  repayments: RepaymentRecord[];

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
  saveAgentRecord: (rec: PrivateAgentRecord) => Promise<void>;
  saveIssuerRecord: (rec: PrivateIssuerRecord) => Promise<void>;
  saveMerchantRecord: (rec: PrivateMerchantRecord) => Promise<void>;
  generateIdentity: (role: "issuer" | "agent" | "merchant") => Promise<string>;
  importIdentity: (role: "issuer" | "agent" | "merchant", secretHex: string) => Promise<void>;

  // Asynchronous mutations via LineRuntime
  doFundReserve: (amount?: number) => Promise<boolean>;
  doWithdrawReserve: (amount?: number) => Promise<boolean>;
  doRegisterMerchant: (merchantPk?: string) => Promise<boolean>;
  doOpen: (limit?: number) => Promise<boolean>;
  doQuote: (amount: number, invoiceId?: string, merchant?: "A" | "B") => Promise<boolean>;
  doDraw: (quoteCommitOrPackage: string | QuoteTransferPackage) => Promise<boolean>;
  doRedeem: (noteCommitOrPackage: string | DrawNoteTransferPackage, merchant?: "A" | "B") => Promise<boolean>;
  doExpireNote: (noteCommit: string) => Promise<boolean>;
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
  withdrawableReserve: 0,
  quoteCount: 0,
  noteCount: 0,
  nullifierCount: 0,
  runtime: "network",
};

export const useAppStore = create<ProductStoreState>((set, get) => ({
  ledger: initialPublicLedger,
  runtimeMode: getRuntime().mode,
  isWalletConnected: getRuntime().isConnected(),
  txLifecycle: "idle",
  lastTxHash: null,
  lastBlockHeight: null,
  flash: null,
  dual: null,

  isVaultUnlocked: isVaultSessionUnlocked(),
  activeMerchant: "A",

  agentLineRecord: null,
  merchantQuotes: [],
  drawNotes: [],
  repayments: [],

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
    if (!passphrase || passphrase.length < 8) {
      set({ flash: { tone: "fail", text: "Passphrase must be at least 8 characters." } });
      return false;
    }
    try {
      unlockVaultSession(passphrase, 15);
      const runtime = getRuntime();
      const contractAddr = runtime.getContractAddress() ?? "unconfigured";
      const networkId = runtime.networkId;
      const prefix = `line:vault:${networkId}:${contractAddr}`;

      const agentLineRec = await loadEncryptedJson<AgentLineRecord>(`${prefix}:agent-line`, passphrase);
      const agentRec = await loadEncryptedJson<PrivateAgentRecord>(`${prefix}:agent`, passphrase);
      const issuerRec = await loadEncryptedJson<PrivateIssuerRecord>(`${prefix}:issuer`, passphrase);
      const merchantRec = await loadEncryptedJson<PrivateMerchantRecord>(`${prefix}:merchant`, passphrase);
      const quotes = (await loadEncryptedJson<MerchantQuoteRecord[]>(`${prefix}:quotes`, passphrase)) ?? [];
      const notes = (await loadEncryptedJson<DrawNoteRecord[]>(`${prefix}:notes`, passphrase)) ?? [];
      const repayments = (await loadEncryptedJson<RepaymentRecord[]>(`${prefix}:repayments`, passphrase)) ?? [];

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

      set({
        isVaultUnlocked: true,
        agentLineRecord: agentLineRec ?? null,
        agentRecord: activeAgentRec,
        issuerRecord: issuerRec ?? null,
        merchantRecord: merchantRec ?? null,
        merchantQuotes: quotes,
        drawNotes: notes,
        repayments,
        invoices: uiInvoices,
        notes: uiNotes,
        flash: { tone: "ok", text: "Encrypted vault unlocked. Ephemeral session active." },
      });
      return true;
    } catch (err) {
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
    set({
      isVaultUnlocked: false,
      agentLineRecord: null,
      agentRecord: null,
      issuerRecord: null,
      merchantRecord: null,
      merchantQuotes: [],
      drawNotes: [],
      repayments: [],
      invoices: [],
      notes: [],
      flash: { tone: "info", text: "Encrypted vault locked. Ephemeral credentials wiped from memory." },
    });
  },

  saveAgentRecord: async (rec) => {
    const passphrase = getVaultSessionPassphrase();
    if (!passphrase) throw new Error("Vault is locked.");
    const runtime = getRuntime();
    const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress() ?? "unconfigured"}`;
    await saveEncryptedJson(`${prefix}:agent`, rec, passphrase);
    set({ agentRecord: rec });
  },

  saveIssuerRecord: async (rec) => {
    const passphrase = getVaultSessionPassphrase();
    if (!passphrase) throw new Error("Vault is locked.");
    const runtime = getRuntime();
    const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress() ?? "unconfigured"}`;
    await saveEncryptedJson(`${prefix}:issuer`, rec, passphrase);
    set({ issuerRecord: rec });
  },

  saveMerchantRecord: async (rec) => {
    const passphrase = getVaultSessionPassphrase();
    if (!passphrase) throw new Error("Vault is locked.");
    const runtime = getRuntime();
    const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress() ?? "unconfigured"}`;
    await saveEncryptedJson(`${prefix}:merchant`, rec, passphrase);
    set({ merchantRecord: rec });
  },

  generateIdentity: async (role: "issuer" | "agent" | "merchant"): Promise<string> => {
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
    return secret;
  },

  importIdentity: async (role: "issuer" | "agent" | "merchant", secretHex: string): Promise<void> => {
    const clean = secretHex.trim().replace(/^0x/, "");
    if (clean.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(clean)) {
      throw new Error("Expected 32-byte hexadecimal secret key (64 hex characters).");
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
  },

  doFundReserve: async (amount?: number) => {
    const runtime = getRuntime();
    const callerSk = get().issuerRecord?.issuerSecret;
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
    const runtime = getRuntime();
    const total = get().ledger.totalReserve ?? 0;
    const locked = (get().ledger.encumberedReserve ?? 0) + (get().ledger.redeemedReserve ?? 0);
    const withdrawable = Math.max(0, total - locked);
    const amt = amount ?? withdrawable;
    const callerSk = get().issuerRecord?.issuerSecret;
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

  doRegisterMerchant: async (merchantPk?: string) => {
    const runtime = getRuntime();
    const callerSk = get().issuerRecord?.issuerSecret;
    if (!callerSk) {
      set({
        flash: {
          tone: "fail",
          text: "Merchant registration refused: Issuer private key record missing from vault.",
        },
      });
      return false;
    }

    const pk = merchantPk ?? get().merchantRecord?.merchantPk;
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

  doOpen: async (limit?: number) => {
    const runtime = getRuntime();
    const callerSk = get().issuerRecord?.issuerSecret;
    if (!callerSk) {
      set({
        flash: {
          tone: "fail",
          text: "Open line refused: Issuer secret missing from vault. Unlock vault or save issuer key.",
        },
      });
      return false;
    }

    if (!limit || limit <= 0) {
      set({
        flash: { tone: "fail", text: "Open line refused: Provide a positive credit limit." },
      });
      return false;
    }

    const agentSecret = get().agentLineRecord?.agentSecret ?? get().agentRecord?.agentSecret;
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
    const domainBytes = hexToBytes(get().ledger.contractDomain);
    const c0Bytes = lineStateCommit(
      {
        domain: domainBytes,
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
      const res = await runtime.openLine({
        limit,
        expiry: (get().ledger.actionClock || 0) + 10_000,
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
        networkId: get().ledger.networkId,
        contractAddress: get().ledger.contractAddress ?? "",
        contractDomain: get().ledger.contractDomain,
        agentSecret,
        identityCommitment,
        lineCommitment,
        limit,
        outstanding: 0,
        epoch: 0,
        salt,
        lineGeneration: get().ledger.lineGeneration,
        updatedAt: Date.now(),
      };

      const passphrase = getVaultSessionPassphrase();
      if (passphrase) {
        const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress() ?? "unconfigured"}`;
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
        flash: { tone: "ok", text: "Credit line opened. Confidential commitment C0 committed in ZK." },
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
    const runtime = getRuntime();
    const chosenMerchant = merchant ?? get().activeMerchant;
    const merchantSk = get().merchantRecord?.merchantSecret;
    if (!merchantSk) {
      set({
        flash: {
          tone: "fail",
          text: "Quote posting refused: Merchant credentials missing from vault. Unlock vault or save merchant key.",
        },
      });
      return false;
    }

    if (amount <= 0) {
      set({ flash: { tone: "fail", text: "Quote posting refused: Amount must be greater than zero." } });
      return false;
    }

    const displayInvoiceId = invoiceId ?? `inv-${chosenMerchant}-${amount}`;
    const invBytes = canonicalInvoiceIdBytes(displayInvoiceId);
    const quoteNonce = toHex(randomBytes32());
    const expiry = (get().ledger.actionClock || 0) + 10_000;
    const merchantPkBytes = hexToBytes(
      get().merchantRecord?.merchantPk || toHex(merchantPublicKey(hexToBytes(merchantSk)))
    );
    const domainBytes = hexToBytes(get().ledger.contractDomain);
    const qBytes = quoteCommit({
      merchantPk: merchantPkBytes,
      invoiceId: invBytes,
      amount: BigInt(amount),
      expiry: BigInt(expiry),
      nonce: hexToBytes(quoteNonce),
      generation: BigInt(get().ledger.lineGeneration),
      domain: domainBytes,
    });
    const quoteCommitment = toHex(qBytes);

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Posting quote on Midnight network..." } });
    try {
      set({ txLifecycle: "proving" });
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
        networkId: get().ledger.networkId,
        contractAddress: get().ledger.contractAddress ?? "",
        merchantPublicKey: toHex(merchantPkBytes),
        invoiceIdBytes: toHex(invBytes),
        displayInvoiceId,
        amount,
        expiry,
        quoteNonce,
        quoteCommitment,
        lineGeneration: get().ledger.lineGeneration,
        status: "open",
        transactionId: res.txHash ?? undefined,
        updatedAt: Date.now(),
      };

      const updatedQuotes = [...get().merchantQuotes, newQuote];
      const passphrase = getVaultSessionPassphrase();
      if (passphrase) {
        const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress() ?? "unconfigured"}`;
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
    const runtime = getRuntime();
    let quote: MerchantQuoteRecord | null = null;

    if (typeof quoteCommitOrPackage === "string") {
      quote = get().merchantQuotes.find((q) => q.quoteCommitment === quoteCommitOrPackage) ?? null;
      if (!quote) {
        const inv = get().invoices.find((i) => i.Q === quoteCommitOrPackage);
        if (inv) {
          if (!inv.preimage) {
            set({ flash: { tone: "fail", text: "Draw refused: Quote preimage missing. Import full quote package." } });
            return false;
          }
          quote = {
            version: 1,
            networkId: get().ledger.networkId,
            contractAddress: get().ledger.contractAddress ?? "",
            merchantPublicKey: inv.preimage.merchantCommitment,
            invoiceIdBytes: toHex(canonicalInvoiceIdBytes(inv.invoiceId)),
            displayInvoiceId: inv.invoiceId,
            amount: inv.amount,
            expiry: inv.preimage.expiry,
            quoteNonce: inv.preimage.nonce,
            quoteCommitment: inv.Q,
            lineGeneration: inv.preimage.generation,
            status: inv.used ? "consumed" : "open",
            updatedAt: Date.now(),
          };
        }
      }
    } else {
      const pkg = validateQuoteTransferPackage(
        quoteCommitOrPackage,
        get().ledger.networkId,
        get().ledger.contractAddress ?? undefined
      );
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
        status: "open",
        updatedAt: Date.now(),
      };
    }

    if (!quote) {
      set({ flash: { tone: "fail", text: "Draw refused: Quote record not found in vault." } });
      return false;
    }

    const agentRec = get().agentLineRecord;
    const legacyAgent = get().agentRecord;
    const agentSecret = agentRec?.agentSecret ?? legacyAgent?.agentSecret;
    const limit = agentRec?.limit ?? legacyAgent?.L ?? 0;
    const outstanding = agentRec?.outstanding ?? legacyAgent?.B ?? 0;
    const epoch = agentRec?.epoch ?? legacyAgent?.epoch ?? 0;
    const salt = agentRec?.salt ?? legacyAgent?.salt;

    if (!agentSecret || !salt || limit <= 0) {
      set({ flash: { tone: "fail", text: "Draw refused: Agent credit line not opened or record missing." } });
      return false;
    }

    if (outstanding + quote.amount > limit) {
      set({ flash: { tone: "fail", text: "Clearance could not be proven." } });
      return false;
    }

    const newSalt = toHex(randomBytes32());
    const noteNonce = toHex(randomBytes32());
    const noteSalt = toHex(randomBytes32());

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Proving confidential credit clearance in ZK..." } });
    try {
      set({ txLifecycle: "proving" });
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
      });
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: res.error ?? "Clearance could not be proven." },
        });
        return false;
      }

      const idBytes = agentId(hexToBytes(agentSecret));
      const identityCommitment = toHex(idBytes);
      const newOutstanding = outstanding + quote.amount;
      const newEpoch = epoch + 1;
      const domainBytes = hexToBytes(get().ledger.contractDomain);
      const newCBytes = lineStateCommit(
        {
          domain: domainBytes,
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
        networkId: get().ledger.networkId,
        contractAddress: get().ledger.contractAddress ?? "",
        contractDomain: get().ledger.contractDomain,
        agentSecret,
        identityCommitment,
        lineCommitment: newLineCommitment,
        limit,
        outstanding: newOutstanding,
        epoch: newEpoch,
        salt: newSalt,
        lineGeneration: get().ledger.lineGeneration,
        updatedAt: Date.now(),
      };

      const dPreimage = {
        domain: domainBytes,
        lineGeneration: BigInt(get().ledger.lineGeneration),
        identity: idBytes,
        quoteCommit: hexToBytes(quote.quoteCommitment),
        merchantPk: hexToBytes(quote.merchantPublicKey),
        amount: BigInt(quote.amount),
        noteNonce: hexToBytes(noteNonce),
        expiry: BigInt(quote.expiry),
      };
      const dBytes = drawNoteCommit(dPreimage, hexToBytes(noteSalt));
      const noteCommitment = toHex(dBytes);

      const newDrawNote: DrawNoteRecord = {
        version: 1,
        networkId: get().ledger.networkId,
        contractAddress: get().ledger.contractAddress ?? "",
        noteCommitment,
        contractDomain: get().ledger.contractDomain,
        lineGeneration: get().ledger.lineGeneration,
        identityCommitment,
        quoteCommitment: quote.quoteCommitment,
        merchantPublicKey: quote.merchantPublicKey,
        amount: quote.amount,
        noteNonce,
        noteSalt,
        expiry: quote.expiry,
        status: "active",
        drawTransactionId: res.txHash ?? undefined,
        updatedAt: Date.now(),
      };

      const updatedNotes = [...get().drawNotes, newDrawNote];
      const updatedQuotes = get().merchantQuotes.map((q) =>
        q.quoteCommitment === quote.quoteCommitment ? { ...q, status: "consumed" as const } : q
      );

      const passphrase = getVaultSessionPassphrase();
      if (passphrase) {
        const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress() ?? "unconfigured"}`;
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
    const runtime = getRuntime();
    const chosen = merchant ?? get().activeMerchant;
    const merchantSk = get().merchantRecord?.merchantSecret;
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
      note = get().drawNotes.find((n) => n.noteCommitment === noteCommitOrPackage) ?? null;
      if (!note) {
        const uiN = get().notes.find((n) => n.D === noteCommitOrPackage);
        if (uiN) {
          if (!uiN.salt) {
            set({ flash: { tone: "fail", text: "Redemption refused: Note opening salt missing. Import full draw note package." } });
            return false;
          }
          note = {
            version: 1,
            networkId: get().ledger.networkId,
            contractAddress: get().ledger.contractAddress ?? "",
            noteCommitment: uiN.D,
            contractDomain: uiN.preimage.domain,
            lineGeneration: uiN.preimage.lineGeneration,
            identityCommitment: uiN.preimage.identity,
            quoteCommitment: uiN.preimage.quoteCommit,
            merchantPublicKey: uiN.preimage.merchantPk,
            amount: uiN.preimage.amount,
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
        get().ledger.networkId,
        get().ledger.contractAddress ?? undefined
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

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Redeeming settlement note against reserve..." } });
    try {
      set({ txLifecycle: "proving" });
      const res = await runtime.redeemDraw({
        noteCommit: note.noteCommitment,
        amount: note.amount,
        expiry: note.expiry,
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

      const updatedNotes = get().drawNotes.map((n) =>
        n.noteCommitment === note.noteCommitment
          ? { ...n, status: "redeemed" as const, redemptionTransactionId: res.txHash ?? undefined }
          : n
      );

      const passphrase = getVaultSessionPassphrase();
      if (passphrase) {
        const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress() ?? "unconfigured"}`;
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
    const runtime = getRuntime();
    const callerSk = get().issuerRecord?.issuerSecret;
    if (!callerSk) {
      set({
        flash: {
          tone: "fail",
          text: "Note expiry refused: Issuer private key missing from vault. Unlock vault or save issuer key.",
        },
      });
      return false;
    }

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Submitting note expiry..." } });
    try {
      set({ txLifecycle: "proving" });
      const res = await runtime.cancelOrExpireNote(noteCommit, callerSk);
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: `Expire rejected: ${res.error}` },
        });
        return false;
      }

      const updatedNotes = get().drawNotes.map((n) =>
        n.noteCommitment === noteCommit ? { ...n, status: "expired" as const } : n
      );
      const passphrase = getVaultSessionPassphrase();
      if (passphrase) {
        const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress() ?? "unconfigured"}`;
        await saveEncryptedJson(`${prefix}:notes`, updatedNotes, passphrase);
      }

      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        drawNotes: updatedNotes,
        flash: { tone: "ok", text: "Note expired." },
      });
      await get().refreshStatus();
      return true;
    } catch (err) {
      set({
        txLifecycle: "failed",
        flash: { tone: "fail", text: `Expire failed: ${err instanceof Error ? err.message : String(err)}` },
      });
      return false;
    }
  },

  doAck: async (amount?: number, paymentReference?: string) => {
    const runtime = getRuntime();
    const callerSk = get().issuerRecord?.issuerSecret;
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

    const agentRec = get().agentLineRecord;
    const legacyAgent = get().agentRecord;
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
    const receiptExpiry = (get().ledger.actionClock || 0) + 10_000;

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Acknowledging repayment..." } });
    try {
      set({ txLifecycle: "proving" });
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
      const domainBytes = hexToBytes(get().ledger.contractDomain);
      const newCBytes = lineStateCommit(
        {
          domain: domainBytes,
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
        networkId: get().ledger.networkId,
        contractAddress: get().ledger.contractAddress ?? "",
        contractDomain: get().ledger.contractDomain,
        agentSecret,
        identityCommitment,
        lineCommitment: newLineCommitment,
        limit,
        outstanding: newOutstanding,
        epoch: newEpoch,
        salt: newSalt,
        lineGeneration: get().ledger.lineGeneration,
        updatedAt: Date.now(),
      };

      const repayRecord: RepaymentRecord = {
        version: 1,
        networkId: get().ledger.networkId,
        contractAddress: get().ledger.contractAddress ?? "",
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

      const updatedRepayments = [...get().repayments, repayRecord];
      const passphrase = getVaultSessionPassphrase();
      if (passphrase) {
        const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress() ?? "unconfigured"}`;
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
        flash: { tone: "ok", text: "Repayment acknowledged. Credit capacity restored in ZK." },
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
    const runtime = getRuntime();
    const callerSk = get().issuerRecord?.issuerSecret;
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
      const res = await runtime.setStatus(status, callerSk);
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
    const q = get().merchantQuotes.find((m) => m.quoteCommitment === quoteCommit);
    if (!q) return null;
    return {
      format: "line:quote-package:v1",
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
      issuedAt: q.updatedAt,
    };
  },

  importQuotePackage: (pkg: unknown): boolean => {
    try {
      const valid = validateQuoteTransferPackage(
        pkg,
        get().ledger.networkId,
        get().ledger.contractAddress ?? undefined
      );
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
        status: "open",
        updatedAt: valid.issuedAt,
      };
      const updated = [...get().merchantQuotes, quoteRec];
      const passphrase = getVaultSessionPassphrase();
      if (passphrase) {
        const runtime = getRuntime();
        const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress() ?? "unconfigured"}`;
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
    const n = get().drawNotes.find((d) => d.noteCommitment === noteCommit);
    if (!n) return null;
    return {
      format: "line:note-package:v1",
      networkId: n.networkId,
      contractAddress: n.contractAddress,
      contractDomain: n.contractDomain,
      lineGeneration: n.lineGeneration,
      noteCommitment: n.noteCommitment,
      quoteCommitment: n.quoteCommitment,
      identityCommitment: n.identityCommitment,
      merchantPublicKey: n.merchantPublicKey,
      amount: n.amount,
      noteNonce: n.noteNonce,
      noteSalt: n.noteSalt,
      expiry: n.expiry,
      issuedAt: n.updatedAt,
    };
  },

  importDrawNotePackage: (pkg: unknown): boolean => {
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
        noteNonce: valid.noteNonce,
        noteSalt: valid.noteSalt,
        expiry: valid.expiry,
        status: "active",
        updatedAt: valid.issuedAt,
      };
      const updated = [...get().drawNotes, noteRec];
      const passphrase = getVaultSessionPassphrase();
      if (passphrase) {
        const runtime = getRuntime();
        const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress() ?? "unconfigured"}`;
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
}));

/**
 * Backward compatibility alias for components expecting useLine.
 * Pure production store with zero fixture keys or simulator code.
 */
export const useLine = useAppStore;
