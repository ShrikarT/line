import { ArrowRight, Bank, CheckCircle, Lightning, Robot, Storefront, Wallet } from "@phosphor-icons/react";
import { Shell } from "@/components/line/shell";
import { WalletButton, useWalletSession } from "@/components/line/wallet-connect";
import { Button } from "@/components/ui/button";

const roles = [
  { href: "/agent", label: "Agent", icon: Robot, copy: "Inspect the private allowance and purchase lifecycle." },
  { href: "/issuer", label: "Issuer", icon: Bank, copy: "Manage reserve accounting, credit policy and repayment reports." },
  { href: "/merchant", label: "Merchant", icon: Storefront, copy: "Explore quotes and merchant-bound claim redemption." },
];

export function WorkspacePage() {
  const { connected, name } = useWalletSession();
  return <Shell evaluation evaluationMode="preprod" hideVault>
    <div className="start-workspace">
      <div className="line-page-intro"><div><p className="line-eyebrow">Your workspace / Start here</p><h1>Put your agent<br />to work.</h1></div><p>Connect your wallet, explore the roles and try a purchase that settles on Midnight Preprod.</p></div>
      <div className="workspace-start-grid">
        <section className="workspace-welcome" aria-labelledby="wallet-step">
          <div className="flex items-center justify-between"><span className="line-eyebrow">01 / Your wallet</span>{connected ? <CheckCircle weight="fill" aria-label="Connected" /> : <Wallet weight="duotone" aria-hidden="true" />}</div>
          <h2 id="wallet-step">{connected ? "You’re connected." : "Your wallet. Your session."}</h2>
          <p>{connected ? `${name} is connected in this browser session. Manage your address or disconnect at any time.` : "Connect a Midnight wallet on Preprod. No seed phrase or account password needed."}</p>
          <WalletButton />
          <small>Wallet connection is optional for the operator-run demo. It does not grant access to the demo’s private role keys.</small>
          <a href="/connect" className="text-xs text-muted underline underline-offset-4">Already have a facility? Connect it</a>
        </section>
        <section className="workspace-launch" aria-labelledby="purchase-step">
          <span className="line-eyebrow">02 / Try the complete flow</span>
          <h2 id="purchase-step">A task in.<br />Two services out.</h2>
          <p>Give an agent a document. It buys analysis and a cost report, proves each purchase, and pays both merchants in valueless test tokens.</p>
          <div className="workspace-purchase-meta"><span><Lightning aria-hidden="true" />Midnight Preprod</span><span>25 + 20 test units</span></div>
          <Button asChild size="lg"><a href="/test-payout">Open test-token checkout <ArrowRight aria-hidden="true" /></a></Button>
          <small>Runs through the local operator’s funded facility. Confirmations take a few minutes. Amounts and recipient addresses are public.</small>
        </section>
      </div>
      <section className="workspace-test-guide" aria-labelledby="testing-heading"><div><p className="line-eyebrow">A quick walkthrough</p><h2 id="testing-heading">Test it from task to receipt.</h2></div><ol><li><span>1</span><p><strong>Open checkout.</strong> Review the credit book, merchant wallets and any existing results.</p></li><li><span>2</span><p><strong>Run a purchase.</strong> Enter a document and choose Run agent purchase. Wait for both services and their confirmed receipts.</p></li><li><span>3</span><p><strong>Check the outcome.</strong> Read both service results, the changed private book and the merchant test-token balances.</p></li></ol><p className="text-sm text-muted">Already completed? Use the explicitly labelled issuer action “Acknowledge reported test repayment”, wait for confirmation, then “Start another purchase”. This is a test repayment report; it does not transfer repayment tokens.</p></section>
      <section aria-labelledby="roles-heading"><div className="workspace-section-heading"><div><p className="line-eyebrow">03 / Explore the protocol</p><h2 id="roles-heading">See each side of the purchase.</h2></div><span className="text-xs text-muted">Separate role consoles · configured runtime</span></div><div className="workspace-role-grid">{roles.map(({ href, label, icon: Icon, copy }) => <a className="workspace-role" href={href} key={href}><Icon weight="duotone" aria-hidden="true" /><h3>{label}</h3><p>{copy}</p><span>Open console <ArrowRight aria-hidden="true" /></span></a>)}</div><p className="mt-4 text-xs text-muted">Role consoles start in the local simulator unless you configure a network connection and the matching private role records. A connected wallet alone does not authorize a credit line.</p></section>
    </div>
  </Shell>;
}
