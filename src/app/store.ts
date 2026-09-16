/**
 * Production Line Product Store
 *
 * All state transitions and operations are asynchronous and route strictly through LineRuntime.
 * Private credentials, line commitments, and witness secrets are encrypted at rest using WebCrypto AES-GCM.
 * Zero fixture keys or demo snapshot secrets are imported.
 */
import { create } from "zustand";
import {
  getRuntime,
  type LineRuntime,
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
import type { DrawNote, MerchantInvoice } from "../lib/line/types.ts";
import { randomBytes32, toHex } from "../lib/line/encoding.ts";

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

  // In-memory private operational states (cleared on vault lock / session timeout)
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

  // Asynchronous mutations via LineRuntime
  doFundReserve: (amount?: number) => Promise<boolean>;
  doWithdrawReserve: (amount?: number) => Promise<boolean>;
  doRegisterMerchant: (merchantPk?: string) => Promise<boolean>;
  doOpen: (limit?: number) => Promise<boolean>;
  doQuote: (amount: number, invoiceId?: string, merchant?: "A" | "B") => Promise<boolean>;
  doDraw: (quoteCommit: string) => Promise<boolean>;
  doRedeem: (noteCommit: string, merchant?: "A" | "B") => Promise<boolean>;
  doExpireNote: (noteCommit: string) => Promise<boolean>;
  doAck: (amount?: number) => Promise<boolean>;
  doStatus: (status: "open" | "defaulted" | "closed") => Promise<boolean>;
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

      const agentRec = await loadEncryptedJson<PrivateAgentRecord>(`${prefix}:agent`, passphrase);
      const issuerRec = await loadEncryptedJson<PrivateIssuerRecord>(`${prefix}:issuer`, passphrase);
      const merchantRec = await loadEncryptedJson<PrivateMerchantRecord>(`${prefix}:merchant`, passphrase);
      const savedInvoices = await loadEncryptedJson<MerchantInvoice[]>(`${prefix}:invoices`, passphrase);
      const savedNotes = await loadEncryptedJson<DrawNote[]>(`${prefix}:notes`, passphrase);

      set({
        isVaultUnlocked: true,
        agentRecord: agentRec ?? null,
        issuerRecord: issuerRec ?? null,
        merchantRecord: merchantRec ?? null,
        invoices: savedInvoices ?? [],
        notes: savedNotes ?? [],
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
      agentRecord: null,
      issuerRecord: null,
      merchantRecord: null,
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

  doFundReserve: async (amount = 500) => {
    const runtime = getRuntime();
    const callerSk = get().issuerRecord?.issuerSecret ?? "";

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
    const callerSk = get().issuerRecord?.issuerSecret ?? "";

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
        flash: { tone: "ok", text: `Accounting capacity reduced: -${amt}. Tx: ${res.txHash?.slice(0, 14)}...` },
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
    const pk = merchantPk ?? get().merchantRecord?.merchantPk ?? toHex(randomBytes32());
    const callerSk = get().issuerRecord?.issuerSecret ?? "";

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

  doOpen: async (limit = 150) => {
    const runtime = getRuntime();
    const callerSk = get().issuerRecord?.issuerSecret ?? "";
    const agentSecret = get().agentRecord?.agentSecret ?? toHex(randomBytes32());
    const salt = toHex(randomBytes32());

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Requesting wallet approval..." } });
    try {
      set({ txLifecycle: "proving" });
      const res = await runtime.openLine({
        limit,
        expiry: 10_000,
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
      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: `Credit line opened. Confidential commitment C0 committed in ZK.` },
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
    const invId = invoiceId ?? `inv-${chosenMerchant}-${amount}`;
    const merchantSk = get().merchantRecord?.merchantSecret ?? "";
    const nonce = toHex(randomBytes32());

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Posting quote on Midnight network..." } });
    try {
      set({ txLifecycle: "proving" });
      const res = await runtime.postQuote({
        amount,
        expiry: 10_000,
        merchantSk,
        invoiceId: invId,
        nonce,
      });
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: `Quote rejected: ${res.error}` },
        });
        return false;
      }
      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
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

  doDraw: async (quoteCommit: string) => {
    const runtime = getRuntime();
    const agentRec = get().agentRecord;
    const callerSk = agentRec?.agentSecret ?? "";
    const newSalt = toHex(randomBytes32());
    const noteNonce = toHex(randomBytes32());
    const noteSalt = toHex(randomBytes32());

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Proving confidential credit clearance in ZK..." } });
    try {
      set({ txLifecycle: "proving" });
      const res = await runtime.draw({
        quoteCommit,
        limit: agentRec?.L ?? 150,
        outstanding: agentRec?.B ?? 0,
        epoch: agentRec?.epoch ?? 0,
        amount: 40,
        expiry: 10_000,
        callerSk,
        agentSecret: callerSk,
        salt: agentRec?.salt ?? toHex(randomBytes32()),
        newSalt,
        invoiceId: "inv",
        quoteNonce: toHex(randomBytes32()),
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
      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: `Draw cleared. Private merchant-bound settlement note issued.` },
      });
      await get().refreshStatus();
      return true;
    } catch (err) {
      set({
        txLifecycle: "failed",
        flash: { tone: "fail", text: "Clearance could not be proven." },
      });
      return false;
    }
  },

  doRedeem: async (noteCommit: string, merchant?: "A" | "B") => {
    const runtime = getRuntime();
    const chosen = merchant ?? get().activeMerchant;
    const merchantSk = get().merchantRecord?.merchantSecret ?? "";

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Redeeming settlement note against reserve..." } });
    try {
      set({ txLifecycle: "proving" });
      const res = await runtime.redeemDraw({
        noteCommit,
        amount: 40,
        expiry: 10_000,
        merchantSk,
        noteIdentity: toHex(randomBytes32()),
        noteQuoteCommit: toHex(randomBytes32()),
        noteNonce: toHex(randomBytes32()),
        noteSalt: toHex(randomBytes32()),
      });
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: `Redemption rejected: ${res.error}` },
        });
        return false;
      }
      set({
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
    const callerSk = get().issuerRecord?.issuerSecret ?? "";

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
      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
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

  doAck: async (amount = 40) => {
    const runtime = getRuntime();
    const callerSk = get().issuerRecord?.issuerSecret ?? "";
    const agentRec = get().agentRecord;

    set({ txLifecycle: "wallet-approval", flash: { tone: "info", text: "Acknowledging repayment..." } });
    try {
      set({ txLifecycle: "proving" });
      const res = await runtime.acknowledgeRepayment({
        limit: agentRec?.L ?? 150,
        outstanding: agentRec?.B ?? 40,
        epoch: agentRec?.epoch ?? 0,
        amount,
        receiptExpiry: 10_000,
        callerSk,
        agentSecret: agentRec?.agentSecret ?? "",
        salt: agentRec?.salt ?? toHex(randomBytes32()),
        newSalt: toHex(randomBytes32()),
        receiptNonce: toHex(randomBytes32()),
        paymentRef: toHex(randomBytes32()),
      });
      if (!res.ok) {
        set({
          txLifecycle: "failed",
          flash: { tone: "fail", text: `Acknowledge rejected: ${res.error}` },
        });
        return false;
      }
      set({
        txLifecycle: "confirmed",
        lastTxHash: res.txHash ?? null,
        lastBlockHeight: res.blockHeight ?? null,
        flash: { tone: "ok", text: `Repayment acknowledged. Credit capacity restored in ZK.` },
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
    const callerSk = get().issuerRecord?.issuerSecret ?? "";

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
}));

/**
 * Backward compatibility alias for components expecting useLine.
 * Pure production store with zero fixture keys or simulator code.
 */
export const useLine = useAppStore;
