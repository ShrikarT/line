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
2. Open the [deck](../artifacts/wave2/line-wave2.html) in a browser.
3. Watch the current recorded user-flow video when the edited candidate is
   delivered; the older `line-review.mp4` is a dated technical review, not the
   current product walkthrough.
4. Review [confirmed Preprod settlement](TEST_TOKEN_PAYOUT_2026-10-16.md) and its
   linked machine-readable raw-output/receipt evidence.
5. Reproduce with `npm ci`, `npm test`, `npm run typecheck`, and the pinned
   Compact toolchain described in the project configuration. The full suite
   currently discovers 641 cases: 640 pass and one is intentionally skipped.

The configured local app is `http://127.0.0.1:5174`. `/test-payout` is the actual
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

The requested GitHub push, repository cleanup, deployment handoff and professional
recorded walkthrough are being finalized. The historical audit corpus stays in
Git history; runtime fixtures and evidence required for evaluation must remain.
