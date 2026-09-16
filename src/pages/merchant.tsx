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
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Settlement Notes Inbox ({notes.length})
            </p>
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
                  <li key={inv.Q} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span>
                      {inv.invoiceId} · {inv.amount} · {inv.used ? "consumed" : "open"}
                    </span>
                    <Mono value={inv.Q} />
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
