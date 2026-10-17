import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight, ArrowSquareOut, CheckCircle, CircleNotch, Copy, Plugs, Wallet } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { connectWallet, disconnectWallet, getActiveWalletInfo, getAvailableWallets, getConnectedWallet, subscribeWallet, type WalletInfo } from "@/lib/runtime/wallet";
import { getRuntime, MidnightNetworkRuntime } from "@/lib/runtime";
import { sanitizeServiceError } from "@/lib/runtime/endpoints";

const WalletContext = createContext<{ connected: boolean; connecting: boolean; name: string; address: string; openWallet: () => void } | null>(null);

export function useWalletSession() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("Wallet controls require WalletSessionProvider.");
  return context;
}

export function WalletButton({ className = "" }: { className?: string }) {
  const { connected, connecting, address, openWallet } = useWalletSession();
  return <Button className={`line-wallet-button ${className}`} onClick={openWallet} aria-label={connected ? "Manage connected wallet" : "Connect wallet"}>
    {connecting ? <CircleNotch className="animate-spin" aria-hidden="true" /> : <Wallet aria-hidden="true" />}
    <span>{connecting ? "Connecting…" : connected ? address ? `${address.slice(0, 12)}…${address.slice(-5)}` : "Wallet connected" : "Connect wallet"}</span>
    {connected && <span className="live-dot" aria-hidden="true" />}
  </Button>;
}

export function WalletSessionProvider({ children }: { children: ReactNode }) {
  const api = useSyncExternalStore(subscribeWallet, getConnectedWallet, () => null);
  const [open, setOpen] = useState(false), [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [connecting, setConnecting] = useState(false), [error, setError] = useState("");
  const [account, setAccount] = useState({ address: "", network: "" }), [copied, setCopied] = useState(false);
  const busy = useRef(false);
  const info = getActiveWalletInfo();
  useEffect(() => {
    if (!open) return;
    const discover = () => setWallets(getAvailableWallets().filter(wallet => wallet.isAvailable));
    discover();
    // Extensions may inject after page load or after the wallet is unlocked.
    const timer = window.setInterval(discover, 1500);
    return () => window.clearInterval(timer);
  }, [open]);
  useEffect(() => {
    let cancelled = false;
    setAccount({ address: "", network: "" }); setCopied(false);
    if (api) void (async () => {
      const config = await api.getConfiguration();
      const address = typeof api.getUnshieldedAddress === "function" ? (await api.getUnshieldedAddress()).unshieldedAddress : "";
      if (!cancelled) setAccount({ address, network: config.networkId });
    })().catch(() => { if (!cancelled) setError("Wallet connected, but its address is unavailable. Unlock the wallet and reconnect to refresh it."); });
    return () => { cancelled = true; };
  }, [api]);
  async function connect(wallet: WalletInfo) {
    if (busy.current) return;
    busy.current = true; setConnecting(true); setError("");
    try { await connectWallet(wallet.rdns, "preprod"); }
    catch (failure) {
      const code = failure instanceof Error && "code" in failure ? failure.code : "";
      setError(code === "WALLET_APPROVAL_REJECTED" ? "Connection declined. You can try again when you’re ready." : sanitizeServiceError(failure instanceof Error ? failure.message : "Could not connect. Unlock your wallet and select Preprod, then try again."));
    } finally { busy.current = false; setConnecting(false); }
  }
  async function disconnect() {
    const runtime = getRuntime();
    if (runtime instanceof MidnightNetworkRuntime) await runtime.detachWallet();
    else await disconnectWallet();
    setError(""); setCopied(false);
  }
  async function copyAddress() {
    try { await navigator.clipboard.writeText(account.address); setCopied(true); }
    catch { setError("Could not copy automatically. Select and copy the address below."); }
  }
  return <WalletContext.Provider value={{ connected: !!api, connecting, name: info?.name ?? "Midnight wallet", address: account.address, openWallet: () => { setError(""); setOpen(true); } }}>
    {children}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="wallet-dialog max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <div className="wallet-emblem"><Wallet weight="duotone" aria-hidden="true" /></div>
          <p className="line-eyebrow">Your Line account / Midnight</p>
          <DialogTitle>{api ? "Your wallet is connected." : "Connect your wallet."}</DialogTitle>
          <DialogDescription>{api ? "Manage the browser wallet connected to this session." : "Choose your Midnight wallet and approve the connection in the extension. Use the Preprod network."}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="wallet-error">{error}</p>}
        {api ? <div className="wallet-account">
          <div className="flex items-center justify-between gap-3"><strong>{info?.name ?? "Midnight wallet"}</strong><span className="wallet-network"><span className="live-dot" />{account.network || "Reading network…"}</span></div>
          <p className="text-xs text-muted">Public receiving address</p>
          {account.address ? <><code className="wallet-address">{account.address}</code><Button variant="outline" size="sm" onClick={() => void copyAddress()}><Copy aria-hidden="true" />{copied ? "Address copied" : "Copy address"}</Button></> : <p className="text-sm text-muted">Waiting for the wallet address.</p>}
          <Button variant="ghost" onClick={() => void disconnect()}><Plugs aria-hidden="true" />Disconnect from Line</Button>
          <p className="text-xs text-muted">To revoke the site permission, remove Line from connected sites in your wallet. After refreshing the page, reconnect to approve a new session.</p>
        </div> : <div className="wallet-options" aria-busy={connecting}>
          {wallets.length ? wallets.map(wallet => <Button key={wallet.rdns} variant="outline" className="wallet-option" disabled={connecting} onClick={() => void connect(wallet)}><Wallet aria-hidden="true" /><span>{wallet.name}</span>{connecting ? <CircleNotch className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</Button>) : <div className="wallet-empty"><strong>No Midnight wallet detected yet.</strong><p>Install a Midnight-compatible browser wallet, enable it for this site, then refresh this page. On mobile, open Line in a browser that supports your wallet extension.</p><Button variant="outline" asChild><a href="https://docs.midnight.network/getting-started/installation" target="_blank" rel="noreferrer">Wallet setup guide <ArrowSquareOut aria-hidden="true" /></a></Button></div>}
          {connecting && <p role="status" className="text-sm text-muted">Approve the connection in your wallet extension…</p>}
        </div>}
        <div className="wallet-scope"><CheckCircle aria-hidden="true" /><p>Connecting shares your wallet address. It does not send a transaction. The funded demo uses the local operator’s existing facility and merchant wallets; your wallet is not its signer.</p></div>
        <Button variant="secondary" asChild><a href="/app" onClick={() => setOpen(false)}>Continue to workspace <ArrowRight aria-hidden="true" /></a></Button>
        <a className="text-center text-xs text-muted underline underline-offset-4" href="/connect" onClick={() => setOpen(false)}>Advanced: connect your own deployed facility</a>
      </DialogContent>
    </Dialog>
  </WalletContext.Provider>;
}
