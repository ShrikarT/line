import { Check, FileText, Receipt, ShieldCheck } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function PurchaseSteps({ steps }: { steps: { label: string; complete: boolean }[] }) {
  return <ol className="purchase-steps" aria-label="Purchase workflow">{steps.map((step, index) => <li key={step.label} data-complete={step.complete}>
    <span className="purchase-step-number">{step.complete ? <Check aria-label="Complete" /> : String(index + 1).padStart(2, "0")}</span>
    <span>{step.label}</span>
  </li>)}</ol>;
}

export function ServiceCards() {
  return <div className="service-grid">{[{ merchant: "A", title: "Text analysis", detail: "Word count & document summary", amount: 25, icon: FileText }, { merchant: "B", title: "Cost report", detail: "A separate processing estimate", amount: 20, icon: Receipt }].map(({ merchant, title, detail, amount, icon: Icon }) => <div className="service-card" key={merchant}>
    <div className="service-card-heading"><span className="service-icon" data-merchant={merchant}><Icon weight="duotone" aria-hidden="true" /></span><span className="line-eyebrow">Merchant {merchant}</span></div>
    <h3>{title}</h3><p>{detail}</p><div className="service-price"><strong>{amount}</strong><span>test units</span></div>
  </div>)}</div>;
}

export function CreditBook({ book }: { book?: { limit: number; outstanding: number; remaining: number } }) {
  const usage = book && book.limit > 0 ? Math.min(100, Math.max(0, book.outstanding / book.limit * 100)) : 0;
  return <div className="credit-book">
    <div className="credit-book-heading"><ShieldCheck weight="duotone" aria-hidden="true" /><span>Authorized operator view</span></div>
    <dl aria-label="Issuer private credit book">{[["Private limit", book?.limit], ["Private debt", book?.outstanding], ["Private capacity", book?.remaining]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? <Skeleton className="h-8 w-12" />}</dd></div>)}</dl>
    <div className="credit-meter" role="meter" aria-label="Credit used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage} aria-valuetext={book ? `${book.outstanding} of ${book.limit} units used` : "Loading credit book"}><span style={{ width: `${usage}%` }} /></div>
    <p className="text-xs text-muted">{book ? `${book.remaining} units available within the approved line` : "Loading your private credit book…"}</p>
  </div>;
}

export function ServiceResult({ result, merchant }: { result: Record<string, unknown>; merchant: string }) {
  const metrics = Object.entries(result).filter(([, value]) => typeof value === "number");
  return <div className="service-result" role="region" aria-label={`${merchant} service result`}>
    <div className="flex items-center gap-2"><Badge variant="secondary"><Check aria-hidden="true" />Delivered</Badge><span className="text-xs text-muted">{merchant}</span></div>
    {metrics.length > 0 && <dl className="result-metrics">{metrics.map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1").toLowerCase()}</dt><dd>{String(value)}</dd></div>)}</dl>}
    {typeof result.summary === "string" && <p className="result-summary">{result.summary}</p>}
    <details><summary className="text-xs">Full service response</summary><pre className="service-json">{JSON.stringify(result, null, 2)}</pre></details>
  </div>;
}
