import { useLine } from "@/lib/line/store.ts";
import { Mono, Panel, Stat } from "./ui";

export function ExplorerPanel() {
  const ledger = useLine((s) => s.ledger);
  const locked = (ledger.encumberedReserve ?? 0) + (ledger.redeemedReserve ?? 0);
  const withdrawable = Math.max(0, (ledger.totalReserve ?? 0) - locked);
  const merchantCount = Object.keys(ledger.registeredMerchants ?? {}).length;

  return (
    <Panel kicker="Public ledger" title="What the chain discloses">
      <p className="text-sm text-muted">
        Amounts, limits, balances, and counterparties are hidden. Public explorer shows verified
        reserve solvency, commitment progression, anonymous note settlements, and domain nonce.
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
        <Stat label="Status" value={ledger.status} />
        <Stat label="Action Clock" value={ledger.actionClock} />
        <Stat label="Generation" value={ledger.lineGeneration} />
        <Stat label="Merchants" value={merchantCount} />
        <Stat label="Quotes" value={ledger.quotes.length} />
        <Stat label="Nullifiers" value={ledger.nullifiers.length} />
      </div>

      <div className="rounded border border-border bg-surface p-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Reserve Accounting (Wave 2 Settlement)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total Reserve" value={ledger.totalReserve ?? 0} />
          <Stat label="Encumbered" value={ledger.encumberedReserve ?? 0} />
          <Stat label="Redeemed" value={ledger.redeemedReserve ?? 0} />
          <Stat label="Withdrawable" value={withdrawable} />
        </div>
      </div>

      <div className="space-y-2">
        <Stat label="Identity commitment" value={<Mono value={ledger.identityCommitment} />} />
        <Stat label="Line commitment C" value={<Mono value={ledger.lineCommitment} />} />
        <Stat label="Contract Domain" value={<Mono value={ledger.contractDomain} />} />
      </div>

      {ledger.notes.length > 0 && (
        <div className="border-t border-border pt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Settlement Notes ({ledger.notes.length})</p>
          <ul className="space-y-2">
            {ledger.notes.map((n) => (
              <li key={n.commitment} className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-border/50 pb-2">
                <div>
                  <span className="font-mono font-medium">Note {n.amount}</span>
                  <span className="ml-2 text-muted">
                    {n.redeemed ? "Redeemed (Paid)" : n.cancelled ? "Cancelled/Expired" : "Encumbered (Active)"}
                  </span>
                </div>
                <Mono value={n.commitment} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-3 border-t border-border pt-4">
        {ledger.events.length === 0 ? (
          <li className="text-sm text-subtle">No transitions yet.</li>
        ) : (
          ledger.events.map((e) => (
            <li key={`${e.t}-${e.circuit}`} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{e.circuit}</span>
                <span className="font-mono text-xs text-subtle">t={e.t}</span>
              </div>
              <p className="text-muted">{e.publicNote}</p>
              {e.commitment ? (
                <p className="mt-1">
                  C <Mono value={e.commitment} />
                </p>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </Panel>
  );
}
