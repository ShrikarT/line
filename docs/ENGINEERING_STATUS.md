# Engineering status

Updated 18 October 2026. The immediate target is a submission-ready Wave 2
prototype, with public source, current demo assets and deployment preparation.
Production customer onboarding and full-history privacy remain later work.

## Confirmed network checkpoints

- Test-token facility `a159597495b52ea7a703a29562b17fcb042bf7eaa984ec1e05e7e8935208304b`:
  21 independently verified finalized transactions, twelve matching verifier keys,
  25 test units paid to Merchant A and 20 to Merchant B. The reserve decreased
  from 200 to 155. [Exact evidence and boundaries](TEST_TOKEN_PAYOUT_2026-10-16.md).
- Canonical accounting facility
  `8990864c6f80c517c7458fa9b2526d3500f3a9814399fc836097ee409da9bed0`:
  the local retained checkpoint has 29 confirmed receipts. This profile records
  claims and accounting, not merchant token payouts.
- The browser SDK reads the historical canonical contract through the standalone
  server's authenticated HTTP/WebSocket routes, including same-reader recovery
  after sign-out. [Read-only report](../artifacts/organization-product/provider-routing-preprod-read.json).

A fresh recorded test-token purchase is being captured separately; its final
state and receipts must be verified before updating these checkpoint counts.

## Current verification

| Check | Result |
| --- | --- |
| Full core `npm test` | 644 discovered; 643 passed; one intentional skip; no failures/cancellations |
| Organization browser | Nine passed; includes actual SDK preparation and deliberately rejected approval |
| Compact regeneration | Canonical and organization compile; zero managed drift |
| Build/typecheck | `npm run build:deploy` passes and exports 37 public proving files |
| Dependency and credential scans | 90 production modules checked; no fixture keys; no configured secrets in 558 text/build files |
| Review | Standards/spec findings for session renewal and idle revocation fixed; no remaining actionable increment finding |

[Machine-readable current verification](../artifacts/organization-product/submission-verification.json).
Local ignored logs retain the full output and unsuccessful attempts.

## Important fixes

- Wallet connection, network verification, address access and session checks have
  bounded waits. Cancel/close/disconnect invalidates pending connection work;
  late responses cannot replace or clear a newer account. A wallet is published
  as connected only after its receiving address and Preprod session are read.
  The dialog reports the actual waiting stage rather than a single indefinite
  spinner. Seventeen focused connector lifecycle regressions pass. Compatible
  injected v4 providers are selected by their actual injection key; ambiguous
  selections cannot silently switch wallets. The real Lace connection, verified
  Preprod receiving address and organization vault opening were observed in the
  running app. The connected wallet reports 5,000 tNIGHT. Facility preparation
  reached wallet approval, but no new organization deployment is confirmed yet.
  Alternative-wallet dispatch is tested; an actual 1AM transaction is unverified.
- Browser fetch retains its required global receiver.
- Incomplete facility forms display useful feedback; SDK preparation reaches the
  wallet approval boundary on desktop and phone.
- Results and confirmed private candidates publish only after encrypted writes
  commit. Uncertain storage blocks another mutation; recovery does not redeem twice.
- Supplier APIs verify signed wallet sessions and immutable organization ownership.
- Proxy reads preserve usable wallet endpoints and never expose provider credentials.
  Every SDK read/finality/observable entry authenticates before starting. Sign-out,
  expiry and session eviction immediately terminate idle subscriptions.
- Vite uses the existing empty PostCSS pipeline explicitly, avoiding a cached
  stylesheet error after a transient partial package.json read.

## Remaining boundaries

The 18 October repeat recording confirmed Merchant A's redemption at block
3,034,322 (raw transaction and finality checked). Merchant B's original draw
was rejected with node error 170 and remains pending in the durable journal;
no replacement was sent. There are 26 confirmed calls in the retained facility.
The accepted **complete** two-merchant payout checkpoint remains the earlier
21-call run, with 25/20 test units independently verified. The cached wallet
observation is from that checkpoint, not a fresh observation of the partial run.
[Recording diagnostic](../artifacts/wave2/line-review-video/assets/capture/pending-check.json).

The organization-preview Docker image builds and validates all 52 full-release
files. The latest `line-organization:submission` image is
`sha256:d90816d203a939a9b2317debcbce9ea9219929aed3e129abb81aac94ce750fa9`.
SDK imports succeed inside the image, temporary diagnostic pages and the checked
private paths are absent, and the configured user is `node`. Compose configuration
validates without starting another wallet. This verifies packaging, not funded startup
or hosting of the separate operator test-payout endpoints. See [deployment](DEPLOYMENT.md).

Actual Lace connection and organization vault opening were owner-confirmed.
The new organization's complete funded lifecycle and actual Lace circuit proof
approval are still unverified. Independent supplier cold synchronization/funding
and public production deployment remain open. The existing token checkout uses
one operator for all roles, first-party deterministic services and valueless
transparent test tokens; repayment is an issuer report. Complete historical
privacy, independent commercial custody and customer validation are not claimed.

Obsolete chronological reports are accessible in
[the archived revision](https://github.com/ShrikarT/line/tree/1088cf9/docs).
