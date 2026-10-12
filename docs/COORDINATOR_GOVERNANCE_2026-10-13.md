# Recoverable coordinator governance

The private financial worker now constructs the existing Compact inputs for `disableMerchant`, `withdrawUnencumberedReserve`, `withdrawFees` and `setStatus`. This extends its dispatch inventory from six to ten names. The Compact source and managed canonical artifacts are unchanged. Repayment, the three compensation modes and closed-book reopening still need integrated work; this is not the completed twelve-circuit lifecycle.

## Authority and private state

All four actions require the issuer client. Disable signs the selected merchant identifier. Reserve withdrawal signs the predecessor reserve commitment and exact private amount. Fee withdrawal signs that commitment and the exact earned fee amount. Status signs the predecessor private book, requested state and new salt. The new book keeps its debt, rotates its salt and advances its epoch exactly as Compact requires.

Before the owner request, the worker saves the descriptor, complete private inputs, exact circuit arguments and semantic request in the existing encrypted write-ahead authorization intent. Restart uses those saved values. Candidate publication and confirmation use the existing journal; completed retries must match their original semantic request and cannot reserve/sign again.

The separately selected `approval-owner-governance-policy.mjs` extends the existing purchase policy only when an issuer config explicitly selects `governanceMode: 'bounded'`. It requires private withdrawal/fee limits, counts withdrawn amounts against the signer's authorization budget, and restricts status to an allowed set and the configured borrower/domain. Debt-bearing closure, closed predecessors, exhausted epochs and foreign books deny. Existing purchase-only stores are not automatically broadened. No payment/repayment/refund action is approved by this extension.

Free-reserve preflight includes **all six Compact locks**: encumbered principal, redeemed principal, earned fees, pending fees, refund holds and reported-refund holds. Invalid amounts, debt-bearing closure, wrong governance actors and missing enabled-supplier paths reject before writing an authorization intent. A disabled merchant can still redeem its eligible original claim; the registered identity and enabled quote tree have different purposes. Compact remains the final authority for all checks.

These are accounting instructions, not custody or payout receipts. Neither the software policy nor local confirmation proves that cash exists or moved.

## Verification scope

Targeted coordinator tests pass **10/10**, covering exact lock conservation, opt-in policy bounds, role/domain/borrower restrictions and closure predicates. Full local regression passes **539 tests / 60 suites**. Canonical compile/zero managed drift, build/typecheck and fixture-key/credential scans pass. Fresh compatibility runs also pass: original purchase fixture ten calls/eight exits/six controls/46 counted invocations; repeated-supplier archive thirteen calls/twelve exits/twelve controls/63 counted invocations. Their public generated reports are refreshed at this helper scope; historical native reports are unchanged.

The new `--governance` fixture freshly compiles and completes **15 generated calls across ten names, 28 deliberate exits and 27 controls** through four mTLS owners. Every new governance action is interrupted after intent persistence, approval, candidate publication and confirmation, then restored/retried. Default/resume preserves debt; a disabled Merchant A redeems its old claim; Merchant B still completes its purchase. Disabled quoting, debt-bearing closure, backing withdrawal, empty fee withdrawal and wrong actors reject without leaving pending authorization. [Exact source/helper/artifact-bound report](private-signed-2026-10-11-evidence/owner-coordinator-governance.json).

The historical process counter records **102 successful commands plus deliberate crashes**; failed negative-control worker invocations are excluded, so it is not the total number of process starts. The fixture is generated-only and cannot select native proving or the repeated-supplier mode. Confirmation is a caller-trusted synthetic candidate observation. CI includes a separate fresh governance run alongside the original and repeated-supplier scenarios; remote results remain separate.

Historical native reports retain their exact earlier helper sets. No proof, finalized network call, independent administration, authentic payout or complete-history privacy result is added by the unit regression.
