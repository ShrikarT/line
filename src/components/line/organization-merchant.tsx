import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useOrganization } from "./organization-session";
import { OrganizationField as Field, organizationField as field } from "./organization-ui";
import { decodeNote, encodeMerchant, encodeQuote } from "@/lib/organization/transfers";
import { units } from "@/lib/organization/account";
import { invoiceReferenceError, requiredDrawFee } from "@/lib/line/encoding";

const QUOTES_PER_PAGE = 10;
function quoteDeadline(expiry: bigint) {
  const date = new Date(Number(expiry) * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : `Unix second ${expiry}`;
}

export function OrganizationMerchant({ output }: { output: (title: string, value: string) => void }) {
  const { account, network, snapshot, busy, pending, run } = useOrganization();
  const [name, setName] = useState(""), [address, setAddress] = useState(""), [invoice, setInvoice] = useState(""), [price, setPrice] = useState(""), [minutes, setMinutes] = useState("60"), [claim, setClaim] = useState("");
  const [balances, setBalances] = useState<Record<string, string>>({}), [error, setError] = useState("");
  const [quoteSearch, setQuoteSearch] = useState(""), [quotePage, setQuotePage] = useState(0);
  const disabled = busy || !!pending || !network;
  const invoiceError = invoiceReferenceError(invoice);
  // Only the committed snapshot is shareable. A pending postQuote candidate
  // becomes visible here after exact successful finality promotes it.
  const search = quoteSearch.trim().toLowerCase();
  const savedQuotes = [...(snapshot?.quotes ?? [])].reverse().filter(quote =>
    [quote.contractAddress, quote.invoiceId, quote.quoteCommitment].some(value => value.includes(search)));
  const lastPage = Math.max(0, Math.ceil(savedQuotes.length / QUOTES_PER_PAGE) - 1);
  const page = Math.min(quotePage, lastPage);
  useEffect(() => {
    let stopped = false; setBalances({}); setError("");
    if (account) void account.wallet.getUnshieldedBalances().then(value => { if (!stopped) setBalances(Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, amount.toString()]))); }).catch(() => { if (!stopped) setError("Your wallet balance could not be refreshed."); });
    return () => { stopped = true; };
  }, [account, snapshot?.receipts.length]);
  return <div className="organization-tab"><div className="workspace-section-heading"><div><p className="line-eyebrow">Merchant / Your receiving wallet</p><h2>Quote, redeem and receive assets.</h2></div></div><div className="workspace-start-grid"><section className="workspace-welcome"><h2>Share your public profile.</h2><p>An organization registers your public role key and this wallet’s receiving address. Your secret remains in your encrypted account.</p><Field label="Merchant name"><input className={field} value={name} onChange={event => setName(event.target.value)} maxLength={80} disabled={busy} /></Field><Button variant="outline" disabled={!network} onClick={() => { if (network) output("Your public merchant profile", encodeMerchant(network.merchantProfile(name))); }}>Show merchant profile</Button><code className="wallet-address w-full">{account?.receivingAddress}</code></section><section className="workspace-launch"><p className="line-eyebrow">Existing assets / Read from your wallet</p><h2>Your receiving wallet.</h2>{Object.entries(balances).length ? Object.entries(balances).map(([color, amount]) => <div key={color} className="organization-asset"><strong>{amount} base units</strong><code>{color}</code></div>) : <p>No unshielded asset balance was returned by your wallet.</p>}<small>A claim pays only the receiving address your organization registered. A recipient mismatch blocks quotes and redemption.</small></section></div>
    <section className="workspace-welcome"><h2>Post a quote to an organization.</h2><form className="organization-form-grid w-full" onSubmit={event => { event.preventDefault(); if (invoiceError) return; void run(async client => { const validity = Number(minutes); if (!Number.isInteger(validity) || validity < 1 || validity > 10080) throw new Error("Choose validity between one minute and seven days."); output("Confirmed supplier quote", encodeQuote(await client.postQuote(address, invoice, units(price), BigInt(Math.floor(Date.now() / 1000) + validity * 60)))); }); }}><Field label="Organization facility address"><input className={field} value={address} onChange={event => setAddress(event.target.value)} pattern="[0-9a-f]{64}" disabled={disabled} required /></Field><Field label="Invoice / service reference"><input className={field} value={invoice} onChange={event => setInvoice(event.target.value)} maxLength={500} aria-label="Invoice / service reference" aria-invalid={!!invoiceError} aria-describedby="invoice-reference-help" disabled={disabled} required /><small id="invoice-reference-help" role={invoiceError ? "alert" : undefined}>{invoiceError || "Up to 32 UTF-8 bytes, or a 64-digit hexadecimal invoice ID."}</small></Field><Field label="Price in this facility’s asset base units"><input className={field} value={price} onChange={event => setPrice(event.target.value)} inputMode="numeric" pattern="[0-9]+" disabled={disabled} required /></Field><Field label="Quote valid for (minutes)"><input className={field} value={minutes} onChange={event => setMinutes(event.target.value)} type="number" min="1" max="10080" disabled={disabled} required /></Field><Button type="submit" disabled={disabled || !!invoiceError}>Post quote in wallet</Button></form><small>You must be registered by this organization and hold DUST for network fees. Service fulfillment remains your responsibility.</small></section>
    <section className="workspace-welcome"><h2>Redeem your merchant claim.</h2><p>Import the agent’s package. Redemption proves your merchant authority, pays your registered wallet and consumes the claim once.</p><Field label="Merchant claim package"><textarea className={field} rows={7} maxLength={16384} value={claim} onChange={event => setClaim(event.target.value)} disabled={disabled} /></Field><Button disabled={disabled || !claim} onClick={() => void run(client => client.redeem(decodeNote(claim)))}>Redeem and receive assets</Button></section>
    <section className="workspace-welcome" aria-labelledby="saved-quotes-heading">
      <h2 id="saved-quotes-heading">Saved merchant quotes</h2>
      <p>Share the original package again after confirmation, reconciliation or reopening this vault. Sharing prepares no transaction. Saved quotes may have expired, been used or belong to a previous allowance; the facility checks their current validity at purchase.</p>
      <Field label="Find saved quotes"><input className={field} type="search" value={quoteSearch} onChange={event => { setQuoteSearch(event.target.value); setQuotePage(0); }} placeholder="Facility address, invoice ID or quote commitment" /></Field>
      <p aria-live="polite">{savedQuotes.length} saved {savedQuotes.length === 1 ? "quote" : "quotes"}{savedQuotes.length > 0 && ` · Page ${page + 1} of ${lastPage + 1}`}</p>
      <div className="organization-claims">
        {savedQuotes.slice(page * QUOTES_PER_PAGE, (page + 1) * QUOTES_PER_PAGE).map(quote => {
          let fee: bigint | null = null;
          try { fee = requiredDrawFee(quote.amount, quote.feeFlat, quote.feeBps); } catch { /* Retain export even for unpurchasable historical terms. */ }
          return <article key={`${quote.contractAddress}:${quote.quoteCommitment}`} className="organization-claim min-w-0 [overflow-wrap:anywhere]" aria-label={`Saved quote ${quote.quoteCommitment}`}>
            <strong>Merchant price: {quote.amount.toString()} base units</strong>
            {fee !== null ? <p>Organization fee: {fee.toString()} base units · Total allowance charge: {(quote.amount + fee).toString()} base units</p> : <p>The saved fee terms exceed the supported fee range.</p>}
            <p>Allowance generation: {quote.generation.toString()} · Quote deadline: {quoteDeadline(quote.expiry)}</p>
            <p>Facility: <code>{quote.contractAddress}</code></p>
            <p>Invoice ID: <code>{quote.invoiceId}</code></p>
            <p>Quote commitment: <code>{quote.quoteCommitment}</code></p>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => output("Saved merchant quote package", encodeQuote(quote))}>Share saved quote</Button>
          </article>;
        })}
      </div>
      {savedQuotes.length === 0 && <p>{search ? "No saved quotes match this search." : "Confirmed quotes appear here. Resolve a pending quote using Check original transaction first."}</p>}
      {lastPage > 0 && <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setQuotePage(page - 1)}>Previous quotes</Button>
        <Button variant="outline" size="sm" disabled={page === lastPage} onClick={() => setQuotePage(page + 1)}>Next quotes</Button>
      </div>}
    </section>
    {error && <p role="alert" className="wallet-error">{error}</p>}
  </div>;
}
