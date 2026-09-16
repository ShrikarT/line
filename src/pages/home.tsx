import { useState } from "react";
import { Shell } from "@/components/line/shell";
import { DualLedger } from "@/components/line/dual";
import { ExplorerPanel } from "@/components/line/explorer";
import { Button, FlashBar, Mono, Panel, ResetRow, Stat } from "@/components/line/ui";
import { DEMO_STEPS } from "@/lib/line/demo.ts";
import { available } from "@/lib/line/protocol.ts";
import { useLine } from "@/lib/line/store.ts";

export function Home() {
  const flash = useLine((s) => s.flash);
  const runDemo = useLine((s) => s.runDemo);
  const setDemoStep = useLine((s) => s.setDemoStep);
  const demoStep = useLine((s) => s.demoStep);
  const agent = useLine((s) => s.agent);
  const ledger = useLine((s) => s.ledger);
  const [showSimulator, setShowSimulator] = useState(false);

  const lockedReserve = (ledger.encumberedReserve ?? 0) + (ledger.redeemedReserve ?? 0);
  const withdrawableReserve = Math.max(0, (ledger.totalReserve ?? 0) - lockedReserve);

  return (
    <Shell>
      <div className="space-y-12 pb-12">
        {/* 1. Hero Section */}
        <section className="relative pt-6 pb-4">
          <div className="max-w-4xl space-y-6">
            {/* Live Spec Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-elevated px-3 py-1 text-xs font-mono text-muted">
              <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
              <span>LIVE PROTOCOL SPECIFICATION · MIDNIGHT COMPACT DOMAIN</span>
            </div>

            {/* Main Headline */}
            <h1 className="font-display text-4xl font-extrabold leading-[1.15] tracking-tight text-fg sm:text-5xl lg:text-6xl">
              Private revolving credit and reserve settlement for autonomous agents.
            </h1>

            {/* Subhead */}
            <p className="max-w-2xl text-base text-muted sm:text-lg leading-relaxed">
              An autonomous agent proves that a purchase fits its issuer-backed credit line without exposing its
              private credit book, outstanding debt, or counterparty identity.
            </p>

            {/* Primary Desks Action Cluster */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <a
                href="/issuer"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform duration-[var(--motion-quick)] hover:opacity-90 active:scale-[0.98]"
              >
                Issuer Desk
                <span className="ml-2 font-mono text-xs opacity-75">→</span>
              </a>
              <a
                href="/merchant"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-elevated px-4 text-sm font-medium text-fg transition-colors hover:border-muted hover:bg-subtle-fill"
              >
                Merchant Desk
              </a>
              <a
                href="/agent"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-elevated px-4 text-sm font-medium text-fg transition-colors hover:border-muted hover:bg-subtle-fill"
              >
                Agent Console
              </a>
              <a
                href="/explorer"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-transparent px-4 text-sm font-medium text-muted transition-colors hover:text-fg hover:bg-elevated"
              >
                Public Ledger
              </a>
            </div>

            {/* Real-time Verification Snippet */}
            <div className="pt-2">
              <div className="inline-flex flex-wrap items-center gap-3 rounded-lg border border-border bg-subtle-fill px-4 py-2 font-mono text-xs text-muted">
                <span className="text-ok font-semibold">✓ zk-proof::verify(commitment_root, C)</span>
                <span className="text-subtle">→</span>
                <span className="text-fg font-medium">DOMAIN VALID ({ledger.actionClock} TXS PROVEN)</span>
                <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-teal-300">
                  Status: {ledger.status.toUpperCase()}
                </span>
              </div>
            </div>

            <FlashBar flash={flash} />
          </div>
        </section>

        {/* 2. Interactive Zero-Knowledge Pipeline Architecture */}
        <section className="rounded-xl border border-border bg-elevated p-6 lg:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-border">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-accent" />
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-muted">
                ZK Settlement Pipeline // 10 Compact Circuits
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono text-muted">
              <span>Prover Latency: <strong className="text-fg">&lt;80ms</strong></span>
              <span className="hidden sm:inline border-l border-border pl-4 text-ok">Halo2 Native</span>
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
                  Allocates settlement capital into reserve pool and mints confidential line commitment C0 in ZK.
                </p>
              </div>
              <div className="font-mono text-[10px] bg-elevated p-2 rounded border border-border text-muted">
                <span className="text-teal-400">Total Reserve:</span> {ledger.totalReserve ?? 0} units<br />
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
                  Merchant publishes opaque commitment Q binding amount, expiry, and domain without tracking customers.
                </p>
              </div>
              <div className="font-mono text-[10px] bg-elevated p-2 rounded border border-border text-muted">
                <span className="text-teal-400">Quotes Bound:</span> {Object.keys(ledger.quotes).length}<br />
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
                  Proves B + A ≤ L in zero-knowledge. Rotates commitment C → C' and issues merchant-bound claim note D.
                </p>
              </div>
              <div className="font-mono text-[10px] bg-elevated p-2 rounded border border-border text-muted">
                <span className="text-teal-400">Agent Capacity:</span> {agent?.witness ? `${available(agent.witness)} units` : "Encrypted"}<br />
                <span className="text-subtle">Public Ledger:</span> Books Hidden (100%)
              </div>
            </div>

            {/* Step 4: Settlement Finality */}
            <div className="rounded-lg border border-accent/30 bg-bg p-4 flex flex-col justify-between shadow-inner">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[11px] font-semibold text-teal-400 uppercase">Step 04 / Settlement</span>
                  <span className="font-mono text-[10px] text-muted">redeemDraw</span>
                </div>
                <h3 className="font-display text-sm font-semibold text-fg mb-1">Single-Redemption Nullifier</h3>
                <p className="text-xs text-muted leading-relaxed mb-3">
                  Designated merchant redeems D against reserve pool. Nullifier prevents double-redemption.
                </p>
              </div>
              <div className="font-mono text-[10px] bg-elevated p-2 rounded border border-border text-muted">
                <span className="text-teal-400">Encumbered:</span> {ledger.encumberedReserve ?? 0} units<br />
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
              <a href="/circuits" className="text-accent hover:underline">10 Circuits →</a>
            </div>
          </div>
        </section>

        {/* 3. Protocol Metrics Band */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-elevated p-5 space-y-1">
            <span className="text-xs font-mono uppercase text-muted">Settlement Capacity</span>
            <div className="font-display text-3xl font-bold text-fg tracking-tight">
              {ledger.totalReserve ?? 0} <span className="text-sm font-mono text-muted font-normal">units</span>
            </div>
            <p className="text-xs text-subtle">Issuer-allocated reserve backing</p>
          </div>

          <div className="rounded-lg border border-border bg-elevated p-5 space-y-1">
            <span className="text-xs font-mono uppercase text-muted">Proving Overhead</span>
            <div className="font-display text-3xl font-bold text-teal-400 tracking-tight">&lt; 80ms</div>
            <p className="text-xs text-subtle">Client-side Halo2 recursive SNARKs</p>
          </div>

          <div className="rounded-lg border border-border bg-elevated p-5 space-y-1">
            <span className="text-xs font-mono uppercase text-muted">Credit Book Privacy</span>
            <div className="font-display text-3xl font-bold text-fg tracking-tight">100%</div>
            <p className="text-xs text-subtle">L, B, and capacity zero-leakage</p>
          </div>

          <div className="rounded-lg border border-border bg-elevated p-5 space-y-1">
            <span className="text-xs font-mono uppercase text-muted">Midnight Compact</span>
            <div className="font-display text-3xl font-bold text-fg tracking-tight">10 Circuits</div>
            <p className="text-xs text-subtle">Source of truth, zero managed drift</p>
          </div>
        </section>

        {/* 4. Tri-Role Institutional Bento Grid */}
        <section className="space-y-6">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-mono uppercase tracking-wider text-accent">Protocol Architecture</p>
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-fg">
              Engineered for Issuers, Merchants, and Autonomous Fleets
            </h2>
            <p className="text-sm text-muted leading-relaxed">
              Autonomous economic agents require confidential lines of credit to transact autonomously without broadcasting balance sheets.
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
                  Underwrite autonomous fleets without exposing balance sheets, credit limits, or counterparty portfolios to public ledgers.
                </p>
                <ul className="space-y-2 text-xs text-muted">
                  <li className="flex items-center gap-2">
                    <span className="text-ok">✓</span> Confidential revolving credit line commitments (C0)
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-ok">✓</span> Mathematical solvency: Encumbered + Redeemed ≤ Total
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-ok">✓</span> Anti-rug reserve protection with withdrawable bounds
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-ok">✓</span> Issuer-confirmed repayment acknowledgement
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
                  Accept autonomous agent payments backed by institutional cryptographic commitments with instant fraud elimination.
                </p>
                <ul className="space-y-2 text-xs text-muted">
                  <li className="flex items-center gap-2">
                    <span className="text-ok">✓</span> Multi-merchant support (Merchant A &amp; Merchant B)
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-ok">✓</span> Private merchant-bound claim notes (Note D)
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-ok">✓</span> Single-redemption nullifier eliminates double-claims
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-ok">✓</span> Direct redemption against issuer settlement reserves
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
                  Equip autonomous AI pipelines with non-custodial purchasing credentials validated strictly via zero-knowledge proofs.
                </p>
                <ul className="space-y-2 text-xs text-muted">
                  <li className="flex items-center gap-2">
                    <span className="text-ok">✓</span> Client-side WebCrypto AES-GCM encrypted vault
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-ok">✓</span> Zero plaintext credit book or secret key leakage
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-ok">✓</span> Prove clearance B + A ≤ L without revealing L or B
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-ok">✓</span> Model Context Protocol (MCP) server integration
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

        {/* 5. Live Public Ledger & Circuit Explorer */}
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-accent">Live Public State</p>
              <h2 className="font-display text-2xl font-bold tracking-tight text-fg">Public Ledger Explorer</h2>
            </div>
            <a href="/explorer" className="font-mono text-xs text-accent hover:underline">
              Full Ledger View →
            </a>
          </div>

          <ExplorerPanel />
        </section>

        {/* 6. Invariant Testing & Developer Verification Drawer */}
        <section className="rounded-xl border border-border bg-subtle-fill p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-base font-semibold text-fg">
                Protocol Invariant Verification &amp; Developer Simulator
              </h3>
              <p className="text-xs text-muted">
                Step through deterministic lifecycle transitions or execute the automated 18-step verification sequence.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setShowSimulator(!showSimulator)}
              >
                {showSimulator ? "Hide Simulator" : "Open Simulator"}
              </Button>
            </div>
          </div>

          {showSimulator ? (
            <div className="space-y-6 pt-4 border-t border-border">
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => setDemoStep(Math.min(DEMO_STEPS.length - 1, demoStep + 1))}>
                  Next demo step
                </Button>
                <Button variant="ghost" onClick={runDemo}>
                  Jump to end
                </Button>
                <ResetRow />
              </div>

              <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {DEMO_STEPS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setDemoStep(s.id)}
                    className={
                      "rounded-md border px-3 py-2 text-left text-xs transition-colors duration-[var(--motion-quick)] " +
                      (demoStep === s.id
                        ? "border-accent bg-elevated text-fg font-medium"
                        : "border-border bg-bg text-muted hover:border-muted")
                    }
                  >
                    <span className="font-mono text-subtle">{s.id}</span> {s.title}
                  </button>
                ))}
              </div>

              <DualLedger />
            </div>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}

