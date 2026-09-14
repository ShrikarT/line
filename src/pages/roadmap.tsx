import { Shell } from "@/components/line/shell";
import { Panel } from "@/components/line/ui";


export function RoadmapPage() {
  return (
    <Shell>
      <div className="space-y-6 max-w-3xl">
        <h1 className="font-display text-3xl tracking-tight">Roadmap</h1>
        <Panel kicker="Now" title="Wave 1 — authorization">
          <p className="text-sm text-muted">
            Private revolving balance, issuer receipts, opaque quotes, attack
            lab. Merchant is authorized, not auto-paid in tokens.
          </p>
        </Panel>
        <Panel kicker="Next" title="Wave 2 — settlement">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
            <li>Issuer shielded escrow redeemable with the draw nullifier</li>
            <li>Per-invoice notes instead of one pooled B</li>
            <li>Unlinkable draws (note / UTXO)</li>
            <li>Portable issuer credential and a second merchant</li>
            <li>compactc on Midnight testnet; Lace for the agent secret</li>
          </ul>
        </Panel>
        <Panel kicker="Then" title="Wave 3 — network">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
            <li>Protocol fees, human BNPL skin, Cardano settlement</li>
            <li>Pay-per-crawl policy packs, production MCP</li>
            <li>Auditor unwrap, issuer marketplace</li>
          </ul>
        </Panel>
      </div>
    </Shell>
  );
}
