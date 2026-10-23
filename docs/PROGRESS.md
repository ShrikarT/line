# Wave progress

Updated 23 October 2026. Line is a Midnight Preprod prototype for
organization-funded agent purchases. Production credit, complete historical
privacy and independent commercial custody are not established.

## Current status

| Area | Verified state / limitation |
| --- | --- |
| Public application | [line-midnight.onrender.com](https://line-midnight.onrender.com/app), free wallet-only hosting; no hosted supplier signing wallet or automated supplier |
| Product release | `49e6c21`, live Render deployment `dep-dbdfqj29lscs73bklclg` at 06:24:39 UTC on 23 October. Nine public JS chunks, including the package dialog, workspace, account/network code and unchanged memory holder, match the tested build by SHA-256. HTML selects the current entry with no-store; `/readyz` reports ready in wallet-only mode. No transaction was submitted by this release check |
| Local verification | This follow-up: 695 core tests passed, one skipped. After adding the clock-skew and missing-capability checks, all 14 affected auth/adapter tests passed again. Two built wallet-only host tests, typecheck, production build, 37-file proving export, production key/secret scans and zero managed-contract drift passed |
| Browser verification | 70 distinct organization, startup and wallet scenarios passed across the broad/focused runs, including duplicate-read, retained-cookie, missing-code and closed-original-tab cases. The broad run caught two missing backup-completion messages; those were corrected and their reruns passed. All eight final production-preview checks passed. Six further browser checks confirmed exact pending bytes, atomic recovery, backup/restore, outage export and lock protection; the startup checks also passed. Final UI/cache changes were verified after the full core run. CI now repeats these against built assets. Fixtures are controlled tests, not new network acceptance |
| Full CI | The [refresh correction `1efc8b4`](https://github.com/ShrikarT/line/actions/runs/39776737263), [startup follow-up `568c093`](https://github.com/ShrikarT/line/actions/runs/39780636985), [code-download correction `cb754a5`](https://github.com/ShrikarT/line/actions/runs/39784089985) and [second-opening recovery `702194d`](https://github.com/ShrikarT/line/actions/runs/39901700502) all passed. Recovery's 39 focused tests, five browser cases, two built-host tests, typecheck, build, proving export and key/secret checks also passed locally |
| Actual organization | Latest separately checked finalized fee withdrawal: OPEN, generation 2, policy 1,000 + 100 bps, zero encumbrance, pending fees and finalized fees. The cycle paid 100,000 to the registered owner/merchant and 2,000 to the fixed issuer wallet. Post-state custody is 1,798,000, reserve accounting 1,998,000 and cumulative redeemed principal 200,000. The earlier extra reserve increase is observed; its funding receipt has not yet been separately audited. Latest workspace receipt count has not been reread |
| Active blocker | The two expired openings are archived, and fresh fee-bearing reopening, quote, draw, merchant payout and fee withdrawal are all finalized. Remaining work includes final UI/backup checks, clearer claim selection, additional merchant/compensation acceptance, independent suppliers/customer validation and full-history privacy |
| Live testing | On 23 October the owner confirmed automatic wallet connection, a ready organization and an unlocked vault after refresh, then successfully reviewed and archived the newer opening. The displayed history records `006c2322...` at finalized block 3,092,740 and `00abb757...` at finalized block 3,099,704. These are encrypted local recovery records with provider-backed evidence, not finalized failure receipts or successful reopening acceptance |
| Wallet / backup | Latest encrypted backup remains saved. On the new live build, the actual 1AM owner wallet connected with one click and restored itself after refresh. The owner subsequently reported an organization logout after refresh; a live tab showed a rate limit above the password form. The reproduced boundary was network-read failure being presented as vault logout; the correction retains the memory session for retry. On the corrected deployment, the actual owner tab restored the organization after refresh without password entry, displayed all 22 receipts, and completed wallet/contract-release setup. This is session verification, not a new chain transaction. Its original signed operation is retained. Prior connector failures included a rate limit, generic configuration failure and InternalError; none justified bypassing live guards |

The owner reported a missing `account-m22_y_or.js` after deployment; the file
returned 404 while the current build used a different hash. Code-load failures
now offer a workspace reload rather than another password attempt, preserving
records and the memory resume ticket. HTML is not stored in caches and hashed
assets are immutable. Initial copied-tab tickets are discarded before wallet
discovery, including when the original tab closes first.

Wallet-read failure during restoration now offers a retry using the retained
absolute session deadline. Failure after decryption keeps the vault and encrypted
backup available while transaction tools wait for fresh verification. A missing
memory record is handled as locked, never as a successful restore. SDK setup now
uses the fresh account identity guard instead of repeating configuration RPCs.
A refreshed client can reuse its existing thirty-minute HttpOnly sign-in cookie
after a server check for the selected wallet, without another signature or any
extension of the cookie deadline. Service errors and stale locks cannot bypass
that check.

Wallet/organization refresh uses public wallet selection and a random tab ticket
in sessionStorage. Passwords, verified configuration and the original absolute
expiry remain in a same-origin memory holder. Restore verifies the live Preprod
session and both identities, then reads the latest durable encrypted journal.
Manual lock/disconnect revokes the ticket before releasing its browser lease;
late replies cannot restore it. Browser restart or loss of that memory requires
the password again. The first-click retry is bounded to two attempts and covers
only explicit transient connection/configuration failures, never signing,
proving, balancing or submission.

Saved-quote export generated JSON but left focus on the summary card without a
copy control. A browser regression reproduced that handoff failure. Transfer
exports now open a focused dialog with Copy package, Download package and an
explicit close action. Four saved-quote browser cases pass, covering exact
finality, backup/history export on mobile, the real clipboard, denied clipboard
fallback, exact downloaded JSON, import into the 102,000-unit purchase preview
and vault-lock cleanup. Eight production-preview startup/refresh cases and both
built-host cases also pass, along with typecheck, build, proving export, key/secret
scans and unchanged managed contracts. These are controlled browser checks, not
live purchase acceptance. The dialog update is deployed as `49e6c21`; its
[full CI run](https://github.com/ShrikarT/line/actions/runs/39911136195) passed.
The prior recovery release's full CI also passed.

## Wave 1 — foundation

- Five circuits: `openLine`, `postQuote`, `draw`, `acknowledgeRepayment`, `setStatus`.
- Compiling Compact contract, generated execution and TypeScript reference model.
- Issuer, agent and merchant consoles, local checkout and MCP tools.
- Private spending-book witnesses, allowance checks and replay controls.

The baseline is preserved at `c02843c`. It established a local protocol prototype,
not customer-funded settlement.

## Wave 2 — checkout and recovery

- Twelve circuits, merchant registration, reserve/fee withdrawals and expiry
  compensation; Merchant A/B separation, contract domains and single-redemption
  merchant-bound claims.
- Wallet-first organization, agent and merchant workspaces. Organizations fund
  and control their own agents. Onboarding accepts the owner's receiving profile
  or an independent merchant's public profile.
- Actual Preprod test-token settlement, including the complete historical
  two-merchant checkpoint and the fresh 1AM organization lifecycle below.
- Encrypted wallet-scoped accounts, backup/restore, durable candidates and
  receipt-based recovery. Organization sessions last twelve hours in tab memory;
  manual locking, disconnect and account changes revoke the session. Same-tab
  refresh can restore the original session from memory without renewing expiry.
- Same-origin authenticated Preprod HTTP/WebSocket readers recover retired wallet
  endpoints while wallets retain proving, signing and submission.
- Treasury reads actual `ContractState.balance`, separately from reserve
  accounting. Summary and wallet-balance reads are serialized; failed reads stay
  unavailable, refresh retries them, and asset typing uses cached balances.
- Optional flat/proportional organization fees, upward-rounded charge previews,
  saved service fee ceilings and issuer withdrawal of finalized fees only.
- Invoice references validate 32 UTF-8 bytes or a full 64-digit hexadecimal ID
  before wallet preparation; valid encoding is unchanged.
- Merchants can search and re-export saved quote packages after confirmation,
  exact-success reconciliation or reopening their vault. Only committed quotes
  appear; uncertain and failed candidates remain unavailable. The original
  package, fee preview and deadline survive without reposting a quote. Saved
  packages do not establish current availability or independent fulfillment.
- Merchant claim review binds the imported opening, public note terms, asset
  and registered receiving wallet before redemption. The SDK rereads state
  before preparation, rejects spent/cancelled claims and preserves older valid
  claims after disabling, closure and reopening. Observed unspent status does
  not guarantee a payout; Compact checks expiry and custody at execution.
- Contract engines load after vault opening. Local production initial resource
  bodies fell from 12.30 MB to 0.34–0.36 MB, with no earlier WASM request. This is
  downloaded-byte evidence, not a rendering-speed guarantee.

### Confirmed organization receipts

Facility:
`ab428f74f8a8e72dc66a2f521c932d97860525d848a4d7a3acf0c795b3ef7e73`

The owner also receives the merchant payout in this run. This proves the protocol
path with valueless Preprod assets; it does not establish independent merchant
fulfillment, a commercial pilot or cash settlement. One tNIGHT is 1,000,000 base
units. All amounts below use base units.

| Action | Finalized transaction | Block |
| --- | --- | --- |
| Deploy | `35308f95c29cd7dd90560ef0d2e2f463298c5aa1b3a2069baed34732be05f257` | 3,048,990 |
| Final verifier registration | `2c3ee75877479103cc21f6fa21ee0b0e1bbc369058a37ab793a3546caf3628d9` | 3,049,250 |
| Fund 1,000,000 | `59d844efbf8767d63189bafea7a4b8fb865c5c0a6429bc14fcfe2742cb05437d` | 3,049,290 |
| Open zero-fee allowance | `48a13cca323df8a4d719a19c1e0963e7c322c549bde4ce75782b3438b517049c` | 3,058,632 |
| Quote 100,000 | `6ce7e7d3704c6abdc2cb9a74cb698e8f0a467a35ba75490752aeae7f47f4a2c2` | 3,058,680 |
| Draw 100,000 | `0e70cdc79ba75a9dace592736648d3e7a1ad9b270c7b3990e4422fb0a33a8246` | 3,058,719 |
| Redeem 100,000 | `285f48f366885382b84d45cd071a056e005de0d17929b6d2b66b1e56347dbf97` | 3,058,809 |
| Deposit/replenish 100,000 | `6df1b8453e811030e65a8bca568882814a0ffcb4dcf0dd995634f5fe83d70aef` | 3,059,534 |
| Withdraw 100,000 | `92c149ea2a636a51dfa6afaebe5cc17d8f8902750e4e75576e8f83b574307cb0` | 3,059,575 |
| Pause | `cf4d26a71bef83e78217af23f3e88e54866a4331f31c56406f9e6d4322942ae1` | 3,059,617 |
| Resume | `08435fb970a6856c5d15270dfb299005924eef050040476a781279b3d48fad42` | 3,059,694 |
| Close with zero outstanding | `19b6095be3bb7a3eb03865a514c87386e5c340b593529ecdc3d120c9b30a54fc` | 3,062,090 |
| Reopen with 1,000 flat fee + 100 bps | `5cceda1a3b762fd156a124d412e7b02db263fa4fed172f5f12e4fcf3aae74a65` | 3,099,871 |
| Fresh generation-2 quote | `0f51c305f7ea3da7f97c2b41845423cfce0b4fb3898d2cd33e50810f91595eb7` | 3,099,949 |
| Fee-bearing draw: 100,000 principal + 2,000 fee | `07cab8b6630d41753002e2a23b65556be44be2e97a559b44bfbaaefdd797b66b` | 3,100,335 |
| Redeem generation-2 claim: 100,000 payout | `1deb6fafdfd3486aadcac2b4c5c7f703bbf2906db70ed9660ff0f678c7718357` | 3,100,433 |
| Withdraw 2,000 finalized fees | `8fed9b055aa3725c4164ace297bc5bc40d3d539fe534140b7c4ce23ebf72b802` | 3,100,508 |

Separate read-only checks matched selected raw transactions, contract actions,
identifiers, canonical finalized blocks and all twelve release-matched keys.
Redemption paid exactly 100,000 to the registered merchant recipient. Replenishment
contained an actual 100,000 deposit; withdrawal paid the fixed issuer recipient.
Closure retained 900,000 in custody and 1,000,000 in reserve accounting. These are
configured TLS indexer/RPC checks, not independent full-node or local proof
verification. The latest successful check was 03:18 UTC on 21 October; it
explicitly read generation 1, zero encumbrance, zero fee terms and zero fees.

Fresh receipts cover nine distinct call names: `fundReserve`,
`withdrawUnencumberedReserve`, `withdrawFees`, `openLine`, `postQuote`, `draw`, `redeemDraw`,
`acknowledgeRepayment`, `setStatus`. Verifier registration is not circuit-call
acceptance. Additional `registerMerchant`, `disableMerchant`,
all `cancelOrExpireNote` modes remain unaccepted in this facility. Closed-line
reopening with fees was separately verified on 23 October: exact canonical raw
transaction, aggregate SUCCESS and RPC-finalized block 3,099,871. Its post-state
is OPEN, generation 2, flat fee 1,000 and rate 100 bps, expiring
`2026-10-30T05:40:32Z`. All twelve verifier keys still match the release. The new
generation-2 quote finalized at block 3,099,949. After using the corrected package
dialog, the owner authorized the purchase; its canonical raw `draw` and aggregate
SUCCESS were separately matched to RPC-finalized block 3,100,335. The post-state
encumbers 100,000 principal and holds 2,000 pending fees, with custody unchanged.
Its merchant redemption then finalized at block 3,100,433. Canonical raw outputs
pay exactly 100,000 native base units to the registered owner/merchant receiving
wallet; custody falls to 1,800,000, encumbrance and pending fees become zero, and
2,000 fees become finalized. The owner first selected the old generation-1 claim;
the review correctly showed Already redeemed and disabled duplicate redemption.
Selecting the new generation-2, 2,000-fee claim completed the payout. This remains
same-owner Preprod acceptance. Fee withdrawal then finalized at block 3,100,508;
the canonical raw transaction pays exactly 2,000 native base units to the fixed
issuer recipient. Custody becomes 1,798,000 and reserve accounting 1,998,000, with
zero encumbrance, pending fees and finalized fees. This completes the fee-bearing
reopening/quote/draw/redemption/fee-withdrawal cycle on this facility. It does not
establish independent fulfillment, a customer pilot or full-history privacy.

### Pending allowance and recovery

On 23 October the owner confirmed automatic wallet connection, organization
readiness and an unlocked vault after refresh. The pending identifier was the
newer `00abb757c332b831dd25c7640f417d50323639ede3361893571e361ec8eae44813`,
not the first original below. An exact identifier lookup returned zero records
without GraphQL errors. Fresh scoped node/indexer evidence at finalized block
3,099,172 (`2026-10-23T04:34:06.001Z`) matched the complete trusted closure state,
all twelve release verifier keys and maintenance counter 11. This evidence does
not itself validate the owner's retained candidate or establish a failure receipt.

Recovery scope now includes exactly those two identifiers. Signed-byte identity,
opening transcript/private-candidate replay, fixed terms, finalized TTL margin,
durable review guards and atomic archival are unchanged. A failing browser case
first reproduced the missing review button for the newer identifier; a failing
encrypted backup case reproduced rejection of its recovery history. Both now
pass. Five browser cases cover both openings, preservation of the first archive
when appending the second, stale reviews, wallet changes, storage failure, later
commits, backup/restore and exact receipt reconciliation after expiry. Thirty-nine
focused transaction, evidence, backup, finality and authenticated-provider tests
also pass. These are controlled tests. The owner subsequently confirmed successful
local candidate/evidence review and archival, with both originals retained in
recovery history: `006c2322...` at block 3,092,740 and `00abb757...` at block
3,099,704. This unblocks the workspace without promoting either candidate or
creating a failure receipt. A fresh opening still needs separate owner review.

Saved original identifier:
`006c23221e7a0ebe76a1975d827166437f010f611e6a95bd38d6b0c5b55ab524e2`

The owner approved a 1,000,000-unit allowance with seven-day expiry, a 1,000-unit
flat fee and 100 basis points. Submission acknowledgement timed out. The exact
signed bytes remain in the encrypted journal, with new mutations blocked.
At 02:51 UTC on 21 October, a direct lookup returned HTTP 200, no GraphQL errors
and zero records; current state remained CLOSED, generation 1, fees 0/0 and
900,000 held. Neither a missing receipt nor a latest-state snapshot proves that
an uncertain transaction never applied.

The latest finality check through the recovered live session ended with
`Finality has not been observed yet`. The owner's subsequent original-byte retry
was rejected by expiry validation before wallet submission. The live workspace
still shows the exact original identifier, CLOSED status, 900,000 units held and
22 receipts. Signed bytes and the private candidate remain retained; expiry is
not recorded as finalized failure. Earlier retries and a separate fresh-tab
connection returned `Request failed`. No replacement was created.

Explicit resubmission keeps the original bytes and identifier, validates the
release, canonical encoding, action, target and expiry, and requires fresh wallet
identity plus the account lock. Stale reviews, altered bytes and expired intents
are rejected. It requests no new proof or balancing. Rejection or timeout retains
the pending operation. Expiry alone never clears the journal. A generic expiry
recovery procedure is not established; in this CLOSED facility `setStatus` is
rejected, so it cannot be assumed to provide a cancellation fence.

A narrowly scoped recovery implementation now targets only this original opening.
Fresh node/indexer reads agreed at finalized block 3,077,413 (21 October,
16:18:12 UTC). Its complete contract state still equals the separately
rechecked closure checkpoint: generation 1, CLOSED and maintenance counter 11.
Closure block hash is
`07e0ca54c514da92538ec7d29b3c1aa9db4f315d6a61bd0142379a20dafc9306`;
serialized state SHA-256 is
`b7ff374bea501e82b6fb2210b1e1fed115f1b3688402cb49b6e1ba2211066cdd`.
The observed runtime is `midnight` spec 1,000,300, using ledger 8.1.2.
After deployment, an authenticated public read with an ephemeral, unfunded test
identity also passed through the production recovery endpoint at finalized block
3,077,645. Its state matched the pinned closure and all twelve local release keys.
This checked hosted authentication and provider reads without accessing the
owner's encrypted record or submitting a transaction.
A later production check at block 3,078,006 (21 October, 17:17:30 UTC) again
matched the pinned state and release keys. Readiness remained healthy in
wallet-only mode, and deployed application assets still matched the tested build.
The browser-control tools had no connected browser; the owner's local archive
status therefore remains unverified.

The recovery checks all saved intent TTLs against pinned finalized block time,
retains a 30-second uncertainty margin, verifies the exact signed action and
replays its transcript against the predecessor to bind the generation-2 private
candidate and approved fee terms. The unchanged, nonsaturated maintenance counter
excludes intervening verifier/authority updates; generation cannot reset or wrap
under this release. Details and source references are in
[architecture](ARCHITECTURE.md). These rely on configured TLS providers and normal
validated ledger history, not an independent full node or light-client proof.

Owner confirmation triggers another provider read and wallet check under the
account lock. A single encrypted commit preserves the original operation,
predecessor, candidate and evidence in recovery history before unblocking.
Ordinary expiry rejection and exact-receipt reconciliation remain unchanged.
Recovery neither promotes the candidate nor creates a failure receipt. The real
owner's encrypted operation has not yet passed this new local candidate check or
been archived; that requires the existing vault to be opened locally after the
verified product update. No replacement opening has been created.

Two focused browser regressions passed for expired signed operations: no wallet
submission, proof or balance request; exact bytes and candidate retained through
encrypted backup and reopening; missing and unrelated receipts keep the journal
blocked; exact finalized success or total failure can still reconcile it. These
use serialization fixtures and controlled receipts, not fresh network evidence.
All five transaction-validation tests and typecheck also passed. No production
transaction behavior or contract changed in this verification update.

After the owner restored 1AM and reopened the organization, the diagnostic release
identified `getConfiguration` as the failed check. A later cooldown refresh failed
at the same stage, before proof or submission. The session-check fix verifies
service configuration at unlock and keeps a frozen in-memory copy. Later guards
check the live connector session and Preprod network, then reread both identities.
A failed live check cannot fall back to saved settings. Changed accounts still
lock the vault; reconnect/reopen adopts changed service URLs. This reduces
repeated configuration reads. On the deployed fix, the owner reopened the existing
organization. 1AM initially rate limited the live session-status check; one later
refresh after cooldown recovered the actual treasury without reconnecting or
reopening again. It displayed CLOSED, twelve keys and 900,000 units held, with
the same 22 receipts. This accepts the live read path, not a new financial call;
intermittent wallet rate limiting remains unresolved.

Identity reads remain sequential and bounded. Only explicit rate limits receive
bounded read retries; generic failures, signatures, proofs and submission are not
automatically retried. Fifteen focused finality/read cases and the real encrypted
account regression cover configuration failure, wrong/disconnected networks,
changed accounts, settings isolation, deadlines and no unauthorized mutation.

Backup export reloads the latest durable record under the account lock without
wallet RPCs, rechecks session validity after encryption and retains pending
operations. Restore and financial operations still verify wallet identity.
Keep the original organization password and latest encrypted backup. Extension
unlocking and transaction approvals require the owner; no extension UI was
automated.

### Historical checkpoints and test limitation

| Profile | Checkpoint |
| --- | --- |
| Canonical accounting | `8990864c6f80c517c7458fa9b2526d3500f3a9814399fc836097ee409da9bed0`: 29 retained receipts, no token-payout claim |
| Test-token settlement | `a159597495b52ea7a703a29562b17fcb042bf7eaa984ec1e05e7e8935208304b`: complete 21-transaction run, Merchant A received 25 test units and Merchant B 20; reserve 200 → 155 |

[Historical payout evidence](https://github.com/ShrikarT/line/blob/bbb2fdf/docs/TEST_TOKEN_PAYOUT_2026-10-16.md)
is retained in Git history. A later partial recording has 26 confirmed calls;
Merchant A redeemed, while Merchant B's original draw returned node error 170 and
remains retained. It is not another complete acceptance run and no replacement
was submitted.

An earlier core run hit an unexpected checkpoint-write failure in the SDK-merge
journal test; later runs passed without a storage change. During the session-check
work, a core run alongside build/browser jobs hit a fixture-compilation timeout
and an `EPERM` rename in the unchanged approval signer. A fresh core run alone
passed all 668 cases with one skipped, including both previously failing tests.
No timeout or persistence rule was weakened; the underlying intermittent causes
are not claimed fixed. Temporary I/O tracing was removed. Browser fixtures and
compiled-contract tests do not replace fresh network receipts.

## Wave 3 — pilots and hardening

1. Preserve the finalized generation-2 opening and both encrypted recovery records.
   Use a fresh quote bound to this generation for the next purchase; older
   generation-1 quotes cannot establish acceptance of the reopened allowance.
2. Complete fee-bearing and remaining twelve-action/compensation acceptance with
   finalized receipts and actual asset movements. The next 100,000-unit purchase
   under the proposed policy would charge a 2,000-unit fee, totaling 102,000.
3. Operate independently funded merchants and durable automated suppliers. The
   free public wallet-only host does not provide supplier automation.
4. Complete the privacy redesign and test full-history inference before claiming
   private balances. Public amounts, receiving addresses, reserve changes and
   known-zero starting debt still leak history; see [Privacy](PRIVACY.md).
5. Validate a real API/compute purchase with a budget owner and supplier, including
   reconciliation and willingness to pay. No customer pilot or revenue is
   established. A supplier/customer and persistent supplier host remain external
   dependencies.

Preserve existing pending operations and original keys. Illustrated video scenes,
controlled browser fixtures and installed verifier keys are not live acceptance.
