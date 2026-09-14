import { Shell } from "@/components/line/shell";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Panel, Stat } from "@/components/line/ui";
import { available } from "@/lib/line/protocol.ts";
import { useLine } from "@/lib/line/store.ts";


export function AgentPage() {
  const agent = useLine((s) => s.agent);
  const invoices = useLine((s) => s.invoices);
  const doDraw = useLine((s) => s.doDraw);
  const flash = useLine((s) => s.flash);
  const w = agent?.witness;

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel kicker="Agent console" title="Private books">
          <p className="text-sm text-muted">
            Limit and outstanding live here. Failed draws tell you only that
            clearance could not be proven.
          </p>
          <FlashBar flash={flash} />
          {w ? (
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Limit" privateHint value={w.L} />
              <Stat label="Outstanding" privateHint value={w.B} />
              <Stat label="Available" privateHint value={available(w)} />
            </div>
          ) : (
            <p className="text-sm text-subtle">Issuer has not opened a line for this agent.</p>
          )}
          <ul className="space-y-2">
            {invoices.filter((i) => !i.used).map((inv) => (
              <li key={inv.Q} className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  {inv.invoiceId} · {inv.amount}
                </span>
                <Button onClick={() => doDraw(inv.Q)}>Draw</Button>
              </li>
            ))}
          </ul>
        </Panel>
        <ExplorerPanel />
      </div>
    </Shell>
  );
}
