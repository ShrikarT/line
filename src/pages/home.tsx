import { Shell } from "@/components/line/shell";
import { PixelDivider } from "@/components/line/ui";

const FLOW = [
  { number: "01", role: "Issuer", title: "Set the spending line", description: "Authorize the agent’s limit and reserve. The agent can buy services, but cannot raise its own limit." },
  { number: "02", role: "Agent", title: "Turn a task into purchases", description: "Request quotes from both merchants. Every purchase must clear the issuer’s credit rules." },
  { number: "03", role: "Merchants", title: "Redeem a claim. Deliver a result.", description: "Each merchant redeems its own claim once. Analysis and processing estimates return to the agent." },
];

export function Home() {
  return (
    <Shell hideVault>
      <div className="flex flex-col gap-10 pb-8">
        <section className="rounded-2xl bg-charcoal p-6 text-cream sm:p-10 lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div className="flex flex-col gap-6">
              <img src="/brand/logo-pixel.svg" alt="" className="h-14 w-fit" />
              <p className="text-xs font-semibold uppercase tracking-widest text-pink">Built with Midnight Compact · Local demo</p>
              <h1 className="max-w-2xl font-display text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">Credit for agents.<br />Control for your team.</h1>
              <p className="max-w-xl text-base text-cream/80 sm:text-lg">Give an agent a spending line across API suppliers. Set the rules, follow every purchase, and see both merchants deliver in one interactive demo.</p>
              <div className="flex flex-wrap items-center gap-4">
                <a href="/checkout" className="inline-flex min-h-12 items-center justify-center rounded-md bg-accent px-5 text-base font-semibold text-accent-fg transition-opacity hover:opacity-90 active:scale-[0.98]">Try API checkout <span aria-hidden="true" className="ml-3">→</span></a>
                <span className="text-sm text-cream/80">No wallet needed</span>
              </div>
              <p className="text-xs text-cream/80">Generated Compact runs locally. Demo units only; no proof submission or token transfers.</p>
            </div>
            <div className="rounded-xl border border-cream/20 bg-charcoal p-6">
              <div className="mb-6 flex items-center justify-between gap-3"><span className="text-xs font-semibold uppercase tracking-widest text-pink">The purchasing plan</span><span className="rounded-full border border-cream/20 px-3 py-1 text-xs">2 suppliers</span></div>
              <div className="flex flex-col gap-4">
                <div className="rounded-lg border border-cream/20 p-4"><p className="text-sm text-pink">Merchant A</p><div className="mt-2 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">Document analysis</h2><span className="font-mono text-sm">25 units</span></div><p className="mt-2 text-sm text-cream/80">Word counts, sentences and recurring terms.</p></div>
                <div className="rounded-lg border border-cream/20 p-4"><p className="text-sm text-pink">Merchant B</p><div className="mt-2 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">Processing estimate</h2><span className="font-mono text-sm">20 units</span></div><p className="mt-2 text-sm text-cream/80">Payload size and a disclosed token estimate.</p></div>
                <div className="flex items-center justify-between gap-4 pt-2 text-sm"><span className="text-cream/80">One shared credit line</span><span className="font-semibold">Issuer controls the limit</span></div>
              </div>
            </div>
          </div>
        </section>
        <section aria-label="How Line works" className="grid gap-4 md:grid-cols-3">
          {FLOW.map(step => <article key={step.number} className="rounded-xl border border-border bg-elevated p-6"><p className="text-xs font-semibold uppercase tracking-widest text-muted">{step.number} / {step.role}</p><h2 className="mt-4 font-display text-xl font-semibold">{step.title}</h2><p className="mt-3 text-sm text-muted">{step.description}</p></article>)}
        </section>
        <PixelDivider />
        <section className="grid gap-6 md:grid-cols-2 md:items-center">
          <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">Give the agent room to work.<br />Keep the spending rules.</h2>
          <div className="flex flex-col gap-4 text-sm text-muted"><p>Try the complete purchase flow first. Then choose the smaller credit line to see a generic decline, issuer repayment acknowledgement, and a retry of the blocked purchase.</p><p>The same issuer policy governs both merchants. Quotes, clearance, claim redemption and delivery stay visible in the demo.</p></div>
        </section>
        <section className="rounded-xl border border-border bg-elevated p-6">
          <div className="grid gap-4 sm:grid-cols-3"><div><p className="text-xs uppercase tracking-wide text-muted">Contract engine</p><p className="mt-2 text-xl font-semibold">12 Compact circuits</p></div><div><p className="text-xs uppercase tracking-wide text-muted">Claim redemption</p><p className="mt-2 text-xl font-semibold">One merchant. One use.</p></div><div><p className="text-xs uppercase tracking-wide text-muted">Buyer controls</p><p className="mt-2 text-xl font-semibold">Issuer defined capacity</p></div></div>
        </section>
        <details className="rounded-xl border border-border bg-elevated p-6"><summary className="cursor-pointer text-sm font-semibold">Demo scope and protocol tools</summary><div className="mt-4 flex flex-col gap-4 text-sm text-muted"><p>This is a local protocol demonstration with two deterministic services and shared server administration. Claim redemption is accounting; it does not verify a payment. Public amounts and history can reveal debt. Complete historical privacy and live settlement remain in development.</p><nav aria-label="Protocol tools" className="flex flex-wrap gap-4"><a className="text-navy underline" href="/issuer">Issuer desk</a><a className="text-navy underline" href="/agent">Agent console</a><a className="text-navy underline" href="/merchant">Merchant desk</a><a className="text-navy underline" href="/explorer">Public ledger</a><a className="text-navy underline" href="/circuits">Contract circuits</a><a className="text-navy underline" href="/lab">Verification lab</a></nav><p>The separate protocol consoles inspect their configured runtime; the purchasing demo’s own ledger projection appears on its checkout page.</p></div></details>
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-sm text-muted"><span>Line · Agent purchasing on Midnight</span><a className="font-semibold text-navy underline" href="/checkout">Try API checkout</a></footer>
      </div>
    </Shell>
  );
}