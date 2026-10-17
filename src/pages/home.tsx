import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle,
  Eye,
  LockKey,
  ShieldCheck,
} from "@phosphor-icons/react";
import { Shell } from "@/components/line/shell";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useSectionReveal } from "@/components/line/motion";
import {
  CreditSculpture,
  FeatureVisual,
} from "@/components/line/credit-scene";

const FAQ = [
  [
    "What does an agent actually buy?",
    "The organization workspace offers document metrics and content integrity APIs. A supplier posts a quote, your wallet authorizes a claim, and the supplier delivers its computation after receiving the asset payout.",
  ],
  [
    "Is this running on Midnight?",
    "Line uses Compact contracts and wallet approvals on Midnight Preprod. Connect your wallet, create your organization facility and complete its verifier setup. Your own finalized transactions appear in the workspace; historical protocol receipts are separate evidence.",
  ],
  [
    "What stays private?",
    "The credit limit, debt and remaining capacity are private witnesses, not plaintext ledger fields. Public note amounts, reserve changes and transaction history can still reveal debt. Complete historical privacy remains in development.",
  ],
  [
    "Can a merchant redeem someone else's claim?",
    "Claims are bound to a merchant key and contract domain. The circuit authenticates that merchant and records a single redemption nullifier. Another merchant cannot redeem the same claim.",
  ],
  [
    "Are real payments being made?",
    "The organization contract accepts existing assets and pays registered merchant wallets. Your organization supplies its own funds. Preprod tokens have no real-money value; the new organization lifecycle must be confirmed through its own network receipts.",
  ],
  [
    "What happens if the connection drops?",
    "Your encrypted organization vault retains the original request and private opening. Reconnect the same wallet and unlock the vault to resume. An uncertain submission is checked against its exact receipt before another operation starts.",
  ],
];
const features = [
  {
    kind: "policy" as const,
    number: "01",
    role: "For the organization",
    title: "Set the spending rules.",
    copy: "Deposit your existing assets and set an agent allowance. Your organization owns its facility and approves outgoing transactions.",
  },
  {
    kind: "proof" as const,
    number: "02",
    role: "For the agent",
    title: "Prove the purchase fits.",
    copy: "Turn a merchant quote into an authorized claim. Compact checks the credit rule against the private book.",
  },
  {
    kind: "claim" as const,
    number: "03",
    role: "For the merchant",
    title: "Redeem your claim once.",
    copy: "Authenticate with your merchant key, redeem the claim and deliver the result. Each supplier gets its own claim.",
  },
];

export function Home() {
  const root = useSectionReveal();
  return (
    <Shell hideVault>
      <div ref={root} className="line-modern-home">
        <section className="modern-hero" aria-labelledby="hero-heading">
          <div className="hero-overline">
            <span className="live-dot" />
            Built on Midnight
            <span className="overline-divider" />
            Midnight Preprod <ArrowUpRight />
          </div>
          <h1 id="hero-heading">
            Spending for agents.
            <br />
            <span>On your terms.</span>
          </h1>
          <p className="modern-hero-copy">
            Give your agents the freedom to buy.
            <br className="desktop-break" /> Keep control of what they can
            spend.
          </p>
          <div className="hero-actions">
            <a
              href="/app"
              className="line-button line-button-primary line-button-large"
            >
              Open workspace <ArrowRight />
            </a>
            <a href="#how-it-works" className="hero-secondary">
              See how it works <ArrowDown />
            </a>
          </div>
          <CreditSculpture />
          <div className="modern-hero-foot">
            <span>Private witnesses. Verifiable rules.</span>
            <a href="#proof">
              <span className="live-dot" />
              28 confirmed transactions <ArrowUpRight />
            </a>
          </div>
        </section>
        <section
          id="how-it-works"
          className="line-container modern-section"
          data-reveal
        >
          <div className="modern-section-heading">
            <div>
              <p className="section-index">01 / THE PRODUCT</p>
              <h2>
                One task.
                <br />
                <span>A complete purchase.</span>
              </h2>
            </div>
            <p>
              Your treasury, your agent and your suppliers.
              <br />
              Connect your wallet. Fund a facility. Authorize a purchase.
            </p>
          </div>
          <div className="modern-feature-grid organization-home-flow">
            {[
              ["01", "Connect your wallet.", "Open the encrypted organization vault belonging to your Midnight Preprod account."],
              ["02", "Fund your agent.", "Deposit existing assets into your own facility and set its private spending allowance."],
              ["03", "Purchase a service.", "Approve the quoted purchase. The supplier redeems its claim before releasing the result."],
            ].map(([step, title, copy]) => <article className="modern-feature" key={step}><div className="feature-copy"><span className="feature-role">{step}</span><h3>{title}</h3><p>{copy}</p></div></article>)}
          </div>
        </section>
        <section className="modern-feature-section" data-reveal>
          <div className="line-container">
            <div className="modern-section-heading">
              <div>
                <p className="section-index">02 / THREE DISTINCT ROLES</p>
                <h2>
                  Every participant.
                  <br />
                  <span>One clear responsibility.</span>
                </h2>
              </div>
              <p>
                Authority stays with your organization. The agent purchases. Each
                merchant claims only what belongs to it.
              </p>
            </div>
            <div className="modern-feature-grid">
              {features.map((f) => (
                <article className="modern-feature" key={f.kind}>
                  <FeatureVisual kind={f.kind} />
                  <div className="feature-copy">
                    <span className="feature-role">
                      {f.role}
                      <span>{f.number}</span>
                    </span>
                    <h3>{f.title}</h3>
                    <p>{f.copy}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="modern-statement" data-reveal>
          <div className="line-container">
            <p className="section-index">FREEDOM WITHIN A LIMIT</p>
            <h2>
              Let your agents do the work.
              <br />
              <span>Keep the spending in your hands.</span>
            </h2>
            <a href="/agents" className="line-button line-button-primary">
              Open agent purchases <ArrowUpRight />
            </a>
            <div className="statement-line-art" aria-hidden="true">
              {Array.from({ length: 7 }, (_, i) => (
                <i key={i} />
              ))}
            </div>
          </div>
        </section>
        <section
          id="privacy"
          className="line-container modern-section modern-privacy"
          data-reveal
        >
          <div className="modern-section-heading">
            <div>
              <p className="section-index">03 / THE PRIVACY BOUNDARY</p>
              <h2>
                Prove the rule.
                <br />
                <span>Keep the book private.</span>
              </h2>
            </div>
            <p>
              Credit openings stay outside plaintext ledger fields. Public
              activity still has a disclosure boundary.
            </p>
          </div>
          <div className="privacy-product">
            <div className="privacy-secret">
              <div className="privacy-surface-top">
                <span>
                  <LockKey />
                  Private credit book
                </span>
                <span>AUTHORIZED VIEW</span>
              </div>
              <div className="privacy-hidden-values">
                {["Credit limit", "Outstanding debt", "Available capacity"].map(
                  (label) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong aria-label="Not a plaintext ledger field">
                        {"\u2022".repeat(6)}
                      </strong>
                      <LockKey />
                    </div>
                  ),
                )}
              </div>
              <div className="private-seal">
                <ShieldCheck weight="thin" aria-hidden="true" />
                <span>
                  Private witnesses
                  <br />
                  <strong>Committed. Never printed.</strong>
                </span>
              </div>
            </div>
            <div className="privacy-chain">
              <div className="privacy-surface-top">
                <span>
                  <Eye />
                  Public ledger
                </span>
                <span>OBSERVER VIEW</span>
              </div>
              <div className="chain-row">
                <span className="chain-node">
                  <Check />
                </span>
                <div>
                  <strong>Verifiable activity</strong>
                  <p>Commitments and redemption nullifiers</p>
                </div>
              </div>
              <div className="chain-row">
                <span className="chain-node">
                  <Eye />
                </span>
                <div>
                  <strong>Visible amounts and activity</strong>
                  <p>Claims, fees, reserve changes and merchant keys</p>
                </div>
              </div>
              <div className="privacy-honesty">
                <ShieldCheck />
                <p>
                  Public history can reveal debt. Full history confidentiality
                  remains in development.
                </p>
              </div>
              <a href="/privacy" className="line-text-link">
                Understand the privacy boundary <ArrowRight />
              </a>
            </div>
          </div>
        </section>
        <section id="proof" className="modern-network" data-reveal>
          <div className="line-container network-layout">
            <div className="network-intro">
              <p className="section-index">04 / ON MIDNIGHT PREPROD</p>
              <h2>
                Real proofs.
                <br />
                <span>Recorded on chain.</span>
              </h2>
              <p>
                Historical protocol deployment, merchant purchases and issuer acknowledgements have finalized receipts. These records belong to the earlier operator facility.
              </p>
              <a href="/preprod" className="line-button line-button-primary">
                Inspect historical protocol receipts <ArrowUpRight />
              </a>
            </div>
            <div className="network-evidence">
              <div className="network-counter">
                <strong>
                  28<span>tx</span>
                </strong>
                <div>
                  <span className="live-dot" />
                  <span>
                    Historical protocol facility
                    <br />
                    <small>Verified 16 October 2026</small>
                  </span>
                </div>
              </div>
              <div className="network-event">
                <span>01</span>
                <strong>Quote authenticated</strong>
                <CheckCircle weight="fill" />
              </div>
              <div className="network-event">
                <span>02</span>
                <strong>Credit rule proven</strong>
                <CheckCircle weight="fill" />
              </div>
              <div className="network-event">
                <span>03</span>
                <strong>Merchant claim redeemed</strong>
                <CheckCircle weight="fill" />
              </div>
              <p>
                This accounting facility records claims. The separate{" "}
                <a href="/test-payout" className="underline underline-offset-4">test-token checkout</a>{" "}
                pays valueless test assets. Repayment is issuer reported; one
                local operator holds the role keys.
              </p>
            </div>
          </div>
        </section>
        <section
          className="line-container modern-section modern-faq"
          data-reveal
        >
          <div>
            <p className="section-index">05 / GOOD QUESTIONS</p>
            <h2>
              A little clarity.
              <br />
              <span>Before you begin.</span>
            </h2>
            <p>
              What works today,
              <br />
              and what comes next.
            </p>
            <a href="/roadmap" className="line-text-link">
              View the roadmap <ArrowRight />
            </a>
          </div>
          <Accordion type="single" collapsible className="home-faq">
            {FAQ.map(([question, answer], index) => (
              <AccordionItem value={String(index)} key={question}>
                <AccordionTrigger>
                  <span className="faq-number" aria-hidden="true">
                    0{index + 1}
                  </span>
                  {question}
                </AccordionTrigger>
                <AccordionContent>{answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
        <section className="modern-close" data-reveal>
          <div className="line-container">
            <span className="close-mark" aria-hidden="true">
              <img src="/brand/logo-pixel.svg" alt="" />
            </span>
            <p className="section-index">YOUR NEXT PURCHASE STARTS HERE</p>
            <h2>
              Give your agents
              <br />a Line to work with.
            </h2>
            <div className="hero-actions">
              <a
                href="/app"
                className="line-button line-button-primary line-button-large"
              >
                Open workspace <ArrowRight />
              </a>
              <a href="/privacy" className="hero-secondary">
                Read the privacy scope <ArrowUpRight />
              </a>
            </div>
          </div>
        </section>
        <footer className="line-container modern-footer">
          <div className="line-footer">
            <div>
              <a href="/" className="line-wordmark">
                <img src="/brand/logo-pixel.svg" alt="" />
                Line.
              </a>
              <p>
                Private credit infrastructure
                <br />
                for autonomous agents.
              </p>
            </div>
            <nav aria-label="Footer" className="line-footer-links">
              <a href="/app">Organization workspace</a>
              <a href="/circuits">The protocol</a>
              <a href="/roadmap">Roadmap</a>
              <a href="/privacy">Privacy & scope</a>
            </nav>
          </div>
          <div className="line-footer-caption">
            <span>Line &copy; 2026</span>
            <span>Built on Midnight.</span>
            <a
              href="https://github.com/ShrikarT/line"
              target="_blank"
              rel="noreferrer"
            >
              View source <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        </footer>
      </div>
    </Shell>
  );
}
