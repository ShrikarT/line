import { Shell } from "@/components/line/shell";
import { DualLedger } from "@/components/line/dual";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Panel } from "@/components/line/ui";
import { useSimulator } from "@/dev/simulator-store.ts";

export function LabPage() {
  const flash = useSimulator((s) => s.flash);
  const doOpen = useSimulator((s) => s.doOpen);
  const doQuote = useSimulator((s) => s.doQuote);
  const attackReplay = useSimulator((s) => s.attackReplay);
  const attackFakeRepay = useSimulator((s) => s.attackFakeRepay);
  const attackOverLimit = useSimulator((s) => s.attackOverLimit);
  const attackStale = useSimulator((s) => s.attackStale);
  const attackWrongAgent = useSimulator((s) => s.attackWrongAgent);

  const attackWrongMerchantRedeem = useSimulator((s) => s.attackWrongMerchantRedeem);
  const attackDoubleRedeem = useSimulator((s) => s.attackDoubleRedeem);
  const attackWithdrawEncumbered = useSimulator((s) => s.attackWithdrawEncumbered);
  const attackCrossInstanceReplay = useSimulator((s) => s.attackCrossInstanceReplay);
  const seedActiveDrawNote = useSimulator((s) => s.seedActiveDrawNote);
  const seedRedeemedNote = useSimulator((s) => s.seedRedeemedNote);

  return (
    <Shell>
      <div className="space-y-6">
        {/* Isolated Environment Banner */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-mono text-amber-300">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="font-semibold uppercase tracking-wider">Protocol Verification Lab</span>
            <span className="text-muted">· Isolated Local Simulator Environment (Not Live Network State)</span>
          </div>
        </div>

        <Panel kicker="QA & Security" title="Attack Vector Execution & Invariant Verification">
          <p className="text-sm text-muted">
            Each button is an adversarial attack vector that must fail. A green flash confirms the protocol invariant
            held and the attack was successfully blocked in-circuit or by the Compact execution engine.
          </p>
          <FlashBar flash={flash} />

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Setup & Seeding (Deterministic States)</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={seedActiveDrawNote}>Seed Step 5 (Draw Note Active)</Button>
              <Button variant="ghost" onClick={seedRedeemedNote}>Seed Step 7 (Redeemed Note)</Button>
              <Button variant="ghost" onClick={() => doOpen(150)}>Seed line 150</Button>
              <Button variant="ghost" onClick={() => doQuote(40, "lab-40")}>Seed quote 40</Button>
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Credit Authorization & Invariant Attacks</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={attackReplay}>Replay draw</Button>
              <Button variant="ghost" onClick={attackFakeRepay}>Fake repay</Button>
              <Button variant="ghost" onClick={attackOverLimit}>Over-limit</Button>
              <Button variant="ghost" onClick={attackStale}>Stale C</Button>
              <Button variant="ghost" onClick={attackWrongAgent}>Wrong agent</Button>
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Settlement Claim & Reserve Solvency Attacks</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={attackWrongMerchantRedeem}>
                Wrong Merchant Redeem (B steals A)
              </Button>
              <Button variant="ghost" onClick={attackDoubleRedeem}>
                Double-Redeem Note
              </Button>
              <Button variant="ghost" onClick={attackWithdrawEncumbered}>
                Issuer Rug (Drain Encumbered Reserve)
              </Button>
              <Button variant="ghost" onClick={attackCrossInstanceReplay}>
                Cross-Instance Replay
              </Button>
            </div>
          </div>
        </Panel>
        <DualLedger />
        <ExplorerPanel />
      </div>
    </Shell>
  );
}
