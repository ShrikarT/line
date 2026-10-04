import React, { useState } from "react";
import { useAppStore } from "@/app/store.ts";
import { Button, Mono } from "./ui";
import { cn } from "@/lib/utils";

export function VaultBar() {
  const isVaultUnlocked = useAppStore((s) => s.isVaultUnlocked);
  const unlockVault = useAppStore((s) => s.unlockVault);
  const lockVault = useAppStore((s) => s.lockVault);
  const generateIdentity = useAppStore((s) => s.generateIdentity);
  const importIdentity = useAppStore((s) => s.importIdentity);
  const issuerRecord = useAppStore((s) => s.issuerRecord);
  const agentRecord = useAppStore((s) => s.agentRecord);
  const merchantRecord = useAppStore((s) => s.merchantRecord);

  const [passphrase, setPassphrase] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [importRole, setImportRole] = useState<"issuer" | "agent" | "merchant">("issuer");
  const [importKeyInput, setImportKeyInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (passphrase.length < 8) {
      setErrorMsg("Passphrase must be at least 8 characters.");
      return;
    }
    const ok = await unlockVault(passphrase);
    if (!ok) {
      setErrorMsg("Decryption failed. Ensure passphrase is correct.");
    } else {
      setPassphrase("");
    }
  };

  const handleGenerateAll = async () => {
    setErrorMsg(null);
    try {
      if (!issuerRecord) await generateIdentity("issuer");
      if (!agentRecord) await generateIdentity("agent");
      if (!merchantRecord) await generateIdentity("merchant");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await importIdentity(importRole, importKeyInput);
      setImportKeyInput("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
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
              placeholder="Vault passphrase (min 8 chars)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="rounded border border-border bg-elevated px-2.5 py-1 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button type="submit" variant="ghost" disabled={passphrase.length < 8}>
              Unlock Vault
            </Button>
          </form>
        </div>
        {errorMsg && <p className="mx-auto max-w-6xl pt-1 text-[11px] text-danger">{errorMsg}</p>}
      </div>
    );
  }

  const hasAllKeys = issuerRecord && agentRecord && merchantRecord;

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
                  onClick={() => generateIdentity("issuer")}
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
              {agentRecord?.identityCommitment && (
                <div className="pt-1">
                  <span className="text-[10px] text-subtle">ID: </span>
                  <Mono value={agentRecord.identityCommitment} />
                </div>
              )}
              {!agentRecord && (
                <button
                  onClick={() => generateIdentity("agent")}
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
                  onClick={() => generateIdentity("merchant")}
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
              onChange={(e) => setImportRole(e.target.value as any)}
              className="rounded border border-border bg-elevated px-2 py-1 text-xs text-fg focus:outline-none"
            >
              <option value="issuer">Issuer</option>
              <option value="agent">Agent</option>
              <option value="merchant">Merchant</option>
            </select>
            <input
              type="password"
              placeholder="64 hex characters..."
              value={importKeyInput}
              onChange={(e) => setImportKeyInput(e.target.value)}
              className="flex-1 min-w-[200px] rounded border border-border bg-elevated px-2 py-1 text-xs font-mono text-fg focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <Button type="submit" variant="ghost" disabled={importKeyInput.trim().length !== 64}>
              Import Key
            </Button>
          </form>

          {errorMsg && <p className="text-xs text-danger">{errorMsg}</p>}
        </div>
      )}
    </div>
  );
}
