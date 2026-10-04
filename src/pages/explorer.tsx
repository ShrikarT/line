import { Shell } from "@/components/line/shell";
import { ExplorerPanel } from "@/components/line/explorer";
import { Panel } from "@/components/line/ui";
import { useLine } from "@/lib/line/store.ts";
import { Mono } from "@/components/line/ui";


export function ExplorerPage() {
  const ledger = useLine((s) => s.ledger);
  const quotes = (ledger as any).quotes ?? [];
  const nullifiers = (ledger as any).nullifiers ?? [];

  return (
    <Shell>
      <div className="space-y-6">
        <ExplorerPanel />
        <div className="grid gap-6 md:grid-cols-2">
          <Panel kicker="Public" title="Quote commitments">
            <ul className="space-y-2">
              {quotes.length === 0 ? (
                <li className="text-sm text-subtle">None</li>
              ) : (
                quotes.map((q: any) => (
                  <li key={q.commitment} className="text-sm">
                    <Mono value={q.commitment} />{" "}
                    <span className="text-subtle">{q.used ? "used" : "open"}</span>
                  </li>
                ))
              )}
            </ul>
          </Panel>
          <Panel kicker="Public" title="Nullifiers">
            <ul className="space-y-2">
              {nullifiers.length === 0 ? (
                <li className="text-sm text-subtle">None</li>
              ) : (
                nullifiers.map((n: any) => (
                  <li key={n}>
                    <Mono value={n} />
                  </li>
                ))
              )}
            </ul>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
