import { Shell } from "@/components/line/shell";
import { ExplorerPanel } from "@/components/line/explorer";
import { FlashBar, Mono, PixelDivider } from "@/components/line/ui";
import { useAppStore } from "@/app/store.ts";

export function Home() {
  const flash = useAppStore((s) => s.flash);
  const ledger = useAppStore((s) => s.ledger);

  const lockedReserve = (ledger.encumberedReserve ?? 0) + (ledger.redeemedReserve ?? 0) + (ledger.feeReserve ?? 0) + (ledger.pendingFeeReserve ?? 0) + (ledger.refundReserve ?? 0) + (ledger.reportedRefundReserve ?? 0);
  const withdrawableReserve = Math.max(0, (ledger.totalReserve ?? 0) - lockedReserve);

  return (
    <Shell>
      <div className="space-y-12 pb-12">
        {/* 1. Hero Section */}
        <section className="relative -mx-4 bg-charcoal px-4 py-12 text-cream sm:mx-0 sm:rounded-2xl sm:px-10 sm:py-14">
          <img src="/brand/logo-pixel.svg" alt="" className="mb-8 h-14 w-auto sm:h-20" />
          <div className="max-w-4xl space-y-6">
            {/* Live Spec Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-mono text-pink">
              <span className="size-2 bg-accent" />
              <span>COMPACT PROTOTYPE · LOCAL EVALUATION</span>
            </div>

            {/* Main Headline */}
            <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight text-cream sm:text-5xl lg:text-6xl">
              Test issuer-authorized purchases for autonomous agents.
            </h1>

            {/* Subhead */}
            <p className="max-w-2xl text-base leading-relaxed text-cream/80 sm:text-lg">
              Line explores shared credit and merchant-bound claims for API and compute procurement. Local checkout runs generated Compact and two local services; it submits no proof or transaction and transfers no assets. Public amounts and history can reveal debt and counterparties.
            </p>

            {/* Primary Desks Action Cluster */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <a
                href="/checkout"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform duration-[var(--motion-quick)] hover:opacity-90 active:scale-[0.98]"
              >
                Try API checkout
                <span aria-hidden="true" className="ml-2 font-mono text-xs opacity-75">→</span>
              </a>
              <a
                href="/merchant"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-cream/30 px-4 text-sm font-medium text-cream hover:bg-white/10"
              >
                Merchant Desk
              </a>
              <a
                href="/agent"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-cream/30 px-4 text-sm font-medium text-cream hover:bg-white/10"
              >
                Agent Console
              </a>
              <a
                href="/explorer"
                className="inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium text-pink hover:text-cream"
              >
                Public Ledger
              </a>
            </div>

            {/* Real-time Verification Snippet */}
            <div className="pt-2">
              <div className="inline-flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-4 py-2 font-mono text-xs text-cream/80">
                <span className="text-ok font-semibold">Local contract state</span>
                <span className="text-pink">→</span>
                <span className="font-medium text-cream">SIMULATOR ACTIONS: {ledger.actionClock}</span>
                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-fg">
                  Status: {ledger.status.toUpperCase()}
                </span>
              </div>
            </div>

            <FlashBar flash={flash} />
          </div>
        </section>

        <PixelDivider />

        {/* 2. Interactive Zero-Knowledge Pipeline Architecture */}
        <section className="rounded-xl border border-border bg-elevated p-6 lg:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-border">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-accent" />
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-muted">
                Authorization &amp; accounting // 12 Compact circuits
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono text-muted">
              <span>Network finality: <strong className="text-fg">Unconfirmed</strong></span>
              <span className="hidden sm:inline border-l border-border pl-4 text-ok">Local evaluation</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 pt-6 md:grid-cols-2 lg:grid-cols-4">
            {/* Step 1: Issuer */}
            <div className="rounded-lg border border-border/80 bg-bg p-4 flex flex-col justify-between hover:border-accent/50 transition-colors">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[11px] font-semibold text-accent uppercase">Step 01 / Issuer</span>
                  <span className="font-mono text-[10px] text-muted">openLine</span>
                </div>
                <h3 className="font-display text-sm font-semibold text-fg mb-1">Underwrite &amp; Reserve</h3>
                <p className="text-xs text-muted leading-relaxed mb-3">
                  Records reserve counters and a private book commitment. Canonical opening still needs the agent-secret witness; it verifies no deposit.
                </p>
              </div>
              <div className="font-mono text-[10px] bg-elevated p-2 rounded border border-border text-muted">
                <span className="text-navy">Total Reserve:</span> {ledger.totalReserve ?? 0} units<br />
                <span className="text-subtle">Withdrawable:</span> {withdrawableReserve} units
              </div>
            </div>

            {/* Step 2: Merchant */}
            <div className="rounded-lg border border-border/80 bg-bg p-4 flex flex-col justify-between hover:border-accent/50 transition-colors">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[11px] font-semibold text-accent uppercase">Step 02 / Merchant</span>
                  <span className="font-mono text-[10px] text-muted">postQuote</span>
                </div>
                <h3 className="font-display text-sm font-semibold text-fg mb-1">Post Quote Commitment</h3>
                <p className="text-xs text-muted leading-relaxed mb-3">
                  Merchant authenticates a quote binding amount, expiry, domain and fee policy. Public queries and history can link its pseudonym.
                </p>
              </div>
              <div className="font-mono text-[10px] bg-elevated p-2 rounded border border-border text-muted">
                <span className="text-navy">Quotes Bound:</span> {ledger.quoteCount}<br />
                <span className="text-subtle">Replay Guard:</span> Nonce &amp; Expiry
              </div>
            </div>

            {/* Step 3: Agent */}
            <div className="rounded-lg border border-border/80 bg-bg p-4 flex flex-col justify-between hover:border-accent/50 transition-colors">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[11px] font-semibold text-accent uppercase">Step 03 / Agent</span>
                  <span className="font-mono text-[10px] text-muted">draw</span>
                </div>
                <h3 className="font-display text-sm font-semibold text-fg mb-1">ZK Witness &amp; Draw Note</h3>
                <p className="text-xs text-muted leading-relaxed mb-3">
                  Compact checks B + amount + fee ≤ L, rotates the book commitment and issues a merchant-bound claim. Local consoles simulate this; checkout executes generated Compact.
                </p>
              </div>
              <div className="font-mono text-[10px] bg-elevated p-2 rounded border border-border text-muted">
                <span className="text-navy">Agent Capacity:</span> Encrypted (Private State)<br />
                <span className="text-subtle">Public Ledger:</span> History reveals debt
              </div>
            </div>

            {/* Step 4: Settlement Finality */}
            <div className="rounded-lg border border-accent/30 bg-bg p-4 flex flex-col justify-between shadow-inner">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[11px] font-semibold text-navy uppercase">Step 04 / Settlement</span>
                  <span className="font-mono text-[10px] text-muted">redeemDraw</span>
                </div>
                <h3 className="font-display text-sm font-semibold text-fg mb-1">Single-Redemption Nullifier</h3>
                <p className="text-xs text-muted leading-relaxed mb-3">
                  Only the designated merchant redeems D once. Reserve counters track the claim; redemption confirms no payout or fulfillment.
                </p>
              </div>
              <div className="font-mono text-[10px] bg-elevated p-2 rounded border border-border text-muted">
                <span className="text-navy">Encumbered:</span> {ledger.encumberedReserve ?? 0} units<br />
                <span className="text-ok">Redeemed:</span> {ledger.redeemedReserve ?? 0} units
              </div>
            </div>
          </div>

          {/* Real-time State Strip */}
          <div className="mt-6 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-muted">
            <div className="flex items-center gap-2">
              <span className="text-accent">❯</span>
              <span>Ledger Action Clock: <strong className="text-fg">#{ledger.actionClock}</strong></span>
              <span className="text-subtle">·</span>
              <span>Domain: <Mono value={ledger.contractDomain} /></span>
            </div>
            <div className="flex items-center gap-3">
              <a href="/lab" className="text-accent hover:underline">Attack Lab →</a>
              <a href="/circuits" className="text-accent hover:underline">12 Circuits →</a>
            </div>
          </div>
        </section>

        <PixelDivider />

        {/* 3. Protocol Metrics Band */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-elevated p-5 space-y-1">
            <span className="text-xs font-mono uppercase text-muted">Reserve Accounting</span>
            <div className="font-display text-3xl font-bold text-fg tracking-tight">
              {ledger.totalReserve ?? 0} <span className="text-sm font-mono text-muted font-normal">units</span>
            </div>
            <p className="text-xs text-subtle">Counter only; funded assets unverified</p>
          </div>

          <div className="rounded-lg border border-border bg-elevated p-5 space-y-1">
            <span className="text-xs font-mono uppercase text-muted">Proof Performance</span>
            <div className="font-display text-3xl font-bold text-navy tracking-tight">Unmeasured</div>
            <p className="text-xs text-subtle">No production performance benchmark</p>
          </div>

          <div className="rounded-lg border border-border bg-elevated p-5 space-y-1">
            <span className="text-xs font-mono uppercase text-muted">Credit Book Privacy</span>
            <div className="font-display text-3xl font-bold text-fg tracking-tight">Incomplete</div>
            <p className="text-xs text-subtle">Public history can reconstruct debt</p>
          </div>

          <div className="rounded-lg border border-border bg-elevated p-5 space-y-1">
            <span className="text-xs font-mono uppercase text-muted">Midnight Compact</span>
            <div className="font-display text-3xl font-bold text-fg tracking-tight">12 Circuits</div>
            <p className="text-xs text-subtle">Source of truth, zero managed drift</p>
          </div>
        </section>

        <PixelDivider />

        {/* 4. Tri-Role Institutional Bento Grid */}
        <section className="space-y-6">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-mono uppercase tracking-wider text-accent">Protocol Architecture</p>
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-fg">
              Engineered for Issuers, Merchants, and Autonomous Fleets
            </h2>
            <p className="text-sm text-muted leading-relaxed">
              Enterprise API and compute teams are an unvalidated buyer hypothesis. Shared organizational credit, independent suppliers and confidential books remain the product destination.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Card 1: Issuer */}
            <div className="rounded-xl border border-border bg-elevated p-6 flex flex-col justify-between hover:border-accent/40 transition-colors">
              <div className="space-y-4">
                <div className="h-10 w-10 rounded-lg bg-subtle-fill border border-border flex items-center justify-center font-mono text-sm font-bold text-accent">
                  IS
                </div>
                <div>
                  <span className="font-mono text-xs text-accent uppercase font-medium">For Issuers</span>
                  <h3 className="font-display text-lg font-bold text-fg mt-1">Private Underwriting &amp; Reserves</h3>
                </div>
                <p className="text-sm text-muted leading-relaxed">
                  Evaluate issuer authority and committed credit books. Full-history confidentiality, independent capital and an accountable borrower are not established.
                </p>
                <ul className="space-y-2 text-xs text-muted">
                  <li className="flex items-center gap-2">
                    <span className="size-2 shrink-0 bg-navy" /> Domain-bound private book commitments (C0)
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-2 shrink-0 bg-navy" /> Reserve accounting includes principal, fees and refunds
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-2 shrink-0 bg-navy" /> Withdrawable-counter bounds; external custody unverified
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-2 shrink-0 bg-navy" /> Issuer-confirmed repayment acknowledgement
                  </li>
                </ul>
              </div>
              <div className="pt-6 mt-4 border-t border-border">
                <a href="/issuer" className="font-mono text-xs text-accent hover:underline flex items-center justify-between">
                  <span>Enter Issuer Console</span>
                  <span>→</span>
                </a>
              </div>
            </div>

            {/* Card 2: Merchant */}
            <div className="rounded-xl border border-border bg-elevated p-6 flex flex-col justify-between hover:border-accent/40 transition-colors">
              <div className="space-y-4">
                <div className="h-10 w-10 rounded-lg bg-subtle-fill border border-border flex items-center justify-center font-mono text-sm font-bold text-accent">
                  ME
                </div>
                <div>
                  <span className="font-mono text-xs text-accent uppercase font-medium">For Merchants</span>
                  <h3 className="font-display text-lg font-bold text-fg mt-1">Zero-Knowledge Checkout &amp; Claims</h3>
                </div>
                <p className="text-sm text-muted leading-relaxed">
                  Evaluate merchant-bound claims, ownership checks and single redemption. Actual merchant payment and fulfillment authenticity remain unverified.
                </p>
                <ul className="space-y-2 text-xs text-muted">
                  <li className="flex items-center gap-2">
                    <span className="size-2 shrink-0 bg-navy" /> Multi-merchant support (Merchant A &amp; Merchant B)
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-2 shrink-0 bg-navy" /> Merchant-bound notes with public principal and fee
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-2 shrink-0 bg-navy" /> Single-redemption nullifier prevents claim replay
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-2 shrink-0 bg-navy" /> Reserve accounting on redemption; payout unverified
                  </li>
                </ul>
              </div>
              <div className="pt-6 mt-4 border-t border-border">
                <a href="/merchant" className="font-mono text-xs text-accent hover:underline flex items-center justify-between">
                  <span>Enter Merchant Desk</span>
                  <span>→</span>
                </a>
              </div>
            </div>

            {/* Card 3: Agent */}
            <div className="rounded-xl border border-border bg-elevated p-6 flex flex-col justify-between hover:border-accent/40 transition-colors">
              <div className="space-y-4">
                <div className="h-10 w-10 rounded-lg bg-subtle-fill border border-border flex items-center justify-center font-mono text-sm font-bold text-accent">
                  AG
                </div>
                <div>
                  <span className="font-mono text-xs text-accent uppercase font-medium">For Autonomous Agents</span>
                  <h3 className="font-display text-lg font-bold text-fg mt-1">Sovereign Proofs &amp; Procurement</h3>
                </div>
                <p className="text-sm text-muted leading-relaxed">
                  Evaluate bounded purchasing authority and encrypted recovery. All checkout signing keys share one server process; independent custody remains open.
                </p>
                <ul className="space-y-2 text-xs text-muted">
                  <li className="flex items-center gap-2">
                    <span className="size-2 shrink-0 bg-navy" /> Client-side WebCrypto AES-GCM encrypted vault
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-2 shrink-0 bg-navy" /> Public responses omit plaintext private books
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-2 shrink-0 bg-navy" /> Private witnesses check capacity; public history leaks debt
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-2 shrink-0 bg-navy" /> Model Context Protocol (MCP) server integration
                  </li>
                </ul>
              </div>
              <div className="pt-6 mt-4 border-t border-border">
                <a href="/agent" className="font-mono text-xs text-accent hover:underline flex items-center justify-between">
                  <span>Enter Agent Console</span>
                  <span>→</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        <PixelDivider />

        {/* 5. Live Public Ledger & Circuit Explorer */}
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-accent">Current Evaluation State</p>
              <h2 className="font-display text-2xl font-bold tracking-tight text-fg">Public Ledger Explorer</h2>
            </div>
            <a href="/explorer" className="font-mono text-xs text-accent hover:underline">
              Full Ledger View →
            </a>
          </div>

          <ExplorerPanel />
        </section>

        <PixelDivider />

        {/* 6. Protocol Verification & Attack Lab Navigation */}
        <section className="rounded-xl border border-border bg-subtle-fill p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-xl space-y-1">
              <h3 className="font-display text-base font-semibold text-fg">
                Protocol Verification &amp; Adversarial Attack Lab
              </h3>
              <p className="text-xs text-muted leading-relaxed">
                Step through deterministic lifecycle transitions, inspect public vs private state progression, or execute
                adversarial attack vectors against contract domain isolation and nullifier guarantees in the dedicated test environment.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/lab"
                className="inline-flex min-h-10 items-center justify-center rounded-md bg-accent px-4 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90"
              >
                Open Attack Lab →
              </a>
              <a
                href="/circuits"
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-transparent px-4 text-xs font-medium text-fg hover:bg-elevated transition-colors"
              >
                View Twelve Circuits
              </a>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}
