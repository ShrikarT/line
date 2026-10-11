# Line audit update — 11 October 2026

This updates the [full product/code audit](FULL_AUDIT_2026-10-07.md), using the newer branding and simulator changes from `main`, canonical source fingerprint `35ebd14e19ce682230b685f6f3729923a9c56b0719eb17a684e44e4a39c73eff`, and the current fixes. The 7 October reproductions remain historical evidence. Current architecture, lifecycle and acceptance requirements are recorded in [engineering status](ENGINEERING_STATUS.md), [protocol](PROTOCOL.md), [privacy](PRIVACY.md) and [product direction](PRODUCT_DIRECTION.md).

**Verdict:** Line has a substantial, tested Compact accounting and authorization implementation. Real local proofs now work for all twelve circuits and pass separate cryptographic verification. It still does not satisfy the complete privacy, independent custody, network execution, funded settlement or customer-demand gates. The Wave 2 privacy-demo gate remains unmet.

## Highest-priority findings

| Priority | Finding and evidence | Required change and acceptance |
|---|---|---|
| Blocker | **Historical privacy fails.** The singleton has a known-zero opening, a stable identity and linkable transitions. Public principal and fees reconstruct outstanding debt before private repayment. The custody experiment reconstructs 25 exactly. Public query transcripts also disclose merchant pseudonyms; omitting a field from final metadata does not make the merchant unlinkable. | Compile a compatible private-book population design with unlinkable transitions. Test complete public arguments, queries, commitments, note/reserve deltas, fees, lifecycle and network/prover metadata across counterfactual borrower histories. Include enrollment, repayment, default, closure, reopening, compensation and concurrent spends. A shared root alone does not establish privacy, especially with one distinguishable borrower. |
| Blocker | **Canonical custody is shared.** `openLine` still requests both issuer and agent secrets. Checkout retains every role key in one process; the evaluator receives both capabilities. Browser encryption cannot establish independent operators. | Integrate the [two-phase consent experiment](CUSTODY_SPIKE_2026-10-11.md) through a versioned ABI, encoding, role stores, console/journal/recovery and proving artifacts. Preserve exactly twelve entry points. Bind accountable borrower authority and complete terms; prove wrong-role, replay, revocation and device-loss behavior under independently operated custody. |
| Blocker | **Network finality is unconfirmed.** Local proofs are not a deployment or finalized transaction. Fee balancing was deliberately disabled in the proof experiment. | Execute the supported wallet/prover/endpoint path with actual fee funding. Save submission IDs before dispatch; collect finalized lifecycle receipts and independently decode state. Recover uncertain submission without repeating a logical purchase. |
| Blocker | **Settlement is accounting, not money.** Funding, reserve withdrawal, redemption, repayment and refund reports authenticate roles/counters/references. They do not prove deposits, payouts, receipts or refunds. | Name the asset, capital/custody owner and settlement rail. Reconcile a genuine deposit, merchant claim, paid payout, repayment and refund against authenticated rail evidence. Retain global/partial allocation, duplicate identifiers, default/dispute and insolvency requirements. No payout claim should rest on an issuer assertion or `R` counter alone. |
| High | **Demand and economics are unvalidated.** The accepted initial cohort is enterprise teams whose agents purchase APIs/compute. There are no customer contacts, interviews, commitments, pilots or revenue. | Run the [validation protocol](PRODUCT_VALIDATION.md): a recent real workflow, named budget owner/liable buyer, measured pain, strongest viable incumbent comparison, and an observed willingness to integrate/pay. Measure software, creditor and merchant economics separately; assign each cost once. Public research and a questionnaire are not demand evidence. |
| High | **Proof-verification flags can create false confidence.** Installed ledger WASM accepted decodable corrupted proofs despite requested verification flags. | Require the supported Rust verifier in the local proof command. Check valid proofs and invalid-proof controls. Keep simulator execution, proof generation, cryptographic verification and network finality as separate evidence. [Actual results and reproduction](LOCAL_PROOF_VERIFICATION_2026-10-11.md). |
| High | **Merging the newer UI regressed safety and claims.** Older network setup, recovery controls, confirmed note status and roadmap copy returned. The homepage claimed 100% privacy, an unmeasured 80 ms prover, and simulator actions as proven transactions. | Retain the pixel branding while restoring tested runtime/configuration/recovery behavior. Display actual claim status and deadlines. Count fee/refund holds in withdrawable reserve; describe public-history leakage and accounting-only settlement. This integration is isolated from concurrent edits to the primary workspace. |

## Repairs and new evidence

- Linux CI exposed an exact-source fingerprint failure caused by Windows CRLF versus Git LF. Compact, managed output and compiler-wrapper checkout rules now force LF; recovery provenance and public verifier fixtures were regenerated from a freshly validated full release. The pushed `a5cc4f8` run [passed CI](https://github.com/ShrikarT/line/actions/runs/38077327909). This was a portability bug, not a semantic contract change.
- The isolated custody variant preserves all twelve circuit names. The agent prepares a domain/generation/book/expiry/fee/terms-bound consent commitment; the issuer accepts those exact terms without the agent secret. Five independently keyed processes reject missing/altered consent, wrong roles/agent, over-limit and replayed draws, stolen redemption and redemption replay. This is feasibility, not canonical integration, production isolation or legal-borrower authority.
- [Real proof evidence](proof-2026-10-11-evidence/verification.json) records 19 contract proofs across all twelve canonical circuits and ten negative checks. The supported HTTP prover and separate Rust ledger 8.1.3 verifier accept the valid proofs. Three decodable corrupted draw proofs reject in Rust. The lifecycle includes both merchants, repayment-reference replay after a new draw, actual wall-clock expiry, compensation and zero-debt closure. Signing keys and openings still share one orchestrator; the loopback prover receives private preimages.
- Earlier remediation includes stable payment-reference nullifiers, authenticated zero-debt closure, ledger-time expiry, exact issuer fee policy, pending/earned fee accounting, note-bound compensation, encrypted operation journals, process-death recovery and domain-bound private books. These repairs close specific local defects; they do not close the blockers above.

## Verification of the updated integration

| Check | Observed result |
|---|---|
| Unit/generated-contract/recovery suite | 462 passing tests in 60 suites; zero skipped or failed |
| Browser role, checkout and recovery suite | 20 passing tests without retries after fixing the homepage checkout link's accessible name; earlier resource-contention timeouts and the actual link failure were investigated rather than counted as passes |
| Build and typechecking | Passed; SDK externalization/WebSocket and bundle-size warnings remain. Network operation is unverified |
| Pinned Compact output | 16 files match fresh compiler output; zero Git diff in managed bindings |
| Production fixture-key and secret-pattern scans | Passed; 49 production-graph modules inspected by the key scanner |
| Desktop/mobile visual review | 1280-pixel desktop and 390-pixel mobile inspected; narrow-screen status-card overflow repaired, document width equals viewport width, and no browser page errors observed |
| Native local proof experiment | 19 valid contract proofs, all twelve circuits, three invalid-proof controls rejected in separate Rust verification; no fee-funded network transaction |

The browser runner accepts an explicit loopback port and starts Vite directly, avoiding duplicate port arguments and reuse of the primary workspace's server during isolated verification. CI now runs the browser suite. The native proof experiment is separately reproducible and is not automatically run by CI.

Published integration commit `ad7939b` passed [GitHub CI](https://github.com/ShrikarT/line/actions/runs/38105545515), including fresh compilation/zero managed drift, generated and reference tests, the custody experiment, typecheck, scans, production build and browser tests. The audit/proof tooling is on `fix/audit-integration`; no merge to `main` is claimed.

## Execution order

1. Prove and integrate the compatible privacy/custody architecture. Establish the actual observer model and borrower authority before presenting a confidential credit product.
2. Complete fee-funded network proving, submission, finality and recovery with reproducible receipts. Keep local proof evidence clearly labeled.
3. Authenticate deposits, merchant payments, repayments and refunds against an actual asset rail and accountable counterparties.
4. Pursue customer discovery alongside engineering. Choose a lead segment from observed transactions and buying authority, rather than the appeal of an autonomous-agent narrative.
5. Build the judging demonstration around the resulting evidence: two independent merchants, valid/declined/replayed purchases, recovery, a complete privacy transcript and a separately reconciled payment. Keep the full product requirements in scope; a deadline does not establish readiness.

No confirmed Preprod deployment, real asset movement, independent production custody, full-history privacy or customer validation is claimed by this audit update.
