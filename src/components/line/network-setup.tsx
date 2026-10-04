import React, { useState, useEffect } from "react";
import { Panel, Button, FlashBar, Mono } from "./ui";
import { isWalletInjected, getAvailableWallets, connectWallet, type WalletInfo } from "@/lib/runtime/wallet";
import { getRuntime, setRuntime, MidnightNetworkRuntime, LocalDevelopmentRuntime, type RuntimeMode } from "@/lib/runtime";

interface NetworkSetupProps {
  onConnected?: () => void;
  onSwitchToLocal?: () => void;
}

export function NetworkSetupScreen({ onConnected, onSwitchToLocal }: NetworkSetupProps) {
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [connectedWalletName, setConnectedWalletName] = useState<string | null>(null);
  const [contractAddressInput, setContractAddressInput] = useState("");
  const [joiningContract, setJoiningContract] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const runtime = getRuntime();
  const isNetworkMode = runtime.mode === "network";

  useEffect(() => {
    if (typeof window !== "undefined") {
      setWallets(getAvailableWallets());
    }
  }, []);

  const handleConnectWallet = async (preferredRdns?: string) => {
    setConnecting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const api = await connectWallet(preferredRdns);
      const conf = await api.getConfiguration().catch(() => null);
      setConnectedWalletName(conf?.networkId ?? "Midnight Wallet");
      setSuccessMsg("Wallet connected successfully via Midnight DApp Connector.");
      if (onConnected) onConnected();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };

  const handleJoinContract = async () => {
    if (!contractAddressInput.trim()) {
      setErrorMsg("Please enter a valid Midnight contract address.");
      return;
    }
    setJoiningContract(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      if (runtime instanceof MidnightNetworkRuntime) {
        const status = await runtime.joinContract(contractAddressInput.trim());
        setSuccessMsg(`Joined Line contract domain 0x${status.contractDomain.slice(0, 10)}... successfully.`);
        if (onConnected) onConnected();
      } else {
        setErrorMsg("Runtime is not in network mode.");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setJoiningContract(false);
    }
  };

  const handleSwitchSimulator = () => {
    setRuntime(new LocalDevelopmentRuntime());
    if (onSwitchToLocal) onSwitchToLocal();
    else window.location.reload();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <Panel kicker="Network Architecture" title="Midnight Network Setup & Wallet Connection">
        <p className="text-sm text-muted">
          Line uses native zero-knowledge smart contracts compiled with Midnight Compact. In network mode,
          circuit transactions require an external Midnight wallet (such as Lace) and an active on-chain contract.
        </p>

        {errorMsg && <FlashBar flash={{ tone: "fail", text: errorMsg }} />}
        {successMsg && <FlashBar flash={{ tone: "ok", text: successMsg }} />}

        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">1. Browser Wallet</span>
            <span className="text-xs font-mono text-subtle">
              {connectedWalletName ? `Connected (${connectedWalletName})` : "Not connected"}
            </span>
          </div>

          <p className="text-xs text-muted">
            Connect your browser wallet extension via the standard Midnight DApp Connector API.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => handleConnectWallet()}
              disabled={connecting}
            >
              {connecting ? "Connecting..." : "Connect Midnight Wallet"}
            </Button>

            {wallets.length > 0 && (
              <span className="text-xs text-subtle">
                Detected: {wallets.map((w) => w.name).join(", ")}
              </span>
            )}
            {wallets.length === 0 && (
              <span className="text-xs text-subtle">
                No extension detected in browser window.
              </span>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">2. Deployed Contract</span>
            <span className="text-xs font-mono text-subtle">
              {runtime.getContractAddress() ? "Joined" : "Unconfigured"}
            </span>
          </div>

          <p className="text-xs text-muted">
            Enter the address of a Line contract deployed on the Midnight network.
          </p>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. 0x0123456789abcdef..."
              value={contractAddressInput}
              onChange={(e) => setContractAddressInput(e.target.value)}
              className="flex-1 rounded-md border border-border bg-elevated px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button
              onClick={handleJoinContract}
              disabled={joiningContract || !contractAddressInput.trim()}
              variant="ghost"
            >
              {joiningContract ? "Verifying..." : "Join Contract"}
            </Button>
          </div>
        </div>

        <div className="border-t border-border pt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-subtle">
            Need to test offline or without wallet?
          </div>
          <Button variant="ghost" onClick={handleSwitchSimulator}>
            Switch to Local Development Simulator
          </Button>
        </div>
      </Panel>
    </div>
  );
}
