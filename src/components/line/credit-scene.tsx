import { useEffect, useRef, useState } from "react";
import { animate, createTimeline, stagger } from "animejs";
import {
  ArrowRight,
  Check,
  CheckCircle,
  Fingerprint,
  LockKey,
  Play,
  Receipt,
  ShieldCheck,
} from "@phosphor-icons/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Illustrative product objects. These never submit a transaction. */
export function CreditSculpture() {
  return (
    <div
      className="credit-sculpture"
      aria-label="Illustrative private credit card and merchant receipt"
    >
      <div className="sculpture-grid" aria-hidden="true" />
      <div className="sculpture-orbit orbit-one" aria-hidden="true" />
      <div className="sculpture-orbit orbit-two" aria-hidden="true" />
      <div className="sculpture-backplate" aria-hidden="true" />
      <div className="sculpture-card">
        <div className="sculpture-card-top">
          <span className="sculpture-brand">
            <img src="/brand/logo-pixel.svg" alt="" />
            Line.
          </span>
          <span>PRIVATE CREDIT</span>
        </div>
        <div className="sculpture-chip" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="sculpture-card-book">
          <span>Approved allowance</span>
          <strong>
            60<span> units</span>
          </strong>
        </div>
        <div className="sculpture-card-bottom">
          <span>
            AGENT 01 <span>•••• 2048</span>
          </span>
          <Fingerprint size={32} weight="thin" />
        </div>
      </div>
      <div className="sculpture-receipt">
        <div className="flex items-center justify-between">
          <Receipt size={22} />
          <span className="receipt-stamp">
            <Check />
            Cleared
          </span>
        </div>
        <p>Merchant A</p>
        <strong>Text analysis</strong>
        <div className="sculpture-receipt-total">
          <span>Authorized</span>
          <b>
            25 <small>units</small>
          </b>
        </div>
        <div className="receipt-barcode" aria-hidden="true" />
        <span className="receipt-serial">One claim. One redemption.</span>
      </div>
      <span className="sculpture-tag tag-private">
        <LockKey weight="fill" />
        Private credit book
      </span>
      <span className="sculpture-tag tag-verified">
        <ShieldCheck weight="fill" />
        Rules proven on Midnight
      </span>
      <span className="sculpture-caption">
        ILLUSTRATIVE CREDIT / TEST UNITS
      </span>
    </div>
  );
}

const stages = [
  "Quote received",
  "Credit rule proven",
  "Merchant claim redeemed",
];

export function PurchasePlayground() {
  const [role, setRole] = useState("agent");
  const [stage, setStage] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!playing) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Assemble all stages before playback: the initial zero-duration callback
    // can otherwise finish an auto-playing timeline while it is being built.
    const timeline = createTimeline({
      autoplay: false,
      onComplete: () => setPlaying(false),
    });
    timeline
      .call(() => setStage(0), 0)
      .call(() => setStage(1), reduced ? 160 : 1000)
      .call(() => setStage(2), reduced ? 320 : 2200);
    timeline.play();
    return () => {
      timeline.cancel();
    };
  }, [playing]);
  useEffect(() => {
    if (!root.current || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const animation = animate(
      root.current.querySelectorAll(
        ".playground-panel[data-state='active'] .demo-animate",
      ),
      {
        opacity: [0, 1],
        y: [12, 0],
        duration: 600,
        delay: stagger(70),
        ease: "outCubic",
      },
    );
    return () => {
      animation.revert();
    };
  }, [role]);
  return (
    <div ref={root} className="purchase-playground">
      <div className="playground-topbar">
        <span>
          <span className="live-dot" />
          Line workspace
        </span>
        <span>Interactive preview · test units</span>
        <span className="playground-window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
      <Tabs value={role} onValueChange={setRole} className="playground-tabs">
        <TabsList aria-label="Preview participant">
          <TabsTrigger value="issuer">Issuer</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="merchant">Merchants</TabsTrigger>
        </TabsList>
        <TabsContent value="agent" className="playground-panel">
          <div className="demo-task demo-animate">
            <span className="task-avatar">
              <img src="/brand/logo-pixel.svg" alt="" />
            </span>
            <div>
              <span className="demo-micro">AGENT TASK</span>
              <h3>Analyze the document. Estimate the cost.</h3>
            </div>
            <span className="task-shortcut" aria-hidden="true">
              ↵
            </span>
          </div>
          <div className="demo-flow demo-animate">
            <div className="demo-allowance">
              <span className="demo-micro">REMAINING ALLOWANCE</span>
              <strong>
                {stage === 2 ? "15" : "60"}
                <small> units</small>
              </strong>
              <div className="allowance-segments" aria-hidden="true">
                {Array.from({ length: 20 }, (_, i) => (
                  <i key={i} data-used={stage === 2 && i < 15} />
                ))}
              </div>
              <span>Issuer approved · 2 suppliers</span>
            </div>
            <ArrowRight className="demo-flow-arrow" />
            <div className="demo-order-list">
              {[
                { merchant: "A", name: "Text analysis", price: 25 },
                { merchant: "B", name: "Cost report", price: 20 },
              ].map((item) => (
                <div className="demo-order" key={item.merchant}>
                  <span
                    className="merchant-token"
                    data-merchant={item.merchant}
                  >
                    {item.merchant}
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <span>Merchant {item.merchant}</span>
                  </div>
                  <b>
                    {item.price}
                    <small> units</small>
                  </b>
                  {stage === 2 && (
                    <CheckCircle weight="fill" className="order-check" />
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="demo-execution demo-animate">
            <ol aria-label="Illustrative purchase progress">
              {stages.map((label, i) => (
                <li key={label} data-done={stage >= i}>
                  <span>
                    {stage >= i ? <Check /> : String(i + 1).padStart(2, "0")}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
            <button
              className="demo-run"
              disabled={playing}
              onClick={() => {
                setStage(-1);
                setPlaying(true);
              }}
            >
              {playing
                ? "Running preview…"
                : stage === 2
                  ? "Replay purchase"
                  : "Preview a purchase"}
              {!playing && <Play weight="fill" />}
            </button>
          </div>
          <p className="demo-outcome" aria-live="polite">
            {stage === 2
              ? "Both illustrative claims redeemed. 45 units used, 15 remaining."
              : "A prepared example. No wallet, proof or network transaction is used here."}
          </p>
        </TabsContent>
        <TabsContent value="issuer" className="playground-panel">
          <div className="demo-issuer-view demo-animate">
            <div>
              <span className="demo-micro">THE ISSUER'S VIEW</span>
              <h3>You set the allowance.</h3>
              <p>
                Your agent can spend within this policy. It cannot increase its
                own limit or acknowledge repayment.
              </p>
              <span className="demo-private-pill">
                <LockKey />
                Private opening
              </span>
            </div>
            <div className="demo-policy">
              <div>
                <span>Credit limit</span>
                <strong>
                  60 <small>units</small>
                </strong>
              </div>
              <div>
                <span>Purchase total</span>
                <strong>
                  45 <small>units</small>
                </strong>
              </div>
              <div>
                <span>Remaining</span>
                <strong>
                  15 <small>units</small>
                </strong>
              </div>
              <span className="policy-rule">
                <CheckCircle />
                45 ≤ 60 · Within policy
              </span>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="merchant" className="playground-panel">
          <div className="demo-merchant-view demo-animate">
            <div className="claim-fingerprint">
              <Fingerprint weight="thin" />
              <span>MERCHANT A</span>
            </div>
            <div>
              <span className="demo-micro">A CLAIM ADDRESSED TO YOU</span>
              <h3>Verify. Redeem. Deliver.</h3>
              <p>
                The note binds the purchase to your merchant key. Another
                supplier cannot claim it, and redemption cannot be repeated.
              </p>
              <div className="claim-fields">
                <span>
                  <Check />
                  Merchant authenticated
                </span>
                <span>
                  <Check />
                  Single redemption
                </span>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
      <div className="playground-bottom">
        <span>
          <LockKey />
          The private book stays with authorized operators.
        </span>
        <a href="/checkout">
          Try the working demo <ArrowRight />
        </a>
      </div>
    </div>
  );
}

export function FeatureVisual({
  kind,
}: {
  kind: "policy" | "proof" | "claim";
}) {
  if (kind === "policy")
    return (
      <div className="feature-visual policy-visual" aria-hidden="true">
        <div className="policy-mini">
          <span>
            Spending policy <LockKey />
          </span>
          <strong>
            60<small> units</small>
          </strong>
          <div className="policy-mini-track">
            <i />
          </div>
          <div className="flex justify-between">
            <span>Used 45</span>
            <span>Available 15</span>
          </div>
        </div>
        <span className="visual-caption">
          <CheckCircle weight="fill" />
          Your agent follows your rules
        </span>
      </div>
    );
  if (kind === "proof")
    return (
      <div className="feature-visual proof-visual" aria-hidden="true">
        <div className="proof-mesh">
          {Array.from({ length: 36 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${i * 70}ms` }} />
          ))}
          <span>
            <ShieldCheck weight="thin" />
          </span>
        </div>
        <div className="proof-mini">
          <code>B + A + fee ≤ L</code>
          <span>
            <CheckCircle weight="fill" />
            Clearance proven
          </span>
        </div>
      </div>
    );
  return (
    <div className="feature-visual claim-visual" aria-hidden="true">
      <div className="claim-mini">
        <div>
          <Receipt />
          <span>Merchant A</span>
          <b>25</b>
        </div>
        <span className="claim-mini-separator" />
        <div className="claim-mini-confirmed">
          <CheckCircle weight="fill" />
          <span>
            Claim redeemed
            <br />
            <small>Text analysis delivered</small>
          </span>
        </div>
        <div className="receipt-barcode" />
      </div>
      <span className="claim-mini-corner">01 / 01</span>
    </div>
  );
}
