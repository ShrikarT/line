import { Shell } from "@/components/line/shell";
import { DualLedger } from "@/components/line/dual";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Panel } from "@/components/line/ui";
import { useLine } from "@/lib/line/store.ts";


export function LabPage() {
  const flash = useLine((s) => s.flash);
  const doOpen = useLine((s) => s.doOpen);
  const doQuote = useLine((s) => s.doQuote);
  const attackReplay = useLine((s) => s.attackReplay);
  const attackFakeRepay = useLine((s) => s.attackFakeRepay);
  const attackOverLimit = useLine((s) => s.attackOverLimit);
  const attackStale = useLine((s) => s.attackStale);
  const attackWrongAgent = useLine((s) => s.attackWrongAgent);

  const attackWrongMerchantRedeem = useLine((s) => s.attackWrongMerchantRedeem);
  const attackDoubleRedeem = useLine((s) => s.attackDoubleRedeem);
  const attackWithdrawEncumbered = useLine((s) => s.attackWithdrawEncumbered);
  const attackCrossInstanceReplay = useLine((s) => s.attackCrossInstanceReplay);
  const setDemoStep = useLine((s) => s.setDemoStep);

  return (
    <Shell>
      <div className="space-y-6">
        <Panel kicker="QA & Security" title="Attack Lab">
          <p className="text-sm text-muted">
            Each button is an attack vector that must fail. A green flash means the protocol invariant
            held and the attack was successfully blocked in-circuit or by the engine.
          </p>
          <FlashBar flash={flash} />

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Setup & Seeding</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDemoStep(5)}>Seed Step 5 (Draw Note Active)</Button>
              <Button variant="ghost" onClick={() => setDemoStep(7)}>Seed Step 7 (Redeemed Note)</Button>
              <Button variant="ghost" onClick={() => doOpen(150)}>Seed line 150</Button>
              <Button variant="ghost" onClick={() => doQuote(40, "lab-40")}>Seed quote 40</Button>
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Wave 1 Credit Lifecycle Attacks</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={attackReplay}>Replay draw</Button>
              <Button variant="ghost" onClick={attackFakeRepay}>Fake repay</Button>
              <Button variant="ghost" onClick={attackOverLimit}>Over-limit</Button>
              <Button variant="ghost" onClick={attackStale}>Stale C</Button>
              <Button variant="ghost" onClick={attackWrongAgent}>Wrong agent</Button>
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Wave 2 Settlement & Reserve Attacks</p>
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
