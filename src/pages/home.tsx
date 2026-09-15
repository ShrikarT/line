import { Shell } from "@/components/line/shell";
import { DualLedger } from "@/components/line/dual";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Panel, ResetRow, Stat } from "@/components/line/ui";
import { DEMO_STEPS } from "@/lib/line/demo.ts";
import { available } from "@/lib/line/protocol.ts";
import { useLine } from "@/lib/line/store.ts";


export function Home() {
  const flash = useLine((s) => s.flash);
  const runDemo = useLine((s) => s.runDemo);
  const setDemoStep = useLine((s) => s.setDemoStep);
  const demoStep = useLine((s) => s.demoStep);
  const agent = useLine((s) => s.agent);
  const ledger = useLine((s) => s.ledger);

  return (
    <Shell>
      <div className="space-y-8">
        <section className="max-w-2xl space-y-4">
          <p className="text-xs font-medium uppercase tracking-wide text-subtle">
            Midnight Buildathon · Wave 1
          </p>
          <h1 className="font-display text-4xl leading-tight tracking-tight md:text-5xl">
            Prove the purchase is affordable. Never publish the books.
          </h1>
          <p className="text-muted">
            Revolving credit, not a spend cap. Issuer underwrites. Agent draws.
            Merchant gets a one-time authorization. Failed proofs write nothing.
            Wave 1 does not move tokens.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setDemoStep(Math.min(10, demoStep + 1))}>
              Next demo step
            </Button>
            <Button variant="ghost" onClick={runDemo}>
              Jump to end
            </Button>
            <ResetRow />
          </div>
          <FlashBar flash={flash} />
        </section>

        <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {DEMO_STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setDemoStep(s.id)}
              className={
                "rounded-md border px-3 py-2 text-left text-xs transition-colors duration-[var(--motion-quick)] " +
                (demoStep === s.id
                  ? "border-accent bg-elevated text-fg"
                  : "border-border text-muted")
              }
            >
              <span className="font-mono text-subtle">{s.id}</span> {s.title}
            </button>
          ))}
        </div>

        <DualLedger />

        <div className="grid gap-4 md:grid-cols-3">
          <Panel kicker="Public" title="Explorer">
            <p className="text-sm text-muted">
              Status {ledger.status}. Action clock {ledger.actionClock}. Commitment rotates;
              books do not appear.
            </p>
          </Panel>
          <Panel kicker="Settlement" title="Authorization only">
            <p className="text-sm text-muted">
              Wave 1 does not move tokens. A successful draw is clearance, not a
              payout. Escrow redeemable by the draw nullifier is Wave 2.
            </p>
          </Panel>
          <Panel kicker="Agent" title="Private capacity">
            {agent?.witness ? (
              <Stat label="Available" privateHint value={available(agent.witness)} />
            ) : (
              <p className="text-sm text-subtle">No line in the agent store.</p>
            )}
          </Panel>
        </div>

        <ExplorerPanel />
      </div>
    </Shell>
  );
}
