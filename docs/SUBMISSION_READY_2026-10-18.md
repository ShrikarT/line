# Line — Wave 2 submission package

The immediate release is a working Midnight prototype. Production customer
onboarding, a lender/custodian business, new organization-funded network
acceptance and public production operation are later milestones.

## Submission description

Line gives autonomous agents organization-approved purchasing capacity and gives
merchants verifiable, single-use payment claims. Compact checks private spending
inputs, authenticates the issuer, agent and merchant roles, separates contract
instances and rejects replay. Wave 2 adds two-merchant checkout, recovery,
wallet-first screens and actual Preprod test-token settlement. The recorded
facility has 21 finalized transactions; its merchants received 25 and 20 test
units, verified against raw transaction outputs, registered recipients and wallet
balances. The test assets have no monetary value. Public amounts and history
remain visible; complete historical credit-book privacy is still research.

The first customer hypothesis is teams letting agents buy APIs and compute. We
have not established customer interviews, pilots, revenue or independent
commercial suppliers. Our next milestone is a small organization-funded pilot,
followed by further privacy and custody work.

## Judge path

1. Read the current README and privacy boundary.
   Open the [public wallet workspace](https://line-midnight.onrender.com/app).
   It uses free hosting and real Preprod readers; fresh funding requires wallet
   approval, and hosted API supplier automation is unavailable on this host.
2. Open the [public deck](https://shrikart.github.io/line/) in a browser, or use
   its [standalone HTML](../artifacts/wave2/line-wave2.html).
3. Watch the current [product walkthrough source and verification](../artifacts/wave2/line-review-video/README.md).
   Wallet and purchase sequences are labeled illustrations; the receipt chapter
   uses actual Preprod evidence. The older `line-review.mp4` is a dated technical review.
   [Download the final 1080p/60 fps MP4](https://github.com/ShrikarT/line/releases/download/wave2-submission-2026-10-19/Line-Wave2-Product-Walkthrough.mp4).
4. Review [confirmed Preprod settlement](TEST_TOKEN_PAYOUT_2026-10-16.md) and its
   linked machine-readable raw-output/receipt evidence.
5. Reproduce with `npm ci`, `npm test`, `npm run typecheck`, and the pinned
   Compact toolchain described in the project configuration. The full suite
   currently discovers 644 cases: 643 pass and one is intentionally skipped.

The public app is `https://line-midnight.onrender.com/app`; its free host can
sleep between visits. [Verified hosting scope](../artifacts/organization-product/public-host-verification.json).
The configured local app is `http://127.0.0.1:5174`. Locally, `/test-payout` is the actual
test-token prototype; `/preprod` is the separate accounting profile. `/app` is the
new wallet-owned organization workspace, whose complete funded lifecycle remains
unaccepted. Do not substitute its preview for the confirmed settlement evidence.

## Current event check

The [AKINDO event](https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG) and its
[public metadata](https://api.akindo.io/public/wave-hacks/jaMZjqPOBsLXvjdG) accept
prototypes/working concepts and ask for public source, a slide deck, demo/video,
at least one compiling Compact contract and a clear prior-Wave delta. The live
Wave 2 timestamp is **19 October 2026, 15:00:34 UTC / 20:30:34 IST**. The static
Midnight overview and older linked rules show different dates; the entrant must
check the actual dashboard and controlling rules. Prepare and submit promptly.

The current public scoring weights are engineering 40%, QA 15%, product 15%, UX
15%, communication 10% and business 5%. Engineering evidence and a clear user
walkthrough take priority over production feature expansion.

## Entrant actions

- Confirm individual/team registration, eligibility, Discord and Telegram fields.
- Upload/link the public repository revision, deck and final current video.
- State the Wave 1-to-2 changes and submit personally through AKINDO. The event
  prohibits automated entry; no entry has been submitted by this agent.

The complete submission source is on [`main`](https://github.com/ShrikarT/line/tree/main).
The recorded wallet increment was verified at `59b06bd`, which is retained in its history.
Lace connection, the Preprod address and the organization vault were observed in
the actual app; the wallet reports 5,000 tNIGHT. A new organization deployment
has not been confirmed. The Cap recording reached the actual approval boundary,
then the approval wait ended and the vault locked. This is not transaction-success
footage. The owner authorized illustrated wallet and purchase sequences for the
submission film. Those sequences are explicitly labeled and accompanied by the
confirmed historical settlement evidence. Fresh funded organization acceptance
still requires owner approval and separate finality verification.

Repository cleanup and the deployment handoff are prepared. The historical audit
corpus stays in Git history; runtime fixtures and evidence required for evaluation
remain. Temporary diagnostic pages and browser-test report directories are
archived outside the repository.
