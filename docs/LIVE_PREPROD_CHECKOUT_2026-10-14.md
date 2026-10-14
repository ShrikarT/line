# Live Midnight Preprod checkout

## Owner scope and implementation

The owner prioritized a working, polished app on Midnight Preprod and deferred website deployment and wider audit work. Redeployment was authorized when needed. The supplied test wallet matches the old contract's issuer. Its old line expired and its deployment script did not retain the rotating private opening, so a new canonical demo instance was created with encrypted, durable openings. The old instance's accounting was restored after the live reserve/withdrawal check.

Requirements for this change: keep exactly the canonical twelve Compact circuits and actual Compact hashes; authenticate issuer, agent and two merchant operations with their distinct keys; submit actual proofs and pay network DUST fees; verify finalized receipts; retain book openings and stable request IDs across restart; reject draws with `Clearance could not be proven.`; fulfill a service only after the merchant's redemption confirms; preserve the private book outside plaintext ledger fields; and distinguish test accounting from asset settlement. Independent custody and full-history privacy remain deferred and must not be claimed.

The existing polished demo remains at `/checkout`. Actual network purchasing is at `/preprod`, using a local Node signer and the official Midnight.js/wallet SDK. The local HTTP interface requires the loopback, same-origin operator context, has one active job, returns asynchronous acceptance, and exposes progress through polling. Secrets stay in ignored `.env.local` and private openings in encrypted `.midnight-cache/live-checkout/private-db`. Native proving assets and private/cache directories are excluded from the Vite watcher, fixing the Windows `EBUSY` crash on LevelDB's `LOCK` file.

## Confirmed deployment and purchasing

Fresh contract: `8990864c6f80c517c7458fa9b2526d3500f3a9814399fc836097ee409da9bed0`.

Deploy transaction: `fe622c6cd7c9030027701fbc10ef829a6904a874fc6428781c18cf032da47f6a`, block **2977060**. Eleven subsequent key registrations install the other circuits. Setup funding, Merchant B registration and line opening are confirmed; there are **15 verified setup transactions**.

An actual browser used the supplied Node wallet, without an injected wallet stub, to buy both services. Six new Preprod calls confirmed: quote, draw and redemption for each merchant. Both deterministic services delivered, and a browser reload retained the receipts and private opening without another charge. The configured test book is 60 units, with 45 outstanding and 15 remaining after this run. This is an intentionally disclosed test fixture; it is not a public plaintext credit-book field.

Two separate checks on the old contract also confirmed: funding 1 accounting unit at block **2976954**, then withdrawing that unit at **2976969**, restoring total reserve to 998. These are accounting transitions, not token deposits or payouts.

## Recovery and limits

The controller retains the deployment nonce, maintenance key, quote/note openings, rotating book, requests and pending post-confirmation state under encryption. Finalized transaction bytes and identifiers are saved before RPC submission. A restart queries that exact identifier; uncertain submissions are not blindly repeated. A failed pending reconciliation blocks further mutation. Reusing a confirmed purchase ID checks its document and retains the original receipts.

The local operator controls all role keys. Logical circuit authentication is implemented; independent organizations/custodians are not. Public amounts, merchant keys and reserve history can reveal activity/debt. Full-history confidentiality is not established. Merchant redemption is a claim/accounting event; no merchant token payout occurs. Repayment acknowledgement represents an issuer-reported test payment and does not verify cash receipt. The two services are deterministic local implementations, not external paid APIs.

Development and preview provide the native backend. Static-file hosting does not. Vercel/public deployment is deferred by the owner. Do not expose the configured signing backend publicly.

## Review baseline and verification

Fixed baseline for the focused Standards/Spec review: `214221d15961295c1760232efa20aa7ca885b460`, the fully verified receipt/read-only setup checkpoint. All new functionality is reviewed against the owner scope above and repository standards. Four initial focused tests pass: generated-Compact two-merchant execution, exactly-once retry, private-book repayment restoration, generic capacity rejection, and local HTTP mutation admission/single-job behavior (the HTTP case covers several assertions). Native financial correctness also has the independent finalized receipt checks described above. Broader final build/core/browser results and restart/repayment checks are recorded after they complete.
