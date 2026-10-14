# Public dependency review and remaining privacy gate

Reviewed 12 October 2026 against fetched main `a0e51ee1486511e60b0f5a7bc2099a1f8b161aa0` and audit implementation `fc249984e4316a7e6f7c95c0e83e2fcd43011d45`. The audit branch contains main, including the reported Preprod deployment. This is a source dependency review, not another native proving run, network verification or construction-level privacy proof.

Canonical source SHA-256: `35ebd14e19ce682230b685f6f3729923a9c56b0719eb17a684e44e4a39c73eff`.
Private-offer candidate SHA-256: `ae970672c048c48692ab690554c77285fec19d1943dc3b4574080970b7fa657d`.

## Conclusion

The canonical deployment still permits exact known-zero debt reconstruction from public amounts and fees. The private-offer candidate removes those numeric ledger disclosures and the supplier's direct access to identity, generation and fee policy. It does not establish confidentiality of the complete integrated purchase history. The remaining gate concerns public semantics and side information as well as the distributions of commitments, nullifiers and proofs.

The [wire review](PUBLIC_ENCODING_REVIEW_2026-10-12.md) explains the eleven saved pairs' length differences. Explaining a length difference does not establish that all public values hide the credit book. Likewise, a verified proof establishes that the encoded transition is valid; it does not establish network finality, reserve assets, merchant payment or service delivery.

## Every candidate circuit

The following covers all twelve exported names in `contracts/experimental/line-private-offer.compact`. All successful calls also increment the public action counter and insert an approval-use nullifier. Approval bodies bind action-specific private terms; their hiding requires review of the hash construction and authorization nonce handling. Listed predicates follow from success, even when their witnesses remain private. Attribution of a predicate to a particular borrower requires its own linkage evidence.

| Circuit / source line | Public semantic observations and dependencies | Private values and residual boundary |
|---|---|---|
| `registerMerchant`, 294 | Merchant identifier, enabled/registered membership, index and registry/tree updates | Registry population and additions are intentionally visible; a small registry can assist inference about later purchases |
| `disableMerchant`, 302 | Disabled identifier, index query and enabled-tree update; registration remains | Registry revocation is public. Existing claims and eligible quotes retain their documented rules |
| `fundReserve`, 308 | Funding action and new reserve commitment; success requires positive funding and no overflow | Amount and reserve book are witnesses. A public deposit with a matching amount/time can reveal them outside Compact |
| `withdrawUnencumberedReserve`, 316 | Withdrawal action and reserve commitment rotation; success proves a positive authorized amount fits the free reserve | Neither amount nor free reserve is a plaintext ledger value. External transfer data and repeated authorized attempts can add bounds |
| `withdrawFees`, 323 | Fee-withdrawal action and new reserve commitment; success implies earned fees were positive | The circuit withdraws all earned fees in accounting. The asset rail must not be confused with this counter update |
| `openLine`, 333 | Consent/acceptance mode, expiry, common book root, request hash, issuance/spend nullifier queries, linked request acceptance and inserted book commitment | Identity, predecessor selection, generation, fees, limit and book are private. `hasPreviousBook()` is not disclosed. Fresh/reopened query-shape controls exist; full value distributions, singleton timing and caller attribution remain unproved |
| `postQuote`, 384 | Enabled merchant-tree root, quote hash, quote expiry and quote-metadata commitment | Selected merchant is proven as a private member. Price, invoice, binding and nonce stay private on chain; supplier knows its own offer. Catalog uniqueness, service traffic and nonce quality remain relevant |
| `draw`, 395 | Referenced quote, deadline, current book/registered merchant roots, spent-book and draw nullifiers, new note/book/reserve/quote commitments | Amount, fee, identity and selected merchant are witnesses. Success proves open status, valid time, exact fee, credit headroom and reserve backing. The transaction links this quote to the newly created note; it does not remove activity linkage |
| `redeemDraw`, 435 | Referenced note, deadline, redemption nullifier and note/reserve commitment updates; success is a one-time unexpired claim | Merchant and principal stay private in Compact; supplier receives its own claim/price. Redemption creates accounting liabilities, not an asset payout or fulfillment proof |
| `cancelOrExpireNote`, 453 | Note reference and action `0/1/2`. Expiry/allocation publish the note deadline through time queries. Allocation also queries the common book root and spends/inserts a book; acknowledgment uses a payment nullifier and receipt deadline | Cash-owed flag, refund amount and reserve holds are committed. Cash and zero-obligation acknowledgments have generated/native examples with matching action shape; real zero/nonzero payments and scheduler behavior can still distinguish them |
| `acknowledgeRepayment`, 524 | Receipt deadline, common book root, payment/receipt nullifiers and new book commitment; success implies positive repayment not exceeding prior debt | Amount, reference, identity and resulting debt stay private. This updates debt only; it does not verify incoming money or replenish the reserve |
| `setStatus`, 535 | Status action, common root, spent-book nullifier and new book commitment; success implies the prior status was neither NONE nor CLOSED | Requested status is private. A CLOSED request enforces zero debt internally; the call alone does not announce that CLOSED was selected. Subsequent enrollment, timing or caller information may add lifecycle inference |

Shared source helpers: approval-use nullifier at 184; current book root/spend at 203–211; book insertion at 222; reserve commitment rotation at 250; private note metadata at 261; private quote metadata at 272. Constructor state includes issuer/domain/nullifier-key commitment, registry and initial committed zero reserve at 282–291. No helper discloses the book limit or debt as a standalone plaintext field in this candidate.

## What still needs a falsification attempt

1. **Whole-history attribution.** Capture consent through repayment/refund/reopening with actual caller, fee-payer, timing and asset observations. A pool containing one active borrower gives much less uncertainty than a pool with concurrent users. Compare reachable histories with the same permitted observer knowledge; do not strip unequal public values before comparison.
2. **Commitment and nullifier construction.** Review every disclosed digest's input entropy and reuse. Book, reserve, quote-metadata and note-metadata openings need fresh secret salts on each transition. Quote hashes need unpredictable nonce material. Approval-use hashes depend on action bodies and authorization nonces; book-spend tags depend on a commitment and its salt. Secret-key payment/issuance tags need construction review. Naming a digest a commitment or nullifier does not prove hiding or pseudorandomness. Randomness generation and encrypted retention are runtime responsibilities, not established by a Compact witness declaration.
3. **Clearance oracle.** Generic error text removes an explicit diagnostic, not the success/failure bit. Under a separate threat model where an authorized observer can obtain repeated checks against an unchanged book, knows fees, and knows reserve/time/authentication checks cannot fail, chosen amounts can narrow headroom. This review does not demonstrate that an unauthenticated public reader or supplier can obtain that oracle. Verify capability boundaries and repeated-request policy before claiming either exploitability or protection. Successful draws alter debt, so they cannot be treated as unchanged-book probes.
4. **Lifecycle scheduling.** Public refund action modes and repayment calls reveal activity. Private cash-owed/status values help only if the actual scheduler, acknowledgments and settlement rail respect the same leakage boundary. No synthetic fixed clock establishes equivalent wall-clock behavior.
5. **Recovery and concurrency.** Local guarded native recovery now proves a ten-call path across six names, including interrupted proving and exact saved-proof recovery. That closes a concrete tested process gap. It does not authenticate the caller-supplied `confirm` state, cover all twelve names' durable recovery, settle uncertain network submissions or prove safe parallel book-path rebasing.

These are falsification/review targets, not findings of a newly demonstrated exploit. No new proof counts or privacy pass are added by this document.

## Changes to the project direction before submission

Preserve the goal of protected shared credit and multi-supplier checkout. Concentrate the submission on one enterprise agent task with two supplier roles, exact issuer-approved fees, a rejected draw, one-time redemption and safe retry. Explain the distinction between the canonical deployed baseline and the private-offer experiment, and associate each displayed capability with its exact evidence scope.

Prioritize the remaining work in this order:

1. Freeze the source, demo path, deck and video into one reproducible entry. Include a short evidence matrix: generated execution, local native proof, reported network call, independently confirmed receipt and actual payment are different states.
2. Replace caller-trusted confirmation with independently authenticated finalized receipt/state reconciliation before presenting the candidate as live. Preserve candidates and private openings through ambiguous submission; do not rerun the funded deployment flow to manufacture evidence.
3. Demonstrate one authentic deposit/payout/repayment/refund rail and accountable borrower/capital/supplier roles before calling the system settled credit infrastructure. Reserve arithmetic alone cannot satisfy this requirement.
4. Execute the integrated observer cases above and obtain independent review of approvals/commitments and separately administered custody. Keep the privacy release gate open until the evidence supports it.
5. Validate the accepted enterprise API/compute customer hypothesis against a recent real purchase and its incumbent billing/payment method. Current research supplies alternatives, not contacts, interviews or demand. Supplier acceptance of a credit-backed claim remains a product question.

Additional speculative features and repeated synthetic proof runs are lower priority than these outcomes. The [consolidated audit](FULL_AUDIT_2026-10-11.md) retains the full code, runtime, security, economics and hackathon findings and their historical evidence scopes.

## Verification and event timing

This continuation reads all twelve candidate circuit bodies and shared public-write/query helpers, verifies both source hashes, and fetches main with no unseen upstream commits. It changes documentation only; the latest existing full local code regression remains 510 tests / 60 suites, with six separate Windows lifecycle controls and 20 browser checks in the verified implementation CI. It does not relabel these as tests rerun for this document.

The live [AKINDO event API](https://api.akindo.io/public/wave-hacks/jaMZjqPOBsLXvjdG) was read again on 12 October: active Wave 2 `nPmLlGnMksMAqZBN` still gives a submission deadline of 19 October 2026 at 15:00:34 UTC / 20:30:34 IST. The [Midnight overview](https://midnight.network/hackathon/buildathon) still lists October 17. The earlier rules-PDF conflict and lack of a controlling amendment remain documented in [the requirements review](WAVE2_REQUIREMENTS_2026-10-11.md). This does not resolve eligibility or certify submission. Prepare the artifact package immediately; judging success cannot be guaranteed by this audit.
