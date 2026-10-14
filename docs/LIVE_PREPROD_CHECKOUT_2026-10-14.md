# Live Midnight Preprod checkout

## Owner scope and implementation

The owner prioritized a working, polished app on Midnight Preprod and deferred website deployment and wider audit work. Redeployment was authorized when needed. The supplied test wallet matches the old contract's issuer. Its old line expired and its deployment script did not retain the rotating private opening, so a new canonical demo instance was created with encrypted, durable openings. The old instance's accounting was restored after the live reserve/withdrawal check.

Requirements for this change: keep exactly the canonical twelve Compact circuits and actual Compact hashes; authenticate issuer, agent and two merchant operations with their distinct keys; submit actual proofs and pay network DUST fees; verify finalized receipts; retain book openings and stable request IDs across restart; reject draws with `Clearance could not be proven.`; fulfill a service only after the merchant's redemption confirms; preserve the private book outside plaintext ledger fields; and distinguish test accounting from asset settlement. Independent custody and full-history privacy remain deferred and must not be claimed.

The existing polished demo remains at `/checkout`. Actual network purchasing is at `/preprod`, using a local Node signer and the official Midnight.js/wallet SDK. The local HTTP interface requires the loopback, same-origin operator context, has one active job, returns asynchronous acceptance, and exposes progress through polling. Secrets stay in ignored `.env.local` and private openings in encrypted `.midnight-cache/live-checkout/private-db`. Native proving assets and private/cache directories are excluded from the Vite watcher, fixing the Windows `EBUSY` crash on LevelDB's `LOCK` file.

## Confirmed deployment and purchasing

Fresh contract: `8990864c6f80c517c7458fa9b2526d3500f3a9814399fc836097ee409da9bed0`.

Deploy transaction: `fe622c6cd7c9030027701fbc10ef829a6904a874fc6428781c18cf032da47f6a`, block **2977060**. Eleven subsequent key registrations install the other circuits. Setup funding, Merchant B registration and line opening are confirmed; there are **15 verified setup transactions**.

An actual browser used the supplied Node wallet, without an injected wallet stub, to buy both services. Six new Preprod calls confirmed: quote, draw and redemption for each merchant. Both deterministic services delivered, and a browser reload retained the receipts and private opening without another charge. The configured test book is 60 units, with 45 outstanding and 15 remaining after the purchase run. A subsequent actual `acknowledgeRepayment` confirmed at block **2977456**, transaction `2c33fbb9f9ec03107e4e4f77a2024fca7d7467e9124fcab464b6e2ca21b20e5a`, restoring the book to zero debt and 60 available units. There are now **22 confirmed transactions** on this instance. This is an intentionally disclosed test fixture; it is not a public plaintext credit-book field.

Two separate checks on the old contract also confirmed: funding 1 accounting unit at block **2976954**, then withdrawing that unit at **2976969**, restoring total reserve to 998. These are accounting transitions, not token deposits or payouts.

## Recovery and limits

The controller retains the deployment nonce, maintenance key, quote/note openings, rotating book, requests and pending post-confirmation state under encryption. Finalized transaction bytes and identifiers are saved before RPC submission. A restart queries that exact identifier; uncertain submissions are not blindly repeated. A transaction whose durable record proves it was never submitted can resume only its exact saved bytes, after checking its circuit, contract, hash and identifier. Orphan preparations are recovered from their original bytes. The submission-attempt flag is persisted before any RPC call. A failed pending reconciliation blocks further purchasing and repayment; an explicit serialized **Reconcile saved transaction** control lets the operator recheck it. Failed initialization can retry after the indexer catches up. Every public mutation recovers pending state before calculating the next book, preventing stale witnesses from overwriting the recovered opening. Reusing a confirmed purchase ID checks its document and retains the original receipts. The authorized projection restores the original document on reload, and a new plan becomes available after repayment. Streamed request bodies are admitted atomically, with one active operation.

The local operator controls all role keys. Logical circuit authentication is implemented; independent organizations/custodians are not. Public amounts, merchant keys and reserve history can reveal activity/debt. Full-history confidentiality is not established. Merchant redemption is a claim/accounting event; no merchant token payout occurs. Repayment acknowledgement represents an issuer-reported test payment and does not verify cash receipt. The two services are deterministic local implementations, not external paid APIs.

Development and preview provide the native backend. Static-file hosting does not. Vercel/public deployment is deferred by the owner. Do not expose the configured signing backend publicly.

## Review baseline and verification

Fixed baseline for the focused Standards/Spec review: `214221d15961295c1760232efa20aa7ca885b460`, the fully verified receipt/read-only setup checkpoint. All new functionality is reviewed against the owner scope above and repository standards. The focused Standards and Spec reviewers found and rechecked fixes for overlapping streamed requests, stale books after pending repayment recovery, orphan/prepared journals, custom-document reload, and unreachable pending reconciliation. Both report no remaining high-priority findings in this scoped integration review. This is not certification of the deferred comprehensive security investigation.

- Final full core run: **560 tests, 559 passing, zero failures, one intentional compiled-owner skip; 60 suites**. The same `npm test` inventory ran with Node test concurrency limited to four. An earlier unrestricted run hit three WSL/OpenSSL/compiler timeouts while proof generation and build were running; the bounded rerun passed all those tests.
- Separate finalized-receipt regressions: **38 passing**.
- Build/typecheck, fixture-key and secret-pattern scans pass. All 24 browser checks pass across the full run (23 passing) and the targeted rerun of one cold-load console-navigation timeout (passing); no source change was required. The two new Preprod browser regression tests use a mocked HTTP projection and submit no funded transaction; the separate actual browser checks below establish network execution. The production bundle contains none of the configured mnemonic, password or Blockfrost token and excludes the native signer module. Compact artifact check reports **16 generated files, zero drift**, pinned compiler 0.31.1. Canonical contract and managed bindings were not changed.
- Actual two-merchant browser purchase: six confirmed calls, both services delivered, reload retained receipts. Actual repayment: one confirmed call, book 0/60, reload retained receipts.
- Full backend restart: retained all **22 receipts**, book 0/60, new plan available, no additional transaction submitted. A 390px browser had no overflow or runtime errors.
- Independent read-only recheck: **all 22 finalized receipts and all 12 exact canonical verifier keys pass**. This uses TLS indexer/RPC providers and canonical finalized block/raw-byte checks; it is not a light-client proof.

[Public receipt evidence](preprod-2026-10-14-evidence/live-checkout-receipts.json), [actual purchase browser scope](preprod-2026-10-14-evidence/preprod-checkout-browser-verification.json), [actual repayment browser scope](preprod-2026-10-14-evidence/preprod-repayment-browser-verification.json), [backend restart/mobile scope](preprod-2026-10-14-evidence/preprod-restart-browser-verification.json).

## Run and demo

Worktree: `C:\Users\Shrikar\line-audit-review`, branch `fix/preprod-readiness`. The configured signer/password remain in ignored local configuration. Run `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort`, keep the proof server on localhost:6300 running, and open **http://127.0.0.1:5174/preprod**. The live backend is local-only and requires `LINE_LIVE_PREPROD=1`; it is enabled in this checkout. Do not run the CLI signer concurrently with the server. The original checkout and its pending UI changes remain untouched.

For a new demo, choose **Start another purchase**, edit the document, then **Run or resume purchases**. Each merchant's quote/draw/redemption confirms before its result appears. Show the finalized hashes and issuer view; then use the explicitly labeled reported test repayment to restore capacity. Reload/resume keeps the same request ID and original document. If a response is uncertain, use reconciliation and retain the saved state rather than starting a different transaction. The fast generated-Compact alternative remains at `/checkout`.

## Deferred decisions and owner input

No additional credential input is required for the verified local Preprod flow. Website deployment remains deferred as requested. Production settlement still requires a chosen asset/rail, capital provider/custodian, legal borrower and merchant fulfillment/dispute terms. Independent role custody and full-history privacy require separate architecture and verification work. Existing private openings on the expired old line are not recoverable from public state. Customer/supplier validation, the controlling hackathon deadline/eligibility and submission, and any later public release remain owner decisions. Blocked security investigation limitations remain in the earlier audit closeout; they are not represented as resolved by these integration tests.
