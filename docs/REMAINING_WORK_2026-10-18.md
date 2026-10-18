# Remaining product work

The owner requested all remaining work on 18 October 2026. This ledger preserves
the complete requested outcome; completed implementation is not a substitute for
funded network acceptance or privacy evidence.

| Requirement | Acceptance evidence | Current state |
| --- | --- | --- |
| Encrypted backup restore | Correct-wallet recovery in a fresh browser; wrong wallet/password, tampering, stale overwrite and aborted writes rejected; pending signed bytes retained | Implemented; fresh-browser restore passes; refund-staleness review fixes pass generated regression |
| Expired purchase recovery | Uncharged request can be cancelled or re-quoted; charged/ambiguous claims cannot create a second payment; reload retains decisions | Implemented; 36 focused organization checks pass; exact signed uncertainty remains retained |
| Bounded transaction UX | Initial submission and reconciliation return within a bound, preserve original bytes, and resume exact finality without late state promotion | Implemented; 36 focused organization checks pass; exact signed uncertainty remains retained |
| Real organization Preprod lifecycle | Matching twelve-key deployment, existing-asset deposit, allowance, two suppliers, actual payouts, replenishment/withdrawal and reload/recovery receipts | Owner reports creation failed without an error; exact failing stage is not yet reproduced |
| Full-history privacy | Observer-visible history cannot reconstruct protected books under explicit adversaries; generated/native/network evidence for the resulting contract profile | Open; current transparent-asset profile does not satisfy this |
| Public hosting | App, proving assets and durable merchant backend work for outside users; complete the same user flow at public URL | Public proving export, persistent server entry and wallet-authenticated API implemented. Provider routing, deployment and public end-to-end verification remain pending |
| Independent supplier runtime | No historical issuer/test-token bootstrap; stable supplier keys, encrypted wallet snapshot, exclusive owner and safe shutdown/reopen | Core and authenticated HTTP implemented; nine storage/lifecycle checks pass. First-start native sync timed out; routing and funded operation remain pending |
| Production API and wallet admission | Signed wallet sessions, immutable organization ownership, serialized operations, bounded caller admission and safe shutdown | Implemented; actual signature/HTTP/client tests pass. Public provider routing, funded operation and deployment remain pending |
| Durable result publication | A failed controller write cannot expose a confirmed candidate/result or permit another operation | Reproduced and fixed; encrypted delivery recovery avoids a second redemption |
| User-controlled proving | Organization proofs use the user's wallet-supported prover without a localhost fallback | Wallet adapter implemented; actual SDK maintenance/rejection check passes. Actual Lace circuit proving remains unverified |
| Verification/report | Current build, complete regression results, source/release drift checks, public-secret checks and updated readiness audit | Verified locally: core 617 passed / one intentional skip; final affected 55 organization checks and nine browser cases pass; deploy build, drift and scans pass |

Public deployment is authorized after the product is verified. Existing
operator/test-token receipts cannot satisfy a new customer facility's acceptance.
No customer interview, independent supplier operation, commercial traction or
institutional custody can be invented as evidence.

## Verification boundary

The current full core run discovers 618 tests: 617 pass, none fail or cancel, and
one is intentionally skipped. After the final browser fetch receiver fix, all
55 focused organization checks and nine organization browser cases pass. The
full core run precedes only that receiver fix; the affected checks and deploy
build were rerun afterward. Earlier results remain historical evidence.
Both Compact regenerations have zero
managed drift; the full organization release, deploy build/typecheck and
credential scans pass. The production graph scan inspects 88 modules. The broader historical browser
suite is not represented as a fresh full run.

The creation check executes the actual SDK through the wallet proving adapter
and a deliberately rejecting connector at desktop and phone widths. It verifies
visible failure feedback. It
does not approve or submit a wallet transaction. The owner's reported silent
creation failure is still unreproduced. The owner cannot retry the wallet now;
independent product work continues, with actual Lace acceptance retained as an
explicit later check.
[Machine-readable recovery evidence](../artifacts/organization-product/recovery-verification.json).

Creation feedback follow-up: an empty required field reproducibly prevented
submission without an application alert. This path now shows actionable feedback
with zero signatures. It does not establish the cause of the owner's reported
Lace failure. [Deployment preparation](HOSTING_PREPARATION_2026-10-18.md) records
the actual exported asset scope and the durable-backend work still required.
[Supplier runtime and wallet-proving progress](STANDALONE_SUPPLIER_2026-10-18.md)
records the subsequent implementation and the unsuccessful native sync check.
[Current verification scope](../artifacts/organization-product/hosting-preparation-verification.json).
