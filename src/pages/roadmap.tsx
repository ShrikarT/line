import { Shell } from "@/components/line/shell";
import { Panel } from "@/components/line/ui";

export function RoadmapPage() {
  return (
    <Shell>
      <div className="space-y-6 max-w-3xl">
        <h1 className="font-display text-3xl tracking-tight">Product Roadmap</h1>
        <p className="text-sm text-muted">
          Line delivers confidential credit lines and verifiable checkout infrastructure for autonomous agents.
        </p>

        <Panel kicker="Current Release — v0.3.0" title="Private Credit Authorization & Settlement Accounting">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
            <li>10 verified Midnight Compact circuits compiled with toolchain 0.34.0</li>
            <li>Confidential revolving credit balance ($L, B$) proven in ZK; never visible on-chain</li>
            <li>Exact Compact settlement accounting: verifiable reserve pool solvency and tracking</li>
            <li>Multi-merchant network with domain-bound quotes, claims, and redemption nullifiers</li>
            <li>Contract domain isolation via constructor instance nonce</li>
            <li>Model Context Protocol (MCP) server with 8 tools over JSON-RPC</li>
            <li>WebCrypto AES-GCM client security vault with IndexedDB encrypted storage</li>
            <li>Machine-checked privacy inventory and leakage verification suite (99 passing tests)</li>
          </ul>
        </Panel>

        <Panel kicker="Upcoming — v0.4.0" title="Midnight Preprod Deployment & Shielded Asset Settlement">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
            <li>Midnight Preprod public testnet deployment with full proving key packages</li>
            <li>Direct deposit and redemption with Midnight native shielded assets</li>
            <li>Lace Web3 wallet connector for agent and issuer private secret custody</li>
            <li>Automated settlement daemon for merchant invoice fulfillment reconciliation</li>
          </ul>
        </Panel>

        <Panel kicker="Upcoming — v0.5.0" title="Multi-Issuer Syndication & Delegated Policy Modules">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
            <li>Syndicated credit vaults with multiple risk-sharing capital providers</li>
            <li>Programmable ZK expenditure policies (velocity limits, merchant categorization)</li>
            <li>Zero-knowledge interest rate and term loan calculation circuits</li>
          </ul>
        </Panel>

        <Panel kicker="Future — v1.0.0" title="Portable Agent Underwriting & Cross-Chain Settlement">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
            <li>Decentralized agent credit scores and portable zero-knowledge underwriting credentials</li>
            <li>Cross-chain settlement finality to Cardano and EVM ecosystems</li>
            <li>Enterprise MPC key management for large-scale autonomous agent fleets</li>
          </ul>
        </Panel>
      </div>
    </Shell>
  );
}
