import { useLine } from "@/lib/line/store.ts";
import { Mono, Panel, Stat } from "./ui";

export function ExplorerPanel() {
  const ledger = useLine((s) => s.ledger);
  return (
    <Panel kicker="Public ledger" title="What the chain discloses">
      <p className="text-sm text-muted">
        Amounts, limits, balances, and counterparties are not here. Activity
        timing is.
      </p>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Status" value={ledger.status} />
        <Stat label="Clock" value={ledger.clock} />
        <Stat label="Quotes" value={ledger.quotes.length} />
        <Stat label="Nullifiers" value={ledger.nullifiers.length} />
      </div>
      <div className="space-y-2">
        <Stat label="Identity commitment" value={<Mono value={ledger.identityCommitment} />} />
        <Stat label="Line commitment C" value={<Mono value={ledger.lineCommitment} />} />
      </div>
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
