# Wave progress

Updated 21 October 2026. Line is a Midnight Preprod prototype for
organization-funded agent purchases. Production credit, complete historical
privacy and independent commercial custody are not established.

## Current status

| Area | Verified state / limitation |
| --- | --- |
| Public application | [line-midnight.onrender.com](https://line-midnight.onrender.com/app), free wallet-only hosting; no hosted supplier signing wallet or automated supplier |
| Product release | `ad9aafd`, live Render deployment `dep-dbc3m5e1egvs739d2100` at 04:11 UTC on 21 October. Account JavaScript and public proving manifest match the tested local build byte for byte; readiness returns HTTP 200 |
| Local verification | Expired-opening recovery: 676 of 677 core tests passed, one skipped, zero failures; typecheck, production build, 37 proving-file export, key/secret scans and zero managed-binding drift passed |
| Browser verification | All 31 organization cases passed, plus a focused canonical-opening replay case. Coverage includes stale recovery reviews, wallet-network changes, IndexedDB aborts, encrypted history across every commit and backup/restore. These use synthetic candidates and controlled provider/receipt seams, not new network acceptance |
| Full CI | [Session-check release `ad9aafd`](https://github.com/ShrikarT/line/actions/runs/39542507712): all four jobs passed, including the complete browser suite |
| Actual organization | Twelve verifier keys and 22 finalized workspace receipts. Last independently checked state: CLOSED, generation 1, 900,000 native-asset base units held, 1,000,000 reserve accounting, zero encumbrance and fees |
| Active blocker | The original signed fee-bearing `openLine` is expired and remains unresolved. Retry validation rejected it before wallet submission. Its bytes and private candidate remain saved for reconciliation; new mutations stay blocked |
| Wallet / backup | Latest encrypted backup confirmed saved. The owner reopened the existing organization on `ad9aafd`. An initial session-status rate limit recovered after a single cooldown refresh: the live treasury shows CLOSED, all twelve keys and 900,000 units held. Intermittent wallet rate limits remain |

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
  manual locking, disconnect, account changes and reload revoke the session.
- Same-origin authenticated Preprod HTTP/WebSocket readers recover retired wallet
  endpoints while wallets retain proving, signing and submission.
- Treasury reads actual `ContractState.balance`, separately from reserve
  accounting. Summary and wallet-balance reads are serialized; failed reads stay
  unavailable, refresh retries them, and asset typing uses cached balances.
- Optional flat/proportional organization fees, upward-rounded charge previews,
  saved service fee ceilings and issuer withdrawal of finalized fees only.
- Invoice references validate 32 UTF-8 bytes or a full 64-digit hexadecimal ID
  before wallet preparation; valid encoding is unchanged.
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

Separate read-only checks matched selected raw transactions, contract actions,
identifiers, canonical finalized blocks and all twelve release-matched keys.
Redemption paid exactly 100,000 to the registered merchant recipient. Replenishment
contained an actual 100,000 deposit; withdrawal paid the fixed issuer recipient.
Closure retained 900,000 in custody and 1,000,000 in reserve accounting. These are
configured TLS indexer/RPC checks, not independent full-node or local proof
verification. The latest successful check was 03:18 UTC on 21 October; it
explicitly read generation 1, zero encumbrance, zero fee terms and zero fees.

Fresh receipts cover eight distinct call names: `fundReserve`,
`withdrawUnencumberedReserve`, `openLine`, `postQuote`, `draw`, `redeemDraw`,
`acknowledgeRepayment`, `setStatus`. Verifier registration is not circuit-call
acceptance. Additional `registerMerchant`, `disableMerchant`, `withdrawFees`,
all `cancelOrExpireNote` modes and closed-line reopening remain unaccepted in
this facility. Its confirmed allowance used zero fees; fee-bearing checkout and
fee withdrawal still need fresh wallet-approved receipts.

### Pending allowance and recovery

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
16:18:12 UTC). Its complete contract state still equals the independently
rechecked closure checkpoint: generation 1, CLOSED and maintenance counter 11.
Closure block hash is
`07e0ca54c514da92538ec7d29b3c1aa9db4f315d6a61bd0142379a20dafc9306`;
serialized state SHA-256 is
`b7ff374bea501e82b6fb2210b1e1fed115f1b3688402cb49b6e1ba2211066cdd`.
The observed runtime is `midnight` spec 1,000,300, using ledger 8.1.2.

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

1. Reconcile the expired original allowance before starting another mutation.
   The 1AM read path has recovered. Use exact finality or the narrowly scoped,
   owner-reviewed recovery after its local candidate check succeeds. Do not
   discard bytes based on expiry, a missing receipt or a latest CLOSED snapshot.
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
