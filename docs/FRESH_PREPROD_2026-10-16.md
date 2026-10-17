# Fresh funded Preprod purchase - 16 October 2026

The owner requested a fresh funded transaction after the UI redesign and selected Midnight test-token payout as the next implementation priority.

## Confirmed purchase

The actual `/preprod` browser submitted request `003f04c4-2205-4213-a496-9de3068491b9` to the existing canonical instance `8990864c6f80c517c7458fa9b2526d3500f3a9814399fc836097ee409da9bed0`. No wallet stub or mocked Preprod response was used. Both merchant services delivered only after their claim redemptions finalized. The run added six transactions, taking retained receipts from 22 to 28.

| Merchant | Circuit | Block | Transaction hash |
|---|---|---:|---|
| A | postQuote | 3002001 | `43f460be51ccf4a4f201fe957ef7724dcea26aceab6be3cccde280598faad947` |
| A | draw | 3002009 | `e0aa8ce47529e6beec0e388bb4ef603b9063a15c3c142653db9a4929957a4a47` |
| A | redeemDraw | 3002016 | `c8761468da3d7f246037f909b24d197191a3adc97f9992ef6cc5484a397a9a1a` |
| B | postQuote | 3002022 | `aaa94a09f589b6987d68883282223cca13736b49e5b556db16f22e021daddacd` |
| B | draw | 3002029 | `8cecb7b2040762ea037ada3eff97421601f1d2f4c6546034c207d11ae2673a95` |
| B | redeemDraw | 3002035 | `8fb7d9c1536e3ee28411931dd89b956407b9307ee1c32c49cb170c4f53694b8a` |

Each provider receipt reports `feePaid: "1"` in its raw fee representation. Network fees were funded; the 25/20-unit purchases remain contract accounting, not token payouts. The known demo book is now 45 outstanding and 15 available. No new repayment was fabricated or acknowledged.

## Independent and browser checks

- A separate read-only verifier reconciled **all 28 finalized receipts** and **all twelve exact canonical verifier keys** against the pinned release. It checks provider transaction bytes, action identity, canonical finalized blocks and contract state. Trust remains TLS indexer/RPC providers, not a light-client proof.
- Browser reload retained all receipts and both delivered results, with no additional submission. Desktop and 390px captures were inspected; no runtime error or horizontal overflow was observed.
- [Independent receipt report](../artifacts/preprod-2026-10-16/independent-receipts.json), [browser verification](../artifacts/preprod-2026-10-16/fresh-purchase-verification.json), [desktop](../artifacts/preprod-2026-10-16/delivered-desktop.png), [phone](../artifacts/preprod-2026-10-16/delivered-mobile.png).

Docker Desktop and the existing 8.1.3 proof container were stopped initially. They were restarted and `/health` returned HTTP 200 before submission. The new read-only `scripts/check-preprod-readiness.mjs` checks that dependency as well as the operator API, and distinguishes an active/pending operation from an idle facility. The historical receipt report is preserved; the verifier now accepts `--output` for a fresh evidence file.

## Accepted follow-up and remaining boundaries

The isolated twelve-circuit **test-token settlement version** completed its funded gate on 17 October: 21 finalized receipts, 25/20 units observed in the two merchant wallets, exact raw-output/recipient verification and 155 units remaining in custody. [Full evidence and remaining limits](TEST_TOKEN_PAYOUT_2026-10-16.md). A minted test asset has no monetary value, dollar peg or redemption promise. This does not change the canonical accounting deployment described in this report.

Production capital/borrower agreements, independently administered custody, complete-history privacy, external customer validation and public hosting remain separate work. The canonical deployment still has public amounts and reserve history. The private candidate is not silently substituted for this verified live instance. Public app deployment remains deferred.
