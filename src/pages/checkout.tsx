import { useEffect, useState } from "react";
import { Shell } from "@/components/line/shell";
import { Button, Panel } from "@/components/line/ui";

type Durability = "encrypted-disk" | "volatile";
type Session = { id: string; issuerToken: string; agentToken: string; expiresAt: number; durability: Durability };
type View = {
  opened: boolean; totalReserve: number; encumberedReserve: number; redeemedReserve: number; feeReserve: number;
  pendingFeeReserve: number; refundReserve: number; reportedRefundReserve: number;
  domain: string; lineCommit: string; deliveries: number;
  durability: Durability;
  privateBooks?: { limit: number; outstanding: number; remaining: number };
  refunds?: { orderId: string; credited: number; amount: number; reported: boolean }[];
};
type Receipt = {
  orderId: string; service: string; merchant: string; amount: number; quote: string; note: string | null;
  outcome: "pending" | "delivered" | "declined" | "expired" | "compensated"; stages: string[]; message?: string; output?: Record<string, unknown>;
};
const DEFAULT_DOCUMENT = "Autonomous agents need reliable purchasing controls. Line separates private credit authorization from merchant claims. Reliable delivery and honest privacy boundaries matter.";
const field = "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
class RequestRejection extends Error {}

export function CheckoutPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [limit, setLimit] = useState("40");
  const [reserve, setReserve] = useState("200");
  const [repayment, setRepayment] = useState("25");
  const [document, setDocument] = useState(DEFAULT_DOCUMENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Stable IDs survive uncertain HTTP responses while this page is open.
  const [attempt, setAttempt] = useState<{ document: string; ids: string[] } | null>(null);
  const [lastPlan, setLastPlan] = useState<{ document: string; ids: string[] } | null>(null);
  const [ackId, setAckId] = useState<string | null>(null);
  const [refundRefs, setRefundRefs] = useState<Record<string, string>>({});
  const [serverDurability, setServerDurability] = useState<Durability | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/checkout/catalog", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => {
        if (!response.ok) return;
        const catalog = await response.json() as { durability?: Durability };
        if (!controller.signal.aborted && (catalog.durability === "encrypted-disk" || catalog.durability === "volatile")) setServerDurability(catalog.durability);
      }).catch(() => {});
    return () => controller.abort();
  }, []);

  async function request<T>(path: string, token?: string, payload?: Record<string, unknown>): Promise<T> {
    const response = await fetch(`/api/checkout/${path}`, {
      signal: AbortSignal.timeout(15_000),
      method: payload ? "POST" : "GET", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Checkout needs the local evaluation server. Run npm run dev or npm run preview; a static deployment does not provide this API.");
    const result = await response.json();
    if (!response.ok) {
      // 5xx/timeouts can have followed an accepted transition: retain retry IDs.
      const message = result.error ?? "Checkout request failed.";
      throw response.status < 500 ? new RequestRejection(message) : new Error(message);
    }
    return result as T;
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Request failed."); }
    finally { setBusy(false); }
  }
  async function refresh(current: Session) { setView(await request<View>(`sessions/${current.id}/issuer`, current.issuerToken)); }
  async function open() {
    await act(async () => {
      const current = session ?? await request<Session>("sessions", undefined, {});
      setSession(current);
      setView(await request<View>(`sessions/${current.id}/issuer/configure`, current.issuerToken, { limit: Number(limit), reserve: Number(reserve) }));
      setNotice("Issuer opened the line and funded accounting reserve. No funds moved.");
    });
  }
  async function run() {
    if (!session) return;
    await act(async () => {
      const resumeIncomplete = lastPlan?.document === document && receipts.some(receipt => receipt.outcome !== "delivered");
      const plan = attempt ?? { document, ids: [0, 1].map(index => resumeIncomplete && receipts[index]?.outcome === "delivered" ? lastPlan!.ids[index] : crypto.randomUUID()) };
      setAttempt(plan);
      const result: Receipt[] = [];
      for (const [index, service] of ["text-analysis", "cost-report"].entries()) {
        const receipt = await request<Receipt>(`sessions/${session.id}/agent/purchase`, session.agentToken, { service, document: plan.document, requestId: plan.ids[index] });
        result.push(receipt);
        setReceipts([...result]);
      }
      await refresh(session);
      setLastPlan(plan);
      setAttempt(null);
      const declined = result.filter(receipt => receipt.outcome === "declined").length;
      const delivered = result.filter(receipt => receipt.outcome === "delivered").length;
      setNotice(delivered === result.length ? "Both service results are available. Each purchase used its own merchant-bound claim; no asset payout occurred." : `${delivered} service delivered; ${declined} purchase declined; ${result.length - delivered - declined} expired or compensated. Review the issuer's private book and obligations before starting a new purchase.`);
    });
  }
  async function reportRefund(orderId: string) {
    if (!session) return;
    await act(async () => {
      const reference = refundRefs[orderId] ?? crypto.randomUUID();
      setRefundRefs(current => ({ ...current, [orderId]: reference }));
      setView(await request<View>(`sessions/${session.id}/issuer/report-refund`, session.issuerToken, { orderId, reference }));
      setNotice("Issuer reported an evaluation refund acknowledgment. No cash payout was verified; the full original accounting budget remains retired.");
    });
  }
  async function acknowledge() {
    if (!session) return;
    await act(async () => {
      const reference = ackId ?? crypto.randomUUID();
      setAckId(reference);
      try {
        setView(await request<View>(`sessions/${session.id}/issuer/acknowledge`, session.issuerToken, { amount: Number(repayment), reference }));
      } catch (failure) {
        if (failure instanceof RequestRejection) setAckId(null);
        throw failure;
      }
      setAckId(null);
      setNotice("Issuer acknowledged an evaluation repayment. Credit capacity changed; reserve backing did not increase and no payment was collected.");
    });
  }
  const issued = Boolean(view?.opened);
  const durability = view?.durability ?? session?.durability ?? serverDurability;
  return (
    <Shell evaluation>
      <div className="mb-8 max-w-3xl space-y-3">
        <p className="text-xs uppercase tracking-wide text-subtle">API procurement evaluation</p>
        <h1 className="font-display text-3xl tracking-tight md:text-4xl">Give an agent a task. Verify every purchase.</h1>
        <p className="text-muted">Merchant A analyzes your document. Merchant B estimates processing size. A deterministic agent purchases both through separate capabilities, while the issuer controls credit and repayment acknowledgements.</p>
        <p className="border-l-2 border-accent pl-3 text-sm text-muted">Generated Compact executes locally. No ZK proofs are submitted, no tokens move, and all roles share one evaluation server. New purchases close after 30 minutes; debt and pending claims remain available for reconciliation. Leaving or reloading this page drops the browser capabilities and retry IDs.</p>
        <p className="text-sm text-muted" aria-label="Checkout recovery mode">{durability === "encrypted-disk" ? "Server recovery: encrypted checkpoints. A restart can recover this session before expiry with the same source version and storage password. Keep this page open to retain its capabilities and exact retry IDs." : durability === "volatile" ? "Server recovery: volatile memory. Restarting the server loses this evaluation, its credit book and retry journal." : "Server recovery: configuration not yet confirmed."}</p>
      </div>
      {error && <p role="alert" className="mb-4 rounded-md border border-danger/40 p-3 text-sm text-danger">{error}{attempt && " Retry the same plan to retain its request IDs."}</p>}
      {notice && <p role="status" className="mb-4 rounded-md border border-border p-3 text-sm">{notice}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel kicker="Issuer capability" title="Authorize the facility">
          <p className="text-sm text-muted">Start with a 40-unit limit: analysis costs 25, processing estimate costs 20. The second purchase should decline until the issuer acknowledges repayment.</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2 text-sm">Credit limit<input aria-label="Credit limit" type="number" min="1" max="1000000" value={limit} disabled={busy || issued} onChange={e => setLimit(e.target.value)} className={field} /></label>
            <label className="space-y-2 text-sm">Accounting reserve<input aria-label="Accounting reserve" type="number" min="1" max="1000000" value={reserve} disabled={busy || issued} onChange={e => setReserve(e.target.value)} className={field} /></label>
          </div>
          {!issued && <Button disabled={busy} onClick={open}>{busy ? "Opening…" : "Open evaluation line"}</Button>}
          {view?.privateBooks && <dl className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-sm" aria-label="Issuer private credit book">
            <div><dt className="text-subtle">Private limit</dt><dd>{view.privateBooks.limit}</dd></div>
            <div><dt className="text-subtle">Private debt</dt><dd>{view.privateBooks.outstanding}</dd></div>
            <div><dt className="text-subtle">Private capacity</dt><dd>{view.privateBooks.remaining}</dd></div>
          </dl>}
          {issued && <div className="space-y-3 border-t border-border pt-3">
            <label className="block space-y-2 text-sm">Evaluation repayment<input type="number" aria-label="Evaluation repayment" value={repayment} min="1" max="1000000" disabled={busy || Boolean(ackId)} onChange={e => setRepayment(e.target.value)} className={field} /></label>
            <Button variant="ghost" disabled={busy} onClick={acknowledge}>Issuer: acknowledge evaluation repayment</Button>
            <p className="text-xs text-subtle">Evaluation acknowledgement only. A production issuer must verify a genuine payment and reconcile its cash before acknowledging.</p>
          </div>}
          {view?.refunds?.some(refund => refund.amount > 0) && <div className="space-y-3 border-t border-border pt-3" aria-label="Issuer private refund obligations">
            <p className="text-sm text-muted">Private cash refund obligations. Reporting records an issuer assertion; it does not verify cash delivery.</p>
            {view.refunds.filter(refund => refund.amount > 0).map(refund => <div key={refund.orderId} className="space-y-2">
              <p className="text-sm">{refund.amount} evaluation units owed · {refund.reported ? "issuer report recorded" : "awaiting issuer report"}</p>
              <Button variant="ghost" disabled={busy || refund.reported} onClick={() => reportRefund(refund.orderId)}>Issuer: report evaluation refund</Button>
            </div>)}
          </div>}
        </Panel>
        <Panel kicker="Agent capability" title="Buy the services">
          <label className="block space-y-2 text-sm">Document<textarea aria-label="Document" rows={6} maxLength={8000} value={document} disabled={busy || Boolean(attempt)} onChange={e => setDocument(e.target.value)} className={field} /></label>
          <p className="text-sm text-muted">Plan: buy document analysis from Merchant A for 25 units, then processing estimate from Merchant B for 20 units. This policy agent uses fixed steps, not an LLM.</p>
          <Button disabled={busy || !issued || !document.trim()} onClick={run}>{busy ? "Executing…" : attempt ? "Retry the same purchase plan" : lastPlan?.document === document && receipts.some(receipt => receipt.outcome === "declined") ? "Retry declined purchase" : "Run agent purchase plan"}</Button>
          <p className="text-xs text-subtle">The agent endpoint can buy catalog services. Its token cannot fund the reserve, change its limit or acknowledge repayments.</p>
        </Panel>
      </div>
      {receipts.length > 0 && <div className="mt-6 grid gap-6 lg:grid-cols-2" aria-label="Purchase results">
        {receipts.map(receipt => <Panel key={receipt.orderId} kicker={`${receipt.merchant} · ${receipt.amount} evaluation units`} title={receipt.outcome === "delivered" ? "Service delivered" : receipt.outcome === "compensated" ? "Expired claim compensated" : receipt.outcome === "expired" ? "Quote expired" : receipt.outcome === "pending" ? "Purchase pending" : "Purchase declined"}>
          {receipt.message && <p className="text-danger">{receipt.message}</p>}
          <ol className="space-y-1 text-sm text-muted">{receipt.stages.map(stage => <li key={stage}>{stage.replaceAll("-", " ")}</li>)}</ol>
          {receipt.output && <pre className="overflow-auto rounded-md bg-bg p-3 text-xs" aria-label={`${receipt.merchant} service result`}>{JSON.stringify(receipt.output, null, 2)}</pre>}
          <details className="text-xs text-subtle"><summary className="cursor-pointer">Quote and claim references</summary><p className="mt-2 break-all">Quote: {receipt.quote}</p><p className="mt-2 break-all">Note: {receipt.note ?? "No note issued"}</p></details>
          <p className="text-xs text-subtle">Payout: not connected. Claim redemption is an accounting transition.</p>
        </Panel>)}
      </div>}
      {view && <div className="mt-6"><Panel kicker="Public ledger view" title="What an observer can see">
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div><dt className="text-subtle">Total reserve</dt><dd>{view.totalReserve}</dd></div><div><dt className="text-subtle">Encumbered</dt><dd>{view.encumberedReserve}</dd></div><div><dt className="text-subtle">Claims redeemed</dt><dd>{view.redeemedReserve}</dd></div><div><dt className="text-subtle">Services delivered</dt><dd>{view.deliveries}</dd></div>
          <div><dt className="text-subtle">Pending fees</dt><dd>{view.pendingFeeReserve}</dd></div><div><dt className="text-subtle">Earned fees</dt><dd>{view.feeReserve}</dd></div><div><dt className="text-subtle">Refund budgets held</dt><dd>{view.refundReserve}</dd></div><div><dt className="text-subtle">Reported refund budgets</dt><dd>{view.reportedRefundReserve}</dd></div>
        </dl>
        <p className="text-sm text-muted">Credit books are absent from this public projection, but public purchase amounts and historical reserve changes can reveal debt. Remaining capacity and exact limit are not published; approvals still reveal bounds. Stronger history confidentiality remains required.</p>
        <details className="text-xs text-subtle"><summary className="cursor-pointer">Contract references</summary><p className="mt-2 break-all">Domain: {view.domain}</p><p className="mt-2 break-all">Current commitment: {view.lineCommit}</p></details>
      </Panel></div>}
      {session && <div className="mt-6"><Button variant="ghost" disabled={busy} onClick={() => { setSession(null); setView(null); setReceipts([]); setAttempt(null); setLastPlan(null); setAckId(null); setRefundRefs({}); setError(""); setNotice("Evaluation cleared in this browser. Server records with debt or pending obligations remain available using the original capabilities."); }}>Start a new evaluation</Button></div>}
    </Shell>
  );
}
