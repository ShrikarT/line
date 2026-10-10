import { useState, useEffect } from "react";
import { Panel, Button, FlashBar } from "./ui";
import { getAvailableWallets, type WalletInfo } from "@/lib/runtime/wallet";
import { getRuntime, setRuntime, MidnightNetworkRuntime, LocalDevelopmentRuntime } from "@/lib/runtime";
import { sanitizeServiceError } from "@/lib/runtime/endpoints";

interface NetworkSetupProps { onConnected?: () => void; onSwitchToLocal?: () => void }

export function NetworkSetupScreen({ onConnected, onSwitchToLocal }: NetworkSetupProps) {
  const initialRuntime = getRuntime();
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [networkId, setNetworkId] = useState(initialRuntime.networkId === "preview" ? "preview" : "preprod");
  const [projectToken, setProjectToken] = useState("");
  const [proofServerUri, setProofServerUri] = useState("http://127.0.0.1:6300");
  const [zkConfigBaseUrl, setZkConfigBaseUrl] = useState("/line-zk");
  const [connecting, setConnecting] = useState(false);
  const [connectedWalletName, setConnectedWalletName] = useState<string | null>(null);
  const [contractAddressInput, setContractAddressInput] = useState(initialRuntime.getContractAddress() ?? "");
  const [joiningContract, setJoiningContract] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const busy = connecting || joiningContract;
  useEffect(() => { setWallets(getAvailableWallets()); }, []);

  const handleConnectWallet = async () => {
    setConnecting(true); setErrorMsg(null); setSuccessMsg(null); setConnectedWalletName(null);
    try {
      if (networkId === "preprod" && !projectToken.trim()) throw new Error("Enter a Blockfrost Midnight Preprod project token.");
      const runtime = new MidnightNetworkRuntime({ networkId, blockfrostProjectId: projectToken.trim() || undefined,
        proofServerUri, zkConfigBaseUrl: new URL(zkConfigBaseUrl, window.location.origin).href });
      await runtime.attachWallet();
      setRuntime(runtime);
      setConnectedWalletName(networkId);
      setSuccessMsg("Wallet connected. Join your deployed Line contract to continue.");
    } catch (err) { setErrorMsg(sanitizeServiceError(err instanceof Error ? err.message : String(err))); }
    finally { setConnecting(false); }
  };
  const handleJoinContract = async () => {
    setJoiningContract(true); setErrorMsg(null); setSuccessMsg(null);
    try {
      const runtime = getRuntime();
      if (!(runtime instanceof MidnightNetworkRuntime) || !runtime.isWalletConnected()) throw new Error("Connect a wallet for this network first.");
      const status = await runtime.joinContract(contractAddressInput.trim());
      setSuccessMsg(`Line contract state loaded: ${status.contractDomain.slice(0, 12)}?`);
      onConnected?.();
    } catch (err) { setErrorMsg(sanitizeServiceError(err instanceof Error ? err.message : String(err))); }
    finally { setJoiningContract(false); }
  };
  const switchLocal = () => {
    setRuntime(new LocalDevelopmentRuntime());
    onSwitchToLocal?.();
  };
  const changeConfiguration = (change: () => void) => { change(); setConnectedWalletName(null); setSuccessMsg(null); };
  const inputClass = "w-full rounded-md border border-border bg-elevated px-3 py-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent";
  return <div className="mx-auto max-w-2xl space-y-6 py-6">
    <Panel kicker="Network setup" title="Midnight Network Setup & Wallet Connection">
      <p className="text-sm text-muted">Use a wallet on the selected network and a deployed Line contract. Transactions require matching proving assets, a compatible proof server and an unlocked private vault.</p>
      {errorMsg && <FlashBar flash={{ tone: "fail", text: errorMsg }} />}
      {successMsg && <FlashBar flash={{ tone: "ok", text: successMsg }} />}
      <fieldset disabled={busy} className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <legend className="text-xs font-semibold text-muted">Service configuration</legend>
        <label className="block text-xs text-muted">Network
          <select aria-label="Network" className={inputClass} value={networkId} onChange={e => changeConfiguration(() => setNetworkId(e.target.value))}>
            <option value="preprod">Preprod</option><option value="preview">Preview</option>
          </select>
        </label>
        {networkId === "preprod" && <label className="block text-xs text-muted">Blockfrost Midnight Preprod project token
          <input type="password" autoComplete="off" spellCheck={false} className={inputClass} value={projectToken} onChange={e => changeConfiguration(() => setProjectToken(e.target.value))} />
          <span className="text-subtle">Held in memory for this session. The public Preprod services require this token.</span>
        </label>}
        <label className="block text-xs text-muted">Proof server URL (8.1.3)
          <input type="url" className={inputClass} value={proofServerUri} onChange={e => changeConfiguration(() => setProofServerUri(e.target.value))} />
        </label>
        <label className="block text-xs text-muted">Published Line proving asset root
          <input className={inputClass} value={zkConfigBaseUrl} onChange={e => changeConfiguration(() => setZkConfigBaseUrl(e.target.value))} />
          <span className="text-subtle">Must serve matching keys/ and zkir/ directories from a validated release.</span>
        </label>
      </fieldset>
      <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex justify-between text-xs text-muted"><span>1. Browser Wallet</span><span>{connectedWalletName ? `Connected (${connectedWalletName})` : "Not connected"}</span></div>
        <Button onClick={handleConnectWallet} disabled={busy}>{connecting ? "Connecting..." : "Connect Midnight Wallet"}</Button>
        <p className="text-xs text-subtle">{wallets.length ? `Detected: ${wallets.map(w => w.name).join(", ")}` : "No extension detected in browser window."}</p>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <p className="text-xs text-muted">2. Deployed Contract</p>
        <label className="block text-xs text-muted">Contract address (32 hex bytes)
          <input spellCheck={false} className={inputClass} value={contractAddressInput} onChange={e => setContractAddressInput(e.target.value)} placeholder="0123456789abcdef?" />
        </label>
        <Button onClick={handleJoinContract} disabled={busy || !connectedWalletName || !contractAddressInput.trim()} variant="ghost">{joiningContract ? "Verifying..." : "Join Contract"}</Button>
        <p className="text-xs text-subtle">Loading public state does not confirm a transaction or token payout. Keep the vault unlocked for private circuit operations.</p>
      </div>
      <Button variant="ghost" onClick={switchLocal} disabled={busy}>Switch to Local Development Simulator</Button>
    </Panel>
  </div>;
}
