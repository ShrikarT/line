import { useState } from "react";
import { cn } from "@/lib/utils";
import { getRuntime, setRuntime, LocalDevelopmentRuntime, MidnightNetworkRuntime } from "@/lib/runtime";
import { NetworkSetupScreen } from "./network-setup";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/issuer", label: "Issuer" },
  { to: "/merchant", label: "Merchant" },
  { to: "/agent", label: "Agent" },
  { to: "/explorer", label: "Explorer" },
  { to: "/lab", label: "Attack lab" },
  { to: "/circuits", label: "Circuits" },
  { to: "/roadmap", label: "Roadmap" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const [showNetworkSetup, setShowNetworkSetup] = useState(false);
  const runtime = getRuntime();
  const isNetwork = runtime.mode === "network";
  const isConnected = runtime.isConnected();
  const contractAddr = runtime.getContractAddress();

  const handleToggleMode = () => {
    if (isNetwork) {
      setRuntime(new LocalDevelopmentRuntime());
      window.location.reload();
    } else {
      setRuntime(new MidnightNetworkRuntime());
      setShowNetworkSetup(true);
    }
  };

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <a href="/" className="flex items-baseline gap-2">
              <span className="font-display text-lg tracking-tight">Line</span>
              <span className="hidden text-xs text-muted sm:inline">
                Private credit authorization
              </span>
            </a>

            <button
              onClick={() => (isNetwork ? setShowNetworkSetup(!showNetworkSetup) : handleToggleMode())}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-mono transition-colors border",
                isNetwork
                  ? isConnected && contractAddr
                    ? "border-ok/30 bg-ok/10 text-ok"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-400"
                  : "border-border bg-elevated text-muted hover:text-fg"
              )}
              title="Click to configure runtime / wallet"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  isNetwork
                    ? isConnected && contractAddr
                      ? "bg-ok"
                      : "bg-amber-400"
                    : "bg-muted"
                )}
              />
              {isNetwork ? "Midnight Network" : "Local Simulator"}
            </button>
          </div>

          <nav className="flex flex-wrap gap-1">
            {NAV.map((item) => (
              <a
                key={item.to}
                href={item.to}
                className={cn(
                  "rounded-sm px-3 py-2 text-sm text-muted transition-colors duration-[var(--motion-quick)] hover:text-fg",
                  pathname === item.to && "bg-elevated text-fg",
                )}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      {/* Network Setup screen if toggled or if in unconfigured network mode */}
      {showNetworkSetup && (
        <div className="border-b border-border bg-elevated/40 px-4 py-4">
          <div className="mx-auto max-w-6xl flex justify-end pb-2">
            <button
              onClick={() => setShowNetworkSetup(false)}
              className="text-xs text-subtle hover:text-fg"
            >
              ✕ Close Setup
            </button>
          </div>
          <NetworkSetupScreen
            onConnected={() => setShowNetworkSetup(false)}
            onSwitchToLocal={() => {
              setRuntime(new LocalDevelopmentRuntime());
              setShowNetworkSetup(false);
            }}
          />
        </div>
      )}

      {/* Network warning banner when in network mode without active wallet connection */}
      {isNetwork && (!isConnected || !contractAddr) && !showNetworkSetup && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
            <span>
              <strong>Midnight Network Mode:</strong> External wallet or contract address unconfigured. Transactions require on-chain setup.
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setShowNetworkSetup(true)}
                className="underline hover:text-amber-200"
              >
                Configure Connection
              </button>
              <span>·</span>
              <button
                onClick={handleToggleMode}
                className="underline hover:text-amber-200"
              >
                Switch to Simulator
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
