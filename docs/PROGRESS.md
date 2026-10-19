# Wave progress

Updated 19 October 2026. Line's current release is a Midnight Preprod prototype
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
| Organization wallet | Actual 1AM facility deployment confirmed at block 3,048,990; independent indexer/RPC receipt checks passed. Verifier registration is progressing; fresh reserve funding and the remaining lifecycle are not yet accepted |
| Regression checks | Full CI for `65cdaf1`: four jobs passed, core 647 passed/two Windows-only skips, separate Windows ACL checks passed, and 54 browser cases passed. Deployment build and secret/key checks passed; four focused browser checks also passed against the public deployment |
| Public host | Free wallet-only server, source-matched proving files, signed reader sessions and actual historical Preprod reads verified |

[Finalized test-token evidence](https://github.com/ShrikarT/line/blob/bbb2fdf/docs/TEST_TOKEN_PAYOUT_2026-10-16.md)
and [CI run](https://github.com/ShrikarT/line/actions/runs/39236743404) retain the
underlying checks. Historical reports and presentation assets remain in Git
history or release downloads rather than the product source tree.

The later partial recording has 26 confirmed calls. Merchant A redeemed; Merchant
B's original draw returned node error 170 and remains retained for reconciliation.
It is not a second complete two-merchant acceptance run, and no replacement was
submitted. The accepted complete checkpoint remains the earlier 21-transaction run.

### Current priority — organization funding

Complete verifier registration for the fresh organization facility and fund its
reserve with existing Preprod assets. Confirm the original transactions and
actual asset inputs against finalized receipts. This acceptance is not yet
complete. Wave 2 submission is finished; this acceptance remains the first
post-submission product task. A closed wallet-extension channel now produces
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
the last two registrations await wallet synchronization or resolution. The
reserve remains zero. This is not independent full-node
or local proof verification, and does not establish reserve funding.

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

## Wave 3 — pilots and hardening

1. Extend organization acceptance through allowance, independent merchant
   checkout, replenishment, withdrawal and interrupted-operation recovery.
   Confirm every step against finalized receipts and actual asset movements.
2. Operate independently funded merchants and durable automated suppliers. The
   current free host does not provide hosted supplier automation.
3. Redesign settlement disclosures and test full-history inference before claiming
   complete balance privacy. Transparent native-asset amounts remain public.
4. Validate one real API/compute purchasing task with a budget owner and supplier,
   including reconciliation and willingness to pay. No customer pilot or revenue
   is currently established.

Fresh funded acceptance requires the owner's actual wallet approvals. Those
approvals cannot be replaced by illustrated video sequences or browser fixtures.
Preserve any existing pending operation and its original keys until reconciled.
