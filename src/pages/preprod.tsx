import { useEffect, useRef, useState } from "react";
import { Shell } from "@/components/line/shell";
import { Button, Panel } from "@/components/line/ui";
import { ArrowUpRight, CheckCircle, CircleNotch, Lightning } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { CreditBook, PurchaseSteps, ServiceCards, ServiceResult } from "@/components/line/purchase";
import type { PreprodSummary } from "@/lib/preprod";

const DEFAULT_DOCUMENT = "Line lets an autonomous agent buy API services with issuer-approved credit. Midnight proves clearance, each merchant redeems its own claim, and the credit book stays out of plaintext ledger fields.";
export function TestSettlementPage() { return <PreprodPage settlement />; }
export function PreprodPage({ settlement = false }: { settlement?: boolean } = {}) {
  const storagePrefix = settlement ? "line.preprod.settlement" : "line.preprod";
  const apiBase = settlement ? "/api/preprod/settlement" : "/api/preprod";
  const [state, setState] = useState<PreprodSummary | null>(null), [document, setDocument] = useState(DEFAULT_DOCUMENT);
  const [error, setError] = useState(""), [submitting, setSubmitting] = useState(false);
  const [planId, setPlanId] = useState<string | null>(() => sessionStorage.getItem(`${storagePrefix}.purchase`));
  const purchaseId = useRef<string | null>(null), repayId = useRef<string | null>(null), setupId = useRef<string | null>(null);
  useEffect(() => { purchaseId.current = sessionStorage.getItem(`${storagePrefix}.purchase`) ?? null; repayId.current = sessionStorage.getItem(`${storagePrefix}.repay`) ?? null; }, [storagePrefix]);
  useEffect(() => {
    const latest = state?.orders.at(-1)?.id.slice(0, 36), active = planId ?? latest;
    if (!active) return;
    if (!planId) { setPlanId(active); purchaseId.current = active; sessionStorage.setItem(`${storagePrefix}.purchase`, active); }
    const retained = state?.orders.find(order => order.id.startsWith(`${active}-`))?.document;
    if (retained !== undefined) setDocument(retained);
  }, [state?.orders, planId, storagePrefix]);
  useEffect(() => {
    let stopped = false; const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`${apiBase}/status`, { headers: { "X-Line-Preprod": "operator" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]) });
        const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Preprod is unavailable.");
        if (!stopped) { setState(value); setError(value.error ?? ""); }
      } catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : "Preprod is unavailable."); }
      finally { if (!stopped) timer = setTimeout(poll, 2500); }
    };
    void poll(); return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [apiBase]);
  async function act(action: "purchase" | "acknowledge" | "reconcile" | "setup") {
    setSubmitting(true); setError("");
    const ref = action === "purchase" ? purchaseId : action === "acknowledge" ? repayId : action === "setup" ? setupId : { current: crypto.randomUUID() }, key = action === "purchase" ? `${storagePrefix}.purchase` : `${storagePrefix}.repay`;
    ref.current ??= crypto.randomUUID(); if (action === "purchase" || action === "acknowledge") sessionStorage.setItem(key, ref.current);
    if (action === "purchase") setPlanId(ref.current);
    try {
      const response = await fetch(`${apiBase}/${action}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Line-Preprod": "operator" }, body: JSON.stringify({ requestId: ref.current, ...(action === "purchase" ? { document } : {}) }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Preprod request failed.");
      setState(current => current ? { ...current, busy: true, progress: "Starting Preprod transaction" } : current);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Request failed. Retry uses the same request ID."); }
    finally { setSubmitting(false); }
  }
  const busy = submitting || !!state?.busy, ready = state?.phase === "ready";
  const activeOrders = state?.orders.filter(order => order.id.startsWith(`${planId ?? state.orders.at(-1)?.id.slice(0, 36)}-`)) ?? [];
  const delivered = activeOrders.filter(order => order.status === "delivered");
  function nextPurchase() {
    const id = crypto.randomUUID(); purchaseId.current = id; repayId.current = null;
    sessionStorage.setItem(`${storagePrefix}.purchase`, id); sessionStorage.removeItem(`${storagePrefix}.repay`);
    setPlanId(id); setDocument(DEFAULT_DOCUMENT); setError("");
  }
  return <Shell evaluation evaluationMode="preprod"><div className="checkout-workspace">
    <div className="line-page-intro checkout-intro"><div><p className="line-eyebrow">{settlement ? "Test-token settlement / Midnight Preprod" : "Live on Midnight Preprod"}</p><h1>One agent. Two merchants.<br />{settlement ? "Actual test-token payouts." : "Real proofs."}</h1></div><p>The agent proves each purchase against your approved line. Each merchant redeems its own claim before its service runs.</p></div>
    {error && <div role="alert" className="scope-callout is-error"><div><h2>We couldn't complete that request.</h2><p>{error}</p></div></div>}
    <div role="status" aria-live="polite" className="network-status"><div>{busy ? <CircleNotch className="animate-spin" aria-hidden="true" /> : <Lightning weight="duotone" aria-hidden="true" />}<span>{busy ? state?.progress ?? "Connecting to Preprod..." : ready ? "Connected to Midnight Preprod" : settlement && state ? "Test-token facility needs setup" : "Loading the deployed facility..."}</span></div><Badge variant="outline">{state?.receipts.length ?? 0} confirmed transactions</Badge></div>
    {!!state?.pending && <div className="scope-callout"><div><h2>Confirm the saved transaction.</h2><p>Check its receipt before continuing so the same purchase is not submitted twice.</p><Button variant="ghost" disabled={busy} onClick={() => void act("reconcile")}>Reconcile saved transaction</Button></div></div>}
    {settlement && state && !ready && <Panel kicker="Setup / Separate test contract" title="Fund the test-token facility"><p>Deploy the twelve-circuit settlement contract and mint 200 valueless test units into its reserve. Merchant payouts go to two fixed, distinct wallets. This uses Preprod transaction fees.</p><Button disabled={busy || !!state.pending} onClick={() => void act("setup")}>Set up test-token facility</Button></Panel>}
    {settlement && <Panel kicker="Merchant wallets / Public test asset" title="Test-token receipts"><p>Merchant A receives 25 units and Merchant B receives 20 per completed purchase. Wallet balances below are checked against the Midnight indexer after redemption.</p>{state?.tokenObservation ? <><div className="service-grid">{(["A", "B"] as const).map(name => <div key={name} className="contract-address"><span>Merchant {name}</span><strong>{state.tokenObservation!.balances[name].units} test units received</strong><code>{state.tokenObservation!.balances[name].address}</code></div>)}</div><div className="contract-address"><span>Token identity</span><code>{state.tokenObservation.color}</code></div><p className="text-xs text-muted">Last wallet check: {new Date(state.tokenObservation.verifiedAt).toLocaleString()}. Transparent test tokens have no monetary value; amounts and recipients are public.</p></> : <p className="text-sm text-muted">No wallet observation yet. Confirmed transfers will appear after setup and purchase.</p>}</Panel>}
    <PurchaseSteps steps={[{ label: "Facility connected", complete: !!ready }, { label: "Agent purchases", complete: activeOrders.length > 0 }, { label: "Merchants deliver", complete: delivered.length >= 2 }]} />
    <div className="checkout-columns"><Panel kicker="01 / Agent checkout" title="Give the agent a task">
      <label className="document-field"><span>Document to analyze</span><textarea value={document} onChange={event => setDocument(event.target.value)} maxLength={5000} disabled={busy || activeOrders.length > 0} /><small>{document.length.toLocaleString()} / 5,000 characters</small></label>
      <ServiceCards />
      <Button disabled={!ready || busy || !!state?.pending || delivered.length >= 2} onClick={() => void act("purchase")}>{busy ? "Confirming on Preprod..." : delivered.length >= 2 ? "Both services delivered" : purchaseId.current ? "Run or resume purchases" : "Run agent purchase"}</Button>
      {delivered.length >= 2 && state?.privateBook.outstanding === 0 && <Button variant="ghost" disabled={busy || !!state.pending} onClick={nextPurchase}>Start another purchase</Button>}
      <p className="text-xs text-muted">Each quote, draw and redemption is a network transaction. Confirmations can take a few minutes. Reloading retains the same request ID.</p>
    </Panel><div className="flex flex-col gap-6"><Panel kicker="02 / Issuer's private view" title="Credit book">
      <CreditBook book={state?.privateBook} />
      <Button variant="ghost" disabled={!ready || busy || !!state?.pending || !state?.privateBook.outstanding} onClick={() => void act("acknowledge")}>Acknowledge reported test repayment</Button><p className="text-xs text-muted">This proves an issuer acknowledgement. It does not verify a cash repayment or transfer tokens.</p>
    </Panel><div className="checkout-explainer"><span className="line-eyebrow">What happens next</span><h2>Quote. Prove. Deliver.</h2><p>The merchant signs the terms. The agent proves clearance. A confirmed redemption unlocks the service result.</p><a href="/circuits" className="line-text-link">Explore the twelve circuits <ArrowUpRight aria-hidden="true" /></a></div></div></div>
    <section aria-label="Service delivery" className="flex flex-col gap-5"><div className="section-label-row"><h2>Service results</h2><span>{delivered.length} of 2 delivered</span></div>
      {delivered.length === 0 ? <div className="line-empty-state"><CheckCircle weight="duotone" aria-hidden="true" /><h3>Your results arrive after confirmation.</h3><p>Run the agent's task to follow both merchant claims through to delivery.</p></div> : <div className="service-grid">{delivered.map(order => <Panel key={order.id} kicker={order.service === "text-analysis" ? "Merchant A / Text analysis" : "Merchant B / Cost report"} title={order.service === "text-analysis" ? "Merchant A delivered" : "Merchant B delivered"}><ServiceResult result={order.result ?? {}} merchant={order.service === "text-analysis" ? "Merchant A" : "Merchant B"} /></Panel>)}</div>}
    </section>
    <Panel kicker="03 / Network evidence" title="Confirmed contract calls">
      <div className="contract-address"><span>Contract address</span><code>{state?.contractAddress ?? "Loading contract address..."}</code></div>
      <ol className="receipt-list">{state?.receipts.filter(receipt => receipt.kind === "call").slice().reverse().map(receipt => <li key={receipt.id}><CheckCircle weight="fill" aria-hidden="true" /><div><div className="receipt-heading"><strong>{receipt.name}</strong><span>Block {receipt.blockHeight.toLocaleString()}</span></div><code>{receipt.txHash}</code></div><Badge variant="secondary">Confirmed</Badge></li>)}</ol>
      {state && state.receipts.filter(receipt => receipt.kind === "call").length === 0 && <p className="text-sm text-muted">Confirmed circuit calls will appear here with their block and transaction hash.</p>}
    </Panel>
    <details className="scope-details"><summary>What this live demo establishes</summary><p>Actual Compact proofs, DUST fees, finalized Preprod transactions and durable private openings. The local operator controls the role keys. The services are deterministic; {settlement ? "redemptions transfer an actual unshielded test asset to fixed merchant wallets. The asset has no monetary value; repayment is still issuer-reported." : "reserve and redemption units are accounting, with no merchant token payout."} Public amounts and reserve history can reveal debt; complete historical privacy is still under development.</p><a href="/privacy" className="line-text-link">Privacy & demo scope <ArrowUpRight aria-hidden="true" /></a></details>
    <a className="line-text-link" href="/checkout">Open the quick local checkout demo <ArrowUpRight aria-hidden="true" /></a>
  </div></Shell>;
}
