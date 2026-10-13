# Line — current project and Wave 2 audit

Snapshot: **13 October 2026, IST**. Repository: [ShrikarT/line](https://github.com/ShrikarT/line). Latest fetched main: `a0e51ee`, including deployment work `babc507`. Audit/fix branch: `fix/audit-integration`, [draft PR #10](https://github.com/ShrikarT/line/pull/10). Original owner checkout remains unchanged. This report consolidates the current result; the [detailed audit history](FULL_AUDIT_2026-10-11.md) preserves earlier reproductions and failures.

## Verdict

**Line has substantial verified protocol engineering. It is not yet an operating private-credit and settlement product.** Its strongest demonstrated work is exact Compact accounting, adversarial checks, role approval separation, real local proofs and recovery of private claim openings. Its decisive gaps are full-history privacy, independent institutional custody, complete integrated lifecycle, independently reconciled network execution, actual settlement and customer demand.

The accepted customer hypothesis is enterprise teams whose agents buy APIs and compute. Keep the broader destination: shared repayable credit, multiple suppliers, protected credit books, real fulfillment/settlement and risk management. The next submission must show exactly which part works and why a buyer needs it. More proof counts alone cannot establish demand, deployment, payment or a guaranteed judging result.

## What actually runs

| Lane | Current evidence | Practical boundary |
|---|---|---|
| Canonical contract and consoles | Compiles with zero managed drift; local checkout/browser and accounting/recovery controls pass | Public amounts/fees/history reveal debt; keys remain combined in the evaluation; local service results are deterministic |
| Reported canonical Preprod deployment | Twelve verifier registrations; eight named calls reported at `b2254962147c9cc2e5b9fbcf39f8a4e0d1f149b7801a651df2e41dda1e4410d9` | Independent authenticated receipt/state reconciliation is pending; registrations are not executions, payouts or deployment of the privacy candidate |
| Private-offer Compact experiment | 65 contract calls across all twelve names, with eight decodable corrupted-proof rejections in separate Rust verification | Synthetic ledger/time, disabled fee balancing, original ephemeral actors; full observer privacy remains unproved |
| Durable private coordinator | Eleven dispatch names through four owner services; fresh per-offer bindings; exact prepared/proven retries; claim archives; latest lifecycle has 23 generated calls/56 exits/49 controls, repayment and changed-terms reopening | New lifecycle is generated-only with synthetic owner receipt records. Historical native recovery covers six names. One borrower/two supplier roles; compensation is unintegrated; same-host ownership and no live wallet/submission adapter |
| Repeated-supplier recovery | 13 generated calls, twelve exits/controls; older quote and note used after newer Merchant A purchases; Merchant B separation | Deeper recovery across six names, not all-twelve durable lifecycle or compensation |
| Native archive evidence | Fourteen saved public transactions freshly Rust-verified and replayed as one continuous chain, representing thirteen contract calls | Original proving run remains incomplete from a reporting-count error; separate artifact revalidation preserves that failure and generates no replacement proofs |
| Network financial journal | Internally fetched bootstrap/confirmation, pinned verifier/service policy, saved identifiers/intents and candidate-state checks; simulated-provider controls pass | Reusable application boundary; not the completed private worker/deployment integration or independently operated full-node verification |

The archive implementation passed **535 local tests / 60 suites**, 36 separate receipt controls and both implementation CI runs. Linux CI recorded 533 core passes and two platform skips; separate jobs covered Windows ACLs and Windows/Linux process ownership. The original and repeated-supplier coordinator scenarios and 20 browser tests passed. [CI](https://github.com/ShrikarT/line/actions/runs/38296967793), [archive evidence](CLAIM_ARCHIVE_2026-10-13.md).

The latest [governance continuation](COORDINATOR_GOVERNANCE_2026-10-13.md) passes **539 local tests / 60 suites**, compile/zero drift, build/scans and fresh original/repeated-supplier compatibility. Its separate fifteen-call generated scenario covers ten names with twenty-eight exits and twenty-seven controls. Governance CI remains separate; no new native, network or payout scope follows from this generated result.

The subsequent [repayment/reopening continuation](COORDINATOR_REPAYMENT_REOPENING_2026-10-13.md) passes **541 local tests / 60 suites** and a corrected 23-call/eleven-name generated lifecycle with 56 exits and 49 controls. An initial run found a payment-nullifier preflight field-order error after staging a denied intent; the source-exact correction and failed run are documented. Governance `1a1cb03` passes push/PR CI; the newer lifecycle CI is separate. Synthetic owner-record matching is not authentic payment or settlement.

Lifecycle `a096edc` now passes both implementation CI runs, including fresh original/archive/governance/lifecycle, browser and platform checks. The [subsequent identifier fix](COORDINATOR_OPERATION_IDS_2026-10-13.md) passes **542 local tests / 60 suites** and a new actual compiled-worker/mTLS admission/retry test, plus compile/zero drift, build and scans. Historical lifecycle/native reports keep their exact original helper scopes; identifier-fix CI remains separate.

## Critical findings

The [owner policy integrity review](OWNER_POLICY_INTEGRITY_2026-10-13.md) reproduced a helper-change authorization gap and adds an encrypted-store pin for the CLI's full policy module. Updated profile hashes cannot silently broaden an existing bound module policy. Imported dependencies remain unpinned, and older CLI stores have no automatic migration. Its 537-test local regression and both implementation CI runs pass. New governance has its separate 539-test/generated scope above. Neither change adds native-proof, network or settlement evidence.

| Priority | Finding | Required change / evidence |
|---|---|---|
| P0 | Canonical history reconstructs debt from a known-zero opening | Replace the disclosure path in the actual submitted runtime. A public 15-unit debit plus known 1-unit fee establishes 16 owed; a hidden commitment cannot undo that arithmetic |
| P0 | Experimental field hiding is not full-history privacy | Review complete observer-specific histories, public values/distributions, deadlines, sender/DUST, service traffic, probes and asset events. Preserve the explicit protected-book requirement |
| P0 | Accounting is not cash custody or settlement | Select an accountable denomination/rail/custodian; authenticate deposits, delivery, payout, repayment and refund receipts. Name borrower, capital provider, merchant, settlement operator and loss bearer |
| P0 | Deployment evidence is not independently reconciled here | Configure read-only receipt access and verify raw actions, source-bound keys, canonical finalized blocks and post-state. Do not synthesize success or repeat uncertain funded actions |
| P0 | Independent institutional custody remains unverified | Run owners under separate administration with enforceable policy and recovery. Same-host stores/mTLS demonstrate interfaces, not independent institutions or managed hardware signing |
| P1 | Private coordinator dispatches eleven of twelve names; all three compensation modes remain absent | Retain exact refund openings, authenticate refund receipts and verify a continuous all-twelve lifecycle. Obtain native/network evidence for the newer governance, repayment and reopening paths; synthetic records are not cash |
| P1 — fixed for new requests | Worker/owner operation-ID namespaces differed; invalid IDs could strand an intent | [Real-worker reproduction and fix](COORDINATOR_OPERATION_IDS_2026-10-13.md) aligns validation before persistence and uses safe own request entries. Current signer rejects `__proto__` before approval, so post-approval prototype mutation is not the observed failure. Historical denied intents still require authenticated resolution |
| P1 | Custom Jubjub approval construction lacks independent review | Review subgroup/nonce/challenge/range semantics, implementation and custody support. Accepted proofs do not certify a signature construction or secure hardware integration |
| P1 | No observed customer purchase, supplier commitment or adoption | Validate a recent real workflow, contracting/budget owner, evidenced pain, incumbent comparison and willingness to integrate/pay. Current contacts/interviews/pilots/revenue are absent |
| P1 | Proving latency is material to checkout and expiry | Measure the complete quote-to-proof-to-finality path; set deliberate deadline/SLA margins and safe expiry recovery. Do not pitch millisecond checkout |
| P1 | Submission assets/version and controlling deadline are not certified | Freeze source/demo/deck/video and resolve organizer schedule/rubric authority. A pitch specification is not a delivered deck or video |
| P2 | Rollback, device loss, expired intents, capacity and concurrency remain open | Preserve obligations, add authenticated backup/migration and current-root recovery, and resolve uncertainty without replacing nonces or deleting evidence |

The [twelve-circuit coverage map](TWELVE_CIRCUIT_RUNTIME_GAP_2026-10-13.md) identifies exact roles, policy denials and missing fields. The unimplemented coordinator names are `disableMerchant`, `withdrawUnencumberedReserve`, `withdrawFees`, `cancelOrExpireNote`, `acknowledgeRepayment` and `setStatus`. Its opening path also lacks integrated closed-predecessor reopening. The signer defining those tuples does not prove that the coordinator can execute/recover them.

The reported deployment script still has unsafe assumptions: saved hashes can skip unconfirmed work, restarts regenerate private salts/nonces, and exceptions can be retried without resolving finality. A known transaction hash is not a recoverable credit-book opening. [Deployment audit](NETWORK_RECEIPT_AUDIT_2026-10-11.md).

## Bugs and boundaries already improved

The audit branch repairs stable payment-reference replay prevention, authenticated zero-debt closure, ledger-time expiry, exact issuer-approved fees, pending/earned fee accounting, note-bound compensation and locked refund budgets. Runtime/provider compatibility, encrypted staged operations, browser/restart recovery and production key/credential checks have their own recorded evidence.

The newer private lane separates signing scalars from the financial worker, minimizes supplier payloads, adds owner-policy stores and pinned mTLS interfaces, and contains interrupted native workers. It saves exact public proven bytes for reply-loss recovery. Network journals no longer accept copied state as finalized confirmation. Saved identifiers and intent bytes must survive the tested SDK merge form unchanged.

Two recent custody/privacy defects are specifically repaired:

- **Repeated offer binding:** new quotes use fresh salted actual Compact bindings. Exact retries retain the original binding. A separately opted-in supplier policy accepts those handles from its pinned financial caller; existing fixed-customer policies are unchanged. This removes an off-chain equality channel, not independently known buyer identity or full-history inference.
- **Lost older claim opening:** quote/note records are archived by commitment while current supplier records remain selectors. Older claims can be selected and redeemed after newer purchases. Legacy import preserves only secrets still present; already-overwritten openings require authentic backup. Compensation recovery is not inferred from successful redemption.

The 13-call native run's final guard expected 87 counted invocations instead of 85. All thirteen calls had verified, but the original report remained incomplete. The separate revalidator checked source/key/helper/binary hashes, freshly verified every saved transaction and continuously replayed its pre-state chain. The actual count is 63 generated invocations + 13 per-call proving responses + 9 additional draw interruption/retry invocations. [Preserved failure and revalidation](CLAIM_ARCHIVE_2026-10-13.md). This distinction is part of the evidence, not an omitted failed test.

## Privacy assessment

The private candidate commits book/reserve/note quantities and minimizes supplier disclosures. Its finite confidential-fee pair permits different debts under identical supplier quote terms. Fresh bindings and archived secrets improve the integrated flow. They do not establish computational indistinguishability of complete public histories.

The eleven recorded transaction-size differences now have explained public encoding causes: binding response/randomness widths, normalized byte values and graph sharing. Explaining those finite sizes is narrower than proving their distributions leak nothing. [Wire review](PUBLIC_ENCODING_REVIEW_2026-10-12.md), [public dependencies](PUBLIC_DEPENDENCY_REVIEW_2026-10-12.md).

Define each observer's authorized information. The borrower may know its own book; the issuer/financial prover is explicitly trusted with books and reserve openings; suppliers know their own offers/claims. If someone knows starting debt, every debit/fee and every repayment, debt follows mathematically. The system must avoid supplying those facts to unauthorized observers; it cannot conceal a consequence of facts already known. Public action/lifecycle outcomes, unique catalogs, caller attribution and real payment events still need assessment. [Observer model](PRIVACY_OBSERVER_MODEL_2026-10-11.md).

## Product direction and economics

"Agents can buy APIs" and "agents have spending caps" are weak differentiators. Coinbase documents human-controlled per-call/session caps, and Stripe documents machine payments over MPP/x402 with settlement, refunds and scoped card credentials. These are documented alternatives, not independently reproduced competitor benchmarks. [Coinbase controls](https://docs.cdp.coinbase.com/agentic-wallet/mcp/mcp-tools/show-wallet-app), [Stripe machine payments](https://docs.stripe.com/payments/machine).

**Inference:** Line must establish demand for protected shared repayable credit and accepted supplier clearance beyond those rails, conventional billing or a trusted gateway. Do not assume cards expose the customer's credit limit to merchants. Ask what confidential information actually leaks in a recent purchase and why independent verification changes the outcome.

The 65-call private-offer fixture's local proving has an upper median of **45.5 seconds**, nearest-rank p95 **127.8 seconds**, maximum **263.6 seconds**; draw samples take roughly **104–264 seconds**. These finite measurements use two CPU workers and exclude balancing, finality and settlement. They favor testing invoice/account-sized compute procurement before promising high-frequency micropayment checkout. That is a testable fit hypothesis, not permission to shrink the full product. [Measured scope](FULL_AUDIT_2026-10-11.md).

Before a pilot, measure proof/finality and service latency, integration hours, capital cost, default/loss/collections, dispute/refund burden and supplier acceptance against the strongest viable incumbent. Keep unmeasured economics blank. Repayment restoring debt headroom does not automatically replenish physical cash or authenticate a reserve deposit. [Validation plan](PRODUCT_VALIDATION.md), [full product requirements](PRODUCT_DIRECTION.md).

## Wave 2 priorities

1. **Freeze a truthful demonstration now.** Show one enterprise agent task, both supplier roles, exact clearance/fees, a decline, one-time claim use and recovered older purchases. Label the lane at every transition: generated, locally proved, reported network, independently confirmed or paid.
2. **Prepare the required entry package.** Pin commit/source/key evidence, demo instructions, deck and narrated video. Explain the Wave 2 change and remaining gate. Existing `PITCH.md` and `WAVE2_DEMO.md` are specifications; a final rendered deck/video and entrant submission are not verified.
3. **Close the critical live path before calling it operating credit.** Reconcile receipts and private openings, preserve uncertain submissions, integrate actual settlement and independently operated role policies. Complete all compensation modes without blindly approving external payment assertions; verify newer governance, repayment and reopening with native proofs and finalized receipts.
4. **Test the protected-history promise.** Use reachable paired histories with equal permitted knowledge, not stripped placeholders. Address caller, timing, fee, service and asset observations and obtain construction/implementation review.
5. **Obtain buyer/supplier evidence.** Start with recent enterprise API/compute purchases and a named budget owner. No outreach or customer result was performed by this audit.

On **13 October**, the [live AKINDO API](https://api.akindo.io/public/wave-hacks/jaMZjqPOBsLXvjdG) still lists Wave 2 submission at **19 October, 15:00:34 UTC / 20:30:34 IST**. The [Midnight overview](https://midnight.network/hackathon/buildathon) still lists **October 17**. The earlier linked rules-PDF and rubric conflicts remain unresolved; no controlling written amendment is established. Prepare immediately and use October 17 as a conservative engineering freeze relative to those two future dates, without treating that as a legal resolution of the older PDF. Entrant registration/eligibility and personal submission remain unverified. [Requirements/source review](WAVE2_REQUIREMENTS_2026-10-11.md).

## Audit limits

This is a systematic source, execution, architecture and evidence review, not formal verification that every possible defect is excluded. Native verifiers are separate processes using the pinned Midnight cryptographic implementation, not a separately designed verifier. Local fixtures use synthetic identities/time and may disable balancing. CI, compiled keys, commitment-looking bytes and source hashes each establish limited facts. This audit used no funded wallet and independently confirmed no privacy-candidate deployment or real payout. No customer demand was invented, and no judging outcome is guaranteed.
