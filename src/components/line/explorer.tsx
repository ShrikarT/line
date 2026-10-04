import { useAppStore } from "@/app/store.ts";
import { Mono, Panel, Stat } from "./ui";

export function ExplorerPanel() {
  const ledger = useAppStore((s) => s.ledger);
  const total = ledger.totalReserve ?? 0;
  const encumbered = ledger.encumberedReserve ?? 0;
  const redeemed = ledger.redeemedReserve ?? 0;
  const withdrawable = ledger.withdrawableReserve ?? Math.max(0, total - (encumbered + redeemed));

  const quotesCount = "quoteCount" in ledger ? (ledger as any).quoteCount : (ledger as any).quotes?.length ?? 0;
  const nullifiersCount = "nullifierCount" in ledger ? (ledger as any).nullifierCount : (ledger as any).nullifiers?.length ?? 0;
  const notesCount = "noteCount" in ledger ? (ledger as any).noteCount : (ledger as any).notes?.length ?? 0;
  const notesList = "notes" in ledger && Array.isArray((ledger as any).notes) ? (ledger as any).notes : [];

  return (
    <Panel kicker="Public ledger" title="What the chain discloses">
      <p className="text-sm text-muted">
        The agent&apos;s credit limit, outstanding debt and remaining capacity remain private.
        Settlement amount and merchant pseudonym are public in this protocol version.
        The public explorer verifies reserve solvency, commitment progression, claim notes,
        and instance domain nonce.
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
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">On-Chain Settlement Reserve Capacity</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total Reserve" value={total} />
          <Stat label="Encumbered" value={encumbered} />
          <Stat label="Redeemed" value={redeemed} />
          <Stat label="Withdrawable" value={withdrawable} />
        </div>
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
                    {n.redeemed ? "Redeemed (Claim Settled)" : n.cancelled ? "Cancelled/Expired" : "Encumbered (Active Claim)"}
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
