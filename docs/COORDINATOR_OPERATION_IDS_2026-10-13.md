# Approval-owner operation-ID alignment

The worker allowed leading punctuation in operation IDs, while `DurableApprovalSigner` requires an initial ASCII letter or digit followed by at most 127 letters/digits/colon/dot/underscore/hyphen characters. `__proto__` therefore reached write-ahead intent persistence but was denied by the owner. The resulting saved intent blocked subsequent operations. The ordinary funding operation in the same real-worker fixture had already succeeded, and the owner encrypted store remained unchanged during the invalid request.

A prior source/codec reproduction also showed that assigning `requests['__proto__']` into a plain object changes its prototype and causes the vault codec to reject the record. The real current signer rejects that ID before approval, so the end-to-end result does **not** establish post-approval prototype mutation. An initial diagnostic expecting an owner-store change disproved that interpretation; its failed log is retained. This distinction corrects the earlier audit finding rather than overstating reachability.

The worker now validates the owner's exact namespace before staging an intent or invoking the owner. Request insertion uses a computed own property instead of the prototype setter, and completed retries require an own saved request entry. Existing invalid or otherwise denied intents are not silently discarded; an authenticated resolution procedure is still needed for historical records.

## Verification

`tests/coordinator-operation-id.test.mjs` freshly compiles the private-offer source and reconstructs the actual worker for each step through one synthetic issuer mTLS service. Ordinary funding succeeds. `__proto__`, leading underscore/colon/hyphen and overlength IDs reject with no pending/authorization record or owner-store change. `constructor` and `toString` retain their exact committed requests and restore/confirm across processes; exact completed retries succeed and altered amounts reject. The test is included in `npm test` and preserves generic worker errors.

The initial correctly scoped regression fails because `authorizationOperation` is `__proto__` instead of null. After the fix the targeted real-worker case passes, and the complete local regression passes **542 tests / 60 suites**. Canonical compile/zero managed drift, build/typecheck and fixture-key/credential scans pass. Remote CI for this fix remains separate.

This test is synthetic generated execution, not native proving, network finality, a deposit/payout or independent institutional custody. The prior 23-call lifecycle report remains bound to `a096edc` and its exact earlier helper bytes; it is not relabeled as a new run of this identifier fix. That lifecycle implementation passes [push CI](https://github.com/ShrikarT/line/actions/runs/38360303539) and [PR CI](https://github.com/ShrikarT/line/actions/runs/38360308222), including fresh original/archive/governance/lifecycle scenarios, browser and platform checks.
