# Fee, expiry and refund attribution evidence

Updated 10 October 2026. The twelve-circuit Compact source is `contracts/line.compact`; this note records local implementation and verification. It makes no claim of live chain execution, cash payout or verified external refunds.

## Accounting and authorization

Let `T` be total reserve accounting; `E` encumbered principal; `R` redeemed principal; `F` earned fees; `P` pending fees; `U` backing held for expired claims and cash refunds; `X` backing retained after issuer refund reports. The contract enforces `E+R+F+P+U+X<=T`; withdrawable reserve subtracts all six locked categories from T.

A draw commits fee into its private note and adds principal to E, fee to P and both to private debt. Merchant redemption transfers principal E?R and pending fee P?F. Only F is fee-withdrawable. A `feeReserve` movement proves accounting, not payment collection.

Permissionless expiry moves principal E?U and pending fee P?U without forgiving borrower debt. Compensation action 1 is authorized by the issuer or original agent. It binds the expired note and its original private opening; credits only the amount allocated to the current debt; and commits any cash remainder privately. A zero remainder frees backing. Any positive remainder keeps the **full original note cost** in U, preventing public reserve deltas from revealing the exact remainder. Historical-generation notes can retain full cash obligation without mutating the replacement line.

Issuer report action 2 proves the exact positive private refund opening and an unexpired report deadline. It requires global payment-reference nullifier membership and stores that exact nullifier in the note metadata. It moves the full note cost U?X. The global match alone cannot attribute another operation's payment to this note; both the stored note binding and global membership are checked. X remains locked because the contract receives no proof of the external cash transfer.

## Recovery and limits

Encrypted console journals preserve exact note openings and candidate state across uncertain operations. Recovery validates the note-specific public effect, book transition and refund nullifier binding before confirming an operation. Historical agent credentials are retained encrypted while needed to compensate an old-generation note; they do not restore the obsolete book. Journal-confirmed state is authoritative over older per-record mirrors. Deleting a mirror does not revoke a key that remains in the journal.

The browser walkthrough verifies an expired checkout, private cash remainder handling and retained backing. Generated Compact tests cover premature/wrong note receipts, missing global nullifiers, cleared receipts, replay, old-generation behavior and exact recovery. The current full suite reports 461 passing tests in 60 suites; Playwright reports 20 passing browser tests. Typecheck, build, pinned Compact drift/release validation, production-key and secret-pattern scans pass; `npm audit` reports zero known vulnerabilities in the current dependency tree.

Still unproven: external receipt authenticity, an actual asset payout/refund, global allocation across facilities, partial-payment rules, post-redemption service disputes, line-history privacy, independent role custody, live proving/finality and customer acceptance. Accounting report labels must not be presented as cash paid.
