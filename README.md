# Line

**A protocol prototype testing issuer-authorized agent purchasing. Private credit is the unproven destination.**

Line's intended product lets organizations delegate revolving purchasing capacity to agents, lets merchants independently verify authorization and own single-use claims, and reconciles purchases with service delivery and actual payment. The first customer hypothesis is enterprise API/data/compute procurement. It is unvalidated: no customer interviews, pilots or revenue are established by this repository.

The executable starting point is [`/checkout`](docs/PRODUCT_WALKTHROUGH.md): a deterministic agent buys document analysis and a processing estimate through compiler-generated Compact execution and local HTTP services. **This is a local evaluation, with no submitted ZK proofs, public-network finality or token payout.** Full fleet credit, historical confidentiality, funded settlement, independent custody, risk/default controls and durable recovery remain product requirements, with evidence gates in [the product direction](docs/PRODUCT_DIRECTION.md) and [roadmap](docs/ROADMAP.md).

## Try the procurement evaluation

Use **Node.js 22.18 or later** for native TypeScript stripping; the evaluated environment uses Node 26.7.0. A Compact compiler is needed to regenerate the contract, but the checked-in managed JavaScript supports the local evaluation.

```bash
git clone https://github.com/ShrikarT/line.git
cd line
npm ci
npm run dev
```

Open `http://localhost:5173/checkout`:

1. Open an evaluation line with the default **40-unit credit limit** and **200-unit accounting reserve**. No cash is deposited.
2. Run the purchase plan on a document. Merchant A's analysis costs **25 units** and succeeds. Merchant B's processing estimate costs **20 units** and declines because `25 + 20 > 40`, showing **"Clearance could not be proven."**
3. Use the issuer panel to acknowledge **25 evaluation units**. This changes credit capacity; it is not an incoming payment or reserve replenishment.
4. Keep the document unchanged and choose **Retry declined purchase**. A's fulfilled order/result is reused without another debit; B receives a fresh attempt and succeeds for 20. Both useful local results complete the task. The processing/token estimate is a disclosed heuristic, not a vendor bill.
5. Review claim references, service outcomes and public accounting. **Payout is not connected.**

The agent API capability cannot configure its limit, fund reserves or acknowledge repayment. Merchant secrets are distinct. All roles/private state still live in one evaluation server and the browser receives both issuer and agent tokens; independent production custody remains open. Sessions expire after 30 minutes. The default is volatile; optional encrypted checkpoints recover generated state and purchase stages after server restart. Browser reload still loses capabilities/IDs. [Configure checkout recovery](docs/CHECKOUT_DURABILITY_2026-10-10.md). Consoles separately journal candidates before execution and reconcile unknown outcomes against exact receipts/public state; [recovery evidence and limits](docs/OPERATION_RECOVERY_2026-10-10.md).

`npm run build` followed by `npm run preview` also serves the evaluation. A static deployment of `dist/` alone has **no checkout API**; Vite development/preview middleware supplies `/api/checkout`. See [the demo guide](docs/WAVE2_DEMO.md) for exact API and retry behavior.

## Product and economic boundaries

An organization is the liable borrower; its agent exercises bounded authority. A capital provider supplies liquidity and takes the documented risk. The protocol does not create capital, decide creditworthiness or collect debts automatically.

| Event | Evidence it provides | Separate requirement |
|---|---|---|
| Credit authorization | Authenticated transition satisfying private credit constraints | Underwriting, policy and responsible borrower |
| Reserve accounting | Capacity counters consistent with the declared invariant | Actual asset/cash custody and funding |
| Merchant claim redemption | Intended merchant consumed the note once | Delivery and actual payout |
| Asset payout | Finalized rail-specific payment receipt | Invoice/claim/recipient reconciliation and recovery |

The current Compact contract implements authorization and claim **accounting**. `fundReserve` increases a counter; `redeemDraw` moves accounting from encumbered to redeemed. Neither transfers tokens. Reserve units currently have no demonstrated cash backing, asset denomination or redeemable cash value. Issuer opening now fixes a public flat/basis-point schedule, quotes bind that schedule, and Compact enforces the exact rounded fee. Consoles disclose merchant price, fee and added debt before authorization. Fee accounting remains separate from actual collection or earned revenue. [Verified pricing and remaining economics work](docs/FEE_POLICY_2026-10-10.md).

The accounting invariant includes fees:

```text
encumberedReserve + redeemedReserve + feeReserve + pendingFeeReserve + refundReserve + reportedRefundReserve <= totalReserve
withdrawableReserve = totalReserve - encumberedReserve - redeemedReserve - feeReserve - pendingFeeReserve - refundReserve - reportedRefundReserve
draw: outstanding + amount + fee <= limit
```

Credit repayment restores capacity separately from reserve replenishment. Expiry uses supported ledger block-time comparisons and the merchant-authenticated quote deadline. Permissionless expiry retains the full claim cost while debt/refund allocation is unresolved; issuer or original agent can allocate note-bound debt relief, and the issuer can report the privately committed refund remainder against an exact stable payment reference. Reported refund backing remains locked: this records no actual payout, cash authenticity, or general dispute resolution. [Compensation evidence](docs/COMPENSATION_2026-10-10.md), [expiry evidence](docs/EXPIRY_2026-10-10.md).

Compact now rejects exact payment-reference reuse within one issuer/domain even after later purchases or reopening. Closing requires proof that the authentic current debt is zero; default/resume preserves the book and old merchant claims survive a clean reopening. This does not verify genuine cash or cross-facility payment allocations. Public closure reveals zero debt. [Verified changes and source-migration limits](docs/REPAYMENT_LIFECYCLE_2026-10-10.md).

## Privacy: private witnesses, observable history

Credit limit, outstanding debt and epoch are private witnesses, and the line commitment hides its opening. The current `LinePreimage` is `{domain, identity, limit, outstanding, epoch}`; the private credit-book commitment is bound to the constructor-derived `contractDomain`. Quotes, merchant notes and nullifiers are also domain-separated. This encoding change requires a fresh matching Compact compile and managed-artifact check; existing deployments/openings require an explicit migration plan. `contracts/line.compact` and its generated encoding are authoritative.

| Data | Current disclosure boundary |
|---|---|
| Limit and remaining capacity | Not plaintext public fields; accepted purchases reveal bounds |
| Outstanding debt | Private opening, but from zero initial debt public draws/fees reconstruct it before the first private repayment |
| Purchase amount and fees | Note amounts and reserve/fee deltas are public |
| Merchant pseudonym | Public registry and merchant lookups in public execution transcripts; quote-to-note activity can link it |
| Invoice contents, secrets and salts | Private inputs/off-chain records; require secure transport/storage and correct role handling |
| Identity/activity | Singleton line/identity state, timing and wallet metadata can link purchases |

The explorer must never print private credit books. That UI boundary does not establish confidentiality against a complete history observer. Public note amounts, reserve changes, registered merchant keys and transaction history reveal purchasing activity. Full credit-book privacy remains a release-blocking target that needs a proven ledger redesign plus transcript/history/metadata tests. [Privacy specification](docs/PRIVACY.md), [audit evidence](docs/FULL_AUDIT_2026-10-07.md).

## Why this product, alongside existing payments

Agent wallets already offer spending controls and paid service requests; x402 also documents escrow-funded vouchers with later batched claim/settlement. Line's proposed difference is confidential, independently verifiable revolving eligibility coupled to merchant claims and a complete reconciled purchase. Claims or deferred settlement alone are not unique. A centralized private-budget gateway is another baseline to evaluate. [Coinbase spending controls](https://docs.cdp.coinbase.com/agentic-wallet/mcp/mcp-tools/show-wallet-app), [paid APIs](https://docs.cdp.coinbase.com/agentic-wallet/cli/skills/pay-for-service), [x402 batch settlement](https://docs.x402.org/schemes/batch-settlement).

Compare actual information disclosure, integration effort, task reliability, settlement delay, capital exposure and total cost. Do not assume corporate cards publish credit books or competing wallets lack budgets. No x402 interoperability, superior economics or customer preference is established until implemented and measured. [Validation and alternatives](docs/PRODUCT_VALIDATION.md).

## Twelve Compact circuits

| Circuit | Authority | Current purpose |
|---|---|---|
| `registerMerchant` | Issuer | Add merchant public key |
| `disableMerchant` | Issuer | Block new quotes; existing quotes retain their current semantics |
| `fundReserve` | Issuer | Increase reserve accounting |
| `withdrawUnencumberedReserve` | Issuer | Decrease free accounting capacity within the invariant |
| `withdrawFees` | Issuer | Release fee accounting; no asset payout |
| `openLine` | Issuer | Establish one active agent line with a private limit |
| `postQuote` | Merchant | Authenticate and commit invoice terms |
| `draw` | Agent | Check books/quote/backing, rotate commitment and issue merchant note |
| `redeemDraw` | Intended merchant | Consume valid note once; move reserve accounting |
| `cancelOrExpireNote` | Action-dependent | Expire into held backing; issuer/original-agent compensation; issuer refund report |
| `acknowledgeRepayment` | Issuer | Rotate books after authorized repayment acknowledgment |
| `setStatus` | Issuer | Control status; closure proves the current debt is zero |

Compact is the source of truth. Canonical code is [contracts/line.compact](contracts/line.compact); generated bindings are [contracts/managed/line](contracts/managed/line). Preserve `persistentHash`/`persistentCommit` and supported encoding. [Protocol](docs/PROTOCOL.md), [encoding reference](docs/ENCODING.md).

## Runtime paths

| Path | Actual execution |
|---|---|
| `/checkout` and `server/checkout-engine.ts` | Compiler-generated Compact circuits via the harness, with local service results |
| `LocalDevelopmentRuntime` | TypeScript reference model in `src/lib/line/protocol.ts`, not generated Compact |
| `InMemoryTestRuntime` | Isolated reference-model runtime for tests |
| `MidnightNetworkRuntime` | Network integration code; working deploy/write lifecycle remains unconfirmed and audit-tracked |
| `/lab` and scripted demo | Development/reference-model fixtures and attack illustrations |

Existing `/issuer`, `/agent`, `/merchant`, `/explorer` and `/circuits` desks expose technical workflows. The shared store's role/session/recovery defects remain audit-tracked; choosing a page does not establish independent custody. The executable `/checkout` capability scopes are a separate evaluation path, not a claim that every legacy console defect is fixed.

## Development checks

```bash
npm run compact:compile
npm run compact:check
# CI also checks committed managed artifacts with git diff.
npm test
npm run test:checkout
npm run compact:test
npm run test:leakage
npm run typecheck
npm run check:keys
npm run check:secrets
npm run test:e2e
npm run build
```

`npm run compact:compile` skips proving-key generation; `npm run compact:compile:release` creates a fresh versioned release and validated pointer; `compact:release:validate` verifies it. Vite dev/preview serves validated assets at `/line-zk`; static hosting requires separate publication. Unit/integration tests include generated execution, reference-model, store/vault, network-adapter and HTTP checkout checks. Assess what each test proves rather than equating counts with complete correctness, formal verification or deployed behavior. Use current command output for release counts. Browser tests may require Playwright's browser installation.

The selected migration stack is Compact toolchain **0.31.1**, language **0.23**, runtime **0.16.0** and compiler ledger model **8.0.2**, paired with Midnight.js **4.1.1**, connector **4.0.1** and proof server **8.1.3**. Public environments use ledger major 8. Canonical regeneration, release integrity and local SDK construction checks passed; actual network proving/finality remains required. [The official compatibility matrix](https://docs.midnight.network/relnotes/support-matrix) identifies the supported stack and excludes the previous toolchain **0.34.0** / runtime **0.19.0** / ledger-9 combination.

Do not reuse older generated artifacts or the historical 0.34 proving-key size/constraint metrics for this release. Regenerate managed code, ZKIR and all twelve circuit proving/verifying keys together under the selected toolchain, then rerun encoding, lifecycle and network acceptance. Compiler success alone still does not establish deployment.

## MCP and network work

`npm run mcp` and `npm run mcp:dev` currently invoke the local JSON-RPC simulator in `mcp/line-mcp.mjs`. Its demo tools include fixture seeding and issuer operations, and its state file can contain plaintext development private data. It is **not** a production role-isolated agent payment server. Use it only as development evidence; the intended agent integration must expose bounded purchasing capabilities and exclude issuer repayment/funding/status tools. [MCP reference](docs/MCP.md).

Deployment/join/smoke scripts exist, but no confirmed public-network deployment or token payout is established here. The deployment script can attempt funded-wallet actions; **`npm run contract:deploy` is not a dry run**. Acceptance still requires compatible release assets, provider configuration, canonical role-key derivation, secure recoverable state and a confirmed receipt. Consult [the audit](docs/FULL_AUDIT_2026-10-07.md) alongside [deployment guidance](docs/DEPLOYMENT.md).

As announced on 9 October, Midnight-hosted Preprod RPC/indexer endpoints shut down from **03:30 IST on 10 October 2026**. Use the configured Blockfrost Preprod endpoints and a matching project token; Preview has unchanged public endpoints. CLI/browser defaults and token handling must agree before network use. [Official endpoints and migration notice](https://docs.midnight.network/relnotes/network).

## Product and engineering documents

- [Product direction and acceptance contract](docs/PRODUCT_DIRECTION.md)
- [Customer validation and alternatives](docs/PRODUCT_VALIDATION.md)
- [Complete product roadmap](docs/ROADMAP.md)
- [Executable walkthrough](docs/PRODUCT_WALKTHROUGH.md) and [Wave demonstration](docs/WAVE2_DEMO.md)
- [Pitch and evidence checklist](docs/PITCH.md)
- [Architecture](docs/PRODUCT_ARCHITECTURE.md), [protocol](docs/PROTOCOL.md), [privacy](docs/PRIVACY.md), [security](docs/SECURITY.md)
- [Full audit and reproductions](docs/FULL_AUDIT_2026-10-07.md), [engineering status](docs/ENGINEERING_STATUS.md)
- [Development](docs/DEVELOPMENT.md), [deployment](docs/DEPLOYMENT.md), [MCP](docs/MCP.md)

The [AKINDO Midnight wave](https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG) evaluates incremental evidence. Full requirements remain in scope beyond interim demonstrations: independent merchants/custody, durable checkout/recovery, correct repayment/refunds/expiry, history privacy, actual settlement, fleets/policies, risk/default economics, syndication/underwriting credentials and additional rails. No deadline substitutes for those acceptance gates.

## License

Apache-2.0. See [LICENSE](LICENSE). No independent external security audit or production certification is established by this README.
