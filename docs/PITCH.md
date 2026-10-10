# Line pitch and demonstration evidence

Updated: 10 October 2026. [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md) owns product decisions and readiness. This is a pitch specification with explicit present/target boundaries, not proof that planned features shipped.

## Opening

**Line is a local protocol prototype exploring issuer-authorized purchasing for autonomous agents. Its destination is private credit clearance with merchant claims reconciled to service and payment evidence. No public deployment is verified. The current build proves local Compact accounting and single-use claims; it does not prove full purchase privacy, independent custody, service delivery, or asset settlement.**

**Hypothetical buyer task, not customer evidence:** an enterprise agent buys data or compute to complete a task. Treasury controls exposure; the agent needs purchasing authority; each merchant needs valid authorization, reliable delivery/payment reconciliation and protection against repeated claims. The intended product takes this workflow through actual settlement and recovery. No observed buyer workflow is established yet.

## Slide 1 — Buyer and task

Enterprise platform teams can already use prepaid APIs, policy-controlled wallets or conventional billing. These are real controls and the baseline to beat.

The customer segment is not selected. Compare production agent-platform operators buying for their own workflow, enterprise teams operating agents internally, and platforms integrating for a named customer-buyer. The enterprise-team segment remains an explicit hypothesis. No buyer evidence is established; use a clearly labeled hypothetical scenario unless a real workflow and buyer-owned harm are supported by consented evidence. A prior Midnight hackathon report describes the Latch project as implementing private AI-agent budgets, so Line's proposed distinction must be organization-level shared credit and accepted merchant settlement, not agent spending privacy alone. This is a published project description, not independently reproduced evidence. The current ledger exposes amounts and history, so do not promise full-book privacy today. No customer contacts or validation are established.

## Slide 2 — The clearance and merchant claim

Show issuer, agent, Merchant A and Merchant B as distinct evaluation capabilities, not independent custody. The current issuer-authenticated `openLine` also requires the agent secret witness. A draw checks the committed credit predicate and produces a note only that merchant can redeem once.

The generated-Compact local evaluator checks the transition against the circuit's encoded rules. It does not generate or verify a network proof. The merchant receives its own quote/claim data through the application. Public ledger amounts, reserve changes, merchant keys, and history are visible to observers, including merchants; current application scopes do not make those values private.

**Present boundary:** private witnesses and commitments hide openings, but public amounts, reserve deltas and merchant linkage reveal utilization, including initial debt from history. Full credit-book privacy is a required architectural outcome still needing evidence. Do not say "100% private", "unlinked counterparties" or "only clearance is revealed".

## Slide 3 — Claim is distinct from payment

Show credit authorization → accounting capacity reservation → merchant claim redemption → actual asset payout. Show fulfillment separately.

Current counters and note redemption implement accounting transitions, not cash custody, service delivery or token transfer. The destination requires a funded rail, denomination, confirmed payout and recovery/reconciliation. A network receipt and an asset-payment receipt remain distinguishable.

Credit does not create capital. Name borrower, capital provider, settlement operator, custody, payout trigger, loss bearer and repayment owner. A genuine repayment restores debt capacity; reserve replenishment must separately reflect an actual asset inflow. A draw reserves its fee; only merchant redemption moves that pending fee into the earned-fee counter. Neither counter proves fee collection. On unredeemed expiry, compensation may allocate debt relief and commit a private cash remainder. The full original claim backing stays locked if any cash is owed; an issuer's reference-bound refund report moves that budget to another locked counter and still does not prove a cash transfer.

## Slide 4 — Executable local task and production acceptance

The `/checkout` evaluation uses compiler-generated Compact execution and real local HTTP text-analysis and execution-cost report services. Explain that this executes contract logic locally: it is neither cryptographic proof generation, network finality nor token settlement. Local deterministic services demonstrate integration mechanics; they are not independent suppliers or customer traction.

The local evaluator generates distinct keys and agent/issuer API tokens inside one process; the browser operator receives both tokens. State clearly that this is not separate production custody. Record the generated-Compact result, storage mode and local-service output. A planned or simulated step is not a successful network feature.

The full-product acceptance target (not the current Wave 2 demo script) is:

1. Establish the facility, merchants and funding arrangement in the stated environment.
2. Agent obtains A's authenticated quote, gets clearance and transfers its merchant note.
3. A validates and processes the claim; the agent receives a real result with durable fulfillment reference.
4. B attempting to redeem A's note fails. A repeating redemption fails, without duplicate delivery/payment.
5. Over-capacity draw fails with **"Clearance could not be proven."** The explorer omits direct credit fields, but public history exposes and can reconstruct debt; full-history privacy fails today.
6. Issuer reconciles a real repayment once. Repeating the payment after state changes is rejected.
7. Agent purchases from B according to the buyer's observed task. If the task combines A and B, show that one result actually depends on the other; otherwise label these as independent merchant purchases.
8. Show claim and actual payout receipts separately, plus failed delivery/compensation or interrupted-operation recovery.

Steps involving actual money, public network or full historical privacy remain open until independently evidenced. Fixture amounts are test credit units unless an asset/currency and scale are established. Do not present a scripted snapshot as a live funded purchase.

## Slide 5 — Evidence and adversarial checks

Show source commit, compiler/runtime/environment compatibility, the twelve circuit names, generated drift result, authorization/replay/compensation/recovery checks, deployed address if confirmed and payout receipt if paid. Keep raw evidence linked outside slides.

Test wrong roles, cross-merchant theft, quote reuse, repeated redemption/repayment, reserve overdraw, premature expiry, stale opening and ambiguous submission in the actual product path. Attack Lab alone does not establish product capability isolation. Measure p50/p95 proving, finality and service completion separately; a simulator timing is not prover timing.

Use release-run versions/counts. A small deterministic randomized reference-model test is not formal verification of every invariant.

## Slide 6 — Adoption and full destination

Test whether buyers value independently verifiable credit authorization with a privacy guarantee that wallets, x402/MPP, or a trusted private gateway do not provide. The current public amounts and history fail the complete privacy requirement, and no buyer has validated a differentiating need. Wallet spending controls and paid APIs exist. Claims, batching and delayed settlement alone are not unique: x402 documents escrow-funded vouchers and later claim/settlement, while MPP supports one-time, usage-based and recurring payments across supported methods. [Coinbase spending controls](https://docs.cdp.coinbase.com/agentic-wallet/mcp/mcp-tools/show-wallet-app), [paid-service flow](https://docs.cdp.coinbase.com/agentic-wallet/cli/skills/pay-for-service), [x402 batch settlement](https://docs.x402.org/schemes/batch-settlement), [MPP](https://developers.cloudflare.com/agents/tools/payments/mpp/).

Strategic financing hypothesis: the organization is the liable borrower, its agent is a bounded delegate, an independent lender supplies capital, and a named settlement operator pays the supplier. Buyer-funded procurement is a separate control experiment; supplier credit is a separate creditor/receivable experiment. Line's software payer and price still need evidence. Name the capital provider and repayment/default owner. Validate willingness to pay, acceptance, cost and settlement risk separately for each model. Show interviews or commitments only if real and consented; otherwise show [the validation plan](PRODUCT_VALIDATION.md).

Retain fleet private credit, policy modules, independent capital providers, portable underwriting evidence, institutional custody and additional rails. [ROADMAP.md](ROADMAP.md) gives evidence gates. A singleton is not a fleet pool; claim accounting is not shielded token settlement.

## Demonstration release checklist

| Evidence | Needed for the corresponding claim |
|---|---|
| Task | Actual inputs, authenticated quotes, service results and completion artifact |
| Role isolation | Independent stores/capabilities; no issuer repayment in agent session; cross-merchant check in real path |
| Environment | Commit and compatible compiler/runtime/SDK/wallet/ledger/prover manifest; local/network label |
| Network | Address, finalized successful transactions and independently decoded post-state |
| Privacy | Disclosure table and adversarial transcript/history results; unmet target identified |
| Settlement | Denomination/rail, actual funding/payout receipt and invoice/note/recipient linkage |
| Reliability | Retry/crash/idempotency, double-credit protection, timeout lock and restored openings |
| Commercial | Consented buyer/merchant feedback, pricing hypothesis and baseline measurement |
| Wave progress | Accurate prior/current wave delta, repository/demo evidence, license/tag compliance |

Check current [Wave 2 rules and dates](https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG) before submission. An interim wave report keeps the full readiness requirements. This file does not authorize automated submission or outreach.
