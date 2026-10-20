import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle, CircleNotch } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useOrganization } from "./organization-session";
import { OrganizationField as Field, organizationField as field } from "./organization-ui";
import type { OrganizationCatalog } from "@/lib/organization/network";
import { serviceOrderNote } from "@/lib/organization/orders";
import { requiredDrawFee } from "@/lib/line/encoding";

export function OrganizationCheckout({ facilityId }: { facilityId: string }) {
  const { network, snapshot, busy, pending, run } = useOrganization();
  const [catalog, setCatalog] = useState<OrganizationCatalog | null>(null), [error, setError] = useState(""), [document, setDocument] = useState("");
  const [feePolicy, setFeePolicy] = useState<{ feeFlat: string; feeBps: string } | null>(null), [policyError, setPolicyError] = useState("");
  const facility = snapshot?.facilities.find(facility => facility.id === facilityId);
  const orders = snapshot?.serviceOrders?.filter(order => order.facilityId === facilityId) ?? [];
  useEffect(() => {
    let cancelled = false;
    if (network) void network.catalog().then(value => { if (!cancelled) { setCatalog(value); setError(""); } }).catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : "The API suppliers are unavailable."); });
    return () => { cancelled = true; };
  }, [network]);
  useEffect(() => {
    let stopped = false; setFeePolicy(null); setPolicyError("");
    if (network && facility && catalog && catalog.hostedSupplierAutomation !== false) {
      void network.facilitySummary(facility.id).then(value => { if (!stopped) setFeePolicy(value); }).catch(() => { if (!stopped) setPolicyError("The current organization fee policy is unavailable. Refresh the workspace before buying."); });
    }
    return () => { stopped = true; };
  }, [network, facility?.id, catalog, snapshot?.receipts.length]);
  if (!facility) return null;
  if (catalog?.hostedSupplierAutomation === false) return <section className="workspace-welcome"><p className="line-eyebrow">Direct merchant checkout</p><h2>Use your merchant's quote.</h2><p>Exchange quote and claim packages in the Agent and Merchant workspaces. Your wallet signs the contract actions. Automated API suppliers are unavailable on this host.</p></section>;
  const disabled = busy || !!pending || !network || facility.limit === 0n || !feePolicy;
  return <section className="organization-api-checkout">
    <div className="workspace-section-heading"><div><p className="line-eyebrow">API checkout / Organization assets</p><h2>Give your agent a real task.</h2></div><span className="text-xs text-muted">Merchant quote → wallet approval → payout → result</span></div>
    <Field label="Document for the API services" hint="Only the selected supplier receives this document. It is not published on the ledger."><textarea className={field} value={document} maxLength={5000} rows={5} onChange={event => setDocument(event.target.value)} disabled={busy} placeholder="Enter the text you want to process" /></Field>
    {catalog ? <div className="workspace-role-grid mt-6">{catalog.services.map(service => {
      const authorized = facility.merchants.some(merchant => merchant.publicKey === service.profile.publicKey && merchant.address === service.profile.address && !merchant.disabled);
      let fee: bigint | null = null;
      try { if (feePolicy) fee = requiredDrawFee(BigInt(service.price), BigInt(feePolicy.feeFlat), BigInt(feePolicy.feeBps)); } catch { /* Invalid or overflowing terms cannot start a purchase. */ }
      return <article className="workspace-role" key={service.id}>
        <h3>{service.name}</h3><p>{service.description}</p>
        <strong className="block text-sm text-navy">{(Number(service.price) / 10 ** catalog.decimals).toLocaleString(undefined, { maximumFractionDigits: catalog.decimals })} tNIGHT</strong>
        <small className="mt-2 block text-xs text-muted">{service.price} base units · {service.profile.name}</small>
        {fee !== null && <small className="mt-2 block text-xs text-muted">Organization fee: {fee.toString()} base units · Total allowance charge: {(BigInt(service.price) + fee).toString()} base units. Wallet network fees are separate.</small>}
        <Button className="mt-5" disabled={disabled || fee === null || !document.trim() || !authorized || catalog.assetColor !== facility.assetColor} onClick={() => { if (fee !== null) void run(client => client.purchaseService(facilityId, service.id, document, fee)); }}>Buy {service.name} <ArrowRight aria-hidden="true" /></Button>
        {!authorized && <p>Authorize this supplier in the Organization workspace first.</p>}
      </article>;
    })}</div> : !error && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted"><CircleNotch className="animate-spin" aria-hidden="true" />Loading the supplier catalog…</p>}
    {error && <p role="alert" className="wallet-error mt-4">{error}</p>}
    {policyError && <p role="alert" className="wallet-error mt-4">{policyError}</p>}
    {!!orders.length && <div className="organization-claims mt-8">{orders.slice().reverse().map(order => {
      const note = snapshot ? serviceOrderNote(snapshot, order) : undefined;
      const actionable = !busy && !pending && !!network;
      const replaceable = !note || !!note.refund?.paid;
      return <article className="organization-claim" key={order.id}>
      <div className="flex items-center gap-2"><CheckCircle aria-hidden="true" className={order.delivered ? "text-ok" : "text-muted"} /><strong>{catalog?.services.find(service => service.id === order.service)?.name ?? order.service}</strong></div>
      <p className="text-sm text-muted">{order.delivered ? "Delivered after the merchant’s on-chain asset payout." : order.cancelled ? "Request cancelled. Its history is retained and no replacement payment was created." : "Saved purchase. Its original request and claim will be reused."}</p><code>{order.id}</code>
      <p className="text-xs text-muted">Saved maximum organization fee: {order.maxFee ?? "0"} base units.</p>
      {order.quoteExpiry && <p className="text-xs text-muted">Quote deadline: {new Date(Number(order.quoteExpiry) * 1000).toLocaleString()}</p>}
      {order.delivered ? <pre className="organization-service-result">{JSON.stringify(order.result, null, 2)}</pre> : !order.cancelled && <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!actionable || !!note?.refund} onClick={() => void run(client => client.continueService(order.id))}>Resume this purchase</Button>
        {replaceable && <><Button variant="outline" disabled={!actionable} onClick={() => void run(client => client.requoteService(order.id))}>Get a fresh quote</Button><Button variant="ghost" disabled={!actionable} onClick={() => void run(client => client.cancelService(order.id))}>Cancel saved request</Button></>}
        {note && !note.redeemed && !note.refund && note.expiry <= BigInt(Math.floor(Date.now() / 1000)) && <Button variant="outline" disabled={!actionable} onClick={() => void run(client => client.cancelExpired(facilityId, note.noteCommitment))}>Recover expired purchase</Button>}
        {note?.refund && !note.refund.paid && <Button variant="outline" disabled={!actionable} onClick={() => void run(client => client.refund(facilityId, note.noteCommitment))}>Receive remaining refund</Button>}
      </div>}
      {!!order.history?.length && <p className="text-xs text-muted">{order.history.length} retired request(s) retained for recovery.</p>}
    </article>; })}</div>}
  </section>;
}
