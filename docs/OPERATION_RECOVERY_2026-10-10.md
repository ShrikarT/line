# Operation recovery — 10 October 2026

This increment addresses interrupted private-state publication and local checkout restart. It advances PD-06, PD-07, PD-10 and PD-13; it does not close their full production acceptance.

## Console execution boundary

All twelve console mutations acquire an encrypted journal lease before invoking the existing runtime. The journal stores the exact intended parameters, previous snapshot and candidate opening/note/receipt state before execution. It records the finalized transaction identifier before the network submission provider is called. Browser Web Locks serialize the lease across tabs. Browser storage and lock support fail closed; Node journal tests use an encrypted memory fallback and do not establish Node restart durability.

Definite preparation rejection, confirmed execution and unknown outcomes are separate states. A submitting or uncertain intent blocks fresh operations. Runtime/provider exceptions after submission, failed confirmation writes and partial transaction failure do not authorize a new draw. The generic rejected-draw copy remains `Clearance could not be proven.`

The console restores confirmed private state from the atomic journal, even if legacy per-record mirror writes fail. A confirmed operation finishing after vault lock remains encrypted; it does not restore decrypted books. Unlocking reconciles the original contract instance and preserves subsequently saved credentials/imported packages. Consumed quotes cannot be drawn again. Repeated acknowledged payment references with the same amount return their existing acknowledgement; reuse with another amount rejects.

## Reconciliation evidence

Recovery does not submit transactions. It can resolve an intent using:

- A finalized receipt identifying the saved transaction ID. Network success requires complete success and a positive safe block height; complete failure permits rejection, while partial failure remains uncertain.
- The exact saved candidate credit commitment, plus the matching network, address, contract domain, identity and generation. The candidate opening is recomputed using the existing Compact-compatible commitment functions.
- An exact prepared quote/note target and domain/generation with its public quote-present, note-redeemed or note-cancelled effect. Aggregate balance/status changes are insufficient.

The SDK's `watchForTxData` intentionally waits indefinitely. The application waits at most six seconds per observation, reuses the pending watcher for the same ID and permits at most 32 outstanding watchers per runtime. Timeout, absence, mismatch and provider failure remain unknown. Unchanged book commitment never proves rejection. A stale opening, changed source fingerprint, wrong instance or unverifiable snapshot blocks automatic recovery. No transaction lookup API or Compact circuit was invented.

The recovery button queries evidence again. It cannot manufacture a missing receipt or safely reset an unknown operation. Confirmed data is acknowledged only after authorized restoration. Newly prepared intents that provably never entered invocation can be abandoned.

## Verification scope

Meaningful tests cover response loss after an actual local draw, failed encrypted confirmation publication, failed legacy mirror publication, exact candidate recovery, double-action exclusion, credential changes during an operation, revocation, credential creation after the latest circuit, and payment-reference repetition across later draws. Independent candidate tests compare open/draw/repayment commitments, quote commitments and note commitments with actual compiler-generated Compact execution and verify the exact source fingerprint.

Real Chromium tests cover encrypted IndexedDB reload, two-tab Web Lock ownership, browser-owner termination, request-success followed by transaction abort, captured confirmed writes after locking and the application recovery button. The network tests use actual Midnight.js construction/generated execution with simulated provider I/O and receipt faults. They establish adapter boundaries, not live proofs or network finality. [Checkout restart evidence and configuration](CHECKOUT_DURABILITY_2026-10-10.md) covers actual filesystem checkpoints and child-process death separately.

## Remaining acceptance work

- The subsequent [repayment/lifecycle repair](REPAYMENT_LIFECYCLE_2026-10-10.md) adds authoritative exact-reference deduplication within one issuer/domain and requires zero debt to close. Genuine cash verification, alternative identifiers, cross-facility allocations and independent custody remain open. Its new source fingerprint deliberately rejects older journal/checkpoint state; no automatic migration is established.
- Console journals have a 1,000-operation metadata limit and a 100,000-node typed-envelope limit. Historical terminal snapshots compact, but history export, archival, migration and sustained-scale acceptance remain unfinished. Exhaustion fails closed.
- Source provenance currently binds exact Compact source. Pending records from another source require explicit migration/reconciliation. The source guard is not a substitute for verified deployed keys or authenticated public providers.
- The shared console has aggregate role custody. Merchant-only snapshots on an active line cannot safely clear or reconstruct an absent agent opening; automatic aggregate restoration blocks. Independent role stores and role-aware recovery remain open.
- The local console model resets on browser reload. Its journal must not silently reconstruct an authoritative chain that does not exist. Actual chain state or the configured generated-checkout disk checkpoint remains the separate authority.
- Browser profile/device loss, encrypted portable backup/restore, rollback detection, independent/institutional custody, externally observed payment/service compensation and production power-loss guarantees remain open. Encrypted data is not a backup by itself.
- No live deployment, token transfer, customer adoption, full-history credit-book privacy or production certification is established by this increment.

The eighteen product requirements remain in scope. Passing recovery tests does not make the entire product ready or guarantee a hackathon outcome.
