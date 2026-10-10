import React, { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/app/store.ts";
import { Button, Mono } from "./ui";

export function VaultBar() {
  const isVaultUnlocked = useAppStore((s) => s.isVaultUnlocked);
  const unlockVault = useAppStore((s) => s.unlockVault);
  const lockVault = useAppStore((s) => s.lockVault);
  const generateIdentity = useAppStore((s) => s.generateIdentity);
  const importIdentity = useAppStore((s) => s.importIdentity);
  const issuerRecord = useAppStore((s) => s.issuerRecord);
  const agentRecord = useAppStore((s) => s.agentRecord);
  const merchantRecord = useAppStore((s) => s.merchantRecord);
  const hasIssuedAgentLine = useAppStore((s) => Boolean(s.agentLineRecord || s.agentRecord?.lineCommitment));
  const recoveryRequired = useAppStore((s) => s.recoveryRequired);
  const operationBusy = useAppStore((s) => s.operationBusy);
  const recoverOperations = useAppStore((s) => s.recoverOperations);

  const [passphrase, setPassphrase] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [importRole, setImportRole] = useState<"issuer" | "agent" | "merchant">("issuer");
  const [importKeyInput, setImportKeyInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const actionInProgress = useRef(false);

  useEffect(() => {
    if (!isVaultUnlocked) {
      setPassphrase("");
      setImportKeyInput("");
      setShowDetails(false);
    }
  }, [isVaultUnlocked]);

  const runAction = async (action: () => Promise<unknown>) => {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      await action();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      actionInProgress.current = false;
      setIsBusy(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passphrase.length < 8) {
      setErrorMsg("Passphrase must be at least 8 characters.");
      return;
    }
    const enteredPassphrase = passphrase;
    setPassphrase("");
    await runAction(async () => {
      if (!(await unlockVault(enteredPassphrase))) {
        throw new Error(useAppStore.getState().flash?.text ?? "Vault unlock could not be completed.");
      }
    });
  };

  const handleGenerate = (role: "issuer" | "agent" | "merchant") => runAction(() => generateIdentity(role));

  const handleGenerateAll = () => runAction(async () => {
    if (!useAppStore.getState().issuerRecord) await generateIdentity("issuer");
    const current = useAppStore.getState();
    if (!current.agentRecord && !current.agentLineRecord) await generateIdentity("agent");
    if (!useAppStore.getState().merchantRecord) await generateIdentity("merchant");
  });

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const enteredKey = importKeyInput;
    setImportKeyInput("");
    await runAction(async () => {
      if (importRole === "agent" && hasIssuedAgentLine) throw new Error("This agent has an issued credit line. Unlock its existing encrypted book to recover it; replacing its key would discard the opening.");
      await importIdentity(importRole, enteredKey);
    });
  };

  if (!isVaultUnlocked) {
    return (
      <div className="border-b border-border bg-surface/80 px-4 py-2 text-xs">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
            <span>
              <strong>Private Vault Locked:</strong> AES-GCM encrypted state in IndexedDB.
            </span>
          </div>

          <form onSubmit={handleUnlock} className="flex items-center gap-2">
            <input
              type="password"
              aria-label="Vault passphrase"
              placeholder="Vault passphrase (min 8 chars)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="rounded border border-border bg-elevated px-2.5 py-1 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button type="submit" variant="ghost" disabled={isBusy || passphrase.length < 8}>
              Unlock Vault
            </Button>
          </form>
        </div>
        {errorMsg && <p role="alert" className="mx-auto max-w-6xl pt-1 text-[11px] text-danger">{errorMsg}</p>}
      </div>
    );
  }

  const hasAllKeys = Boolean(issuerRecord && agentRecord && merchantRecord);
  const agentImportProtected = importRole === "agent" && hasIssuedAgentLine;

  return (
    <div className="border-b border-border bg-surface/80 px-4 py-2 text-xs">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-ok" />
          <span className="text-ok font-medium">Vault Unlocked</span>
          <span className="text-subtle">· Ephemeral session active (AES-GCM WebCrypto)</span>
          {!hasAllKeys && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
              Setup credentials needed
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!hasAllKeys && (
            <button
              onClick={handleGenerateAll}
              disabled={isBusy}
              className="rounded bg-accent/20 px-2 py-1 text-accent-fg hover:bg-accent/30 transition-colors"
            >
              Generate Role Credentials
            </button>
          )}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-subtle hover:text-fg underline"
          >
            {showDetails ? "Hide Vault Manager" : "Manage Vault Keys"}
          </button>
          <span>·</span>
          <button
            onClick={() => lockVault()}
            className="text-muted hover:text-danger"
          >
            Lock Vault
          </button>
        </div>
      </div>

      {recoveryRequired && (
        <div role="status" className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 pt-2 text-amber-300">
          <span>A previous operation needs reconciliation. New submissions are blocked until its outcome is established.</span>
          <Button variant="ghost" disabled={isBusy || operationBusy} onClick={() => runAction(async () => {
            if (!(await recoverOperations())) throw new Error(useAppStore.getState().flash?.text ?? "Recovery unavailable.");
          })}>Reconcile Operation</Button>
        </div>
      )}

      {showDetails && (
        <div className="mx-auto max-w-6xl border-t border-border/50 mt-3 pt-3 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded border border-border bg-elevated/40 p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-muted">Issuer Identity</span>
                <span className={issuerRecord ? "text-ok" : "text-amber-400"}>
                  {issuerRecord ? "Configured" : "Missing"}
                </span>
              </div>
              <p className="text-[11px] text-subtle">Underwrites lines & acknowledges repayments.</p>
              {!issuerRecord && (
                <button
                  onClick={() => handleGenerate("issuer")}
                  disabled={isBusy}
                  className="mt-2 text-xs text-accent underline"
                >
                  Generate Issuer Key
                </button>
              )}
            </div>

            <div className="rounded border border-border bg-elevated/40 p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-muted">Agent Identity</span>
                <span className={agentRecord ? "text-ok" : "text-amber-400"}>
                  {agentRecord ? "Configured" : "Missing"}
                </span>
              </div>
              <p className="text-[11px] text-subtle">Draws credit & issues settlement notes.</p>
              {hasIssuedAgentLine && <p id="issued-agent-protection" className="text-[11px] text-muted">Issued credit line: agent key replacement is disabled. Keep the existing encrypted book for recovery.</p>}
              {agentRecord?.identityCommitment && (
                <div className="pt-1">
                  <span className="text-[10px] text-subtle">ID: </span>
                  <Mono value={agentRecord.identityCommitment} />
                </div>
              )}
              {!agentRecord && (
                <button
                  onClick={() => handleGenerate("agent")}
                  disabled={isBusy || hasIssuedAgentLine}
                  aria-describedby={hasIssuedAgentLine ? "issued-agent-protection" : undefined}
                  className="mt-2 text-xs text-accent underline"
                >
                  Generate Agent Key
                </button>
              )}
            </div>

            <div className="rounded border border-border bg-elevated/40 p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-muted">Merchant Identity</span>
                <span className={merchantRecord ? "text-ok" : "text-amber-400"}>
                  {merchantRecord ? "Configured" : "Missing"}
                </span>
              </div>
              <p className="text-[11px] text-subtle">Posts quotes & redeems claim notes.</p>
              {merchantRecord?.merchantPk && (
                <div className="pt-1">
                  <span className="text-[10px] text-subtle">PK: </span>
                  <Mono value={merchantRecord.merchantPk} />
                </div>
              )}
              {!merchantRecord && (
                <button
                  onClick={() => handleGenerate("merchant")}
                  disabled={isBusy}
                  className="mt-2 text-xs text-accent underline"
                >
                  Generate Merchant Key
                </button>
              )}
            </div>
          </div>

          <form onSubmit={handleImport} className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
            <span className="text-subtle">Import 32-byte secret hex:</span>
            <select
              value={importRole}
              aria-label="Identity role to import"
              disabled={isBusy}
              onChange={(e) => {
                const role = e.target.value;
                if (role === "issuer" || role === "agent" || role === "merchant") setImportRole(role);
                setImportKeyInput("");
                setErrorMsg(null);
              }}
              className="rounded border border-border bg-elevated px-2 py-1 text-xs text-fg focus:outline-none"
            >
              <option value="issuer">Issuer</option>
              <option value="agent" disabled={hasIssuedAgentLine}>Agent{hasIssuedAgentLine ? " (issued line protected)" : ""}</option>
              <option value="merchant">Merchant</option>
            </select>
            <input
              type="password"
              aria-label="Identity secret key"
              autoComplete="off"
              disabled={isBusy || agentImportProtected}
              placeholder="64 hex characters..."
              value={importKeyInput}
              onChange={(e) => setImportKeyInput(e.target.value)}
              className="flex-1 min-w-[200px] rounded border border-border bg-elevated px-2 py-1 text-xs font-mono text-fg focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button type="submit" variant="ghost" disabled={isBusy || agentImportProtected || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(importKeyInput.trim())}>
              Import Key
            </Button>
          </form>

        </div>
      )}
      {errorMsg && <p role="alert" className="mx-auto max-w-6xl pt-2 text-xs text-danger">{errorMsg}</p>}
    </div>
  );
}
