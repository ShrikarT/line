import { Shell } from "@/components/line/shell";
import { DualLedger } from "@/components/line/dual";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Panel, ResetRow, Stat } from "@/components/line/ui";
import { useLine } from "@/lib/line/store.ts";


export function IssuerPage() {
  const doOpen = useLine((s) => s.doOpen);
  const doAck = useLine((s) => s.doAck);
  const doStatus = useLine((s) => s.doStatus);
  const pending = useLine((s) => s.pendingRepay);
  const lastAcked = useLine((s) => s.lastAcked);
  const status = useLine((s) => s.ledger.status);
  const receipts = useLine((s) => s.receipts);
  const flash = useLine((s) => s.flash);

  const doFundReserve = useLine((s) => s.doFundReserve);
  const doWithdrawReserve = useLine((s) => s.doWithdrawReserve);
  const doRegisterMerchant = useLine((s) => s.doRegisterMerchant);
  const ledger = useLine((s) => s.ledger);
  const locked = (ledger.encumberedReserve ?? 0) + (ledger.redeemedReserve ?? 0);
  const withdrawable = Math.max(0, (ledger.totalReserve ?? 0) - locked);

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel kicker="Issuer desk" title="Underwrite, Reserve & Acknowledge">
          <p className="text-sm text-muted">
            Only this desk can fund settlement reserves, withdraw unencumbered capital, register
            merchants, open credit lines, or confirm repayment cash.
          </p>
          <FlashBar flash={flash} />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Status" value={status} />
            <Stat label="Total Reserve" value={ledger.totalReserve ?? 0} />
            <Stat label="Withdrawable" value={withdrawable} />
            <Stat label="Encumbered" value={ledger.encumberedReserve ?? 0} />
            <Stat label="Redeemed" value={ledger.redeemedReserve ?? 0} />
            <Stat label="Pending Repayment" value={pending} />
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Settlement Reserve Capacity</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => doFundReserve(500)}>Allocate Reserve · 500</Button>
              <Button variant="ghost" onClick={() => doWithdrawReserve(withdrawable)} disabled={withdrawable <= 0}>
                Withdraw Unencumbered ({withdrawable})
              </Button>
              <Button variant="ghost" onClick={() => doRegisterMerchant()}>
                Register Merchant B
              </Button>
            </div>
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Credit Line Lifecycle</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => doOpen(150)}>Open line · 150</Button>
              <Button variant="ghost" onClick={() => doAck()} disabled={pending <= 0}>
                Acknowledge repayment ({pending})
              </Button>
              <Button variant="ghost" onClick={() => doStatus("defaulted")}>
                Mark defaulted
              </Button>
              <Button variant="ghost" onClick={() => doStatus("open")}>
                Reopen status
              </Button>
              <ResetRow />
            </div>
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
