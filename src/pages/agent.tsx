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
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Pending Invoices ({invoices.filter((i) => !i.used).length})
            </p>
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
                  <li key={n.D} className="text-xs text-muted border-b border-border/50 pb-1 flex items-center justify-between">
                    <span>Note {n.preimage.amount} units</span>
                    <Mono value={n.D} />
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
