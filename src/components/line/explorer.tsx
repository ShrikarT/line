import { useAppStore } from "@/app/store.ts";
import { Mono, Panel, Stat } from "./ui";

export function ExplorerPanel() {
  const ledger = useAppStore((s) => s.ledger);
  const total = ledger.totalReserve ?? 0;
  const encumbered = ledger.encumberedReserve ?? 0;
  const redeemed = ledger.redeemedReserve ?? 0;
  const feeReserve = ledger.feeReserve ?? 0;
  const pendingFees = ledger.pendingFeeReserve ?? 0;
  const refundReserve = ledger.refundReserve ?? 0;
  const reportedRefundReserve = ledger.reportedRefundReserve ?? 0;
  const locked = encumbered + redeemed + feeReserve + pendingFees + refundReserve + reportedRefundReserve;
  const withdrawable = ledger.withdrawableReserve ?? Math.max(0, total - locked);

  const quotesCount = "quoteCount" in ledger ? (ledger as any).quoteCount : (ledger as any).quotes?.length ?? 0;
  const nullifiersCount = "nullifierCount" in ledger ? (ledger as any).nullifierCount : (ledger as any).nullifiers?.length ?? 0;
  const notesCount = "noteCount" in ledger ? (ledger as any).noteCount : (ledger as any).notes?.length ?? 0;
  const notesList = "notes" in ledger && Array.isArray((ledger as any).notes) ? (ledger as any).notes : [];

  return (
    <Panel kicker="Public ledger" title="What the chain discloses">
      <p className="text-sm text-muted">
        Private credit openings are omitted here. Public claim amounts, fees, reserve changes
        and linked history can reveal debt or constrain it. This view shows reserve accounting,
        commitments and the instance domain; it does not establish cash custody or merchant payout.
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
        <Stat label="Status" value={ledger.status} />
        <Stat label="Action Clock" value={ledger.actionClock} />
        <Stat label="Generation" value={ledger.lineGeneration} />
        <Stat label="Runtime" value={ledger.runtime ?? "network"} />
        <Stat label="Quotes" value={quotesCount} />
        <Stat label="Nullifiers" value={nullifiersCount} />
      </div>

      <div className="rounded border border-border bg-surface p-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Contract Reserve Accounting</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Total Reserve" value={total} />
          <Stat label="Encumbered" value={encumbered} />
          <Stat label="Redeemed" value={redeemed} />
          <Stat label="Fee Reserve" value={feeReserve} />
          <Stat label="Pending Fees" value={pendingFees} />
          <Stat label="Refund Budgets" value={refundReserve} />
          <Stat label="Reported Refund Budgets" value={reportedRefundReserve} />
          <Stat label="Withdrawable" value={withdrawable} />
        </div>
        <p className="text-xs text-muted">Refund budgets retain each original claim's full cost. They do not disclose the private cash remainder or verify a payout.</p>
      </div>

      <div className="space-y-2">
        <Stat label="Identity commitment" value={<Mono value={ledger.identityCommitment} />} />
        <Stat label="Line commitment C" value={<Mono value={ledger.lineCommitment} />} />
        <Stat label="Contract Domain" value={<Mono value={ledger.contractDomain} />} />
        <Stat label="Active Contract" value={<Mono value={ledger.contractAddress} />} />
      </div>

      {notesList.length > 0 && (
        <div className="border-t border-border pt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Settlement Claims ({notesList.length})</p>
          <ul className="space-y-2">
            {notesList.map((n: any) => (
              <li key={n.commitment} className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-border/50 pb-2">
                <div>
                  <span className="font-mono font-medium">Claim {n.amount}</span>
                  <span className="ml-2 text-muted">
                    {n.redeemed ? "Claim redeemed; payout unverified" : n.cancelled ? "Cancelled/Expired" : "Encumbered (Active Claim)"}
                  </span>
                </div>
                <Mono value={n.commitment} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
