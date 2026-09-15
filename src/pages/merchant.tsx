import { Shell } from "@/components/line/shell";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Mono, Panel, Stat } from "@/components/line/ui";
import { useLine } from "@/lib/line/store.ts";
import { MERCHANT_A_PK, MERCHANT_B_PK } from "@/lib/line/keys.ts";

export function MerchantPage() {
  const doQuote = useLine((s) => s.doQuote);
  const doRedeem = useLine((s) => s.doRedeem);
  const activeMerchant = useLine((s) => s.activeMerchant);
  const setActiveMerchant = useLine((s) => s.setActiveMerchant);
  const invoices = useLine((s) => s.invoices);
  const notes = useLine((s) => s.notes);
  const ledger = useLine((s) => s.ledger);
  const flash = useLine((s) => s.flash);

  const currentPk = activeMerchant === "A" ? MERCHANT_A_PK : MERCHANT_B_PK;
  const merchantNotes = notes.filter((n) => n.preimage.merchantPk === currentPk);

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel kicker="Merchant desk" title="Post quotes & Redeem Settlement Notes">
          <p className="text-sm text-muted">
            You know the price and hold the private opening key. Wave 2 settlements are private,
            merchant-bound draw notes redeemable directly against the issuer reserve.
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
            <Button onClick={() => doQuote(40, `inv-${activeMerchant}-40`)}>
              Quote 40 ({activeMerchant})
            </Button>
            <Button variant="ghost" onClick={() => doQuote(120, `inv-${activeMerchant}-120`)}>
              Quote 120 ({activeMerchant})
            </Button>
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Settlement Notes Inbox ({merchantNotes.length})
            </p>
            {merchantNotes.length === 0 ? (
              <p className="text-sm text-subtle">No notes received yet. Agent draws create notes.</p>
            ) : (
              <ul className="space-y-2">
                {merchantNotes.map((n) => {
                  const onChain = ledger.notes.find((ln) => ln.commitment === n.D);
                  const isRedeemed = onChain?.redeemed ?? false;
                  return (
                    <li key={n.D} className="rounded border border-border p-2 text-sm flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Note Claim: {n.preimage.amount} units</span>
                        <span className={isRedeemed ? "text-subtle text-xs" : "text-ok text-xs font-medium"}>
                          {isRedeemed ? "Redeemed (Paid)" : "Ready to Redeem"}
                        </span>
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
                      {!isRedeemed && (
                        <Button onClick={() => doRedeem(n.D, activeMerchant)}>
                          Redeem {n.preimage.amount} against Reserve
                        </Button>
                      )}
                    </li>
                  );
                })}
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

          <Stat label="Private rule" value="Amount and merchant identity never hit public explorer." />
        </Panel>
        <ExplorerPanel />
      </div>
    </Shell>
  );
}
