import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { getRuntime, setRuntime, LocalDevelopmentRuntime, MidnightNetworkRuntime } from "@/lib/runtime";
import { NetworkSetupScreen } from "./network-setup";
import { VaultBar } from "./vault-bar";
import { ShellLayout, type ShellProps } from "./shell";

export function ProtocolShell({ children, evaluation = false, evaluationMode = "local", hideVault = false }: ShellProps) {
  const [showNetworkSetup, setShowNetworkSetup] = useState(false);
  const runtime = getRuntime(),
    isNetwork = runtime.mode === "network",
    isConnected = runtime.isConnected(),
    contractAddr = runtime.getContractAddress();
  const handleToggleMode = () => {
    if (isNetwork) {
      setRuntime(new LocalDevelopmentRuntime());
      window.location.reload();
    } else {
      setRuntime(new MidnightNetworkRuntime());
      setShowNetworkSetup(true);
    }
  };
  const runtimeLabel = evaluation
    ? evaluationMode === "preprod"
      ? "Midnight Preprod · live proofs"
      : "Generated Compact · local evaluation"
    : isNetwork
      ? isConnected && contractAddr
        ? "Midnight connected"
        : "Midnight Network"
      : "Local Simulator";
  const runtimeControl = evaluation ? (
    <span className="line-runtime">
      <span
        className={cn(
          "line-runtime-dot",
          evaluationMode === "preprod" && "is-live",
        )}
      />
      {runtimeLabel}
    </span>
  ) : (
    <button
      className="line-runtime"
      onClick={() =>
        isNetwork ? setShowNetworkSetup(!showNetworkSetup) : handleToggleMode()
      }
      title="Configure runtime and wallet"
    >
      <span
        className={cn(
          "line-runtime-dot",
          isNetwork && isConnected && "is-live",
        )}
      />
      {runtimeLabel}
    </button>
  );
  return <ShellLayout evaluation={evaluation} evaluationMode={evaluationMode}
    runtimeControl={runtimeControl}
    vault={!hideVault ? <VaultBar /> : null}
    setup={<>
      {!evaluation && showNetworkSetup && (
        <section aria-label="Network setup" className="line-container py-6">
          <div className="mb-4 flex justify-end">
            <button
              className="line-button line-button-ghost"
              onClick={() => setShowNetworkSetup(false)}
            >
              <X aria-hidden="true" />
              Close Setup
            </button>
          </div>
          <NetworkSetupScreen
            onConnected={() => setShowNetworkSetup(false)}
            onSwitchToLocal={() => {
              setRuntime(new LocalDevelopmentRuntime());
              setShowNetworkSetup(false);
            }}
          />
        </section>
      )}
      {!evaluation &&
        isNetwork &&
        (!isConnected || !contractAddr) &&
        !showNetworkSetup && (
          <div className="line-container my-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red/30 bg-red/5 p-4 text-sm">
            <span>
              <strong>Midnight Network Mode:</strong> Connect a wallet and
              contract to continue.
            </span>
            <div className="flex gap-4">
              <button
                className="underline"
                onClick={() => setShowNetworkSetup(true)}
              >
                Configure Connection
              </button>
              <button className="underline" onClick={handleToggleMode}>
                Switch to Simulator
              </button>
            </div>
          </div>
        )}
    </>}>
    {children}
  </ShellLayout>;
}
