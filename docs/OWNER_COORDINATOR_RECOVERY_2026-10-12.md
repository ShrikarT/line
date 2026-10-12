# Whole financial coordinator recovery — 12 October 2026

The experimental private-offer coordinator now reconstructs generated Compact execution in a new process for every command. Its financial openings are stored in the encrypted source/instance-bound journal; the parent fixture receives public state and bounded status, not books, salts, nullifier keys or witness packets. Role approvals come from the existing four mTLS services. This closes a demonstrated local request-loss gap, not the product's privacy, independent custody, network or settlement gates.

## Bug and change

Previously, a coordinator could generate a new request and call the owner before saving that request. If the owner committed the approval and the coordinator died, its replacement lost the original randomness. Retrying the same operation ID with a newly generated descriptor could be rejected by the owner's idempotency guard; creating a new ID would risk another authorization reservation.

`PrivateFinanceJournal.stageAuthorization` now durably saves the semantic request, exact projected descriptor, circuit arguments, predecessor and pre-approval witnesses **before** the owner RPC. Only the identical intent may resume. After approval, `prepare` checks the saved inputs and atomically replaces the intent with the private candidate. A pending candidate blocks new work. Confirmation retains the existing exact candidate check; an exact completed semantic retry returns its completion without requesting another approval. Changed completed requests reject.

The worker also computes `flatFee + ceil(amount * basisPoints / 10000)` with BigInt, validates UInt64 terms/cost and reports a staged operation ID so recovery status does not falsely appear idle. Compact remains the source of truth and checks the actual fee, capacity, merchant membership, approval and claim rules. No Compact APIs or commitments are replaced. Canonical source and managed bindings are unchanged.

## Exact evidence

[Current generated report](private-signed-2026-10-11-evidence/owner-coordinator-recovery.json) pins private-offer source `ae970672c048c48692ab690554c77285fec19d1943dc3b4574080970b7fa657d`, generated executable/compiler metadata and sixteen runtime helper fingerprints. LF-normalized fingerprints correlate the Git source; they are not another execution.

- Ten calls across six names: merchant registration, reserve authorization, agent consent, issuer acceptance, and quote/draw/redemption for Merchant A and Merchant B. All underlying twelve circuit exports are retained; recovery for the remaining names is not established.
- Forty-six successful/crashed execution-worker invocations, with a fresh process for preparation, restoration and confirmation. Rejected commands are additional invocations and are not included in this count.
- Eight abrupt exit-23 faults: for each merchant's draw, after intent publication before RPC; after owner approval before candidate; after candidate publication before response; and after confirmation publication before response.
- Six controls: two pending replacement rejections, two altered confirmation rejections, and two exact-completed-retry/changed-request checks. Status checks verify staged intents and their eventual removal.
- A nonzero percentage-fee policy executes through the actual generated contract. The two fee tests cover ceiling boundaries, invalid terms and UInt64 cost overflow; they do not certify all numerical combinations.
- Three additional journal regressions cover identical reopening, competing intent/input rejection, atomic conversion and publication uncertainty. Existing six journal tests continue to cover candidate recovery, scope isolation, ciphertext authentication, writer exclusion and process loss.

The earlier 34-invocation graceful and 40-invocation four-crash local experiments are historical. Their helper fingerprints differ from this report and are not relabeled as current evidence. Older native proof reports similarly retain their exact versions: the previous ten-call native owner-API fixture had volatile financial state, and the earlier six-call financial recovery fixture restarted storage children rather than this complete worker. Neither verifies this new crash-recovery path cryptographically.

The full sequenced local Windows suite passes **507 tests / 60 suites**, with canonical compilation/zero managed drift, build/typecheck and production fixture/credential scans passing. Implementation `7ee6a41` passes [push CI](https://github.com/ShrikarT/line/actions/runs/38236212478) and [PR CI](https://github.com/ShrikarT/line/actions/runs/38236217724): 505 Linux tests with two platform skips, both Windows ACL controls, 20 browser checks and the fresh ten-call/eight-crash coordinator integration, plus compile/zero-drift, build/typecheck and scans.

## Trust boundary and open work

This is a same-host synthetic fixture. Its launcher creates and owns all four software-owner keys, the TLS test CA/client credentials and the financial password. The worker is trusted with private financial openings and is not a hardware enclave. Separate processes and an API do not establish independent administrative custody. The financial journal keeps its v1 envelope with an optional intent field; legacy callers without staging remain supported. No production checkpoint migration or independently reviewed rollback/backup protocol is performed.

The worker neither proves nor submits a transaction. `confirm` accepts a caller-supplied public candidate and does **not** authenticate a network receipt, finality, contract address in an observed transaction, or asset payment. It cannot close the confirmed-network gate. Approval budgets and reserve counters do not establish deposited capital or merchant payouts.

An intent whose approval expires, is denied, or cannot execute remains unresolved and blocks further work. Owner retry policy checks current time before returning a saved approval. There is no certified intent-abandonment, reservation-release, multi-party cancellation or receipt-reconciliation protocol; silently generating a replacement would defeat the recovery guarantee. Only the supported first-generation purchase path is wired into this experimental worker. Refunds, repayment, status, reopening, concurrent-root reconciliation and owner-key recovery need their own durable protocols and controls.

Full-history privacy is still open: the canonical deployment publishes debt increments, while the experimental source has finite serialized-history differences, traffic/timing correlations and a trusted financial prover. Padding application frames does not establish complete transcript privacy. The worker has no canonical browser/backend integration, native proof of its restored packets, funded network execution, real settlement, independently operated owners or customer demand evidence.

## Reproduction and next acceptance criteria

```bash
npm run finance:journal:test
node --experimental-strip-types --test tests/private-owner-coordinator.test.mjs
npm run owner:coordinator:compact
```

The integration freshly compiles into an ignored `.compact-keys` directory and uses ephemeral TLS fixtures. Its metadata publisher refuses changed source/helpers/artifacts and false scope flags. Run canonical compilation and check zero drift before the full suite; do not regenerate canonical artifacts while tests copy them.

Next, prove and independently verify the actual restored worker candidate without returning private openings to its caller; replace caller-trusted confirmation with receipt-bound finalized reconciliation; cover the remaining lifecycle and ambiguous approval states; then integrate separately managed owners into runtime/console flows. Complete observer analysis, authentic capital/payout reconciliation and buyer validation remain separate release gates. [Full audit](FULL_AUDIT_2026-10-11.md), [owner API](OWNER_APPROVAL_API_2026-10-12.md), [privacy observer model](PRIVACY_OBSERVER_MODEL_2026-10-11.md).
