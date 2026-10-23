# Wave progress

Updated 23 October 2026. Line is a Midnight Preprod prototype for
organization-funded agent purchases. Production credit, complete historical
privacy and independent commercial custody are not established.

## Current status

| Area | Verified state / limitation |
| --- | --- |
| Public application | [line-midnight.onrender.com](https://line-midnight.onrender.com/app), free wallet-only hosting; no hosted supplier signing wallet or automated supplier |
| Product release | `9d95475`, live Render deployment `dep-dbdmagvavr4c73aivb30` at 13:48:19 UTC on 23 October. Nine selected public JS chunks match the tested build by SHA-256; the session memory holder is unchanged. HTML selects the current entry with no-store; `/readyz` is ready in wallet-only mode. The authenticated quote reader returned matching pinned state/keys and correctly rejected early archival at finalized block 3,104,723 (13:49:12 UTC). Verification used and revoked a new unfunded HTTP identity, without accessing the owner journal or submitting a transaction |
| Local verification | Quote recovery and submission guards: 60 focused evidence/transaction/backup/finality/provider tests, 13 submission/replay/recovery browser cases, eight production-preview startup/refresh cases, typecheck, production build, 37-file proving export, production key/secret scans and zero managed-contract drift passed. All five archive cases exercise network-level backup restore, storage aborts, stale reviews, wallet changes and backwards checkpoints. The full core suite passed 713 tests with one skipped and zero failures. Fixtures are controlled tests, not live quote or propagation acceptance |
| Browser verification | 70 distinct organization, startup and wallet scenarios passed across the broad/focused runs, including duplicate-read, retained-cookie, missing-code and closed-original-tab cases. The broad run caught two missing backup-completion messages; those were corrected and their reruns passed. All eight final production-preview checks passed. Six further browser checks confirmed exact pending bytes, atomic recovery, backup/restore, outage export and lock protection; the startup checks also passed. Final UI/cache changes were verified after the full core run. CI now repeats these against built assets. Fixtures are controlled tests, not new network acceptance |
| Full CI | The [quote recovery/submission guard `9d95475`](https://github.com/ShrikarT/line/actions/runs/39964015926) passed all jobs; all local checks above passed. The [compensation recovery `1c0fd1c`](https://github.com/ShrikarT/line/actions/runs/39955741452) passed all jobs; the full local core suite and focused checks also passed. The [submission diagnostics `0439698`](https://github.com/ShrikarT/line/actions/runs/39950249356) passed all jobs. The [merchant-disable recovery `3051942`](https://github.com/ShrikarT/line/actions/runs/39938915159) passed all jobs; the local checks above also passed. The [claim-list correction `df43535`](https://github.com/ShrikarT/line/actions/runs/39917370912) passed all jobs; local checks above also passed. The [refresh correction `1efc8b4`](https://github.com/ShrikarT/line/actions/runs/39776737263), [startup follow-up `568c093`](https://github.com/ShrikarT/line/actions/runs/39780636985), [code-download correction `cb754a5`](https://github.com/ShrikarT/line/actions/runs/39784089985) and [second-opening recovery `702194d`](https://github.com/ShrikarT/line/actions/runs/39901700502) all passed. Recovery's 39 focused tests, five browser cases, two built-host tests, typecheck, build, proving export and key/secret checks also passed locally |
| Actual organization | Merchant 2's new quote/draw, disabling and subsequent redemption finalized at blocks 3,105,843 / 3,105,896 / 3,105,915 / 3,105,949. Its existing claim paid exactly 100,000 to its registered second wallet after disabling. OPEN generation 2; custody 1,698,000, reserve accounting 1,998,000, cumulative redeemed principal 300,000, finalized fees 2,000, zero principal encumbrance/pending fees. Merchant 2 is disabled. Its earlier expired claim remains compensated without payout. Latest workspace receipt count has not been reread |
| Remaining acceptance | All twelve distinct circuit names now have finalized call acceptance on this facility. Compensation modes 0 and 2, remaining negative-path checks, original submission diagnosis, independent suppliers/customer validation and full-history privacy remain outstanding. The owner confirmed archival of the expired Merchant 2 quote; all five original operations remain in encrypted recovery history. Its replacement quote/draw and redemption were separately owner-approved |
| Live testing | On 23 October the owner confirmed automatic wallet connection, a ready organization and an unlocked vault after refresh, then successfully reviewed and archived the newer opening. The displayed history records `006c2322...` at finalized block 3,092,740 and `00abb757...` at finalized block 3,099,704. These are encrypted local recovery records with provider-backed evidence, not finalized failure receipts or successful reopening acceptance |
| Wallet / backup | The owner confirmed automatic wallet connection, organization readiness and an unlocked vault after refresh on 23 October. After the fee-bearing cycle, the owner confirmed allowance 1,000,000, spending balance 102,000, remaining allowance 898,000, zero fees and assets held 1,798,000. A fresh encrypted backup was saved; only its existence was checked, without reading or decrypting it. Intermittent wallet rate limits remain possible; failed reads retain the memory session and never bypass live transaction guards |

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

Claim cards now show allowance generation, merchant payout, organization fee and
total allowance charge, with newer generations first. Local redemption records
are labeled as local; an unrecorded payout asks for a current Merchant workspace
check. Older valid claims remain exportable. This corrects the ambiguous list
that led the owner to select the already-redeemed generation-1 claim. Three
focused browser cases passed, including mobile ordering, exact old/new exports,
clipboard handoff and the existing spent-state guard. Eight production-preview
startup/refresh cases and two built-host tests also passed. Typecheck, production
build, 37-file proving export, key/secret scans and managed-contract drift checks
passed. These are controlled checks, not additional live financial acceptance.
The owner then checked the deployed app: the first saved claim shows generation 2,
100,000 payout, 2,000 fee, 102,000 total charge and a recorded redemption. This
confirms the live claim-list presentation; no additional transaction was requested.

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
| Additional funding 1,000,000 | `fe9ef402e5609b8787fa707b3f92b49e28290063974fc0265d4db67bbb456627` | 3,099,785 |
| Reopen with 1,000 flat fee + 100 bps | `5cceda1a3b762fd156a124d412e7b02db263fa4fed172f5f12e4fcf3aae74a65` | 3,099,871 |
| Fresh generation-2 quote | `0f51c305f7ea3da7f97c2b41845423cfce0b4fb3898d2cd33e50810f91595eb7` | 3,099,949 |
| Fee-bearing draw: 100,000 principal + 2,000 fee | `07cab8b6630d41753002e2a23b65556be44be2e97a559b44bfbaaefdd797b66b` | 3,100,335 |
| Redeem generation-2 claim: 100,000 payout | `1deb6fafdfd3486aadcac2b4c5c7f703bbf2906db70ed9660ff0f678c7718357` | 3,100,433 |
| Withdraw 2,000 finalized fees | `8fed9b055aa3725c4164ace297bc5bc40d3d539fe534140b7c4ce23ebf72b802` | 3,100,508 |
| Register Merchant 2 | `5d6f6f24bc8295ff64e0108afaa3c4f1cdab18a3bae35832a51cd6b0d43cce6d` | 3,101,980 |
| Merchant 2 quote: 100,000 principal + 2,000 fee | `4e84c89185ab29d3d1168c6a2d942b95b73ce7ce6bf7c07b9b52b8ee4056b751` | 3,102,136 |
| Merchant 2 draw: 100,000 principal + 2,000 fee | `7032da078691a74615eaf7efe9d8bf608627655c8fa3118c3df673fc7efca04c` | 3,102,203 |
| Merchant 2 expired-claim compensation, mode 1 | `e0d3a6728ebf74f2d3eb29869075aa70f2102e01ccda578d0bdbb963a8f387bb` | 3,104,191 |
| Merchant 2 fresh quote, invoice 03 | `ccc53f034c8367245ba245bef39c29cf6116e7f13684e1e95f09110f31479529` | 3,105,843 |
| Merchant 2 fresh draw: 100,000 + 2,000 fee | `fd5d32a81f0f00b18e9e7ed2ce629baf3d3ee3f88d8043cbb2acb38828b958ac` | 3,105,896 |
| Disable Merchant 2; existing claim preserved | `c9b48cef17196e5bf43a817ee1e7b2d88e229e46dfcea7ea610c0b349089964e` | 3,105,915 |
| Redeem existing Merchant 2 claim after disabling | `f1f950fa28d99fbfa9a70e2437e4c59650a3b3417cad60a765cb415bbac672ee` | 3,105,949 |

Separate read-only checks matched selected raw transactions, contract actions,
identifiers, canonical finalized blocks and all twelve release-matched keys.
Redemption paid exactly 100,000 to the registered merchant recipient. Replenishment
contained an actual 100,000 deposit; withdrawal paid the fixed issuer recipient.
Closure retained 900,000 in custody and 1,000,000 in reserve accounting. These are
configured TLS indexer/RPC checks, not independent full-node or local proof
verification. The 21 October closure check explicitly read generation 1, zero
encumbrance, zero fee terms and zero fees. A fresh read-only audit at 07:26 UTC on
23 October verified all 18 selected receipt rows and release keys, and read OPEN,
generation 2, custody 1,798,000, reserve accounting 1,998,000 and zero encumbrance
or fees. Selected rows are not the full workspace receipt count; intermediate
verifier installations are represented by their final registration checkpoint.
A later read-only audit at 15:57 UTC reverified all 26 selected rows and twelve
release-matched keys, including Merchant 2's accepted disable and subsequent
100,000-unit payout. It read custody 1,698,000 and finalized fees 2,000, started
no wallet and submitted no transaction.

Fresh receipts cover all twelve distinct call names: `registerMerchant`, `disableMerchant`, `fundReserve`,
`withdrawUnencumberedReserve`, `withdrawFees`, `openLine`, `postQuote`, `draw`, `redeemDraw`,
`acknowledgeRepayment`, `setStatus`, `cancelOrExpireNote` (mode 1 only). Verifier
registration is not circuit-call acceptance. Compensation modes 0 and 2 remain
unaccepted in this facility. All twelve call names do not imply all branches or
negative paths have live acceptance. Additional Merchant 2 registration finalized at block 3,101,980;
its canonical raw `registerMerchant`, aggregate SUCCESS and RPC-finalized block
were matched, with its supplied public key mapped to the exact second receiving
wallet. Merchant 2 uses another owner-controlled wallet; this is permission
acceptance, not independent supplier fulfillment. Its quote finalized at block
3,102,136. The supplied package's persistentHash commitment was recomputed from
its exact merchant, invoice, nonce, domain, generation, amount, deadline and fees,
and matched the unused quote at that finalized receipt. Its price is 100,000,
organization fee 2,000 and total allowance charge 102,000; expiry is
`2026-10-23T11:28:48Z`. The owner then authorized the purchase. Its canonical raw
`draw`, aggregate SUCCESS and RPC-finalized block 3,102,203 were matched. The
supplied note opening recomputes its exact persistentCommit commitment
`9d55f2375cd36e6684ebbc342fa1d9d1d00199b5d2ae5f40b4d6d11e515d23ef`.
The post-state consumes that quote, holds the unredeemed/uncancelled generation-2
note for 100,000 plus 2,000 fee, encumbers 100,000 and retains 2,000 pending fees.
Custody was unchanged. This established purchase authorization. The claim later
expired and was cancelled with compensation, without a Merchant 2 payout.

Closed-line reopening with fees was separately verified on 23 October: exact
canonical raw
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
zero encumbrance, pending fees and finalized fees. A separate canonical raw receipt
check identified the additional `fundReserve` at block 3,099,785: exact 1,000,000
native inflow, custody 1,900,000 and reserve accounting 2,000,000 while still CLOSED
at generation 1, before the fresh opening. This completes the fee-bearing
reopening/quote/draw/redemption/fee-withdrawal cycle on this facility. It does not
establish independent fulfillment, a customer pilot or full-history privacy.

### Archived Merchant 2 quote and subsequent accepted purchase

The owner approved another Merchant 2 quote with invoice
`line-merchant2-20261023-02`, price 100,000 and 120-minute validity. Its retained
signed identifier is
`0077dc714982d5af87aa9035d5fca6413f7de9367e890d74cfcb4d0644744dfd53`;
canonical transaction hash is
`7b791d81de16ec8c0be2b2ea3241e732a6b4ed9d9f49a7b7295c7f85041701ab`.
The public diagnostic's identity, action, facility and source release passed
canonical checks. DUST creation time is 13:08:54 UTC, its intent TTL 13:10:11 UTC,
and the contract intent TTL 14:07:39 UTC on 23 October. The 77-second fee window
is a confirmed constraint, not proof of the original propagation failure.
The quote commitment is
`3eaa15536ddac4b264da8b410976a7e8370fc64b3fae7c8c12657de5048154c6`.
Public transcript replay against the verified compensation predecessor inserts
exactly that unused generation-2 quote, expiring at Unix second 1792768054.

The exact identifier lookup returned no records. Read-only runtime application
simulation succeeded at historical blocks 3,104,321 and 3,104,323, then rejected
at block 3,104,486 with generic application error 182. Mempool admission still
reported valid at the latter block; the pinned node's soft validation cache is
keyed by transaction bytes and may return an earlier success. Thus pool admission
is not current execution or finality evidence. These were runtime overlays only;
no transaction was broadcast or canonical ledger state committed by the probes.
The original submission timing and wallet-node propagation remain unconfirmed.

A regression reproduced an unnecessary duplicate identity/network check between
wallet balancing and the SDK's immediate submission call. The duplicate RPCs
are removed while session revocation and the fresh submission guard remain.
A second regression reproduced initial forwarding of already-expired signed
bytes; the initial send now retains the bytes durably, then applies the same
expiry restriction as an explicit retry. Changed-wallet/network guards still
block submission. These correct app defects; live propagation repair is not
claimed before another owner-approved transaction is confirmed.

The exact quote has a separate guarded recovery using the compensation receipt
as its pinned predecessor. It cannot archive before finalized ledger time passes
14:08:10 UTC (19:38:10 IST), regardless of the earlier DUST TTL. It must still
verify complete state, release/history assumptions, quote absence, canonical
replay and the retained merchant candidate locally. The encrypted original and
unpromoted candidate remain preserved; no new quote is approved by archival.
The update is live as `9d95475`. Its authenticated production reader matched the
checkpoint and all release keys at finalized block 3,104,723, hash
`88ff105a0785da99b43c6c4151c585b87bb7f381bb8b235b0ef3b6e9b788b473`,
time 13:49:12 UTC. The local time gate rejected archival because the last signed
intent was still live. No owner candidate was decrypted, archived or replaced
by that release check. After the time gate, the owner confirmed: "Expired merchant
quote archived with provider-backed nonapplication evidence. No transaction was
submitted." The exact original and unpromoted candidate remain in encrypted
recovery history; this is not a finalized failure receipt.

The owner then separately approved invoice `line-merchant2-20261023-03`, price
100,000, fee 2,000 and deadline Unix second 1792777183. Its exact quote commitment
`6b790d33521c3984044d3374c0fb9cad67ee0b919238fbf81964ecefa329e195`
was installed at block 3,105,843 and consumed by the draw at block 3,105,896.
The resulting claim is
`098c3854fba45be6a58ad0a3ac0692759f0f1b2adf7a331ca983f45d102c1bfc`.
Merchant 2 was disabled at block 3,105,915 while that claim remained unredeemed
and uncancelled. The subsequent redemption finalized at block 3,105,949, hash
`b16676296d511d85c6466f7a4c0fa59bf95f6963bc57133b3ae9d857c4bec397`.
Canonical raw output pays exactly 100,000 native base units to Merchant 2's
registered receiving wallet ending `e826t0`, with the merchant key still disabled.
The owner independently confirmed receipt in that wallet. Custody is 1,698,000;
reserve accounting 1,998,000; cumulative principal paid 300,000; finalized fees
2,000; encumbrance and pending fees zero. This establishes redemption of an
existing claim after merchant disabling, using another same-owner wallet. It
does not establish independent supplier fulfillment. The latest product full CI
also passed. No transaction was submitted by receipt verification.

### Confirmed expired-claim compensation and retained recovery history

The owner requested recovery of the expired Merchant 2 claim. The wallet returned
`Operation failed: Transaction is temporarily banned`; Line retained its original
signed `cancelOrExpireNote` identifier
`00dd26b256427e8ad3dd29dc7054cf7447c697a383933ea8dd50c5a1aec73c3c27`.
An exact indexer lookup returned zero records without errors. The configured
read node reported 31 peers and no syncing, and its pool later returned zero
entries. That is not the wallet submission node's status or proof of nonapplication.
The [pinned upstream pool implementation](https://github.com/paritytech/polkadot-sdk/blob/2e4dd0bc22366a5af820492528869a493b5a5208/substrate/client/transaction-pool/src/graph/rotator.rs)
tracks temporary bans by extrinsic hash; the original rejection cause and wallet
node's ban duration remain unknown. No replacement was created or sent.

The owner exported the public submission diagnostics. Canonical identity,
action, facility and release checks passed; transaction hash is
`a387400959500081a5e5d685bc6010d75ac06f8b2935d1d613526ad7cc8e54d1`.
Its DUST intent TTL is 11:38:16 UTC and its contract-action TTL is 12:35:23 UTC on
23 October. Their difference does not establish the original pool-ban cause.
Read-only runtime validation at block 3,103,402 (11:37:06 UTC) returned valid;
a current check returned custom error 182, the pinned node's generic transaction
application error. The provider rejects `system_dryRun` as externally unsafe.
No transaction was broadcast by these checks. The exact public contract transcript
locally replays as mode-1 allocation of the intended 100,000 principal / 2,000 fee
claim. This is transcript binding, not proof or transaction acceptance.

At finalized block 3,104,009,
`e87a4aa22717f68161a6b48674565cc2439d7a7183f575c8dedf818d0656c866`,
time 12:37:48.001 UTC, the fixed provider reader and local evidence validator
confirmed the entire state still equals the trusted draw predecessor,
maintenance counter remains 11, and this claim remains unredeemed, uncancelled
and unallocated. This is past the latest signed TTL plus uncertainty. The exact
compensation recovery checks that evidence, canonical replay and the retained
private candidate before an owner-reviewed atomic archive. It retains the
unpromoted candidate and original bytes, creates no receipt and sends no
replacement. It also fixes backup restore dispatch for archived merchant disables,
which previously used the opening validator. The owner subsequently confirmed:
"Expired claim compensation archived with provider-backed nonapplication
evidence. No transaction was submitted." The
original bytes and unpromoted candidate remain in encrypted recovery history.
At finalized block 3,104,139 (12:50:48 UTC), a fresh read still found the claim
unredeemed, uncancelled and unallocated, with 100,000 encumbered principal and
2,000 pending fees. The owner then separately approved a fresh mode-1 recovery.
Its canonical signed identifier is
`007b0157cdafba0f1cccc4a24569efafe87bb73b2677a1e48595a1c01a51a95f27`.
Aggregate SUCCESS, canonical raw bytes/action/identifiers and finalized RPC block
3,104,191 were verified, with block hash
`874ecdaf81d73e5e03291eb28855f2993bbebc2259257a3521eb3938896741b8`.
Replaying this exact public action against the trusted draw predecessor produces
the entire receipt state byte-for-byte. The target claim is cancelled and
compensation allocated, with no cash refund owed; principal encumbrance, pending
fees, finalized fees and refund reserve are zero. Custody remains 1,798,000 and
reserve accounting 1,998,000. All twelve verifier keys match and maintenance
counter remains 11. This establishes this mode-1 compensation, not Merchant 2
redemption or other compensation modes. A 13:00 UTC read-only audit reverified
all 22 selected receipt rows and release keys, with zero encumbrance/fees and
1,798,000 held assets; it started no wallet and submitted zero transactions. The owner confirmed the private spending balance
is 102,000 with 898,000 remaining. The
original pool-ban cause remains unconfirmed.
The recovery is live as `1c0fd1c`. Its authenticated production endpoint returned
release-key-matched evidence at finalized block 3,104,109, hash
`1c0c12bda087955647dd0d0c5a14acb3dca545141286b883cc0b0c14b178a2b0`,
time 12:47:48.001 UTC, with both signed deadlines past and the complete predecessor
unchanged. The probe used and revoked an ephemeral unfunded HTTP sign-in; no
owner wallet, encrypted record, replacement transaction or chain mutation was used.

### Archived Merchant 2 disabling and expired claim

The owner's `disableMerchant` submission acknowledgement timed out. Its exact
retained identifier is
`0054af76ef4d913f967d607a266633d5fb6c7d6db18b79b4ddb7c6d9158649cce6`.
At finalized block 3,102,407 (`2026-10-23T09:57:36Z`), an exact identifier query
returned zero records without indexer errors; pinned node state still showed
Merchant 2 active and its 100,000 + 2,000 claim unredeemed. These configured
provider observations do not prove nonapplication or future impossibility.
The owner then explicitly retried the retained bytes; expiry validation rejected
them before wallet submission. They remain encrypted and blocked. No replacement
transaction or failure receipt has been created.

A separate recovery implementation now covers only that disable identifier,
facility, release and Merchant 2 key. Its predecessor is the canonical finalized
draw at block 3,102,203, hash
`13d5551f24549e40163593496d37607654db72581c321a5d23cbd2ea291892ce`,
with serialized public state SHA-256
`6a719b9fa4fd187e102f158c040d7c4b9586d02c2df31fe4fc8f72c561a87cf7`.
A fresh node/indexer read at finalized block 3,102,653 (`2026-10-23T10:22:12Z`)
matched that complete state, all twelve release keys and maintenance counter 11.
This is provider evidence only; the owner's original bytes/private candidate
still require local validation after the update. Active membership cannot return
after disabling under this release; details are in [architecture](ARCHITECTURE.md).
The implementation checks the exact canonical signed identifier/action/target,
replays the disabled key, permits only the retained disabled-flag candidate
change and requires finalized time past every TTL plus uncertainty. Archival
retains the original/predecessor/candidate/evidence atomically without promoting
the candidate, fabricating a receipt or submitting another transaction.

The missing review control was reproduced by a failing browser case. Six focused
browser cases now pass, covering real generated opening/disable replay, both old
archives, the new review and atomic mixed-history preservation. They reject
storage aborts, changed operations/wallets and a backwards checkpoint; backup
restore and later commits preserve all originals. Three ordinary resubmission and
expired-reconciliation browser cases also pass. Forty-nine focused transaction,
evidence, backup, finality, recovery, authenticated-read and server tests pass,
including rejection of a different actual disabled key. Typecheck, production
build, 37-file proving export, key/secret scans and managed-contract drift pass.
Eight production-preview startup/refresh cases and two built-host tests also pass.
These were controlled checks; the owner later confirmed the archive, and a
separately approved Merchant 2 disabling finalized at block 3,105,915 above.

The recovery update is live as `3051942`. A production request using an ephemeral,
unfunded signing identity returned 401 before authentication and 200 after it;
its finalized block 3,102,708 (`2026-10-23T10:27:42Z`) passed the same pinned-state
and release-key validator. That temporary HTTP session was logged out. No owner
vault or original candidate was accessed, no wallet was started and no chain
transaction was submitted. The owner subsequently reported successful local archival: original bytes and
candidate were retained with provider-backed nonapplication evidence and no
transaction was submitted. At that checkpoint no replacement disable had been requested; the later
separately approved disabling is recorded above. At pinned finalized block 3,103,348
(`2026-10-23T11:31:42Z`), Merchant 2 remained active and its claim remained
unredeemed/uncancelled. Its deadline had passed at `2026-10-23T11:28:48Z`.
That original claim did not establish redemption acceptance. The owner instead approved
expired-claim compensation for its 102,000-unit charge, now finalized above.
The cause of the recurring wallet submission acknowledgement timeouts remains
unresolved; this update does not claim to repair wallet submission.

### Archived expired openings

The owner completed local review and atomic archival of both expired fee-bearing
openings on 23 October. Encrypted recovery history retains the original canonical
signed bytes, predecessor, private candidate and nonapplication evidence:

| Original identifier | Owner-displayed finalized evidence block |
| --- | --- |
| `006c23221e7a0ebe76a1975d827166437f010f611e6a95bd38d6b0c5b55ab524e2` | 3,092,740 |
| `00abb757c332b831dd25c7640f417d50323639ede3361893571e361ec8eae44813` | 3,099,704 |

Both had timed out without observed finality. Retrying the retained bytes was
rejected before submission because their signed TTLs had expired. Neither expiry
nor missing receipts alone cleared the journal. The scoped recovery instead
checked canonical identity/action/target/release, replayed the actual opening
against the retained candidate and required complete serialized state equality
with the trusted closure checkpoint at block 3,062,090. Its block hash is
`07e0ca54c514da92538ec7d29b3c1aa9db4f315d6a61bd0142379a20dafc9306`;
state SHA-256 is
`b7ff374bea501e82b6fb2210b1e1fed115f1b3688402cb49b6e1ba2211066cdd`.
The unchanged generation, all twelve release-matched keys and nonsaturated
maintenance counter 11 exclude an intervening opening under the verified ledger
assumptions. Finalized time must exceed every signed intent TTL plus the node's
30-second uncertainty margin. See [architecture](ARCHITECTURE.md) for assumptions
and implementation references. These are configured TLS provider checks, not an
independent full-node or light-client proof.

Confirmation rereads durable state, provider evidence and wallet identity under
the account lock. One encrypted commit archives before unblocking, without
promoting either candidate or inventing a finalized failure receipt. Recovery is
limited to these two exact operations; a fresh opening still required separate
owner approval and subsequently finalized as listed above. The history remains
bounded, nonrecursive and validated through backup/restore.

Five recovery browser cases cover both identifiers, appending the second archive,
stale reviews, wallet changes, failed storage writes, later commits and encrypted
backup/restore. Thirty-nine focused transaction, evidence, backup, finality and
authenticated-provider tests passed. Separate expired-operation cases retain
exact bytes/candidates across backups, reject resubmission, keep missing/unrelated
receipts blocked and allow exact finalized success or total failure to reconcile
after expiry. These fixtures do not replace the owner's live candidate review or
network receipts.

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

1. Preserve the finalized generation-2 fee-bearing cycle, confirmed mode-1
   compensation, the later Merchant 2 payout/disable and all five encrypted recovery
   records in the latest backup.
2. Complete compensation modes 0 and 2 with finalized receipts and actual asset
   movements where applicable. Mode 1, Merchant 2 payout and disabling are confirmed.
   The current organization UI exposes mode 1 recovery and mode 2 refund payment;
   a separate mode 0 expiry action still needs an application entry point. The completed
   100,000-unit purchase charged a 2,000-unit fee, totaling 102,000 allowance units.
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
