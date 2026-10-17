# Line organization product: implementation and readiness audit

Date: 18 October 2026 (IST). Local worktree: `line-audit-review`, branch `feat/line-ui-redesign`. GitHub main `cc5cb71` is an ancestor of this worktree; checked again against the remote. This supplements the [full audit](AUDIT_REPORT_2026-10-13.md), whose earlier architecture and evidence must be read with their original scope.

## Decision and present verdict

The owner selected **each organization funds and controls its own agents' spending**. The primary `/app` flow now implements that model. An organization's deposit is its own capital, not an outside loan. No mock payment, minted reserve or operator-owned credit book is selected by connecting a wallet.

**The user product is not yet accepted end to end on Preprod.** The owner personally confirmed that actual Lace connects and the organization vault opens. Automated browser execution reaches the real SDK's deployment approval boundary; a deliberately rejecting connector leaves no confirmed facility or payment. A new organization deployment, deposit, purchase and merchant payout still need their own finalized receipts. The earlier accounting and minted-test-token contracts are historical evidence, not substitutes for that acceptance.

## Implementation review

| Area | Current implementation | Practical limit / remaining work |
| --- | --- | --- |
| Product direction | Organization-funded API purchasing; one facility per delegated agent; explicit organization, agent and merchant workspaces | Demand remains an unvalidated customer hypothesis. No outside credit or borrower liability should be advertised. |
| Wallet onboarding | Visible Connector v4 control; Preprod check, discovery, rejection/retry, address copy, disconnect; wallet changes revoke the open vault | Actual extension approvals remain human-operated in this environment. No claim of unattended signing. |
| User custody | Fresh random role secrets; AES-GCM encrypted IndexedDB records scoped to wallet identity and network; Web Locks serialize cross-tab changes | Browser custody is not institutional custody. Losing both browser records and recoverable private records loses access to role/maintenance keys. |
| Contract identity | Separate organization source and release; matching generated JS fingerprint and verifier keys checked before operations | Historical facilities are incompatible with this profile and cannot be adopted by relabeling them. |
| Funding | `fundReserve` requires equal incoming existing-asset value; no mint primitive | Native tNIGHT funding through the actual wallet/ledger combination still needs live confirmation. Wallet DUST registration may leave no spendable tNIGHT. |
| Allowance | Own issuer sets a private committed allowance and owns the delegated agent; zero initial fee; draw checks the committed book | This does not establish separate outside issuer/borrower custody. One facility currently contains one active book. |
| Merchant permissions | Public role key plus fixed payout recipient; issuer-authenticated register/disable; supplier verifies its actual recipient | Disabling blocks new quotes; existing claims survive. A disabled key cannot be re-registered in this profile. Two built-in suppliers share one local operator. |
| Purchase | Authenticated quote, wallet-approved draw and retained merchant-bound claim | Autonomous external agent execution against this new account model is not yet integrated. |
| Settlement | `redeemDraw` consumes a single-redemption claim and sends the selected asset to the registered merchant | A matching funded organization redemption has not been independently observed yet. Service quality and commercial disputes are outside the circuit. |
| Replenishment | `acknowledgeRepayment` requires an actual incoming asset amount before reducing the committed spending balance | This is replenishing own funds, not evidence of an external loan repayment. Live acceptance remains open. |
| Withdrawal/refund | Asset-paying reserve/fee withdrawals; excess refund branch pays the organization and releases exact held accounting | Generated effect/conservation tests pass; actual organization-network withdrawal/refund remains open. |
| API delivery | First-party document metrics and content-integrity computations over the supplied input; result released after merchant payout and re-observation of the redeemed claim | These are deterministic computations, not LLM services or independent external vendors. Public hosting and a persistent merchant operator are authorized after funded verification; neither is currently deployed. |
| Retry/recovery | Candidate and signed transaction saved before submission; exact receipt required; uncertain operations block replacement; stable supplier order and quote reuse | Wallet reads and approval, submission acknowledgement and finality waits are bounded. Reconciliation reuses the original observation and never replaces an uncertain payment. Partial failures remain blocked for investigation. |
| Persistence | Private candidate promoted only after matching finality and committed encrypted storage; failed writes cannot publish a successful private book in memory | Encrypted export and authenticated import into a fresh workspace are implemented. Restore checks actual facility and note/refund commitments, retains pending candidates and rejects stale recovery openings. A different web origin still needs an explicit backup transfer. |
| Privacy | Private witnesses and Compact commitments; public purchase/fee amounts, transfer recipients and reserve deltas explicitly disclosed | Full-history privacy remains unsolved: known zero opening plus public draws can reconstruct the spending balance. Do not claim that observers cannot infer books. |
| UI and accessibility | Existing cream/navy/coral theme; wallet-first empty states, actual balances, facilities, supplier permissions, purchases/results and own receipts; responsive navigation | Primary product routes exclude simulator/operator shortcuts. Historical protocol tools remain reachable by explicit paths. |
| Hosting and operations | Local Vite app and real proof server; local supplier backend with durable encrypted state and shared signer admission | A static Vercel upload alone will not provide this backend, proving assets or merchant worker. Public deployment is now authorized after product verification. |
| Security review | Credential graph scan and regression checks; account switching, recipient mismatch and transaction boundary protections | The earlier supplemental security investigation remains incomplete. This report is not a penetration-test completion or internet production certification. |
| Hackathon presentation | Historical proof/receipt evidence retained separately; primary CTA opens own organization workspace | Submission copy/video must describe organization-funded spending and current privacy limits. The older review video predates this product path. No prize or judging outcome can be guaranteed. |

## Defects fixed in this increment

1. **Deployment could not read its verifier key in the browser.** The SDK's default cross-fetch function was invoked as a provider method and lost the native browser receiver (`Illegal invocation`). Both browser ZK providers now receive a bound native fetch. The actual SDK deployment preparation subsequently reaches wallet approval.
2. **Connecting a wallet could have appeared to adopt operator state.** `/app` now opens only that wallet's own encrypted organization account and creates its own facility. Old funded facilities are not customer balances.
3. **Two tabs could prepare duplicate service requests or draw the same saved quote again.** Request insertion is checked under the account lock, and an existing confirmed note for the same facility/quote is reused.
4. **A failed storage commit could update the displayed private book in memory.** Account mutation now publishes only after encrypted persistence commits.
5. **Wallet/account changes could retain a previous user's view.** Connection changes lock the vault, and organization/session/selected output is cleared. Both shielded identity and receiving address are checked around authorization.
6. **A disabled supplier still looked authorized.** Confirmed disabled status is retained and purchase controls respect it. The UI explains immutable disabled registration.
7. **Finalized rejection had no recovery decision.** An exact `FailEntirely` receipt retains failure evidence and leaves the previous private book intact; partial/unknown outcomes do not clear the saved operation.
8. **Homepage primary actions still led to illustrative purchases.** Primary entry now opens the organization product, with static explanatory steps and clearly separate historical evidence.

## Verification and evidence boundaries

- Compact organization compilation and full release succeeded: compiler 0.31.1, twelve circuit names, 52 release files. Source SHA-256 file fingerprint: `057aa57267c0b8afd537cfb8950946db99bda45954a259c521877bdbb23e5157`. File fingerprints do not replace Compact's `persistentHash` or `persistentCommit`.
- Full organization release validation passes. Canonical regeneration has zero drift across 16 managed files. Canonical and earlier test-token sources remain unchanged.
- All 36 focused organization checks pass, covering generated contract effects/conservation, public transport, real service computations, HTTP signer admission, encrypted backup validation, stale refund openings, exact finality, safe request retirement, public asset export and actual SDK maintenance construction. Synthetic ledger/unit adapters are not on-chain acceptance.
- Production build/typecheck passes. The SDK produces browser externalization/WebSocket-default warnings and the WASM bundle is large; the organization provider explicitly supplies the native WebSocket.
- The fresh full core run discovers **599 tests: 598 passed, zero failed or cancelled, one intentional skip**. Earlier failed/cancelled logs are retained separately; this fresh run is the current result.
- Browser review includes real IndexedDB/Web Locks and metadata-only connector stubs. Those stubs never approve a funded transaction. Actual Lace connection/vault opening is owner-reported evidence, distinct from these tests.
- Fixture-key graph and banned-credential scans pass. A separate exact-value scan checks the three configured credentials against eleven public build/report text files and finds no matches. No credentials are included in the report or public proving manifest.
- A fresh read-only supplier catalog returns HTTP 200 with both actual merchant public keys/receiving wallets and the exact organization source fingerprint. Catalog readiness does not establish a customer purchase.

**Current organization browser result:** all eight cases pass, including actual SDK deployment preparation through a deliberately rejecting connector at 1440/390 pixels, explicit incomplete-form feedback with zero signatures, wallet isolation, IndexedDB write-abort recovery and encrypted backup transfer into a fresh browser. No signature or live transaction is approved. The owner's reported silent creation failure remains unreproduced; explicit creation stages and focused error feedback are now present for diagnosis. The prior broad browser run was 41/43 with its affected legacy cases passing separately; it is not represented as a new full run. [Current verification scope](../artifacts/organization-product/hosting-preparation-verification.json), [historical checkpoint evidence](../artifacts/organization-product/README.md).

## Remaining highest-priority acceptance

1. Create the new facility in `/app`, approve its deployment and finish the eleven remaining verifier registrations. Provide its **public address** or exact error so it can be independently checked against all twelve release keys. No mnemonic or vault password is needed for this check.
2. Verify the wallet has spendable native Preprod tNIGHT and DUST. Deposit existing assets (for example, 100000 base units = 0.1 tNIGHT), then set an allowance. Record actual input/contract balance and finality.
3. Authorize the second supplier. Buy document metrics (25000 base units) and content integrity (20000). Match quote, draw, redemption, actual merchant receiving outputs, returned computation and reload recovery. Do not report payment success before these checks pass.
4. Confirm a real replenishment deposit and an available-reserve withdrawal. Exercise uncertain-submission recovery against the exact signed transaction; never replace an ambiguous payment.

These are acceptance steps, not a statement that the network operations have already succeeded. Native NIGHT SDK compatibility is a specific unresolved integration risk until this run completes.

## Items needing owner input or a later decision

- **Needed now:** public facility address or the exact wallet/deployment error; wallet approvals and spendable Preprod assets. The current toolset cannot operate the owner's existing Lace extension. The owner now reports creation failing without an error. Explicit deployment progress and focused error feedback were added, but this is not yet a reproduced or fixed network failure.
- **Authorized after verification:** public app/backend deployment. Read-only account inspection found no existing Line project in the connected Vercel account; the durable supplier backend and proving assets still need deployment preparation.
- **Implemented recovery follow-up:** backup restore, expired/unconsumed request cancellation and re-quoting, and bounded initial finality. Review corrections reject stale refund openings and bound connector identity reads. See the [current work ledger](REMAINING_WORK_2026-10-18.md) for verification.
- **Before public operations:** monitored durable hosting, production operator authentication/admission and the funded user-facility acceptance above. Uncertain charged claims continue to block replacement payments.
- **Product validation:** one real organization willing to test the service, actual external suppliers and pricing feedback. No existing customer contact was supplied.
- **Broader original goals:** full-history privacy, outside capital/independent custody, institutional key management, unattended agent integration and updated hackathon presentation. These are not silently treated as solved by the organization-funded profile.
