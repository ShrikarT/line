import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/line/shell";
import { DualLedger } from "@/components/line/dual";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Panel, ResetRow, Stat } from "@/components/line/ui";
import { useLine } from "@/lib/line/store.ts";

export const Route = createFileRoute("/issuer")({ component: IssuerPage });

function IssuerPage() {
  const doOpen = useLine((s) => s.doOpen);
  const doAck = useLine((s) => s.doAck);
  const doStatus = useLine((s) => s.doStatus);
  const pending = useLine((s) => s.pendingRepay);
  const lastAcked = useLine((s) => s.lastAcked);
  const status = useLine((s) => s.ledger.status);
  const receipts = useLine((s) => s.receipts);
  const flash = useLine((s) => s.flash);

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel kicker="Issuer desk" title="Underwrite and acknowledge">
          <p className="text-sm text-muted">
            Only this desk can open a line, confirm cash received, or freeze
            status. Agents cannot shrink outstanding balance by themselves.
          </p>
          <FlashBar flash={flash} />
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Status" value={status} />
            <Stat label="Pending (off-chain)" value={pending} />
            <Stat label="Last ack" value={lastAcked} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => doOpen(150)}>Open line · 150</Button>
            <Button variant="ghost" onClick={() => doAck()} disabled={pending <= 0}>
              Acknowledge repayment
            </Button>
            <Button variant="ghost" onClick={() => doStatus("defaulted")}>
              Mark defaulted
            </Button>
            <Button variant="ghost" onClick={() => doStatus("open")}>
              Reopen status
            </Button>
            <ResetRow />
          </div>
          <ul className="space-y-2 border-t border-border pt-4 text-sm">
            {receipts.length === 0 ? (
              <li className="text-subtle">No issuer receipts yet. Off-chain cash, then ack.</li>
            ) : (
              receipts.map((r) => (
                <li key={r.nonce} className="text-muted">
                  Receipt {r.amount} · {r.paymentRef}
                </li>
              ))
            )}
          </ul>
        </Panel>
        <div className="space-y-6">
          <DualLedger />
          <ExplorerPanel />
        </div>
      </div>
    </Shell>
  );
}
