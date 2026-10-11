# Privacy observer model and acceptance cases — 11 October 2026

This defines the verification target for experimental merchant source `afb75b1`, not an achieved guarantee or a change to the deployed canonical contract. The canonical inventory remains in [PRIVACY.md](PRIVACY.md). Implementation and existing generated controls are in [the merchant report](PRIVATE_MERCHANT_2026-10-11.md).

## Protected information and authorized readers

The target protects a facility's limit, outstanding debt and remaining capacity from public observers and unrelated participants. It also protects purchase amounts and aggregate reserve totals from public readers. An issuer and its explicitly trusted financial coordinator receive books and reserve openings. A legal borrower receives its own terms and debt. A merchant receives its own quote, claim and payment information, including price, but must not receive unrelated books or aggregate reserve openings merely to sign a quote or redeem a claim.

| Observer | Authorized knowledge | Additional observable channels requiring analysis |
|---|---|---|
| Public chain reader | Contract version, registry/population changes, public action names and arguments, deadlines, commitments and nullifiers | Complete query transcripts, ledger changes, transaction sizes, proofs, sender/fee-payer metadata, timing, quote/note linkage and lifecycle predicates |
| Merchant A or B | Its own offer, agreed price, intended buyer relationship, claim and settlement evidence | Public chain plus its own service traffic; another merchant's data is not automatically authorized |
| Borrower organization | Its own books, policy, purchase obligations and receipts | Public chain plus its own submissions; unrelated borrower/reserve openings remain private |
| Issuer / financial coordinator | Underwritten terms, books, reserve accounting and authorized payment reconciliation | This is a trust boundary. Privacy against this coordinator is not established by hiding fields on chain |
| Relayer / fee payer | Information needed for submission and fee handling | Request identity, ordering, size, retries and timing; sharing a relayer does not itself erase these channels |
| Settlement operator | The asset transfers and counterparties it must service | Amounts, accounts, batching, zero/nonzero outputs and references; its public or shared records can defeat chain-only privacy |

Six signer children on one host demonstrate scalar isolation from the executor. They do not establish separate institutional control, an enforceable approval policy, secure transport or durable key custody. An external prover sees supplied financial witnesses unless a different supported proving architecture changes that boundary.

## What a privacy comparison must hold fixed

Compare two reachable histories with the same authorized knowledge for the observer being tested. Change the protected debt, limit or purchase amount, while preserving the declared public disclosures. Both histories must be valid under exact accounting, authentication and time rules. A comparison with different known invoices, public deadlines, caller attribution or authorized receipts cannot establish confidentiality of information those differences already identify.

There is an arithmetic limit to the promise: if an observer knows the opening debt is zero, knows every subsequent debit and fee, and knows there were no repayments or other adjustments, it can calculate the debt. Commitments cannot prevent that calculation. The redesign must prevent the protocol from supplying those facts to an otherwise unauthorized observer; it cannot erase facts independently known to an authorized participant. Avoid claiming confidentiality against arbitrary omniscient or colluding observers.

Commitment bytes from different histories need not be identical. Their hiding requires cryptographic analysis, sufficient fresh secret randomness and safe private-state retention. Comparing field names or replacing every unequal byte with a placeholder is not such an analysis. Different query shapes, counts, public predicates or network behavior can still distinguish histories even when commitments are sound.

## Required cases and current evidence

| Case | Acceptance target | Current evidence / unresolved work |
|---|---|---|
| Known-zero singleton | Public observer cannot reconstruct a different protected debit from protocol amounts/reserve deltas | Canonical baseline fails. Experimental amounts and reserve books are committed; catalogs, attribution and timing remain channels |
| Historic population selection | A spender cannot select a recognizable old singleton root after another enrollment | Current-root rejection passes generated execution; durable path rebasing and concurrent submissions remain open |
| Two merchants | Public quote/draw views do not directly reveal the selected merchant; unauthorized claims reject | Generated merchant identifier, membership and revocation controls pass. Registry population, unique catalogs, service traffic and submission metadata remain visible |
| Facility deadlines | Draw does not repeat a distinct private facility expiry | Generated controls pass. Public note deadline still bounds the facility term; opening expiry and unique scheduling remain disclosures |
| Refund after repayment | Cash and no-cash histories can execute the same acknowledgment sequence without a public cash-owed predicate | Generated histories leave debts 448 and zero; acknowledgment inputs/outputs match. Generated transcripts are compared and both histories have native-verified proofs; serialized acknowledgments differ by one byte. Distributional privacy, deployment, runtime scheduling and asset events remain unverified |
| Closure and reopening | A public observer cannot attribute a zero-debt predicate to a protected borrower beyond permitted disclosures | Requested status is private in the candidate, but reopening publishes a predecessor flag and enrollment linkage. Complete counterfactual histories remain required |
| Failed or competing draws | Rejection behavior does not return debt, capacity, exact failing predicate or a private checkpoint | Generic user-facing copy is required. Access policy, rate limits, timing, repeated chosen-price probes and actual network failure paths still need adversarial evaluation |
| Fees and settlement | Fee-funded submission, deposits, payouts, repayment and refunds preserve the declared privacy boundary | Synthetic proof runs disable balancing. No asset-rail integration or equivalent zero/nonzero settlement behavior is established |
| Recovery | Restart, retry and stale-path recovery neither publish openings nor duplicate liabilities | Canonical local recovery tests are separate. Candidate durable financial state, signers and uncertain network confirmation are not integrated |

The [fresh refund query review](private-signed-2026-10-11-evidence/merchant-history-review.json) extends the original argument-only check to four continuous generated transitions from the same predecessor. Inputs/outputs, observation times and query counts match; it records 7/4/10/8 differing public leaves across repayment/expiry/allocation/acknowledgment. Their values require semantic and cryptographic analysis, and are never equated by the review. This does not show full public histories are indistinguishable. Runtime policy must schedule both cash and no-cash acknowledgments consistently if this is part of the guarantee. Paid cash versus no payment can remain distinguishable on an asset rail even if their Compact calls have the same shape.

The [native transaction size comparison](private-signed-2026-10-11-evidence/merchant-native-refund-sizes.json) records an unresolved one-byte acknowledgment difference (6468 versus 6467 bytes). Both proofs verify. A finite pair cannot establish an indistinguishability argument or attribute that difference to randomness without further analysis.

## Evidence gate

Capture every allowed public observation for each admissible pair: complete inputs/outputs, query sequences, ledger changes, commitments/nullifiers, proof and transaction lengths, caller/fee metadata, time, retries and asset events. Assess participant side information separately. Report the actual distinguishing observation when a pair fails; do not aggregate it into a privacy percentage.

First establish real proofs for the exact source and meaningful invalid-proof controls. Then capture fee-funded finalized network executions and uncertain-confirmation recovery. Cryptographic review, operational access/retention review and genuine settlement evidence are separate requirements. Finite fixtures can falsify a guarantee or close a specific disclosure path; they cannot certify computational indistinguishability or guarantee hackathon results.
