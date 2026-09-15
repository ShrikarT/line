import { Shell } from "@/components/line/shell";
import { Panel } from "@/components/line/ui";


export function RoadmapPage() {
  return (
    <Shell>
      <div className="space-y-6 max-w-3xl">
        <h1 className="font-display text-3xl tracking-tight">Roadmap</h1>
        <Panel kicker="Delivered" title="Wave 1 — Confidential Authorization">
          <p className="text-sm text-muted">
            Private revolving balance, issuer receipts, opaque quotes, attack
            lab. Issuer underwrites, agent draws, merchant verifies. Explorer never shows credit books.
          </p>
        </Panel>
        <Panel kicker="Now — Delivered" title="Wave 2 — Private Credit Settlement Prototype">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
            <li>Exact Compact settlement accounting: strictly verified reserve pool escrow</li>
            <li>Multi-merchant support (Merchant A & Merchant B) with domain separation</li>
            <li>Private merchant-bound draw notes issued on draw, encumbering reserves</li>
            <li>Single-redemption nullifiers preventing double-claims</li>
            <li>Unencumbered reserve withdrawal protections and note expiry release</li>
            <li>10 verified Compact circuits compiled with Compact 0.34.0</li>
          </ul>
        </Panel>
        <Panel kicker="Next" title="Wave 3 — Midnight Testnet & Cross-Chain Settlement">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
            <li>Midnight Preprod/Testnet on-chain contract deployment with full ZK proving keys</li>
            <li>Midnight native token transfers / ADA cross-chain settlement bridge</li>
            <li>Lace wallet integration for agent and issuer secret custody</li>
            <li>Decentralized identity / credentials for portable underwriting</li>
          </ul>
        </Panel>
      </div>
    </Shell>
  );
}
