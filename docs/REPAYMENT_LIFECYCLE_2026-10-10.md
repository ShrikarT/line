# Repayment replay and credit-line lifecycle remediation

Date: 10 October 2026. This changes the authoritative Compact contract first and advances PD-07 and PD-12. It does not complete their economic or production acceptance.

## Result

An authenticated issuer could previously reuse one payment reference after the book commitment changed: the receipt hash included mutable commitment, nonce and amount. The contract now retains that transition-specific receipt hash and independently checks a stable issuer-secret/domain/payment-reference hash. Both enter the existing public nullifier set atomically. Exact-reference reuse rejects after subsequent draws, other repayments, zero-debt reopening or agent replacement in the same instance.

Closing previously allowed a new zero-debt line without proving the old debt was discharged. `setStatus(CLOSED)` now requires the authentic current commitment opening and `outstanding == 0`. A forged zero opening and an authentic indebted opening reject without changing the ledger. Default/resume preserves debt, commitment and generation. Clean closure/reopening preserves existing merchant notes and their reserve backing; their original ownership and expiry rules still apply.

Exactly twelve exported circuits and twenty witness interfaces remain. There are no token transfers or additional Compact entry points. `persistentHash` and `persistentCommit` remain the protocol primitives. [Exact encodings](ENCODING.md), [accounting and lifecycle](PROTOCOL.md).

## Adapter and recovery changes

All application repayment adapters derive the 32-byte witness from the same versioned full UTF-8 reference encoding. Long references are hashed in full, with explicit byte length and domain tag; they are not truncated or interpreted as hex. Invalid Unicode, empty/surrounding-whitespace and over-limit input reject. The generated checkout now binds its reference to the actual supplied evaluation reference instead of a fresh unrelated random identifier.

The network runtime accepts a private closing opening in its operation options. The console captures that opening in the encrypted intent before dispatch, forwards it without dropping the submission hook, and recovers the exact candidate. Default/resume requires no closing opening. Independent issuer custody still needs a supported way to obtain the authorized book opening; this implementation does not establish independent role custody.

## Verification and provenance

Meaningful regression coverage includes generated replay attempts with changed amount/nonce/commitment and intervening operations; reopening with another agent; independent domains; unauthorized issuers; actual-model/generated long-reference parity; malformed reference handling; indebted/forged closure; merchant claims after reopening; and the production console journey.

The actual Midnight.js SDK closing call executes the generated contract and reaches a test proving sentinel with a valid opening. An absent or forged opening rejects before proving. This tests transaction construction, not external proving, submission or finality. Nine existing reconciliation tests are now included in the default suite instead of being omitted.

Current checks pass: `npm test` **359 tests / 54 suites**, zero failures or skips; **17 Chromium browser tests**; production build/type checking; fresh pinned managed-output comparison (**16 files**); full release validation; fixture/secret scanners (**46 frontend production modules**); and `git diff --check`. Existing SDK browser externalization, undefined named WebSocket import and large-bundle warnings remain. [Machine-readable evidence](repayment-2026-10-10-evidence/verification.json).

Current source SHA-256 for provenance (not protocol hashing): `f7715bb3eedbb5801268be6273a9e35d423f487d9ac773b46a02d2565797d4ad`.

Fresh full release: `0.31.1-f7715bb3eedb-a1ba29f6-af29-40d4-81aa-30cb4192cb8d`; 52 manifest-listed files, 70,026,560 bytes. Release pointer manifest hash: `098d99f317187ff1bda3bd59f6b98739b1ad09d40456dfd5300b5af507401df4`. Twelve binary ZKIR/prover/verifier triples were generated, validated and used to refresh the public verifier test fixture. They are not evidence of deployment.

The source-bound console journal and checkout checkpoints reject incompatible prior-source state. Old records must not be relabelled with the new fingerprint. No prior deployment or stored private state was automatically migrated. This release changes constraints/proving keys and requires deliberate deployment/migration acceptance. Preserve old records until a verified migration exists.

## Remaining requirements

- A reference is an issuer assertion, not independently verified cash. Select rail/network/currency/event-output identities; reconcile genuine receipts, alternatives and cross-facility allocations. Separate domains intentionally allow the same reference independently.
- Partial allocations need an authenticated cumulative allocation ledger bounded by the actual cash receipt. Changing a reference cannot establish additional funds.
- Stable reference hashes rely on high-entropy issuer secrets. Public successful closure reveals zero debt, supplying another historical inference baseline. Full-history confidentiality remains open.
- Expiry is still activity-count based; cancellation still does not reverse debt/fees. Fees are still caller selected. These are unchanged implementation gaps, retained in scope.
- Independent custody, loss recovery/underwriting, live proving/finality, actual backing/payout and external supplier/customer evidence remain open.

## Next implementation dependencies

For expiry, Compact documents `blockTimeLt`/`blockTimeGte` comparisons in Unix seconds. The installed runtime exposes an explicit generated-execution time context, allowing deterministic boundary/grinding tests. This is a supported direction to compile and verify, not an implemented repair. It requires coordinated deadline schemas/adapters and separate network validity/finality evidence. [Official block-time APIs](https://docs.midnight.network/relnotes/compact/compact-0-17-25-0).

Fee terms should be issuer-authorized and immutable per generation, bound to quotes and their merchant redemption deadline. Agent access to an issuer secret would violate custody. Compensation must distinguish cancelled-note credits from cash repayment, reject credits against a new generation, cap cumulative adjustments and retain a stable refund identity. Refundable fees cannot simply decrement an already-withdrawn fee reserve; pending/earned treatment or explicitly accepted nonrefundable terms is required. These designs need Compact-first changes and adversarial accounting tests before claiming implementation.
