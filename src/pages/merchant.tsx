import { Shell } from "@/components/line/shell";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Mono, Panel, Stat } from "@/components/line/ui";
import { useLine } from "@/lib/line/store.ts";


export function MerchantPage() {
  const doQuote = useLine((s) => s.doQuote);
  const invoices = useLine((s) => s.invoices);
  const flash = useLine((s) => s.flash);

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel kicker="Merchant desk" title="Post opaque quotes">
          <p className="text-sm text-muted">
            You already know the price. The ledger only stores a hash. Wave 1
            settlement is issuer-backed authorization, not a token transfer.
          </p>
          <FlashBar flash={flash} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => doQuote(40, "inv-40")}>Quote 40</Button>
            <Button variant="ghost" onClick={() => doQuote(120, "inv-120")}>
              Quote 120
            </Button>
          </div>
          <ul className="space-y-3 border-t border-border pt-4">
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
          <Stat label="Private rule" value="Amount and merchant name never hit the explorer." />
        </Panel>
        <ExplorerPanel />
      </div>
    </Shell>
  );
}
