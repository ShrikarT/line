import { useEffect, useRef, useState } from "react";
import { Shell } from "@/components/line/shell";
import { Panel } from "@/components/line/ui";

const actionClass = "inline-flex items-center justify-center rounded-md bg-accent px-3 py-2 text-base font-semibold text-accent-fg transition duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";
const linkClass = "text-accent underline underline-offset-4 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";
const benefitLines = ["Authorize agent purchases.", "Reconcile each claim."];
const benefitWords = benefitLines.join(" ").split(" ");
const benefitLineBreak = benefitLines[0].split(" ").length;

const steps = [
  { role: "Company operator", title: "Set the purchasing allowance", body: "The local evaluator records an issuer-approved limit and reserve counter. It moves no funds; a real buyer, liable entity and asset flow are not established." },
  { role: "Agent", title: "Choose a quoted service", body: "Generated Compact checks a draw against committed credit state and creates a merchant-bound claim. The local execution is not a submitted proof, and public note amounts and reserve changes reveal purchase activity." },
  { role: "Service provider", title: "Redeem the claim and deliver", body: "The evaluator redeems a claim once, then returns a deterministic local service result. That does not prove production service delivery or asset payout; those need independent receipts." },
];

const questions = [
  { question: "Who is Line for?", answer: "A company treasury or platform team running unattended API/compute purchases is an unvalidated beachhead hypothesis. No interviews or paid pilots are established. The full destination remains private revolving credit and checkout for agent fleets, issuers and service providers." },
  { question: "Why use Line alongside an agent wallet?", answer: "Agent wallets and x402 already provide spending controls, payments and claims. Line has not shown that buyers prefer its issuer-authorized model. Its current public ledger reveals amounts, reserve changes, registered merchant keys and history. Full purchase privacy, independent custody and actual settlement remain open requirements." },
  { question: "What does a merchant learn?", answer: "A merchant receives its quote and claim through the application. Public note amounts, reserve changes, registered merchant keys and transaction history are visible to any observer, including merchants. They can reveal utilization and initial debt before a private repayment; do not claim cross-merchant history privacy." },
  { question: "Does redemption transfer money?", answer: "The current contract records reserve accounting and claim redemption in credit units. The local evaluation units have no cash value or established exchange rate. The contract does not transfer tokens or prove corresponding cash exists. An actual payout requires a separately verified asset or payment integration with an explicit denomination." },
  { question: "Who can restore the agent's credit?", answer: "The issuer acknowledges a repayment after reconciling its payment evidence. This is a trusted issuer action. An agent must not be able to credit its own repayment, and paying down debt is separate from replenishing reserve liquidity." },
  { question: "What happens when a service is not delivered?", answer: "Delivery, expired claims, disputes and compensating credits need an explicit reconciliation policy. Permissionless expiry holds claim backing. The issuer or original agent can later allocate debt relief against the exact expired note and privately commit any refund remainder. An issuer refund report does not prove cash was sent; redeemed-but-undelivered disputes remain open." },
];

function BenefitStatement() {
  const element = useRef<HTMLHeadingElement>(null);
  const [visible, setVisible] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.IntersectionObserver) {
      setVisible(new Set(benefitWords.map((_, index) => index)));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const indices = entries.filter((entry) => entry.isIntersecting).map((entry) => Number((entry.target as HTMLElement).dataset.word));
      if (indices.length) setVisible((previous) => new Set([...previous, ...indices]));
      entries.filter((entry) => entry.isIntersecting).forEach((entry) => observer.unobserve(entry.target));
    }, { rootMargin: "0px 0px -15% 0px", threshold: 0.5 });
    element.current?.querySelectorAll("[data-word]").forEach((word) => observer.observe(word));
    return () => observer.disconnect();
  }, []);

  return (
    <h2 ref={element} className="max-w-[680px] text-balance font-display text-4xl font-semibold sm:text-5xl" aria-label={benefitLines.join(" ")}>
      {benefitWords.map((word, index) => (
        <span key={index}>
          {index === benefitLineBreak && <br />}
          <span aria-hidden="true" data-word={index} className="transition-opacity duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]" style={{ opacity: visible.has(index) ? 1 : 0.35, transitionDelay: `${index * 40}ms` }}>{word}</span>{" "}
        </span>
      ))}
    </h2>
  );
}

export function Home() {
  return (
    <Shell>
      <div className="space-y-12 pb-12">
        <section className="space-y-6 pt-6" aria-labelledby="home-title">
          <p className="font-mono text-xs uppercase tracking-wide text-accent">Agent purchasing protocol prototype</p>
          <h1 id="home-title" className="max-w-[680px] text-balance bg-linear-to-r from-white to-[#9B9B9B] bg-clip-text font-display text-4xl font-semibold text-transparent sm:text-5xl lg:text-6xl">
            Test issuer-authorized purchases<br className="hidden sm:block" /> for autonomous agents.
          </h1>
          <p className="max-w-[680px] text-pretty text-base text-muted sm:text-lg">
            Line explores issuer-authorized purchasing and merchant-bound claims for API and compute services. The local evaluation runs generated Compact and deterministic local services; it submits no ZK proof, confirms no network transaction, and transfers no assets.
          </p>
          <div className="space-y-3">
            <a href="/checkout" className={actionClass}>Try API checkout <span className="ml-2" aria-hidden="true">→</span></a>
            <p className="max-w-[680px] text-pretty text-sm text-muted">Public note amounts, reserve changes, registered merchant keys and history remain visible. Full purchase privacy and real settlement are not demonstrated.</p>
          </div>
          <div className="max-w-[680px] rounded-lg border border-border bg-elevated p-4 text-sm text-muted">
            <p className="font-semibold text-fg">Inspect the mechanism, then judge the outcome.</p>
            <p className="mt-2 text-pretty">Twelve Compact circuits cover issuer controls, private authorization and merchant claims. Local execution checks contract logic; a network proof, confirmed transaction and actual payout are separate evidence. Private witnesses do not hide every inference from public amounts and history.</p>
          </div>
        </section>

        <section className="space-y-6" aria-labelledby="problem-title">
          <div className="max-w-[680px] space-y-3">
            <p className="font-mono text-xs uppercase tracking-wide text-accent">From delegated budget to completed purchase</p>
            <h2 id="problem-title" className="text-balance font-display text-3xl font-semibold">Can an issuer-authorized agent purchase improve supplier reconciliation?</h2>
            <p className="text-pretty text-base text-muted">The buyer hypothesis is that an organization needs stronger agent authorization and supplier reconciliation than its current wallet, gateway or invoice process. The current public ledger reveals transaction amounts and history. An actual buyer, confidential-book guarantee, funded reserve and supplier payout are not established.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Panel kicker="Operator" title="Bound purchasing authority">
              <p className="text-sm text-muted">The issuer role controls line operations in the prototype. Independent custody is not established: line opening currently uses the agent secret as a witness in an issuer-authenticated call.</p>
            </Panel>
            <Panel kicker="Agent" title="Use a revolving allowance">
              <p className="text-sm text-muted">Request credit clearance for the quoted amount and fee. Issuer acknowledged repayments restore purchasing capacity through a new commitment.</p>
            </Panel>
            <Panel kicker="Merchant" title="Verify a claim you own">
              <p className="text-sm text-muted">Generated Compact binds a claim to the intended merchant and prevents reuse. The contract proves neither correct fulfillment nor actual merchant payment.</p>
            </Panel>
          </div>
        </section>

        <section className="space-y-4 py-6">
          <BenefitStatement />
          <p className="max-w-[680px] text-pretty text-base text-muted">The target product outcome is a permitted purchase, a delivered service and a reconciled payment obligation. The local evaluator demonstrates only generated contract accounting and deterministic service outputs.</p>
        </section>

        <section className="space-y-6" aria-labelledby="flow-title">
          <h2 id="flow-title" className="font-display text-3xl font-semibold">How a service purchase works</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.role} className="rounded-xl border border-border bg-elevated p-6">
                <p className="font-mono text-xs text-accent">{index + 1}. {step.role}</p>
                <h3 className="mt-3 font-display text-lg font-semibold">{step.title}</h3>
                <p className="mt-3 text-pretty text-sm text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-4 md:grid-cols-2" aria-label="Privacy and settlement boundaries">
          <Panel kicker="Privacy boundary" title="Private witnesses, observable history">
            <p className="text-pretty text-sm text-muted">The credit limit and outstanding debt are private witness inputs, sealed in a commitment. Public note amounts, fees, reserve changes and merchant linkage still reveal information. Initial debt can be reconstructed from draws before a private repayment.</p>
            <p className="text-pretty text-sm text-muted">Hiding credit books from a full history observer remains an explicit product requirement. Commitment confidentiality alone does not prove it.</p>
            <a href="https://github.com/ShrikarT/line/blob/main/docs/PRIVACY.md" className={linkClass}>Read the disclosure model</a>
          </Panel>
          <Panel kicker="Settlement boundary" title="A redeemed claim needs a payout rail">
            <p className="text-pretty text-sm text-muted">Funding records issuer authorized reserve capacity. Redemption moves accounting from encumbered to redeemed. These transitions do not establish cash custody or transfer tokens.</p>
            <p className="text-pretty text-sm text-muted">The complete product connects verified authorization, funded liquidity, merchant delivery and actual settlement, including reconciliation when any step fails.</p>
            <a href="/roadmap" className={linkClass}>Review the product readiness gates</a>
          </Panel>
        </section>

        <section className="space-y-4" aria-labelledby="evidence-title">
          <h2 id="evidence-title" className="font-display text-3xl font-semibold">Explore the evidence</h2>
          <p className="max-w-[680px] text-pretty text-base text-muted">Inspect the contract lifecycle and public disclosures. Treat simulator behavior, network confirmation and customer adoption as different kinds of evidence.</p>
          <div className="flex flex-wrap gap-6 text-sm">
            <a href="/circuits" className={linkClass}>Twelve circuit definitions</a>
            <a href="/lab" className={linkClass}>Adversarial scenarios</a>
            <a href="/explorer" className={linkClass}>Public accounting view</a>
            <a href="https://github.com/ShrikarT/line" className={linkClass}>Source repository</a>
          </div>
        </section>

        <section className="space-y-4" aria-labelledby="questions-title">
          <h2 id="questions-title" className="font-display text-3xl font-semibold">Before you delegate a purchase</h2>
          {questions.map(({ question, answer }) => (
            <details key={question} className="rounded-lg border border-border bg-elevated p-4">
              <summary className="cursor-pointer text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">{question}</summary>
              <p className="mt-3 max-w-[680px] text-pretty text-sm text-muted">{answer}</p>
            </details>
          ))}
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-elevated p-6">
          <h2 className="text-balance font-display text-3xl font-semibold">Follow a purchase from allowance to service response.</h2>
          <p className="max-w-[680px] text-pretty text-base text-muted">Commission text analysis from Merchant A and a processing estimate from Merchant B. The default allowance approves the first purchase and declines the second. Then acknowledge an evaluation repayment as issuer and retry the declined purchase.</p>
          <a href="/checkout" className={actionClass}>Try API checkout <span className="ml-2" aria-hidden="true">→</span></a>
          <div className="flex flex-wrap gap-6 pt-4 text-sm">
            <a href="/issuer" className={linkClass}>Issuer console</a>
            <a href="/agent" className={linkClass}>Agent console</a>
            <a href="/merchant" className={linkClass}>Merchant console</a>
          </div>
        </section>
      </div>
    </Shell>
  );
}
