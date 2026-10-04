import { useState } from "react";
import { Shell } from "@/components/line/shell";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Mono, Panel, Stat } from "@/components/line/ui";
import { availableCredit } from "@/lib/line/types.ts";
import { useAppStore } from "@/app/store.ts";

export function AgentPage() {
  const agentRecord = useAppStore((s) => s.agentRecord);
  const invoices = useAppStore((s) => s.invoices);
  const doDraw = useAppStore((s) => s.doDraw);
  const flash = useAppStore((s) => s.flash);
  const notes = useAppStore((s) => s.notes);
  const isVaultUnlocked = useAppStore((s) => s.isVaultUnlocked);
  const txLifecycle = useAppStore((s) => s.txLifecycle);
  const importQuotePackage = useAppStore((s) => s.importQuotePackage);
  const exportDrawNotePackage = useAppStore((s) => s.exportDrawNotePackage);

  const [quotePkgInput, setQuotePkgInput] = useState("");
  const [showImportQuote, setShowImportQuote] = useState(false);
  const [copiedNote, setCopiedNote] = useState<string | null>(null);

  const w = agentRecord ? { L: agentRecord.L, B: agentRecord.B } : null;

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel kicker="Agent console" title="Private books & Draw Notes">
          <p className="text-sm text-muted">
            Limit and outstanding live strictly in your private store. Successful draws issue
            cryptographically-committed settlement notes to merchants backed by issuer reserves.
          </p>
          <FlashBar flash={flash} />
          {w ? (
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Limit" privateHint value={w.L} />
              <Stat label="Outstanding" privateHint value={w.B} />
              <Stat label="Available" privateHint value={availableCredit(w)} />
            </div>
          ) : (
            <p className="text-sm text-subtle">
              {isVaultUnlocked
                ? "Issuer has not opened a credit line for this agent."
                : "Unlock encrypted vault to access confidential credit line."}
            </p>
          )}

          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Pending Invoices ({invoices.filter((i) => !i.used).length})
              </p>
              <button
                onClick={() => setShowImportQuote(!showImportQuote)}
                className="text-xs text-accent underline"
              >
                {showImportQuote ? "Cancel" : "+ Import Quote Package"}
              </button>
            </div>

            {showImportQuote && (
              <div className="rounded border border-border bg-elevated/40 p-3 space-y-2">
                <p className="text-xs text-subtle">Paste JSON QuoteTransferPackage from merchant:</p>
                <textarea
                  rows={3}
                  value={quotePkgInput}
                  onChange={(e) => setQuotePkgInput(e.target.value)}
                  placeholder='{"format":"line:quote-package:v1", ...}'
                  className="w-full rounded border border-border bg-elevated p-2 text-xs font-mono text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <Button
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(quotePkgInput);
                      const ok = importQuotePackage(parsed);
                      if (ok) {
                        setQuotePkgInput("");
                        setShowImportQuote(false);
                      }
                    } catch (e) {
                      alert("Invalid JSON format");
                    }
                  }}
                  disabled={!quotePkgInput.trim()}
                >
                  Import Quote
                </Button>
              </div>
            )}

            {invoices.filter((i) => !i.used).length === 0 ? (
              <p className="text-sm text-subtle">No open quotes from merchants.</p>
            ) : (
              <ul className="space-y-2">
                {invoices.filter((i) => !i.used).map((inv) => (
                  <li key={inv.Q} className="flex items-center justify-between gap-3 border-b border-border/50 pb-2">
                    <span className="text-sm">
                      {inv.invoiceId} · <span className="font-semibold">{inv.amount} units</span>
                    </span>
                    <Button
                      onClick={() => doDraw(inv.Q)}
                      disabled={txLifecycle === "wallet-approval" || txLifecycle === "proving"}
                    >
                      {txLifecycle === "proving" ? "Proving ZK..." : "Draw & Issue Note"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Authorized Draw Notes ({notes.length})
            </p>
            {notes.length === 0 ? (
              <p className="text-sm text-subtle">No notes issued yet.</p>
            ) : (
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.D} className="text-xs text-muted border-b border-border/50 pb-2 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-fg">Note {n.preimage.amount} units</span>
                      <button
                        onClick={() => {
                          const pkg = exportDrawNotePackage(n.D);
                          if (pkg) {
                            navigator.clipboard.writeText(JSON.stringify(pkg, null, 2));
                            setCopiedNote(n.D);
                            setTimeout(() => setCopiedNote(null), 2000);
                          }
                        }}
                        className="rounded border border-border px-2 py-0.5 text-[11px] text-accent hover:bg-elevated transition-colors"
                      >
                        {copiedNote === n.D ? "Copied Package!" : "Copy Package for Merchant"}
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-subtle">Commitment D:</span>
                      <Mono value={n.D} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
        <ExplorerPanel />
      </div>
    </Shell>
  );
}
