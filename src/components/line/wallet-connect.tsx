import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight, ArrowSquareOut, CheckCircle, CircleNotch, Copy, Plugs, Wallet } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cancelWalletConnection, connectWallet, disconnectWallet, getActiveWalletInfo, getAvailableWallets, getConnectedWallet, getConnectedWalletAccount, subscribeWallet, type WalletConnectionPhase, type WalletInfo, type WalletDiagnosticTarget } from "@/lib/runtime/wallet";
import { getActiveRuntime } from "@/lib/runtime/active";
import { sanitizeServiceError } from "@/lib/runtime/endpoints";
import { diagnoseWalletReads, type WalletReadDiagnostic } from "@/lib/runtime/wallet-diagnostics";

const WalletContext = createContext<{ connected: boolean; connecting: boolean; name: string; address: string; openWallet: () => void } | null>(null);
const connectionMessages: Record<WalletConnectionPhase, string> = {
  "requesting-access": "Waiting for your wallet to open the connection request. Unlock the extension and select your Midnight Preprod account.",
  "verifying-network": "Your wallet answered. Checking Midnight Preprod…",
  "reading-address": "Reading your receiving address. Approve address access if the extension asks.",
  "checking-session": "Confirming your wallet session…",
};
const connectionMethods: Record<WalletConnectionPhase, string> = { "requesting-access": "connect(preprod)", "verifying-network": "getConfiguration", "reading-address": "getUnshieldedAddress", "checking-session": "getConnectionStatus" };
const walletDownloads = [
  { name: "1AM", matches: /1am|1 am|one.?am/i, href: "https://chromewebstore.google.com/detail/1am/bphnkdkcnfhompoegfpgnkidcjfbojjp" },
  { name: "Lace", matches: /lace/i, href: "https://www.lace.io/" },
];

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
  const [connectionPhase, setConnectionPhase] = useState<WalletConnectionPhase>("requesting-access");
  const [failedMethod, setFailedMethod] = useState("");
  const [account, setAccount] = useState({ address: "", network: "" }), [copied, setCopied] = useState(false);
  const busy = useRef(false);
  const connectionAttempt = useRef(0);
  const info = getActiveWalletInfo();
  const [diagnostics, setDiagnostics] = useState<WalletReadDiagnostic[]>([]), [checking, setChecking] = useState(false);
  const diagnosticAttempt = useRef(0), diagnosticBusy = useRef(false);
  const [diagnosticTarget, setDiagnosticTarget] = useState<WalletDiagnosticTarget | null>(null);
  const currentDiagnosticTarget = useRef(diagnosticTarget); currentDiagnosticTarget.current = diagnosticTarget;
  useEffect(() => {
    if (!open) return;
    const discover = () => setWallets(getAvailableWallets().filter(wallet => wallet.isAvailable));
    discover();
    // Extensions may inject after page load or after the wallet is unlocked.
    const timer = window.setInterval(discover, 1500);
    return () => window.clearInterval(timer);
  }, [open]);
  useEffect(() => {
    setAccount(api ? getConnectedWalletAccount() ?? { address: "", network: "" } : { address: "", network: "" });
    setCopied(false);
    diagnosticAttempt.current++; setDiagnostics([]); setDiagnosticTarget(null);
  }, [api]);
  useEffect(() => () => { diagnosticAttempt.current++; if (busy.current) { connectionAttempt.current++; cancelWalletConnection(); } }, []);
  function cancelConnection() {
    connectionAttempt.current++;
    cancelWalletConnection();
    busy.current = false; setConnecting(false);
    diagnosticAttempt.current++; setDiagnosticTarget(null);
    setError("Connection cancelled. Unlock your wallet, select Preprod and close any old connection prompt before trying again.");
  }
  function changeOpen(next: boolean) {
    if (!next && busy.current) cancelConnection();
    if (!next) { diagnosticAttempt.current++; setDiagnosticTarget(null); }
    setOpen(next);
  }
  async function connect(wallet: WalletInfo) {
    if (busy.current) return;
    const attempt = ++connectionAttempt.current;
    busy.current = true; setConnecting(true); setError(""); setFailedMethod(""); diagnosticAttempt.current++; setDiagnostics([]); setDiagnosticTarget(null);
    let phase: WalletConnectionPhase = "requesting-access";
    try { await connectWallet(wallet.id, "preprod", next => { phase = next; if (connectionAttempt.current === attempt) setConnectionPhase(next); }, target => { if (connectionAttempt.current === attempt) setDiagnosticTarget(target); }); }
    catch (failure) {
      if (connectionAttempt.current !== attempt) return;
      setFailedMethod(connectionMethods[phase]);
      const code = failure instanceof Error && "code" in failure ? failure.code : "";
      setError(code === "WALLET_APPROVAL_REJECTED" ? "Connection declined. You can try again when you’re ready." : sanitizeServiceError(failure instanceof Error ? failure.message : "Could not connect. Unlock your wallet and select Preprod, then try again."));
    } finally { if (connectionAttempt.current === attempt) { busy.current = false; setConnecting(false); } }
  }
  async function disconnect() {
    if (busy.current) cancelConnection();
    const runtime = getActiveRuntime();
    if (runtime?.detachWallet) await runtime.detachWallet();
    else await disconnectWallet();
    setError(""); setCopied(false); diagnosticAttempt.current++; setDiagnosticTarget(null);
  }
  async function copyAddress() {
    try { await navigator.clipboard.writeText(account.address); setCopied(true); }
    catch { setError("Could not copy automatically. Select and copy the address below."); }
  }
  async function checkConnection() {
    if (diagnosticBusy.current || connecting || !api && !diagnosticTarget) return;
    const checked = api, partial = diagnosticTarget, attempt = ++diagnosticAttempt.current;
    const reads = checked ?? partial!.reads, expectedAddress = checked ? account.address : partial!.address;
    diagnosticBusy.current = true; setChecking(true); setDiagnostics([]);
    try {
      await diagnoseWalletReads(reads, expectedAddress, () => getConnectedWallet() === checked && diagnosticAttempt.current === attempt && (!!checked || currentDiagnosticTarget.current === partial),
        result => setDiagnostics(rows => [...rows, result]));
    } catch { /* Closing the dialog or switching wallets discards late results. */ }
    finally { diagnosticBusy.current = false; setChecking(false); }
  }
  return <WalletContext.Provider value={{ connected: !!api, connecting, name: info?.name ?? "Midnight wallet", address: account.address, openWallet: () => { setError(""); setOpen(true); } }}>
    {children}
    <Dialog open={open} onOpenChange={changeOpen}>
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
          {wallets.length ? wallets.map(wallet => <Button key={wallet.id} variant="outline" className="wallet-option" disabled={connecting} onClick={() => void connect(wallet)}><Wallet aria-hidden="true" /><span>{wallet.name}</span>{connecting ? <CircleNotch className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</Button>) : <div className="wallet-empty"><strong>No compatible Midnight wallet detected yet.</strong><p>Install a Midnight wallet below, create or unlock its Preprod account, then refresh Line. Any wallet implementing Midnight DApp Connector v4 can appear here.</p><Button variant="outline" asChild><a href="https://docs.midnight.network/getting-started/installation" target="_blank" rel="noreferrer">Wallet setup guide <ArrowSquareOut aria-hidden="true" /></a></Button></div>}
          {connecting && <><p role="status" className="text-sm text-muted">{connectionMessages[connectionPhase]}</p><Button variant="ghost" onClick={cancelConnection}>Cancel connection</Button></>}
        </div>}
        {!api && !connecting && <div className="flex flex-col gap-3"><p className="text-xs text-muted">Use another Midnight wallet</p><div className="flex flex-wrap gap-2">{walletDownloads.filter(option => !wallets.some(wallet => option.matches.test(`${wallet.name} ${wallet.rdns}`))).map(option => <Button key={option.name} variant="outline" size="sm" asChild><a href={option.href} target="_blank" rel="noreferrer">Get {option.name}<ArrowSquareOut aria-hidden="true" /></a></Button>)}<Button variant="ghost" size="sm" onClick={() => window.location.reload()}>Refresh wallets</Button></div></div>}
        {(api || diagnosticTarget || failedMethod) && <details className="w-full">
          <summary>Connection diagnostics</summary>
          {failedMethod && <p className="text-xs text-muted">Connection stopped at <code>{failedMethod}</code>.</p>}
          <p className="text-xs text-muted">Check individual connector reads without opening the vault or requesting a proof, signature or transaction. Results stay in this dialog and do not enable payments.</p>
          {(api || diagnosticTarget) && <Button variant="outline" size="sm" disabled={checking || connecting} onClick={() => void checkConnection()}>{checking ? "Checking connector reads…" : "Check connector reads"}</Button>}
          <ul className="flex flex-col gap-2" aria-live="polite">{diagnostics.map(result => <li key={result.method} className="text-xs [overflow-wrap:anywhere]"><code>{result.method}</code>: {result.outcome} · {result.detail}{result.code && ` (code ${result.code})`} · {result.elapsedMs} ms</li>)}</ul>
        </details>}
        <div className="wallet-scope"><CheckCircle aria-hidden="true" /><p>Connecting shares your wallet address and sends no transaction. Your organization’s records stay encrypted in its wallet-scoped vault. Deposits and purchases require separate wallet approvals.</p></div>
        <Button variant="secondary" asChild><a href="/app" onClick={() => changeOpen(false)}>Continue to workspace <ArrowRight aria-hidden="true" /></a></Button>
        {!["/", "/app", "/organization", "/agents", "/suppliers"].includes(window.location.pathname) && <a className="text-center text-xs text-muted underline underline-offset-4" href="/connect" onClick={() => changeOpen(false)}>Advanced: connect an existing canonical contract</a>}
      </DialogContent>
    </Dialog>
  </WalletContext.Provider>;
}
