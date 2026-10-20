import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useOrganization } from "./organization-session";
import { OrganizationField as Field, organizationField as field } from "./organization-ui";
import { OrganizationCheckout } from "./organization-checkout";
import { decodeQuote, encodeNote } from "@/lib/organization/transfers";
import { requiredDrawFee } from "@/lib/line/encoding";
export function OrganizationAgent({ facilityId, output }: { facilityId: string; output: (title: string, value: string) => void }) {
  const { snapshot, busy, pending, network, run } = useOrganization();
  const [quote, setQuote] = useState("");
  const facility = snapshot?.facilities.find(item => item.id === facilityId), disabled = busy || !!pending || !network;
  const quoteTerms = (() => {
    try {
      const terms = decodeQuote(quote), fee = requiredDrawFee(terms.amount, terms.feeFlat, terms.feeBps);
      return { terms, fee, total: terms.amount + fee };
    } catch { return null; }
  })();
  return <div className="organization-tab"><div className="workspace-section-heading"><div><p className="line-eyebrow">Agent / Authorized purchases</p><h2>Purchase a merchant’s actual quote.</h2></div></div>{facility ? <><OrganizationCheckout facilityId={facilityId} /><details className="organization-create"><summary>Use a quote from another supplier</summary><p>The supplier posts it to your organization’s contract. Compact checks the quoted price, registered merchant, expiry and allowance.</p><Field label="Merchant quote package"><textarea className={field} rows={7} value={quote} onChange={event => setQuote(event.target.value)} maxLength={16384} disabled={disabled} /></Field>{quoteTerms && <div className="organization-claim" aria-label="Quoted purchase costs"><p>Merchant price: {quoteTerms.terms.amount.toString()} base units</p><p>Organization fee: {quoteTerms.fee.toString()} base units</p><strong>Total allowance charge: {quoteTerms.total.toString()} base units</strong><small>Wallet network fees are separate. Compact checks the quote against your facility before authorizing the purchase.</small></div>}{quote && !quoteTerms && <p role="alert" className="wallet-error">Paste a complete merchant quote with valid amounts and fee terms.</p>}<Button disabled={disabled || !quoteTerms} onClick={() => void run(async client => output("Confirmed merchant claim", encodeNote(await client.purchase(facilityId, decodeQuote(quote)))))}>Authorize purchase in wallet</Button><small>Share the confirmed claim with this merchant. Its package contains no organization limit, spending balance or agent secret.</small></details><div className="organization-claims">{snapshot?.notes.filter(note => note.contractAddress === facility.address).map(note => <div key={note.noteCommitment} className="organization-claim"><strong>{note.amount.toString()} asset base units</strong><code>{note.noteCommitment}</code><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => output("Merchant claim package", encodeNote(note))}>Share claim</Button><Button variant="ghost" size="sm" disabled={disabled || !!note.refund || note.redeemed || note.expiry > BigInt(Math.floor(Date.now() / 1000))} onClick={() => void run(client => client.cancelExpired(facilityId, note.noteCommitment))}>Recover expired claim</Button>{note.refund && !note.refund.paid && <Button size="sm" disabled={disabled} onClick={() => void run(client => client.refund(facilityId, note.noteCommitment))}>Receive asset refund</Button>}</div></div>)}</div></> : <section className="workspace-welcome"><h2>Create and fund a facility first.</h2><p>Your agent needs a deployed facility and an allowance from your organization before making purchases.</p></section>}</div>;
}
