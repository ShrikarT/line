import { Shell } from "@/components/line/shell";
import { Panel } from "@/components/line/ui";

const gates = [
  {
    kicker: "Purchase outcome",
    title: "An agent buys and receives a useful service",
    items: [
      "A company operator grants a credit allowance; an agent selects quoted API or compute services from distinct merchants.",
      "A permitted purchase produces a merchant claim and a service response. An over capacity request returns only: Clearance could not be proven.",
      "Merchant B cannot redeem Merchant A's claim. Retries cannot duplicate a draw, redemption, service delivery or repayment credit.",
      "Verification: an end to end purchase test covers two merchants, fulfilled output, rejection, replay and issuer reconciliation, using generated Compact execution.",
    ],
  },
  {
    kicker: "Custody and recovery",
    title: "Each participant controls only its authority",
    items: [
      "Issuer, agent and each merchant use distinct keys and private state. Agent tools cannot administer reserves, reopen a line or acknowledge repayment.",
      "Locking revokes signing capability across the UI, runtime and provider caches. Encrypted recovery preserves the latest commitment opening.",
      "A durable operation journal reconciles an interrupted transaction against confirmed contract state before another purchase proceeds.",
      "Verification: separate role sessions, timeout and reload tests, crash recovery after submission, and unauthorized action tests.",
    ],
  },
  {
    kicker: "Privacy outcome",
    title: "Credit confidentiality holds under the stated observer model",
    items: [
      "Keep credit limits, debt and remaining capacity in private witnesses; inspect public transcripts as well as ledger fields.",
      "The present singleton line and public note amounts leak utilization and initial debt. Full history confidentiality requires verified changes to amount disclosure, linkage and state aggregation.",
      "Evaluate private merchant membership and multiple concurrent lines for stronger anonymity while preserving domain isolation and exact accounting.",
      "Verification: adversarial history reconstruction, transcript analysis, metadata disclosure inventory and explicit limits for merchants, issuers and proof providers.",
    ],
  },
  {
    kicker: "Economic outcome",
    title: "Funded liquidity becomes a reconciled merchant payout",
    items: [
      "Define the asset or currency, unit scale and custody mechanism. Connect reserve capacity to demonstrably funded assets or an accountable external payout rail. Claim redemption and payout confirmation remain separate states.",
      "Specify pricing, underwriting, credit exposure, default and recovery. Decide who bears non delivery, expiry and settlement losses.",
      "Implement fee authorization, stable payment deduplication, compensating credits and dispute handling. Cancelling a note must not silently become a refund claim.",
      "Establish redemption windows that unrelated transaction traffic cannot shorten, and preserve obligations through default, closure and recovery.",
      "Verification: reconcile funded assets, liabilities, fees, paid claims and refunds; test duplicate events, failed payouts and merchant delivery failures.",
    ],
  },
  {
    kicker: "Network operation",
    title: "The same lifecycle works on a supported Midnight network",
    items: [
      "Select a compatible compiler, runtime, ledger, wallet, indexer and proof stack. Build and distribute matching managed bindings and proving artifacts.",
      "Use typed wallet and contract adapters, correct target network defaults and durable private state. Fail clearly when configuration or recovery material is missing.",
      "Verify deployment and every role transition through actual proofs, wallet balancing, submission and successful finalization.",
      "Verification: a reproducible deployment manifest, contract address, transaction receipts and decoded post state. Local execution alone does not satisfy this gate.",
    ],
  },
  {
    kicker: "Adoption and scale",
    title: "Customers and merchants can depend on the product",
    items: [
      "Validate enterprise API and compute procurement with treasury operators and service providers: what must remain private, who supplies liquidity, and when a merchant will deliver.",
      "Measure service success, settlement failures, recovery, operating cost and authorization latency using recorded evidence. Establish pricing from customer willingness to pay.",
      "Extend to concurrent agent facilities, pooled liquidity, delegated expenditure policies and multiple issuers with explicit risk boundaries.",
      "Evaluate portable underwriting, cross chain payouts and enterprise key custody against real integration needs and independently tested security assumptions.",
      "Verification: consented customer findings, real pilot outcomes and load and recovery tests. Planned capabilities and adoption evidence must be labeled separately.",
    ],
  },
];

export function RoadmapPage() {
  return (
    <Shell>
      <div className="max-w-4xl space-y-6 pb-12">
        <div className="max-w-[680px] space-y-3">
          <p className="font-mono text-xs uppercase tracking-wide text-accent">Product readiness</p>
          <h1 className="text-balance font-display text-3xl font-semibold">From private credit authorization to dependable agent commerce</h1>
          <p className="text-pretty text-base text-muted">Line's full direction is confidential purchasing authority, funded merchant settlement and useful service delivery for autonomous agents. Enterprise API and compute procurement is the initial customer path. These gates define the complete outcome, without reducing the ambition to a demo or a submission date.</p>
        </div>
        <Panel kicker="Current mechanism" title="Twelve Compact circuits for authorization and accounting">
          <p className="text-pretty text-sm text-muted">The repository includes issuer controls, merchant quotes, private witness authorization, merchant bound notes, reserve accounting and redemption nullifiers. Local execution demonstrates contract transitions. Current public amounts and transaction history limit confidentiality; accounting counters do not establish funded assets or token payout.</p>
          <p className="text-pretty text-sm text-muted">Each gate below is a requirement with its own verification criteria. Listing it does not assert that it has been completed. Read the engineering status and transaction evidence before treating a capability as operational.</p>
        </Panel>
        {gates.map((gate) => (
          <Panel key={gate.kicker} kicker={gate.kicker} title={gate.title}>
            <ul className="list-disc space-y-3 pl-4 text-sm text-muted">
              {gate.items.map((item) => <li key={item} className="text-pretty">{item}</li>)}
            </ul>
          </Panel>
        ))}
        <p className="text-sm text-muted">Protocol changes preserve Compact as the source of truth and the twelve circuit boundary. Changes that require a different protocol shape need an explicit versioned design and compatibility review.</p>
        <a href="/checkout" className="inline-flex rounded-md bg-accent px-3 py-2 text-base font-semibold text-accent-fg transition duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">Try API checkout</a>
      </div>
    </Shell>
  );
}
