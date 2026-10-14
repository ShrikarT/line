import { useEffect, useRef, useState } from "react";
import { Shell } from "@/components/line/shell";
import { Button, Panel } from "@/components/line/ui";
import type { PreprodSummary } from "@/lib/preprod";

const DEFAULT_DOCUMENT = "Line lets an autonomous agent buy API services with issuer-approved credit. Midnight proves clearance, each merchant redeems its own claim, and the credit book stays out of plaintext ledger fields.";
export function PreprodPage() {
  const [state, setState] = useState<PreprodSummary | null>(null), [document, setDocument] = useState(DEFAULT_DOCUMENT);
  const [error, setError] = useState(""), [submitting, setSubmitting] = useState(false);
  const purchaseId = useRef<string | null>(null), repayId = useRef<string | null>(null);
  useEffect(() => { purchaseId.current = sessionStorage.getItem("line.preprod.purchase") ?? null; repayId.current = sessionStorage.getItem("line.preprod.repay") ?? null; }, []);
  useEffect(() => {
    let stopped = false; const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch("/api/preprod/status", { headers: { "X-Line-Preprod": "operator" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]) });
        const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Preprod is unavailable.");
        if (!stopped) { setState(value); setError(value.error ?? ""); }
      } catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : "Preprod is unavailable."); }
      finally { if (!stopped) timer = setTimeout(poll, 2500); }
    };
    void poll(); return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, []);
  async function act(action: "purchase" | "acknowledge") {
    setSubmitting(true); setError("");
    const ref = action === "purchase" ? purchaseId : repayId, key = action === "purchase" ? "line.preprod.purchase" : "line.preprod.repay";
    ref.current ??= crypto.randomUUID(); sessionStorage.setItem(key, ref.current);
    try {
      const response = await fetch(`/api/preprod/${action}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Line-Preprod": "operator" }, body: JSON.stringify({ requestId: ref.current, ...(action === "purchase" ? { document } : {}) }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Preprod request failed.");
      setState(current => current ? { ...current, busy: true, progress: "Starting Preprod transaction" } : current);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Request failed. Retry uses the same request ID."); }
    finally { setSubmitting(false); }
  }
  const busy = submitting || !!state?.busy, ready = state?.phase === "ready", delivered = state?.orders.filter(order => order.status === "delivered") ?? [];
  return <Shell evaluation evaluationMode="preprod"><div className="mx-auto max-w-6xl space-y-6">
    <div className="space-y-3"><p className="text-xs font-semibold uppercase tracking-widest text-muted">Live on Midnight Preprod</p><h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">One agent. Two merchants. Real proofs.</h1><p className="max-w-2xl text-sm text-muted">The agent proves its purchases against an issuer-approved credit line. Each merchant redeems a separate claim before its service runs.</p></div>
    {error && <div role="alert" className="rounded-lg border border-red/30 bg-red/10 p-4 text-sm">{error}</div>}
    <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-elevated p-4 text-sm"><span>{busy ? state?.progress ?? "Connecting to Preprod..." : ready ? "Connected to Midnight Preprod" : "Loading the deployed facility..."}</span><span className="font-mono text-xs">{state?.receipts.length ?? 0} confirmed transactions</span></div>
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><Panel kicker="Agent checkout" title="Buy the two API services">
      <label className="block space-y-2 text-sm"><span>Document to analyze</span><textarea className="min-h-36 w-full rounded-md border border-border bg-bg p-3" value={document} onChange={event => setDocument(event.target.value)} maxLength={5000} disabled={busy || delivered.length > 0} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md border border-border p-4"><p className="text-xs text-muted">Merchant A</p><p className="mt-1 font-semibold">Text analysis</p><p className="mt-2 font-mono">25 units</p></div><div className="rounded-md border border-border p-4"><p className="text-xs text-muted">Merchant B</p><p className="mt-1 font-semibold">Cost report</p><p className="mt-2 font-mono">20 units</p></div></div>
      <Button disabled={!ready || busy || !!state?.pending || delivered.length >= 2} onClick={() => void act("purchase")}>{busy ? "Confirming on Preprod..." : delivered.length >= 2 ? "Both services delivered" : purchaseId.current ? "Run or resume purchases" : "Run agent purchase"}</Button>
      <p className="text-xs text-muted">Each quote, draw and redemption is a network transaction. Confirmations can take a few minutes; you can reload and resume with the same request ID.</p>
      {delivered.map(order => <article key={order.id} className="rounded-md border border-ok/30 bg-ok/5 p-4"><p className="font-semibold">{order.service === "text-analysis" ? "Merchant A delivered" : "Merchant B delivered"}</p><pre className="mt-3 whitespace-pre-wrap break-words text-xs">{JSON.stringify(order.result, null, 2)}</pre></article>)}
    </Panel><div className="space-y-6"><Panel kicker="Issuer’s private view" title="Credit book">
      <div className="grid grid-cols-3 gap-3">{[["Limit", state?.privateBook.limit], ["Outstanding", state?.privateBook.outstanding], ["Remaining", state?.privateBook.remaining]].map(([label, value]) => <div key={label}><p className="text-xs text-muted">{label}</p><p className="mt-2 font-mono text-2xl">{value ?? "—"}</p></div>)}</div>
      <Button variant="ghost" disabled={!ready || busy || !!state?.pending || !state?.privateBook.outstanding} onClick={() => void act("acknowledge")}>Acknowledge reported test repayment</Button><p className="text-xs text-muted">This proves an issuer acknowledgement. It does not verify a cash repayment or transfer tokens.</p>
    </Panel><Panel kicker="Network evidence" title="Confirmed contract calls">
      <p className="break-all font-mono text-xs">{state?.contractAddress ?? "Loading contract address..."}</p>
      <ol className="max-h-80 space-y-3 overflow-y-auto">{state?.receipts.filter(receipt => receipt.kind === "call").slice().reverse().map(receipt => <li key={receipt.id} className="rounded-md border border-border p-3"><div className="flex justify-between gap-3 text-xs"><strong>{receipt.name}</strong><span>Block {receipt.blockHeight}</span></div><p className="mt-2 break-all font-mono text-[11px] text-muted">{receipt.txHash}</p></li>)}</ol>
    </Panel></div></div>
    <details className="rounded-lg border border-border bg-elevated p-4 text-sm"><summary className="cursor-pointer font-semibold">What this live demo establishes</summary><p className="mt-3 text-muted">Actual Compact proofs, DUST fees, finalized Preprod transactions and durable private openings. The local operator controls the role keys. The services are deterministic; reserve and redemption units are accounting, with no merchant token payout. Public amounts and reserve history can reveal debt; complete historical privacy is still under development.</p></details>
    <a className="text-sm text-navy underline" href="/checkout">Open the quick local checkout demo</a>
  </div></Shell>;
}
