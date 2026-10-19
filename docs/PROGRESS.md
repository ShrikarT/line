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

### Verified checkpoints

| Profile / check | Evidence and boundary |
| --- | --- |
| Canonical accounting | Facility `8990864c6f80c517c7458fa9b2526d3500f3a9814399fc836097ee409da9bed0`; retained checkpoint has 29 receipts, with no token-payout claim |
| Test-token settlement | Facility `a159597495b52ea7a703a29562b17fcb042bf7eaa984ec1e05e7e8935208304b`; complete 21-transaction two-merchant checkpoint |
| Organization wallet | Actual Lace connection and vault opening observed; deployment preparation reached wallet approval; fresh funded lifecycle not yet accepted |
| Regression checks | Local core: 643 passed/one skip. Full CI: four jobs and 49 browser cases passed; Linux core: 642 passed/two Windows-only skips, with the separate Windows ACL job passing |
| Public host | Free wallet-only server, source-matched proving files, signed reader sessions and actual historical Preprod reads verified |

[Finalized test-token evidence](https://github.com/ShrikarT/line/blob/bbb2fdf/docs/TEST_TOKEN_PAYOUT_2026-10-16.md)
and [CI run](https://github.com/ShrikarT/line/actions/runs/39221733238) retain the
underlying checks. Historical reports and presentation assets remain in Git
history or release downloads rather than the product source tree.

The later partial recording has 26 confirmed calls. Merchant A redeemed; Merchant
B's original draw returned node error 170 and remains retained for reconciliation.
It is not a second complete two-merchant acceptance run, and no replacement was
submitted. The accepted complete checkpoint remains the earlier 21-transaction run.

### Active final Wave 2 task

Deploy a fresh organization facility through Lace, register its verifier keys and
fund its reserve with existing Preprod assets. Confirm the original transactions
and actual asset inputs against finalized receipts. This acceptance is not yet
complete and is the next task after repository cleanup.

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
