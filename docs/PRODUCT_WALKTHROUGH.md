# Line product walkthrough and capability boundaries

Updated: 9 October 2026. Start with the executable local procurement path at `/checkout`. Its role-scoped API links compiler-generated Compact accounting to actual deterministic HTTP service responses. The full private-credit product requirements remain in [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md), and [WAVE2_DEMO.md](WAVE2_DEMO.md) gives exact steps.

## Run one purchase task

Start `npm run dev` and open `http://localhost:5173/checkout`. The server middleware is required; a static build alone cannot serve the checkout API. Build plus `npm run preview` provides the same local evaluation environment.

The issuer operator opens a test facility with explicit limit and reserve accounting. The agent policy calls Merchant A's document-analysis service for 25 units and Merchant B's processing estimate for 20 units. Each purchase posts a quote, executes generated `draw` and, on success, redeems with the designated merchant secret before returning its service result. The UI shows actual stages, outcome and references.

With the default limit 40, A succeeds and B fails because debt 25 plus price 20 exceeds capacity. The displayed draw failure is **"Clearance could not be proven."** With a new evaluation limit at least 45 and sufficient accounting reserve, both succeed. Returned analysis counts actual input words/sentences/terms; the processing estimate reports payload size and a stated heuristic, not vendor usage or a token bill.

Issuer-only acknowledgment reduces the private book; it is a test operation, not proof of an incoming payment. Acknowledge the default 25 units, keep the document unchanged and choose **Retry declined purchase**. The planner reuses A's delivered order/result and starts a fresh B attempt for 20 units. Debt is then 20, redeemed accounting is 45 and service count is 2. Once the task is fully complete, a new plan creates new purchases. Genuine repayment verification and broader service/task planning remain production dependencies.

## What each interface means

| Interface | Intended authority | Evaluation / existing boundary |
|---|---|---|
| Checkout issuer panel/API | Configure line and reconcile repayment | Separate issuer bearer capability; operator browser obtains it for local evaluation |
| Checkout agent panel/API | Purchase catalog services within authorized capacity | Agent bearer cannot call issuer APIs; fixed deterministic plan, not an LLM integration |
| Merchant A/B service operations | Quote, own/redemption-check their notes, fulfill service | Distinct randomly generated secrets inside one server, not independent custody/operators |
| Checkout public ledger | Accounting, commitments, order outcomes | No plaintext private books in public payload; full-history amounts/deltas still leak utilization |
| Existing `/issuer`, `/agent`, `/merchant` desks | Role controls and private record workflows | Network/runtime/store defects are audit-tracked; labels alone do not establish safe custody or live network operation |
| `/lab` and fixture demo | Repeatable protocol attack illustrations | Reference-model/development evidence, not production authority or payment |
| `/explorer` | Publicly disclosed state | UI omits books, but an observer can access public history/transcripts outside this page |

Do not hand an untrusted agent the operator browser or both tokens. The evaluation separates API privileges but retains all role keys/private state in the same server. Production must isolate credentials, stores, witness handling and operator authority, including enrollment and repayment without granting the agent issuer powers.

## Authorization, redemption, delivery and payout

These are different states with different evidence:

1. A merchant quote commits to invoice terms and is authenticated by the designated merchant.
2. Agent clearance checks private credit state and accounting reserve. It does not establish cash custody.
3. A valid draw produces a merchant-bound note and changes outstanding debt and encumbered accounting.
4. Merchant redemption consumes a note once and changes redeemed accounting. It is not token settlement.
5. Successful service delivery produces a fulfillment/result reference. Delivery is not proven by a claim counter.
6. Actual payout needs a funded rail and finalized payment receipt reconciled to invoice, note, recipient and denomination. The local evaluation explicitly reports **payout not connected**.

Credit repayment and reserve replenishment stay distinct. Permissionless expiry moves a note's principal/fee backing from encumbered/pending counters into `refundReserve` without changing debt. The authenticated compensation action then credits the exact eligible amount against the borrower's current debt and privately commits any cash remainder; if any cash remains owed, the full original cost stays locked. An issuer refund report moves that full budget into `reportedRefundReserve`, which stays locked because the report does not verify cash. This is implemented for unredeemed expired claims; redeemed-but-undelivered disputes still need agreed terms and implementation. Pricing policy, risk/default ownership and debt-preserving reopening remain product requirements.

## Privacy and trust

Limit/outstanding/epoch are private circuit witnesses, while commitments hide their openings. Nevertheless public note amounts, reserve deltas and transaction history can reveal exact initial debt and subsequent increments; successful purchases reveal lower bounds. Merchant allowlist lookups in public execution transcripts reveal merchant pseudonyms. A full privacy guarantee needs the architectural work and observer tests in [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md) and [PRIVACY.md](PRIVACY.md).

The issuer knows the information needed for its authorized administration/reconciliation, and merchants know their own purchase terms. Off-chain content and openings need secure transport/storage. Local server execution keeps private data in that server and cannot be described as proof generation in the agent's browser. All evaluation reserve values are integer test credit units with no cash value.

## Retry, timeout and recovery

Use a stable purchase ID for a single logical order. Same-ID retries within the session resume its recorded stages or return the stored result; changed terms conflict. After a confirmed decline and repayment, use a fresh ID for a new attempt. The UI preserves delivered IDs and refreshes only declined IDs when retrying the unchanged task. A new task after complete success creates new IDs and can buy the services again. Repayment references similarly prevent duplicate evaluation acknowledgments within the server session.

New purchases close 30 minutes after evaluation-session creation. Exact retries and issuer reconciliation remain available for an expired session, and the reaper retains its checkpoint while debt, an unredeemed authorization or a refund budget remains unresolved; those retained sessions continue to consume capacity. Browser reload loses the session capabilities/IDs, and there is no operator recovery UI for that orphaned local state. Default server storage remains volatile. Configured encrypted checkpoints recover generated ledger/books/order stages after server restart. Console journals separately prewrite candidates and reconcile ambiguous transactions against exact receipts/public effects. [Recovery evidence](OPERATION_RECOVERY_2026-10-10.md) and [checkpoint configuration](CHECKOUT_DURABILITY_2026-10-10.md) describe verified boundaries. Production acceptance still requires device-loss backups, rollback/source migration, independent role custody, real-rail exactly-once economic effects, authorized operator recovery and archival capacity management.

## When the product is ready

The executable evaluation establishes a development purchase path when its API/browser/generated-contract tests pass. Full readiness additionally requires all PD-01–PD-18 acceptance: supported confirmed network, actual funding/payout, independent custody/merchants, history privacy, repayment/refund correctness, reliable expiry, durable recovery, enforceable pricing, fleet exposure/default policy, usable onboarding, adoption evidence, launch-market legal/custody/data-governance review, borrower-controlled portable underwriting evidence and safe protocol/policy governance. [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md) and [ROADMAP.md](ROADMAP.md) retain those commitments; test totals or a local successful purchase do not certify them.
