import { Shell } from "@/components/line/shell";
import { DualLedger } from "@/components/line/dual";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Panel, Stat } from "@/components/line/ui";
import { useAppStore } from "@/app/store.ts";

export function IssuerPage() {
  const doOpen = useAppStore((s) => s.doOpen);
  const doAck = useAppStore((s) => s.doAck);
  const doStatus = useAppStore((s) => s.doStatus);
  const status = useAppStore((s) => s.ledger.status);
  const flash = useAppStore((s) => s.flash);
  const txLifecycle = useAppStore((s) => s.txLifecycle);

  const doFundReserve = useAppStore((s) => s.doFundReserve);
  const doWithdrawReserve = useAppStore((s) => s.doWithdrawReserve);
  const doRegisterMerchant = useAppStore((s) => s.doRegisterMerchant);
  const ledger = useAppStore((s) => s.ledger);
  const withdrawable = ledger.withdrawableReserve ?? 0;

  const isBusy = txLifecycle === "wallet-approval" || txLifecycle === "proving";

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel kicker="Issuer desk" title="Underwrite, Reserve & Acknowledge">
          <p className="text-sm text-muted">
            Only this desk can record settlement reserve capacity, withdraw unencumbered capacity, register
            merchants, open credit lines, or confirm off-chain repayment cash in ZK.
          </p>
          <FlashBar flash={flash} />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Status" value={status} />
            <Stat label="Total Reserve" value={ledger.totalReserve ?? 0} />
            <Stat label="Withdrawable" value={withdrawable} />
            <Stat label="Encumbered" value={ledger.encumberedReserve ?? 0} />
            <Stat label="Redeemed" value={ledger.redeemedReserve ?? 0} />
            <Stat label="Action Clock" value={ledger.actionClock} />
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Settlement Reserve Capacity</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => doFundReserve(500)} disabled={isBusy}>
                {isBusy ? "Processing..." : "Allocate Reserve · 500"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => doWithdrawReserve(withdrawable)}
                disabled={isBusy || withdrawable <= 0}
              >
                Withdraw Unencumbered ({withdrawable})
              </Button>
              <Button variant="ghost" onClick={() => doRegisterMerchant()} disabled={isBusy}>
                Register Merchant B
              </Button>
            </div>
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Credit Line Lifecycle</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => doOpen(150)} disabled={isBusy}>
                Open line · 150
              </Button>
              <Button variant="ghost" onClick={() => doAck(40)} disabled={isBusy}>
                Acknowledge Repayment (40)
              </Button>
              <Button variant="ghost" onClick={() => doStatus("defaulted")} disabled={isBusy}>
                Mark defaulted
              </Button>
              <Button variant="ghost" onClick={() => doStatus("open")} disabled={isBusy}>
                Reopen status
              </Button>
            </div>
          </div>
        </Panel>
        <div className="space-y-6">
          <DualLedger />
          <ExplorerPanel />
        </div>
      </div>
    </Shell>
  );
}
