import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getConnectedWallet, subscribeWallet } from "@/lib/runtime/wallet";
import type { OrganizationAccount, OrganizationPending, OrganizationSnapshot } from "@/lib/organization/account";
import type { OrganizationNetwork } from "@/lib/organization/network";
import { onVaultSessionLock } from "@/lib/security/vault";
import { sanitizeServiceError } from "@/lib/runtime/endpoints";

type Session = { account: OrganizationAccount | null; network: OrganizationNetwork | null; snapshot: OrganizationSnapshot | null; pending: OrganizationPending | null; busy: boolean; progress: string; error: string; unlock: (password: string) => Promise<void>; lock: () => void; run: (action: (network: OrganizationNetwork, account: OrganizationAccount) => Promise<unknown>) => Promise<void> };
const OrganizationContext = createContext<Session | null>(null);
export function useOrganization() { const session = useContext(OrganizationContext); if (!session) throw new Error("OrganizationSessionProvider is required."); return session; }
export function OrganizationSessionProvider({ children }: { children: ReactNode }) {
  const wallet = useSyncExternalStore(subscribeWallet, getConnectedWallet, () => null);
  const [account, setAccount] = useState<OrganizationAccount | null>(null), [network, setNetwork] = useState<OrganizationNetwork | null>(null);
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null), [pending, setPending] = useState<OrganizationPending | null>(null);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [error, setError] = useState("");
  const working = useRef(false), currentWallet = useRef(wallet); currentWallet.current = wallet;
  useEffect(() => {
    const clear = () => { setAccount(null); setNetwork(null); setSnapshot(null); setPending(null); setProgress(""); setError(""); };
    clear(); return onVaultSessionLock(clear);
  }, [wallet]);
  async function unlock(password: string) {
    if (working.current || !wallet) return;
    working.current = true; setBusy(true); setError(""); setProgress("Opening your encrypted organization vault");
    try {
      const [{ OrganizationAccount }, { OrganizationNetwork }] = await Promise.all([
        import("@/lib/organization/account"), import("@/lib/organization/network"),
      ]);
      if (getConnectedWallet() !== wallet) return;
      const opened = await OrganizationAccount.unlock(wallet, password);
      if (currentWallet.current !== wallet) return;
      setAccount(opened); setSnapshot(opened.snapshot()); setPending(opened.pending());
      const client = await OrganizationNetwork.connect(opened, message => { if (currentWallet.current === wallet) setProgress(message); });
      opened.assertSession(); setNetwork(client); setProgress("Your wallet and organization contract release are ready");
    } catch (failure) { if (currentWallet.current === wallet) { setProgress(""); setError(sanitizeServiceError(failure instanceof Error ? failure.message : "Could not open the organization vault.")); } }
    finally { working.current = false; setBusy(false); }
  }
  async function run(action: (client: OrganizationNetwork, account: OrganizationAccount) => Promise<unknown>) {
    if (working.current || !network || !account) return;
    working.current = true; setBusy(true); setError(""); setProgress("Working in your organization workspace");
    try { await action(network, account); }
    catch (failure) { if (currentWallet.current === account.wallet) { setProgress(""); setError(sanitizeServiceError(failure instanceof Error ? failure.message : "The operation needs reconciliation.")); } }
    finally {
      try { account.assertSession(); setSnapshot(account.snapshot()); setPending(account.pending()); } catch { /* Revoked account records stay hidden. */ }
      working.current = false; setBusy(false);
    }
  }
  return <OrganizationContext.Provider value={{ account, network, snapshot, pending, busy, progress, error, unlock, lock: () => account?.close(), run }}>{children}</OrganizationContext.Provider>;
}
