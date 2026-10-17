# Remaining product work

The owner requested all remaining work on 18 October 2026. This ledger preserves
the complete requested outcome; completed implementation is not a substitute for
funded network acceptance or privacy evidence.

| Requirement | Acceptance evidence | Current state |
| --- | --- | --- |
| Encrypted backup restore | Correct-wallet recovery in a fresh browser; wrong wallet/password, tampering, stale overwrite and aborted writes rejected; pending signed bytes retained | Implemented; fresh-browser restore passes; refund-staleness review fixes pass generated regression |
| Expired purchase recovery | Uncharged request can be cancelled or re-quoted; charged/ambiguous claims cannot create a second payment; reload retains decisions | Implemented; 32 focused organization checks pass; exact signed uncertainty remains retained |
| Bounded transaction UX | Initial submission and reconciliation return within a bound, preserve original bytes, and resume exact finality without late state promotion | Implemented; 32 focused organization checks pass; exact signed uncertainty remains retained |
| Real organization Preprod lifecycle | Matching twelve-key deployment, existing-asset deposit, allowance, two suppliers, actual payouts, replenishment/withdrawal and reload/recovery receipts | Owner reports creation failed without an error; exact failing stage is not yet reproduced |
| Full-history privacy | Observer-visible history cannot reconstruct protected books under explicit adversaries; generated/native/network evidence for the resulting contract profile | Open; current transparent-asset profile does not satisfy this |
| Public hosting | App, proving assets and durable merchant backend work for outside users; complete the same user flow at public URL | Owner authorized publication after verification; durable backend and proving-asset deployment remain pending |
| Verification/report | Current build, complete regression results, source/release drift checks, public-secret checks and updated readiness audit | Verified locally: core 594 passed / one intentional skip; seven organization browser cases; build, drift and scans pass |

Public deployment is authorized after the product is verified. Existing
operator/test-token receipts cannot satisfy a new customer facility's acceptance.
No customer interview, independent supplier operation, commercial traction or
institutional custody can be invented as evidence.

## Verification boundary

The full core run discovers 595 tests: 594 pass, none fail or cancel, and one is
intentionally skipped. All 32 focused organization checks and seven organization
browser cases pass. Both Compact regenerations have zero managed drift; the full
organization release, production build/typecheck and credential scans pass.
The production graph scan inspects 85 modules. The broader historical browser
suite is not represented as a fresh full run.

The creation check executes the actual SDK through a deliberately rejecting
connector at desktop and phone widths and verifies visible failure feedback. It
does not approve or submit a wallet transaction. The owner's reported silent
creation failure is still unreproduced. The next acceptance step is a new attempt
in the updated workspace with the displayed stage or public pending address.
[Machine-readable recovery evidence](../artifacts/organization-product/recovery-verification.json).
