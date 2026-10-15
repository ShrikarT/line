import { ArrowRight, Eye, LockKey, WarningCircle } from "@phosphor-icons/react";
import { Shell } from "@/components/line/shell";
import { Panel } from "@/components/line/ui";

export function PrivacyPage() {
  return <Shell hideVault><div className="flex flex-col gap-8">
    <div className="line-page-intro"><div><p className="line-eyebrow">Privacy & demo scope</p><h1>A clear boundary.<br />An honest demo.</h1></div><p>Understand what Line keeps in private witnesses, what the network reveals, and what this version establishes.</p></div>
    <div className="privacy-boundary-grid">
      <Panel kicker="Private witnesses" title="Outside plaintext ledger fields"><LockKey className="boundary-icon" weight="duotone" aria-hidden="true" /><ul className="boundary-list"><li>Approved credit limit</li><li>Current debt and remaining capacity</li><li>Secret keys and commitment openings</li><li>Private repayment amount and reference</li></ul><p className="text-sm text-muted">Authorized workflows still need these openings. Local demo roles share one operator; separate organizations do not yet control independent custody.</p></Panel>
      <Panel kicker="Public observations" title="Visible to an observer"><Eye className="boundary-icon" weight="duotone" aria-hidden="true" /><ul className="boundary-list"><li>Claim amounts and public fees</li><li>Reserve changes and transaction history</li><li>Commitments, nullifiers and contract status</li><li>Registered merchant public keys</li></ul><p className="text-sm text-muted">These disclosures can reveal debt or constrain it. Hiding individual fields does not establish confidentiality across the full history.</p></Panel>
    </div>
    <div className="scope-callout"><WarningCircle weight="duotone" aria-hidden="true" /><div><h2>Full-history privacy is unfinished.</h2><p>For a known zero opening, public purchases and fees can reconstruct debt before repayment. Stronger privacy is a separate architecture and verification requirement.</p></div></div>
    <Panel kicker="Choose your execution path" title="Two demos. Explicit evidence."><div className="privacy-boundary-grid"><div className="flex flex-col gap-3"><h3 className="font-semibold">Live Midnight Preprod</h3><p className="text-sm text-muted">Actual Compact proofs, finalized network calls and retained private openings. Both merchant services run only after their claims confirm.</p><a href="/preprod" className="line-text-link">Open live checkout <ArrowRight aria-hidden="true" /></a></div><div className="flex flex-col gap-3"><h3 className="font-semibold">Quick local checkout</h3><p className="text-sm text-muted">Generated Compact executes on the evaluation server. No proof is submitted to the network. It is useful for quickly exploring authorization, decline and recovery.</p><a href="/checkout" className="line-text-link">Try the local flow <ArrowRight aria-hidden="true" /></a></div></div></Panel>
    <Panel kicker="Settlement boundary" title="Accounting is not a token payout"><p className="text-sm text-muted">Reserve units and merchant redemption are accounting transitions. Neither demo transfers a payment asset to a merchant. Repayment acknowledgement records an issuer assertion; it does not independently verify cash receipt. The services are deterministic local computations.</p><a className="line-text-link" href="https://github.com/ShrikarT/line/blob/fix/preprod-readiness/docs/PRIVACY.md">Read the technical privacy inventory <ArrowRight aria-hidden="true" /></a></Panel>
  </div></Shell>;
}

export function NotFoundPage() {
  return <Shell hideVault><div className="not-found"><p className="line-eyebrow">404 / Page not found</p><h1>This route ends here.</h1><p>The workspace is still one click away.</p><a className="line-button line-button-primary" href="/">Back to Line <ArrowRight aria-hidden="true" /></a></div></Shell>;
}
