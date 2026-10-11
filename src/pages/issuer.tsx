import { useState } from "react";
import { Shell } from "@/components/line/shell";
import { DualLedger } from "@/components/line/dual";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Panel, Stat } from "@/components/line/ui";
import { useAppStore } from "@/app/store.ts";
import { Compensation } from "@/components/line/compensation";

export function IssuerPage() {
  const doOpen = useAppStore((s) => s.doOpen);
  const doAck = useAppStore((s) => s.doAck);
  const doStatus = useAppStore((s) => s.doStatus);
  const status = useAppStore((s) => s.ledger.status);
  const flash = useAppStore((s) => s.flash);
  const txLifecycle = useAppStore((s) => s.txLifecycle);
  const operationsUnavailable = useAppStore((s) => s.operationBusy || s.recoveryRequired || !s.isVaultUnlocked);
  const operationBusy = useAppStore((s) => s.operationBusy);
  const [feeFlat, setFeeFlat] = useState("0");
  const [feeBps, setFeeBps] = useState("0");
  const validPolicy = /^\d+$/.test(feeFlat) && /^\d+$/.test(feeBps) &&
    Number.isSafeInteger(Number(feeFlat)) && Number.isSafeInteger(Number(feeBps)) && Number(feeBps) <= 10_000;

  const doFundReserve = useAppStore((s) => s.doFundReserve);
  const doWithdrawReserve = useAppStore((s) => s.doWithdrawReserve);
  const doRegisterMerchant = useAppStore((s) => s.doRegisterMerchant);
  const ledger = useAppStore((s) => s.ledger);
  const withdrawable = ledger.withdrawableReserve ?? 0;

  const isBusy = operationsUnavailable || txLifecycle === "wallet-approval" || txLifecycle === "proving";

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel kicker="Issuer desk" title="Underwrite, Reserve & Acknowledge">
          <p className="text-sm text-muted">
            Only this desk can record settlement reserve capacity, withdraw unencumbered capacity, register
            merchants, open credit lines, or acknowledge reported off-chain repayments. Local mode records accounting changes without verifying payment or submitting proofs.
          </p>
          <FlashBar flash={flash} />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Status" value={status} />
            <Stat label="Total Reserve" value={ledger.totalReserve ?? 0} />
            <Stat label="Withdrawable" value={withdrawable} />
            <Stat label="Encumbered" value={ledger.encumberedReserve ?? 0} />
            <Stat label="Redeemed" value={ledger.redeemedReserve ?? 0} />
            <Stat label="Action Clock" value={ledger.actionClock} />
            <Stat label="Flat fee" value={ledger.feeFlat ?? "Unavailable"} />
            <Stat label="Fee rate (bps)" value={ledger.feeBps ?? "Unavailable"} />
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Settlement Reserve Capacity</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => doFundReserve(500)} disabled={isBusy}>
                {operationBusy ? "Processing..." : "Allocate Reserve · 500"}
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
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted">Flat fee (units)
                <input type="number" min="0" step="1" value={feeFlat} onChange={event => setFeeFlat(event.target.value)} disabled={isBusy}
                  className="mt-1 w-full border border-border bg-elevated p-2 text-fg" />
              </label>
              <label className="text-xs text-muted">Fee rate (basis points)
                <input type="number" min="0" max="10000" step="1" value={feeBps} onChange={event => setFeeBps(event.target.value)} disabled={isBusy}
                  className="mt-1 w-full border border-border bg-elevated p-2 text-fg" />
              </label>
            </div>
            <p className="text-xs text-muted">Each purchase adds the flat fee plus the percentage rounded up to a whole unit (100 basis points = 1%). Terms stay fixed until a zero-debt close and a new line generation. Fees stay pending until merchant claim redemption. Expired unredeemed notes can receive debt credit and a private refund obligation.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => doOpen(150, { feeFlat: Number(feeFlat), feeBps: Number(feeBps) })} disabled={isBusy || !validPolicy}>
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
          <Compensation issuer />
        </Panel>
        <div className="space-y-6">
          <DualLedger />
          <ExplorerPanel />
        </div>
      </div>
    </Shell>
  );
}
