import { Shell } from "@/components/line/shell";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "@phosphor-icons/react";

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

const evidence = [
  { status: "Verified demo", detail: "Two merchants delivered through finalized Preprod claims. External suppliers remain a future integration." },
  { status: "Partially verified", detail: "Encrypted recovery is implemented. Independent organizations do not yet hold the demo role keys." },
  { status: "Under development", detail: "Private ledger fields are hidden. Complete historical confidentiality is not established." },
  { status: "Not connected", detail: "Accounting and claims are implemented. Payment assets, custody and merchant payouts are not connected." },
  { status: "Verified demo", detail: "22 finalized transactions demonstrate the deployed purchase and repayment journey; broader network acceptance remains separate." },
  { status: "Needs validation", detail: "Enterprise API and compute purchasing is a customer hypothesis. No customer or supplier adoption is claimed." },
];

export function RoadmapPage() {
  return <Shell hideVault><div className="flex flex-col gap-8">
    <div className="line-page-intro"><div><p className="line-eyebrow">Product readiness / Roadmap</p><h1>Built in public.<br />Measured in evidence.</h1></div><p>From private credit authorization to dependable agent commerce. Six gates define the complete product beyond this demo.</p></div>
    <div className="roadmap-overview"><div><span className="line-eyebrow">Working today</span><h2>Two merchants.<br />One verified journey.</h2><p>Actual Compact proofs, finalized Preprod transactions and a private book that survives restart.</p><a className="line-button line-button-primary" href="/preprod">Open live checkout <ArrowRight aria-hidden="true" /></a></div><div><span className="line-eyebrow">The next product gates</span><p>Independent custody. Full-history privacy. Real settlement. Validated demand.</p><span className="text-sm text-muted">A working demo is evidence of execution. Each production requirement below needs its own acceptance evidence.</span></div></div>
    <Accordion type="multiple" defaultValue={[gates[0].kicker]} className="roadmap-list">{gates.map((gate, index) => <AccordionItem key={gate.kicker} value={gate.kicker}>
      <AccordionTrigger><div className="roadmap-heading"><span className="roadmap-number">{String(index + 1).padStart(2, "0")}</span><div><span className="line-eyebrow">{gate.kicker}</span><h2>{gate.title}</h2><Badge variant={evidence[index].status === "Verified demo" ? "secondary" : "outline"}>{evidence[index].status}</Badge></div></div></AccordionTrigger>
      <AccordionContent><div className="roadmap-content"><p className="roadmap-evidence">{evidence[index].detail}</p><h3>Acceptance requirements</h3><ul>{gate.items.map(item => <li key={item}>{item}</li>)}</ul></div></AccordionContent>
    </AccordionItem>)}</Accordion>
    <div className="scope-callout"><div><h2>Keep the protocol honest.</h2><p>Compact remains the source of truth. The canonical protocol has twelve circuits. Planned capabilities are not presented as operational or as customer evidence.</p></div></div>
    <a href="/checkout" className="line-text-link">Try API checkout <ArrowRight aria-hidden="true" /></a>
  </div></Shell>;
}
