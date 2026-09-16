import { useState } from "react";
import { Shell } from "@/components/line/shell";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Mono, Panel, Stat } from "@/components/line/ui";
import { useAppStore } from "@/app/store.ts";

export function MerchantPage() {
  const doQuote = useAppStore((s) => s.doQuote);
  const doRedeem = useAppStore((s) => s.doRedeem);
  const activeMerchant = useAppStore((s) => s.activeMerchant);
  const setActiveMerchant = useAppStore((s) => s.setActiveMerchant);
  const invoices = useAppStore((s) => s.invoices);
  const notes = useAppStore((s) => s.notes);
  const flash = useAppStore((s) => s.flash);
  const txLifecycle = useAppStore((s) => s.txLifecycle);
  const exportQuotePackage = useAppStore((s) => s.exportQuotePackage);
  const importDrawNotePackage = useAppStore((s) => s.importDrawNotePackage);

  const [drawNotePkgInput, setDrawNotePkgInput] = useState("");
  const [showImportNote, setShowImportNote] = useState(false);
  const [copiedQuote, setCopiedQuote] = useState<string | null>(null);

  const isBusy = txLifecycle === "wallet-approval" || txLifecycle === "proving";

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel kicker="Merchant desk" title="Post quotes & Redeem Settlement Notes">
          <p className="text-sm text-muted">
            You know the invoice terms and hold the merchant private key. Line settlements issue private,
            merchant-bound claim notes redeemable directly against the issuer reserve. Settlement amount and merchant
            pseudonym are recorded publicly on-chain upon redemption.
          </p>
          <FlashBar flash={flash} />

          <div className="flex items-center gap-2 border-b border-border pb-3">
            <span className="text-xs font-semibold uppercase text-muted">Active Merchant:</span>
            <Button
              variant={activeMerchant === "A" ? "primary" : "ghost"}
              onClick={() => setActiveMerchant("A")}
            >
              Merchant A
            </Button>
            <Button
              variant={activeMerchant === "B" ? "primary" : "ghost"}
              onClick={() => setActiveMerchant("B")}
            >
              Merchant B
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={() => doQuote(40, `inv-${activeMerchant}-40`)} disabled={isBusy}>
              Quote 40 ({activeMerchant})
            </Button>
            <Button variant="ghost" onClick={() => doQuote(120, `inv-${activeMerchant}-120`)} disabled={isBusy}>
              Quote 120 ({activeMerchant})
            </Button>
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Settlement Notes Inbox ({notes.length})
              </p>
              <button
                onClick={() => setShowImportNote(!showImportNote)}
                className="text-xs text-accent underline"
              >
                {showImportNote ? "Cancel" : "+ Import Draw Note Package"}
              </button>
            </div>

            {showImportNote && (
              <div className="rounded border border-border bg-elevated/40 p-3 space-y-2">
                <p className="text-xs text-subtle">Paste JSON DrawNoteTransferPackage from agent:</p>
                <textarea
                  rows={3}
                  value={drawNotePkgInput}
                  onChange={(e) => setDrawNotePkgInput(e.target.value)}
                  placeholder='{"format":"line:note-package:v1", ...}'
                  className="w-full rounded border border-border bg-elevated p-2 text-xs font-mono text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <Button
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(drawNotePkgInput);
                      const ok = importDrawNotePackage(parsed);
                      if (ok) {
                        setDrawNotePkgInput("");
                        setShowImportNote(false);
                      }
                    } catch (e) {
                      alert("Invalid JSON format");
                    }
                  }}
                  disabled={!drawNotePkgInput.trim()}
                >
                  Import Draw Note
                </Button>
              </div>
            )}

            {notes.length === 0 ? (
              <p className="text-sm text-subtle">No notes received yet. Agent draws create notes.</p>
            ) : (
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.D} className="rounded border border-border p-2 text-sm flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Note Claim: {n.preimage.amount} units</span>
                      <span className="text-teal-400 text-xs font-medium">Claim Note Active</span>
                    </div>
                    <div className="text-xs text-muted flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span>Note D:</span>
                        <Mono value={n.D} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Quote Q:</span>
                        <Mono value={n.preimage.quoteCommit} />
                      </div>
                    </div>
                    <Button onClick={() => doRedeem(n.D, activeMerchant)} disabled={isBusy}>
                      Redeem {n.preimage.amount} against Reserve
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Issued Quotes ({invoices.length})
            </p>
            <ul className="space-y-2">
              {invoices.length === 0 ? (
                <li className="text-sm text-subtle">No invoices in the private merchant store.</li>
              ) : (
                invoices.map((inv) => (
                  <li key={inv.Q} className="flex flex-col gap-1 text-sm border-b border-border/40 pb-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">
                        {inv.invoiceId} · {inv.amount} units · {inv.used ? "consumed" : "open"}
                      </span>
                      <button
                        onClick={() => {
                          const pkg = exportQuotePackage(inv.Q);
                          if (pkg) {
                            navigator.clipboard.writeText(JSON.stringify(pkg, null, 2));
                            setCopiedQuote(inv.Q);
                            setTimeout(() => setCopiedQuote(null), 2000);
                          }
                        }}
                        className="rounded border border-border px-2 py-0.5 text-[11px] text-accent hover:bg-elevated transition-colors"
                      >
                        {copiedQuote === inv.Q ? "Copied Package!" : "Copy Package for Agent"}
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span className="text-subtle">Quote Q:</span>
                      <Mono value={inv.Q} />
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>

          <Stat
            label="Privacy disclosure"
            value="The agent's credit limit, outstanding debt and remaining capacity remain private. Settlement amount and merchant pseudonym are public in this protocol version."
          />
        </Panel>
        <ExplorerPanel />
      </div>
    </Shell>
  );
}
