# Twelve-circuit runtime completion audit — 13 October 2026

This review checks the current Compact, durable signer, owner policy and financial coordinator separately. It does not combine their different evidence scopes into an end-to-end pass. Source inspected at `928e2aa`, with fetched main `a0e51ee` already included in the audit branch.

## Actual coverage

The private-offer Compact source exports exactly twelve names. Its completed original native fixture verifies 65 calls across all twelve names. The durable signer defines action tuples, role restrictions and digest encodings for all twelve. Those declarations do not mean the integrated coordinator constructs or recovers every action.

The original review found six dispatch names in `scripts/private-owner-coordinator.mjs`. The [subsequent governance implementation](COORDINATOR_GOVERNANCE_2026-10-13.md) now dispatches ten and verifies fifteen generated calls with 28 exits and 27 controls. Original ten-call and thirteen-call repeated-supplier/native scopes still cover their historical six names. New governance has no native/network proof claim. Repayment, compensation and reopening remain unintegrated.

| Circuit | Required authority | Current coordinator | Supplied owner policy | Missing integrated evidence |
|---|---|---|---|---|
| `registerMerchant` | Issuer | Supported | Selected merchant identifiers | Independently administered onboarding and finalized registration |
| `disableMerchant` | Issuer | Generated recovery supported | Selected merchant identifiers | Native/network disable and independent supplier operation; generated disabled-quote rejection and eligible old-claim redemption pass |
| `fundReserve` | Issuer | Supported | Bounded amount | Authenticated deposit receipt, denomination and actual asset backing |
| `withdrawUnencumberedReserve` | Issuer | Generated recovery supported | Separately opted-in amount/budget bounds | Native/network proof and real payout receipt; saved exact amount/commitment and all six lock classes covered locally |
| `withdrawFees` | Issuer | Generated recovery supported | Separately opted-in fee/budget bounds | Native/network proof and real payout receipt; saved exact earned fees/commitment and recovery covered locally |
| `openLine` | Agent consent then issuer acceptance | Supported for first generation | Issuer example denies previous-book enrollment; agent policy has a reopening predicate | Closed predecessor selection, generation/nullifier continuity, old claims, durable reopen and new terms |
| `postQuote` | Supplier | Supported | Fixed binding or separately opted-in per-offer mode | Independent supplier service/customer scope, concurrency and complete observer history |
| `draw` | Agent | Supported | Own book, merchant, amount/fee/time and cumulative budget | Actual wallet/proving/finality flow, parallel stale-path recovery and observer outcomes |
| `redeemDraw` | Supplier | Supported, including archived selection | Own authenticated supplier, price/time limits | Authentic delivery/payment and expiry/uncertain network recovery |
| `cancelOrExpireNote` | Authenticated expiry; authorized borrower/issuer allocation; issuer refund acknowledgment | Not dispatched | Example policies deny; signer distinguishes action modes | Original note/book/refund openings, all three modes, durable expiry/credit/cash/zero-obligation acknowledgment and replay controls |
| `acknowledgeRepayment` | Issuer | Not dispatched | Example denies | Exact privately retained amount/reference/nonce, owner-authenticated receipt, debt rotation, duplicate payment handling and recovery |
| `setStatus` | Issuer | Generated default/resume recovery supported | Separately opted-in statuses and own-book constraints | Integrated successful zero-debt closure/reopen plus native/network evidence; debt-bearing closure rejects before intent |

Contract references: `contracts/experimental/line-private-offer.compact:294` through `:535`. Signer tuple/role/value definitions: `scripts/durable-approval-signer.mjs:23` through `:39`, with compensation-mode restrictions at `:103` and `:119`. Policies: `scripts/approval-owner-example-policy.mjs`, `scripts/approval-owner-per-offer-policy.mjs` and `scripts/durable-approval-actor.mjs`.

The policy denials are an intentional safety boundary. Do not remove them and claim complete credit operations. A policy must be owner-selected and preserve exact inputs, role/domain/ABI binding, budget limits and idempotency. A software signature authenticates an issuer's assertion; it does not independently establish a bank/asset payment.

## Concrete requirements for the next implementation

1. Extend descriptor construction only with the existing compiled circuit signatures and signer action-body encoding. Keep all twelve names and Compact as accounting truth. Funding/withdrawals must sign the predecessor reserve commitment and exact amount; fee withdrawal must bind the earned fee value. Do not replace Compact commitments with provenance hashes.
2. Persist complete action-specific preimages before approval/submission. A repayment needs amount, payment reference, receipt nonce, predecessor book and new salt. Refund allocation needs the original archived note, current eligible book and new book/refund salt. Refund acknowledgment needs the exact allocated refund opening and payment reference, including the documented zero-obligation path. Retaining quote/note archives alone is insufficient.
3. Obtain time from the actual ledger for network execution. A local fixture may explicitly advance its synthetic clock, but that must be impossible to label as a Preprod observation. Replaying an old packet must retain its accepted inputs; an expired unresolved intent requires an explicit safe resolution, not a new nonce or silent deletion.
4. Add opt-in owner policies for governance, status, repayment and compensation. Preserve existing fixed/per-offer supplier restrictions and the agent's independent policy. Record who authenticated each external receipt and its denomination/reference. Synthetic allowlists are test configuration, not authentic settlement.
5. Exercise one continuous recoverable lifecycle across all twelve names: funding/onboarding, consent/acceptance, two suppliers, draw/redemption, repayment, default/resume, expiry/allocation/refund acknowledgment, fees/free-reserve withdrawal, disable and zero-debt closure/reopen. Include simultaneous or reordered attempts, response loss, stale paths, changed inputs, original-generation claims and exact completed retries. Report actual names, modes and process scope, rather than counting calls as circuit coverage.
6. Verify the exact source/key/runtime path with real proofs and corrupt-proof controls, then fee-funded finalized receipts. The network journal's internally fetched confirmation is a reusable boundary; the current synthetic worker is not its completed wallet/deployment adapter.

These requirements preserve the full credit/checkout destination. They do not authorize funded wallet use, a replacement deployment, outreach or blind receipt approval. The governance continuation uses a separate opt-in policy; existing policies, Compact source and wallets remain unchanged.

## Hackathon implication

Line can demonstrate substantial local engineering: exact accounting, real proof verification, role-separated approval interfaces, fresh opaque offers and recovered older claims. The reported canonical flow executes eight names; new generated governance covers ten; historical native coordinator recovery covers six; the original private-offer native fixture covers twelve. These are distinct scopes.

For the submission, provide one evidence matrix and show the exact lane being demonstrated. Keep private revolving credit and full settlement as the destination, but do not call the newer coordinator a complete credit lifecycle or imply that a local native proof paid a supplier. Freeze the deck/video/source package while prioritizing the missing lifecycle integration and external receipt/settlement/customer evidence. The compiling-contract event requirement and the project's full privacy release gate remain separate.
