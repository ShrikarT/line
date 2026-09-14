import { Shell } from "@/components/line/shell";
import { Panel } from "@/components/line/ui";
import { CIRCUITS } from "@/lib/line/circuits.ts";


export function CircuitsPage() {
  return (
    <Shell>
      <div className="space-y-4">
        <p className="max-w-2xl text-sm text-muted">
          Five circuits. Compact (`contracts/line.compact`) is the source of
          truth. The TypeScript engine is a replica of Compact encodings via
          `@midnight-ntwrk/compact-runtime`.
        </p>
        {CIRCUITS.map((c) => (
          <Panel key={c.name} kicker={c.caller} title={c.name}>
            <p className="text-sm">{c.proves}</p>
            <p className="text-sm text-muted">Discloses: {c.discloses}</p>
            <p className="text-sm text-muted">Hides: {c.hides}</p>
          </Panel>
        ))}
      </div>
    </Shell>
  );
}
