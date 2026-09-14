import { useLine } from "@/lib/line/store.ts";
import { Panel } from "./ui";

export function DualLedger() {
  const dual = useLine((s) => s.dual);
  if (!dual) {
    return (
      <Panel kicker="Dual ledger" title="Public vs private">
        <p className="text-sm text-muted">
          Run a circuit or a demo step. The explorer never sees the right column.
        </p>
      </Panel>
    );
  }
  return (
    <Panel kicker={dual.circuit} title="Public vs private">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs uppercase tracking-wide text-subtle">Public</p>
          <p className="mt-2 text-sm">{dual.publicView}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs uppercase tracking-wide text-subtle">Private</p>
          <p className="mt-2 text-sm">{dual.privateView}</p>
        </div>
      </div>
      <p className="text-xs text-subtle">
        {dual.ok ? "Transition accepted." : "Failed proof: ledger unchanged."}
      </p>
    </Panel>
  );
}
