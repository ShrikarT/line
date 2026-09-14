import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/line/shell";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Panel, ResetRow, Stat } from "@/components/line/ui";
import { available } from "@/lib/line/protocol.ts";
import { useLine } from "@/lib/line/store.ts";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const flash = useLine((s) => s.flash);
  const runDemo = useLine((s) => s.runDemo);
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
            Line is private revolving credit for autonomous agents. An issuer
            underwrites a limit. An agent draws against it. A merchant receives a
            one-time authorization — not a public credit file.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={runDemo}>Run scripted demo</Button>
            <ResetRow />
          </div>
          <FlashBar flash={flash} />
        </section>

        <div className="grid gap-4 md:grid-cols-3">
          <Panel kicker="Public" title="Explorer">
            <p className="text-sm text-muted">
              Status {ledger.status}. Commitment rotates on each successful
              circuit. No 150, no 40, no merchant name.
            </p>
          </Panel>
          <Panel kicker="Merchant" title="Authorization, not settlement">
            <p className="text-sm text-muted">
              Wave 1 does not move tokens. A cleared draw is an issuer-backed
              claim the desk will honor off-chain.
            </p>
          </Panel>
          <Panel kicker="Agent" title="Private capacity">
            {agent?.witness ? (
              <Stat
                label="Available"
                privateHint
                value={available(agent.witness)}
              />
            ) : (
              <p className="text-sm text-subtle">No line in the agent store.</p>
            )}
          </Panel>
        </div>

        <ol className="grid gap-3 text-sm text-muted md:grid-cols-2">
          {[
            "Issuer opens a line (limit 150, private).",
            "Merchant posts a 40-unit opaque quote.",
            "Agent draw 40 rotates C.",
            "Replay dies on the nullifier.",
            "Draw 120 cannot be proven.",
            "Issuer acknowledges repayment of 40.",
            "Draw 120 clears.",
            "Issuer defaults the line. Further draws fail.",
          ].map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="font-mono text-xs text-subtle">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <ExplorerPanel />
      </div>
    </Shell>
  );
}
