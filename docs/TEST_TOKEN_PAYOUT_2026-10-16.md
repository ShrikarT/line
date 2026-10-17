# Midnight test-token payout

This implements the owner's selected next step: actual test-token settlement for the existing two-merchant agent checkout. The local page is `http://127.0.0.1:5174/test-payout`. Public hosting remains deferred.

## Confirmed payout - 17 October 2026

**The funded acceptance gate passed.** Contract `a159597495b52ea7a703a29562b17fcb042bf7eaa984ec1e05e7e8935208304b` has **21 finalized transactions**: deployment, eleven verifier-key registrations, three setup calls and six two-merchant purchase calls. Both services delivered. The browser observed Merchant A's wallet increase from zero to **25 test units** and Merchant B's from zero to **20**.

| Merchant | Units | Finalized block | Redemption transaction |
|---|---:|---:|---|
| A | 25 | 3018769 | `b02e0c3777a67bd4c0a9cdbc7fe77097f1fa7bd26e32f4bbecc4c24484367da6` |
| B | 20 | 3018803 | `291762e37b41552b4ed05809b7cb5f9b3c838d5b1b8cf160ef03e9babaa50dba` |

A separate read-only verifier checked all 21 finalized receipts, all twelve exact release verifier keys, the actual raw redemption outputs and their on-chain registered recipients. The reserve held 200 test units after minting, 175 after A's payout and **155 after B's**. The wallet observations and raw outputs agree on token identity `0d6953d8b70bb5b9980771ae8dfc489d8b2ca05d2fa10093f25d6053b8d664cd`. Trust is the configured TLS node/indexer, not a light-client proof.

[Independent receipt/output report](../artifacts/preprod-2026-10-16/token-independent-receipts.json), [actual browser and wallet evidence](../artifacts/preprod-2026-10-16/token-payout-verification.json), [desktop](../artifacts/preprod-2026-10-16/token-desktop.png), [phone](../artifacts/preprod-2026-10-16/token-mobile.png). Reload retained results and 21 receipts without another POST. No browser runtime error or mobile overflow was observed. Both real captures were visually inspected. The verifier's initial filter incorrectly treated a key registration named `redeemDraw` as a call; it now requires `kind === 'call'` and the complete check passes.

The accounting facility separately retains 28 verified receipts. Final local checks establish 562 core cases with passing evidence and one intentional skip: the full 563-case run passed 561 and timed out one compiler/owner fixture; that exact fixture passed its isolated rerun. Fourteen focused backend checks and six generated settlement cases pass. Ten focused browser cases pass together; the two preview/search cases also pass after the final animation fix, including an assertion that no empty-target warning occurs. TypeScript and production bundling pass. See [machine-readable local verification](../artifacts/preprod-2026-10-16/local-verification.json) for precise scope.

**Unverified:** a full backend restart of this newly funded test facility. The idle pre-restart snapshot was saved, but automatic approval review rejected stopping the local Vite process with only `blocked by policy`. The app was left running. A page reload passed; it is not presented as a backend restart. After manually restarting the same app, `node artifacts/preprod-2026-10-16/verify-restart.mjs --after` performs a read-only comparison against the saved baseline and checks fresh-browser restoration. This limitation does not invalidate the confirmed payouts.

## Contract and runtime

`contracts/experimental/line-test-settlement.compact` is a separate twelve-circuit version. The canonical contract, managed bindings, release pointer and deployed accounting facility remain separate. Its generated release binds source hash `c60602098003d0e1d489222266582a4a003f28ce6c7bcf762d7500c256a652d6` to fresh proving and verification keys. Some inherited accounting comments describe the canonical baseline; the experimental header and executable asset operations define this version's added behavior.

This funded profile was compiled from CRLF source bytes. A file-specific `.gitattributes` exception preserves those exact bytes on every checkout; the normal LF policy still applies to the canonical contract and other Compact sources. The staged source hash was checked against the funded release. Renormalizing a live pinned source is a release migration, not a cosmetic edit.

- Issuer-authenticated `fundReserve` mints a valueless unshielded test asset into contract custody. This is a test faucet, not a capital deposit.
- Merchant recipients are fixed at registration. The merchant must authenticate redemption; callers cannot redirect another merchant's payout.
- `redeemDraw` transfers principal to the registered recipient in the same transaction as note consumption. Replay and wrong-merchant attempts fail.
- Draws check actual asset backing as well as credit and reserve accounting. Issuer reserve and earned-fee withdrawals transfer actual test assets and respect locked budgets.
- The operator keeps the test facility and merchant wallet seeds in a separate encrypted controller. Both live facilities share one fee wallet and one HTTP operation lock. This is still one operator administering all roles.
- The browser has separate request storage for the two facilities. A page reload reads retained results; it does not initiate another transaction.

The acceptance gate is finalized merchant redemption, matching raw transaction outputs, registered recipients, contract asset balances and observed merchant wallet balances. Deployment or circuit simulation alone does not satisfy that gate. The evidence above establishes it for the recorded purchase.

## Recovery checkpoint - 17 October

The separate contract `a159597495b52ea7a703a29562b17fcb042bf7eaa984ec1e05e7e8935208304b` confirmed deployment, all circuit registrations and the 200-unit reserve mint (13 transactions). Merchant B registration was rejected before any purchase. The saved transaction was retained; an exact-byte retry returned RPC 1012 (temporarily banned), and the provider disabled external dry runs. The original rejection reason was not retained, so its root cause remains unproven.

After every saved intent expired, a read-only check established that finalized chain time had passed expiry, the indexer had zero matches for the exact identifier and Merchant B remained unregistered. Only then were the bytes and journal archived and the local pending flag retired. No reserve mint or purchase was repeated by recovery. [Recovery evidence](../artifacts/preprod-2026-10-16/token-expiry-recovery.json).

The runtime now retains sanitized RPC rejection details without automatically rebroadcasting uncertain submissions. It also waits for current DUST synchronization before balancing each transaction, consistent with [Midnight's fee-wallet guidance](https://docs.midnight.network/guides/manage-dust). This closes a synchronization gap; it does not retroactively prove why the earlier transaction failed.

The next rejected attempt captured **Custom error 117**, which the [node error table](https://docs.midnight.network/nodes/error-codes) identifies as `NotNormalized`. Its saved transaction contains a DUST fee section with zero spends and zero registrations; the pinned local ledger independently reproduces `transaction is not in normal form`. The confirmed reserve transaction contains one DUST spend. Actual public bytes for both are retained in `tests/fixtures/preprod-fees/` and exercise the regression guard. The runtime now uses a positive one-unit fee overhead and rejects empty fee sections before journaling/submission. All **14 focused backend checks pass**. Funded acceptance of the replacement remains a separate gate.

The second rejected transaction was also retained until finalized time passed every intent's expiry. Its exact identifier remained absent and Merchant B unregistered; the expiry recovery archived it without changing reserve accounting. [Second recovery evidence](../artifacts/preprod-2026-10-16/token-expiry-recovery-15a7f853cf6d.json). A combined command for an earlier structural-retirement approach was blocked by automatic approval review without a specific reason; that approach was not executed. The completed recovery used the stricter expiry checks instead.

Verification at this checkpoint: the full core inventory passed with **561 tests, 560 passing and one intentional skip**. The additional rejection-diagnostic regression and existing backend checks pass together (**13/13**). The initial broad run had three WSL fixture timeouts; the subsequent full run passed. The production bundle was emitted successfully, with existing SDK/bundle warnings. Six generated test-token contract cases and three browser cases also pass. Actual token payouts remain pending until the acceptance gate above is met.

## Reproduction

```powershell
npm run settlement:compile
npm run settlement:test
npm run settlement:release
npm run settlement:validate
```

Release building generates fresh keys in an isolated directory. Do not rebuild or replace a live profile casually: its encrypted controller is pinned to the source hash. Start the already configured local app and proof server using [DEMO_READY.md](DEMO_READY.md); do not run a second signer alongside it. The test page exposes explicit setup and purchase actions, while status reads do not submit test-settlement transactions.

The manual `artifacts/preprod-2026-10-16/run-token-check.mjs --submit-preprod` requires an explicit funded-run flag and refuses a second run after its request marker exists. Retain and reconcile an interrupted request. It is never part of automated tests.

## Remaining boundaries

Token amounts, contract reserve balances and recipient addresses are public. This does not meet complete historical credit privacy. These tokens have no monetary value, dollar peg or redemption promise. Repayment and positive cash-refund acknowledgements remain issuer reports; there is no verified incoming asset repayment or token-refund implementation. Service results are deterministic local computations. Production capital, legal borrower/creditor terms, independent merchant custody and customer validation remain future work.

The configured wallet was sufficient; no additional wallet credential is needed. The remaining owner action for the optional restart check is to stop and restart the local app, then run the read-only comparison above. Public hosting and production settlement choices require separate decisions later.
