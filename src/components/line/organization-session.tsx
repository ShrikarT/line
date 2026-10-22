import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getConnectedWallet, subscribeWallet } from "@/lib/runtime/wallet";
import type { OrganizationAccount, OrganizationPending, OrganizationSnapshot } from "@/lib/organization/account";
import type { OrganizationNetwork } from "@/lib/organization/network";
import { lockVaultSession, onVaultSessionLock } from "@/lib/security/vault";
import { sanitizeServiceError } from "@/lib/runtime/endpoints";
import { forgetOrganizationTabSession, readOrganizationTabSession, type OrganizationTabSession } from "@/lib/organization/tab-session";

type Session = { account: OrganizationAccount | null; network: OrganizationNetwork | null; snapshot: OrganizationSnapshot | null; pending: OrganizationPending | null; recoveries: ReturnType<OrganizationAccount["recoveryHistory"]>; busy: boolean; resumeAvailable: boolean; needsReload: boolean; progress: string; error: string; unlock: (password: string) => Promise<void>; retryConnection: () => Promise<void>; backup: () => Promise<string | null>; lock: () => void; run: (action: (network: OrganizationNetwork, account: OrganizationAccount) => Promise<unknown>, completedMessage?: string) => Promise<void> };
const CODE_LOAD_MESSAGE = "Line could not load the workspace code. Check your connection, then refresh to load the current application. Your encrypted records remain saved.";
class OrganizationCodeLoadError extends Error { constructor() { super(CODE_LOAD_MESSAGE); } }
async function organizationModules() {
  try { return await Promise.all([import("@/lib/organization/account"), import("@/lib/organization/network")]); }
  catch { throw new OrganizationCodeLoadError(); }
}
const OrganizationContext = createContext<Session | null>(null);
export function useOrganization() { const session = useContext(OrganizationContext); if (!session) throw new Error("OrganizationSessionProvider is required."); return session; }
export function OrganizationSessionProvider({ children }: { children: ReactNode }) {
  const wallet = useSyncExternalStore(subscribeWallet, getConnectedWallet, () => null);
  const [account, setAccount] = useState<OrganizationAccount | null>(null), [network, setNetwork] = useState<OrganizationNetwork | null>(null);
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null), [pending, setPending] = useState<OrganizationPending | null>(null);
  const [recoveries, setRecoveries] = useState<Session["recoveries"]>([]);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [error, setError] = useState("");
  const [resumeAvailable, setResumeAvailable] = useState(false), [restoring, setRestoring] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const working = useRef(false), currentWallet = useRef(wallet); currentWallet.current = wallet;
  const restoreGeneration = useRef(0);
  useEffect(() => {
    const clear = () => { setAccount(null); setNetwork(null); setSnapshot(null); setPending(null); setRecoveries([]); setResumeAvailable(false); setProgress(""); setError(""); };
    clear(); return onVaultSessionLock(clear);
  }, [wallet]);
  useEffect(() => {
    const attempt = ++restoreGeneration.current;
    if (wallet) {
      setRestoring(true);
      void readOrganizationTabSession().then(saved => {
        if (restoreGeneration.current !== attempt || currentWallet.current !== wallet) return;
        setResumeAvailable(!!saved);
        if (saved) return unlock(saved.passphrase, saved);
      }).finally(() => { if (restoreGeneration.current === attempt) setRestoring(false); });
    } else setRestoring(false);
    return () => { restoreGeneration.current++; };
  }, [wallet]);
  function reportFailure(failure: unknown, fallback: string) {
    const codeFailure = failure instanceof OrganizationCodeLoadError || failure instanceof Error && /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(failure.message);
    setProgress("");
    if (codeFailure) { setNeedsReload(true); setError(CODE_LOAD_MESSAGE); }
    else setError(sanitizeServiceError(failure instanceof Error ? failure.message : fallback));
  }
  async function unlock(password: string, restored?: OrganizationTabSession) {
    if (working.current || !wallet || needsReload) return;
    working.current = true; setBusy(true); setError(""); setProgress("Opening your encrypted organization vault");
    let opened: OrganizationAccount | null = null;
    try {
      const [{ OrganizationAccount }, { OrganizationNetwork }] = await organizationModules();
      if (getConnectedWallet() !== wallet) return;
      opened = await OrganizationAccount.unlock(wallet, password, restored);
      if (currentWallet.current !== wallet) return;
      setAccount(opened); setSnapshot(opened.snapshot()); setPending(opened.pending()); setRecoveries(opened.recoveryHistory());
      const client = await OrganizationNetwork.connect(opened, message => { if (currentWallet.current === wallet) setProgress(message); });
      opened.assertSession(); setNetwork(client); setProgress("Your wallet and organization contract release are ready");
    } catch (failure) {
      // A failed live wallet read is not a vault logout. Keep a valid memory
      // ticket retryable, without bypassing the checks or renewing its deadline.
      const retained = restored && !opened ? await readOrganizationTabSession() : null;
      if (currentWallet.current === wallet) {
        if (restored && !opened) setResumeAvailable(!!retained);
        reportFailure(failure, "Could not open the organization vault.");
      }
    }
    finally { working.current = false; setBusy(false); }
  }
  async function retryConnection() {
    if (working.current || !wallet || needsReload) return;
    if (!account) {
      const attempt = restoreGeneration.current;
      setRestoring(true);
      try {
        const saved = await readOrganizationTabSession();
        if (restoreGeneration.current !== attempt || currentWallet.current !== wallet) return;
        setResumeAvailable(!!saved);
        if (saved) await unlock(saved.passphrase, saved);
      } finally { if (restoreGeneration.current === attempt) setRestoring(false); }
      return;
    }
    working.current = true; setBusy(true); setError(""); setProgress("Checking your wallet and organization connection");
    try {
      account.assertSession();
      const [, { OrganizationNetwork }] = await organizationModules();
      const client = await OrganizationNetwork.connect(account);
      account.assertSession(); setNetwork(client); setProgress("Your wallet and organization contract release are ready");
    } catch (failure) { if (currentWallet.current === wallet) reportFailure(failure, "Could not connect the organization."); }
    finally { working.current = false; setBusy(false); }
  }
  async function backup(): Promise<string | null> {
    if (working.current || !account) return null;
    working.current = true; setBusy(true); setError(""); setProgress("Preparing your encrypted backup");
    try {
      const file = JSON.stringify(await account.encryptedBackup(), null, 2);
      setProgress("Encrypted backup download requested");
      return file;
    }
    catch (failure) { if (currentWallet.current === account.wallet) reportFailure(failure, "Could not export the encrypted backup."); return null; }
    finally { working.current = false; setBusy(false); }
  }
  async function run(action: (client: OrganizationNetwork, account: OrganizationAccount) => Promise<unknown>, completedMessage?: string) {
    if (working.current || !network || !account || needsReload) return;
    working.current = true; setBusy(true); setError(""); setProgress("Working in your organization workspace");
    try {
      await action(network, account);
      if (completedMessage) {
        account.assertSession();
        if (currentWallet.current === account.wallet) setProgress(completedMessage);
      }
    }
    catch (failure) { if (currentWallet.current === account.wallet) reportFailure(failure, "The operation needs reconciliation."); }
    finally {
      try { account.assertSession(); setSnapshot(account.snapshot()); setPending(account.pending()); setRecoveries(account.recoveryHistory()); } catch { /* Revoked account records stay hidden. */ }
      working.current = false; setBusy(false);
    }
  }
  return <OrganizationContext.Provider value={{ account, network, snapshot, pending, recoveries, busy: busy || restoring, resumeAvailable, needsReload, progress, error, unlock, retryConnection, backup, lock: () => { forgetOrganizationTabSession(); lockVaultSession(); }, run }}>{children}</OrganizationContext.Provider>;
}
