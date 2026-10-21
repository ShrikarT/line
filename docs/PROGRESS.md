# Wave progress

Updated 21 October 2026. Line's current release is a Midnight Preprod prototype
for organization-funded agent purchases. Production credit, complete historical
privacy and independent commercial custody are not yet established.

## Wave 1 — foundation

- Five public circuits: `openLine`, `postQuote`, `draw`,
  `acknowledgeRepayment` and `setStatus`.
- Compiling Compact contract, generated execution and TypeScript reference model.
- Issuer, agent and merchant consoles, local checkout and MCP tools.
- Private spending-book witnesses, allowance checks and replay controls.

The five-circuit baseline is preserved in source history at `c02843c`. This
milestone established a local protocol prototype, not customer-funded settlement.

## Wave 2 — checkout and recovery

- Expanded to twelve circuits with merchant registration, claim redemption,
  reserve/fee withdrawals and expiry compensation.
- Merchant A/B separation, contract-instance domains, fee-bound quotes and
  single-redemption claims.
- Encrypted accounts, backups, retained transaction identities and interrupted
  operation recovery.
- Actual Preprod test-token settlement, with a complete checkpoint of 21 finalized
  transactions: 25 test units to Merchant A and 20 to Merchant B; reserve 200 → 155.
  The twelve verifier keys and payout outputs were independently checked.
- Wallet-first organization, agent and merchant workspaces; compatible injected
  Midnight wallet discovery, bounded connection waits and observed Lace connection.
- Public wallet-only application with authenticated Preprod HTTP/WebSocket readers.
- Facility onboarding can use the connected account's actual merchant role and
  receiving address, or an independent merchant's public profile. Selecting a
  profile requests no signature; contract deployment still needs wallet approval.
- Wallet connection and public workspaces no longer wait for contract engines.
  Local production measurements reduced initial resource bodies from 12.30 MB to
  0.34–0.36 MB, with no WASM request before vault opening. These are downloaded-byte
  measurements, not a guarantee of faster rendering on every device or network.

### Verified checkpoints

| Profile / check | Evidence and boundary |
| --- | --- |
| Canonical accounting | Facility `8990864c6f80c517c7458fa9b2526d3500f3a9814399fc836097ee409da9bed0`; retained checkpoint has 29 receipts, with no token-payout claim |
| Test-token settlement | Facility `a159597495b52ea7a703a29562b17fcb042bf7eaa984ec1e05e7e8935208304b`; complete 21-transaction two-merchant checkpoint |
| Organization wallet | Actual 1AM facility and twelve verifier keys; funding, allowance, quote, draw, redemption, replenishment, withdrawal, pause, resume and zero-outstanding closure confirmed. Twenty-two receipts in the workspace. Selected finalized receipts, fixed recipients and actual contract custody were checked through the configured indexer/RPC; fee-bearing acceptance and independent merchant fulfillment remain open |
| Regression checks | Full CI for recovery release `82f3d90`, read-serialization release `e37616b` and fee-control release `d521b7f`: all four jobs passed for each release. Original-submission recovery checks passed 664 core tests with one skipped, all 27 account browser cases, the further mobile retry/persistence case, the production build, key/secret scans and zero managed-binding drift |
| Public host | Free wallet-only server, source-matched proving files, signed reader sessions and actual historical Preprod reads verified |

[Finalized test-token evidence](https://github.com/ShrikarT/line/blob/bbb2fdf/docs/TEST_TOKEN_PAYOUT_2026-10-16.md)
and [CI run](https://github.com/ShrikarT/line/actions/runs/39426585810) retain the
underlying checks. Historical reports and presentation assets remain in Git
history or release downloads rather than the product source tree.

The later partial recording has 26 confirmed calls. Merchant A redeemed; Merchant
B's original draw returned node error 170 and remains retained for reconciliation.
It is not a second complete two-merchant acceptance run, and no replacement was
submitted. The accepted complete checkpoint remains the earlier 21-transaction run.

### Current priority — organization checkout

Fresh organization deployment, twelve-key setup, funding, allowance opening,
merchant quote, agent draw and merchant redemption are verified through 1AM.
Replenishment, unencumbered withdrawal, pause and resume are also verified. Continue
with independent merchant fulfillment and remaining recovery cases, checking
original transactions and asset movements against finalized receipts.
A closed wallet-extension channel now produces
refresh/reconnect guidance without publishing an unverified connected account.
1AM is the current working connection path. Its retired Preprod read URLs now
select Line's authenticated same-origin reader; the wallet retains proving,
signing and submission. Malformed URLs, credentials and different networks still
fail validation. A retired wallet submission-node URL no longer blocks selection
of working readers, because Line does not submit through that URL.

The next live 1AM attempt returned `Rate limited` during organization opening.
Line's queried service logs showed no HTTP 429 for that attempt; the browser
recorded a 1AM forwarding error. The exact failing wallet method is not yet
established. Identity probes now run sequentially and retry only explicit
rate-limit responses, at most three attempts inside the existing 25-second wait.
Timeout or session revocation prevents later probes. Network configuration from
the same verified identity read is reused during setup instead of requested twice.
Persistent limits identify the failing identity check; sign-in failures identify
the signature stage and never repeat the signing request automatically.

This handling passed 75 organization tests, 15 focused browser tests, the
deployment build and key/secret checks. An injected temporary wallet identity
limit recovered without a proof or transaction request. The subsequent actual
1AM session opened its vault and deployed facility
`ab428f74f8a8e72dc66a2f521c932d97860525d848a4d7a3acf0c795b3ef7e73`.
Deployment transaction
`35308f95c29cd7dd90560ef0d2e2f463298c5aa1b3a2069baed34732be05f257`
was confirmed at block 3,048,990. A separate read-only check matched the raw
transaction, successful contract action, identifiers and canonical finalized
block against the configured TLS indexer/RPC. Eight installed keys matched the
organization release before the vault session expired during setup. Reopening
the vault and reconciling the unsubmitted candidate allowed setup to resume to
ten confirmed keys. The wallet then reported an already-pending transaction;
the final two registrations subsequently confirmed after reopening the workspace
and retrying a failed read. All twelve installed keys match the organization
release. The final setup transaction
`2c3ee75877479103cc21f6fa21ee0b0e1bbc369058a37ab793a3546caf3628d9`
was independently checked at finalized block 3,049,250. The owner confirmed an
encrypted backup download before the first reserve deposit was requested.
The one-tNIGHT deposit then finalized at block 3,049,290 in transaction
`59d844efbf8767d63189bafea7a4b8fb865c5c0a6429bc14fcfe2742cb05437d`.
Independent checks verified the successful raw call, native-asset input and
1,000,000 base units held in the contract's native-asset balance, matching its
reserve accounting. Thirteen organization transactions are confirmed. These
checks use configured TLS indexer/RPC data, not independent full-node or local
proof verification; they do not establish merchant payout or cash settlement.

The first allowance attempt reached the wallet's balancing/signature step but
exceeded its 180-second wait. No Line submission was recorded. On 20 October,
the owner confirmed the old wallet request was cleared. Reopening the vault
revealed an unsubmitted candidate, which was reconciled through the existing
recovery control before preparing a replacement. After owner approvals, the
replacement `openLine` transaction
`48a13cca323df8a4d719a19c1e0963e7c322c549bde4ce75782b3438b517049c`
finalized at block 3,058,632. A separate raw-receipt/indexer/RPC check matched
the contract action and finalized block; current state is `OPEN`, all twelve
keys still match, and the contract retains 1,000,000 native-asset base units.
The encrypted workspace initially showed a 1,000,000-unit allowance, zero spending
balance and a seven-day expiry. The subsequent 100,000-unit quote, draw and
redemption finalized in order:

| Action | Transaction | Finalized block |
| --- | --- | --- |
| `postQuote` | `6ce7e7d3704c6abdc2cb9a74cb698e8f0a467a35ba75490752aeae7f47f4a2c2` | 3,058,680 |
| `draw` | `0e70cdc79ba75a9dace592736648d3e7a1ad9b270c7b3990e4422fb0a33a8246` | 3,058,719 |
| `redeemDraw` | `285f48f366885382b84d45cd071a056e005de0d17929b6d2b66b1e56347dbf97` | 3,058,809 |

Seventeen workspace transactions are confirmed. Separate raw-receipt/indexer/RPC
checks matched each checkout call and the redemption output: exactly 100,000
native-asset base units to the registered receiving wallet, with 900,000 still
held by the contract. Encumbered principal is zero and redeemed principal is
100,000; `totalReserve` remains the 1,000,000-unit accounting inflow, not the
remaining asset balance. The wallet balance also rose by 100,000. The first
redemption preparation was retained as unsubmitted after the workspace reopened;
the owner confirmed no pending wallet request before reconciliation and retry.
This checkout used the owner's registered merchant wallet. It establishes the
protocol payout path, not an independent commercial merchant or service fulfillment.

The owner then deposited 100,000 base units through `acknowledgeRepayment`,
restoring the private spending balance to zero and the full 1,000,000-unit
allowance. The finalized transaction contains the actual native-asset deposit;
contract custody rose to 1,000,000 while reserve accounting rose to 1,100,000.
A subsequent unencumbered withdrawal paid 100,000 units to the fixed issuer
recipient, leaving 900,000 in custody and 1,000,000 in reserve accounting.
Pause was finalized through `setStatus` (the protocol's `DEFAULTED` status),
without moving assets. Resume then finalized with status `OPEN`, custody unchanged
at 900,000 units, zero private spending balance and the full allowance restored.

| Operation | Finalized transaction | Block |
| --- | --- | --- |
| Replenishment | `6df1b8453e811030e65a8bca568882814a0ffcb4dcf0dd995634f5fe83d70aef` | 3,059,534 |
| Withdrawal | `92c149ea2a636a51dfa6afaebe5cc17d8f8902750e4e75576e8f83b574307cb0` | 3,059,575 |
| Pause | `cf4d26a71bef83e78217af23f3e88e54866a4331f31c56406f9e6d4322942ae1` | 3,059,617 |
| Resume | `08435fb970a6856c5d15270dfb299005924eef050040476a781279b3d48fad42` | 3,059,694 |
| Close zero-outstanding allowance | `19b6095be3bb7a3eb03865a514c87386e5c340b593529ecdc3d120c9b30a54fc` | 3,062,090 |

These read-only checks match finalized receipts and contract snapshots through
configured TLS indexer/RPC services; they are not independent full-node or local
proof verification. All twelve installed verifier keys still match the pinned
organization release. The owner is also the receiving merchant in this run.

The subsequent zero-outstanding closure finalized through `setStatus`. The
configured indexer/RPC receipt check matched the successful call and finalized
block, status CLOSED, unchanged 900,000-unit custody and 1,000,000 reserve
accounting. The live workspace showed the same status and twenty-two finalized
transactions. Reopening with a fee policy has been prepared but is not yet
accepted; no fee-bearing draw or fee withdrawal is claimed.

The owner approved a new `openLine` with a 1,000,000-unit allowance, seven-day
expiry, 1,000-unit flat fee and 100 basis points. The wallet submission
acknowledgement timed out; the signed identifier
`006c23221e7a0ebe76a1975d827166437f010f611e6a95bd38d6b0c5b55ab524e2`
remains retained in the encrypted pending operation. Checking that exact
transaction did not establish finality, and the separate configured indexer/RPC
lookup did not return a unique receipt. A subsequent read at 13:20 UTC returned
HTTP 200 without GraphQL errors and zero indexed records for that identifier.
Current contract state was still CLOSED, generation 1, fees 0/0 and 900,000 units
held; the workspace retained twenty-two receipts. Do not create a replacement allowance or discard
this candidate without reconciling its original transaction. Browser control
detached during the subsequent encrypted-backup download check; that download
is not confirmed saved.
Browser control subsequently recovered, and the app confirmed requesting the
encrypted backup download. Saving it remains owner-confirmed work. Further
funded acceptance is blocked on reconciling the retained transaction and the
owner reporting the wallet's pending/error state; no replacement is authorized
by an absent indexer record alone.

The recovery UI previously offered only observation after a signed submission
timeout. It now also offers an explicit, confirmed retry through the connected
wallet using the same signed bytes. The existing candidate, identifier and
recipient are retained; no new proof, balance request or payment candidate is
prepared. Fresh wallet/account locking remains required. Stale confirmations,
changed release/action metadata, noncanonical bytes and expired transactions are
rejected before submission. Rejection or another timeout keeps the original
operation for reconciliation. This is manual resubmission, not automatic retry
or permission to discard an unobserved transaction.

The controlled browser regression first reached the pending operation and failed
because no retry action existed. It now verifies that opening the confirmation
does not submit; rejection preserves the exact operation across vault reopening;
a stale review cannot submit; and a matching controlled receipt completes the
original durable operation without another proof or balance approval. Public
serialization checks cover deployment, maintenance and call bytes plus expiry
and metadata rejection. These checks do not establish a new Preprod receipt or
resolve the owner's pending allowance by themselves.

The initial full local run reported 662 passes, one skipped case and one
checkpoint-write failure in the existing SDK-merge journal test. The same case
then passed in isolation, and all nineteen tests in that file passed without a
storage change. Its underlying filesystem failure was not established; it is not
reported as fixed. The complete organization browser suite passed all twenty-seven
cases. A further 390px check reproduced pending-identifier overflow; allowing the
recovery panel to shrink and wrap fixed it, and the full retry/persistence case
then passed on mobile as well.

The subsequent complete core run passed 664 of 665 tests, with one skipped and
no failures. Temporary, local-only I/O tracing recorded the expected lease
conflict and the deliberately injected publication failure; it did not reproduce
the earlier unexpected failure. The trace was removed. The final production
build, key/secret scans and zero managed-binding drift checks passed. No Compact
source, verifier key, financial authorization or automatic retry policy changed.

Recovery release `82f3d90` is pushed to `main` and deployed on the free public
host. Its published network, workspace and recovery JavaScript match the tested
local build byte for byte; the public proving manifest is unchanged and
`/readyz` returns HTTP 200 in wallet-only mode. Its
[full CI run](https://github.com/ShrikarT/line/actions/runs/39483250056) passed all
four jobs: verification, native-worker ownership on Ubuntu and Windows, and the
Windows checkpoint ACL check. Chrome control subsequently recovered and the owner
reopened the existing organization. The recovery controls are present in the live
workspace, but its initial treasury read hit a wallet network-configuration rate
limit. A single cooldown refresh and original-transaction check then returned
`Request failed`. The owner subsequently reported submitting from the recovery
review; the observed workspace is checking the original transaction and still
shows twenty-two receipts. A successful resubmission or new finalized receipt
has not been established. The old signed allowance remains unresolved. CI and
browser fixtures do not establish its finality.

A fresh configured-provider read at 19:17 UTC on 20 October still returned no
indexed transaction for the retained identifier, with status CLOSED, generation
1, fees 0/0 and 900,000 units held. This is neither a new finalized receipt nor
permission to clear the original candidate.

The separate read-only verifier succeeded again at 02:51 UTC on 21 October. It
rechecked selected finalized receipts, their fixed payout recipients, all twelve
release-matched verifier keys and current CLOSED state with 900,000 base units
held. A direct lookup of the retained allowance identifier returned HTTP 200,
no GraphQL errors and zero records. These configured TLS provider checks do not
repair the wallet's failed API requests or establish that the allowance never
applied. They submitted no transaction and started no wallet.

Fresh organization receipts cover eight distinct call names: `fundReserve`,
`withdrawUnencumberedReserve`, `openLine`, `postQuote`, `draw`, `redeemDraw`,
`acknowledgeRepayment` and `setStatus`. Installed verifier keys are not call
acceptance. This facility has not yet established live acceptance for an
additional `registerMerchant` call, `disableMerchant`, `withdrawFees`, or the
`cancelOrExpireNote` cancellation/refund modes. Reopening a closed allowance
also remains outside this run. Those paths have automated protocol/recovery
coverage, which does not replace fresh wallet-approved receipt checks. The
network checkpoint used a zero-fee allowance. Optional fee controls and fee
withdrawal are now deployed; fee-bearing Preprod acceptance remains
separate from the verified zero-fee lifecycle.

The treasury now reads custody from `ContractState.balance`, avoiding a redundant
wallet-style output lookup that could report an empty or unrelated balance. It
shows assets held separately from reserve accounting, and failed reads remain
unavailable. The regression first reproduced the incorrect source, then checked
the actual SDK summary, empty custody, shielded-asset exclusion and zero extra
wallet-balance reads. All twenty account browser tests, 658 core tests (one
skipped), typecheck and the deployment build passed for this fix.

Organization allowance setup now supports an optional flat fee and a rate from
0 to 10,000 basis points, retaining zero-fee defaults. The SDK validates the
policy before account or wallet checks and forwards the selected terms to
`openLine`; it previously always supplied zeroes. The treasury reads pending and
finalized fees from the contract and offers issuer withdrawal only for finalized
fees, to the contract's fixed organization recipient. Failed reads and zero
finalized fees disable the control. No Compact source or proving key changed.

Direct quotes and hosted-service cards show merchant price, organization fee and
total allowance charge before purchase. Hosted orders retain the reviewed maximum
fee in encrypted records and backups. Fresh or resumed uncharged requests cannot
exceed that limit; legacy orders keep a zero ceiling. Existing authorized claims
can continue recovery without creating a replacement draw. These checks do not
establish independent supplier operation or a new fee-bearing network payout.
Generated Compact execution confirms upward rounding, pending-fee locking and
issuer-only, single fee withdrawal; controlled browser checks cover policy
forwarding, validation, previews and the saved fee ceiling. The ceiling is
rechecked inside the locked purchase boundary before a draw candidate can be
prepared. A regression reproduced the direct SDK bypass before that guard;
mobile layout checking also caught and corrected recipient-address overflow.
The full core suite passed 660 tests with one skipped; all twenty-five
organization browser cases, typecheck and the production build passed. Key/secret
scans passed and managed bindings have zero drift.

An oversized merchant reference exposed the encoder's `pad32 overflow` message.
The form now uses the same validation as invoice encoding: at most 32 UTF-8
bytes of text, or a complete 64-digit hexadecimal ID (optional `0x` prefix).
Invalid input gets an inline explanation and cannot start wallet preparation;
the SDK also rejects it before acquiring the account lock or reading the network.
Valid references retain their existing encoding; nothing is truncated or rehashed.
The regression first failed on the original form, then passed after the fix,
including Unicode boundaries, full hex IDs and zero proof/signature requests.
The full core suite passed with 658 tests and one skipped; the production build,
typecheck, key/secret scans, sixteen existing account browser cases and the new
invoice regression passed. One combined browser run hit its old 30-second cold
startup budget before connecting; the new case passed separately with the same
120-second startup budget used by the route checks.

Recovery also now reports when an unsubmitted request has been cleared. It
previously left the generic "Working" message visible after the candidate was
discarded. A browser regression reproduced that stale status, then verified the
completion message, enabled controls and durable clearance after locking and
reopening the vault, with no proof or signature request.

At the owner's request, organization vault sessions now last twelve hours rather
than fifteen minutes. The workspace states that duration; the password remains
in tab memory. A browser clock regression failed at minute 31 before the change,
then verified an unlocked session through hour 11:59, expiration after hour 12,
manual locking and disconnect locking. Account isolation and backup-lock guards
also passed. The default timeout for other consoles is unchanged.
The subsequent complete account browser suite passed all nineteen cases. Full CI
for the deployed `2fcdba2` release also completed successfully across all four jobs;
the prior invoice-validation release `84487b4` passed its full CI as well. The
published account and workspace modules matched the locally verified build.

Backup export also now replaces the generic working status with "Encrypted
backup download requested" after handing the encrypted file to the browser.
The message does not claim the owner saved it or that a transaction finalized.
The existing real-download/restore regression reproduced the stale status before
the fix; download, wallet-outage export and lock-during-encryption checks pass.
The complete twenty-case organization browser suite also passes.
The owner confirmed saving a fresh backup after the twenty-first transaction.

The subsequent live treasury check reached the owner's unlocked organization,
but 1AM rate limited its network-configuration probe; an explicit refresh then
returned "Request failed". The UI retained unavailable balances rather than
publishing zero custody. The final owner-tab display check remains unaccepted;
it requires a working wallet read channel. A separate read-only check at
2026-10-20 11:59 UTC still matched all selected receipts and twelve installed
keys, with status OPEN, 900,000 units held and 1,000,000 reserve accounting.
No financial request was retried. A later reload of the deployed app and fresh
1AM connection also returned "Failed to connect to 1AM: Request failed", before
vault opening or a contract read. The owner must restore the local wallet
connection before further funded acceptance; the extension cannot be operated
through the available browser control. The existing 21-transaction backup is
retained, and no replacement facility or payment was created.

After the owner restored the connection and reopened the organization, entering
the treasury still returned "Request failed". A controlled concurrency-sensitive
wallet reproduced that symptom: the treasury started its wallet-balance request
alongside the facility summary's identity probes. The treasury now sequences
those reads, including refreshes arriving before an earlier read settles. It
caches the balance map so editing an asset does not issue another wallet RPC.
Stale reads cannot publish results or start the next balance request; the balance
wait is bounded. Treasury mutations wait for reads to settle and for required
facility data, while explicit refresh remains available. Fresh wallet checks for
mutations are retained. This fixes the reproduced overlap.
All twenty-six organization browser cases, typecheck, the production build,
key/secret scans and zero managed-binding drift checks pass for this change.

The read-serialization release `e37616b` is deployed, and its published treasury
module matches the verified local build. After the owner reopened the existing
organization, the first read still hit an explicit 1AM configuration rate limit.
One later explicit refresh, without reconnecting or reopening the vault, recovered
both wallet balances and the facility summary. The actual owner tab displayed
900,000 native-asset base units held, status OPEN, twelve installed circuit keys,
1,000,000 reserve accounting and 100,000 principal paid. Its 21 finalized receipts
were unchanged; this check requested no proof, signature or transaction. The final
owner-tab custody display check is accepted. Intermittent wallet rate limiting
remains a limitation; this recovery does not establish that it is eliminated.

Encrypted backup export now uses the unlocked vault session and account lock
without depending on the wallet's remote API. It reloads the current durable
record, retains pending transaction identities and rejects session revocation
during encryption. Deployment, restore and financial operations still require
fresh wallet identity verification. Browser checks cover offline-wallet export,
blocked deployment during that outage, locking during encryption, and restoring
the downloaded backup into a fresh browser with a new vault password. No
financial approval or submission is automatically retried.

Receipt and recovery labels distinguish verifier registrations from financial
calls, so a `fundReserve` key insertion cannot be mistaken for an asset deposit.
The recovery changes passed the full local suite (656 passed, one skipped), all
14 existing account browser cases and the additional registration/call labeling
case. Deployment build, source/key drift and secret checks passed.

A failed treasury read could leave setup and funding controls unavailable: its
refresh button retried balances/catalog but omitted the facility summary. Refresh
now retries that read and clears its error on success; failed data is shown as
unavailable rather than indefinitely loading. A browser regression reproduced
the failure, then verified recovery without a proof, signature or new facility.
All sixteen account browser cases and the deployment build passed after this fix.
The fix is pushed to `main` in `1ee3c06` and deployed on the free public host;
the deployed treasury module matches the verified local build. The owner tab
also recovered its failed facility read through the repaired refresh control.

An isolated read-only restart check retained the same browser SDK client across
a backend restart. It reauthenticated after HTTP 401 and read the actual
organization's ten-key state before and after restart (1,446 ms and 318 ms).
It used a separate test signing identity and submitted no blockchain transaction;
it does not establish the cause of the earlier owner-tab timeout.

## Wave 3 — pilots and hardening

1. Extend organization acceptance beyond the verified same-owner checkout through
   independent merchant checkout, remaining status/recovery cases and
   interrupted-operation recovery. Replenishment, withdrawal, pause and resume have
   finalized same-owner acceptance evidence above.
   Confirm every step against finalized receipts and actual asset movements.
2. Operate independently funded merchants and durable automated suppliers. The
   current free host does not provide hosted supplier automation.
3. Redesign settlement disclosures and test full-history inference before claiming
   complete balance privacy. Transparent native-asset amounts remain public.
4. Validate one real API/compute purchasing task with a budget owner and supplier,
   including reconciliation and willingness to pay. No customer pilot or revenue
   is currently established.

Remaining checkout acceptance requires the owner's actual wallet approvals. Those
approvals cannot be replaced by illustrated video sequences or browser fixtures.
Preserve any existing pending operation and its original keys until reconciled.
