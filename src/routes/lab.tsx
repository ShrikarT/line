import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/line/shell";
import { DualLedger } from "@/components/line/dual";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Panel } from "@/components/line/ui";
import { useLine } from "@/lib/line/store.ts";

export const Route = createFileRoute("/lab")({ component: LabPage });

function LabPage() {
  const flash = useLine((s) => s.flash);
  const doOpen = useLine((s) => s.doOpen);
  const doQuote = useLine((s) => s.doQuote);
  const attackReplay = useLine((s) => s.attackReplay);
  const attackFakeRepay = useLine((s) => s.attackFakeRepay);
  const attackOverLimit = useLine((s) => s.attackOverLimit);
  const attackStale = useLine((s) => s.attackStale);
  const attackWrongAgent = useLine((s) => s.attackWrongAgent);

  return (
    <Shell>
      <div className="space-y-6">
        <Panel kicker="QA" title="Attack lab">
          <p className="text-sm text-muted">
            Each button is a circuit that should fail. A green result means the
            invariant held. Seed a line, then attack it.
          </p>
          <FlashBar flash={flash} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => doOpen(150)}>Seed line 150</Button>
            <Button variant="ghost" onClick={() => doQuote(40, "lab-40")}>
              Seed quote 40
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={attackReplay}>
              Replay draw
            </Button>
            <Button variant="ghost" onClick={attackFakeRepay}>
              Fake repay
            </Button>
            <Button variant="ghost" onClick={attackOverLimit}>
              Over-limit
            </Button>
            <Button variant="ghost" onClick={attackStale}>
              Stale C
            </Button>
            <Button variant="ghost" onClick={attackWrongAgent}>
              Wrong agent
            </Button>
          </div>
        </Panel>
        <DualLedger />
        <ExplorerPanel />
      </div>
    </Shell>
  );
}
