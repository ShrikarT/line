# Line product roadmap

Updated: 10 October 2026. The complete product destination and requirements are defined in [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md); customer hypotheses and validation evidence are in [PRODUCT_VALIDATION.md](PRODUCT_VALIDATION.md). Milestones sequence evidence and dependencies. No product requirement is removed to meet a competition deadline.

## Current baseline, not shipping certification

The worktree contains twelve Compact circuits, generated managed artifacts, an executable generated-Compact local checkout, role consoles, an encrypted vault, network/runtime integrations and a development MCP simulator. See the current dated verification in [ENGINEERING_STATUS.md](ENGINEERING_STATUS.md). The [7 October audit](FULL_AUDIT_2026-10-07.md) is a historical snapshot and its test counts and gaps are not current status.

The checkout exercises deterministic local service responses and contract accounting. It submits no ZK proof, establishes no network finality, and transfers no asset. Public note amounts, reserve changes, registered merchant keys and transaction history remain observable. No customer, independent merchant, capital provider or production payout is established.

The twelve circuit names remain `registerMerchant`, `disableMerchant`, `fundReserve`, `withdrawUnencumberedReserve`, `withdrawFees`, `openLine`, `postQuote`, `draw`, `redeemDraw`, `cancelOrExpireNote`, `acknowledgeRepayment`, `setStatus`. Internal changes retain this boundary unless the project constraint changes explicitly. Compact and supported encodings are authoritative.

## Dependency order and pilot entry

A through F are capability workstreams, not a linear launch sequence. Start C's privacy/custody/terms feasibility work together with A's independent-role design and D's multi-borrower/fleet/concurrency design; a compiled private pool and its complete transaction views must be established before committing to the customer architecture. Run buyer/channel discovery and E's creditor/operating-model research in parallel. B's supported-network and payment-receipt integrations may use synthetic books and test assets while these gates remain open. C's final operational privacy acceptance depends on the implemented A/D pool, real proof/finality path and observed metadata; it is not completed before fleet construction merely because C appears first.

No workstream permits real customer credit, supplier reliance on a funded Line claim, live sensitive borrower books or production purchasing authority before the [funded-customer-pilot entry gate](PRODUCT_DIRECTION.md#entry-gate-for-a-real-funded-customer-pilot) passes. That gate requires independent key custody, required full-history privacy for the deployment's borrower/activity cohort, buyer-accepted bound terms, a tested proof/rail/receipt/recovery path, named accepted financing/custody/loss roles and PD-16/18 review. Real inflows must be authenticated before backing claims; actual customer receipts are then pilot exit evidence, not a fictitious pre-existing entry artifact. Test-asset integration and synthetic rehearsal are engineering work, not credit operation or validated customer demand. The project owner records each gate decision; external reviewer/party identities remain unknown until appointed and accepted.

## A — Complete independent-role procurement

**Outcome:** an organization agent completes a real buyer task using the service sequence that task actually needs, with durable delivery/claim reconciliation. Before the funded-customer entry gate passes, exercise this design with synthetic books and test assets or consented task rehearsal, without production credit authority or reliance on a funded Line claim. Independently test a second merchant on a distinct purchase when the observed task uses one supplier, so multi-merchant capability remains an acceptance requirement without inventing a workflow dependency. PD-01, PD-02, PD-06, PD-10, PD-13.

- Independent issuer, agent and merchant credentials/stores/capability scopes. Agent cannot seed a ledger, grant itself credit, acknowledge repayments or withdraw capital.
- Versioned authenticated quote/note transfers bound to merchant, invoice, domain and generation, with service/price/fee/units/expiry/compensation terms.
- Durable checkout/invoice/fulfillment/claim/payment identities. Retries and restarts produce one logical delivery and payment.
- Working navigation/onboarding, session lock, exact witness serialization, encrypted backup/restore and ambiguous-submission recovery.
- Accessible reconciliation views with authorized information and separate delivered/redeemed/paid statuses.

**Exit evidence:** observed task completed by its required independently operated service or services; a separate second-merchant transaction when needed to prove multi-merchant support; isolated-role checks; crash/retry/restore results; and service output linked to invoices. A local adapter supports development but does not close independent-merchant or funded-settlement requirements.

## B — Confirmed execution and funded settlement

**Outcome:** a supported Midnight proof/finality and asset-receipt integration, first verified with synthetic books and test assets. Real funded customer settlement begins only after the conjunctive entry gate above passes; PD-16 review alone does not authorize it. This workstream advances PD-03, PD-05, PD-15 and PD-16, and depends on the custody, privacy, bound-terms and recovery acceptance in A/C/D.

- Compatible pinned compiler/runtime/SDK/ledger/wallet/indexer/prover stack; complete release artifacts/keys and typed wallet/finalization integration.
- Deploy/join key/configuration validation, durable secret management, bounded cleanup and independently decoded confirmed state.
- Reserve denomination, asset/currency, custody, funding evidence, settlement authority and correct treatment of redeemed obligations.
- Supported actual deposit/payout rail, stable external payment identities and durable pending/failed/finalized records. Direct shielded settlement remains a destination; external rails disclose added operator trust.
- Reproducible release evidence and safe merchant reconciliation/settlement worker.
- Versioned upgrade authority, independent review, circuit-key rotation and migration that preserve old claims, liabilities, nullifiers and recovery data; define pause/rollback and notice on compromise (PD-18).
- Signed liability, custody, payout, repayment, reversal and loss-allocation terms with qualified launch-market review before any funded transaction.

**Exit evidence:** separate test-asset integration evidence from real funded-pilot evidence. The latter needs a compatible manifest, confirmed address/lifecycle, authenticated actual deposit/payout/repayment/reserve-replenishment receipts, exact units/recipient, no unfunded claim, no duplicate payment and recovery after interruption, with the funded-customer entry gate recorded as passed. Recheck [Midnight's matrix](https://docs.midnight.network/relnotes/support-matrix): public ledger 8 is incompatible with ledger-9 compiler/runtime combinations, including toolchain 0.34/runtime 0.19 with Midnight.js 4.1.1.

## C — Full privacy and safe revolving credit

**Outcome:** first establish a compiled privacy and independent-custody construction or an explicit incompatibility within the twelve exported circuits; then demonstrate required book confidentiality and reliable debt/claim lifecycle on the implemented multi-borrower/fleet deployment and actual proof/finality path. PD-04, PD-07, PD-08, PD-09, PD-12. Feasibility is early work; final privacy acceptance depends on A/D implementation and B integration.

- Resolve full-history inference from public amounts/deltas, singleton attribution, public merchant lookups, timing, wallet metadata and proof service access; field removal is insufficient.
- Supported private authorization/membership and aggregation where necessary, with explicit anonymity assumptions/residual disclosure and consented private reporting.
- Stable receipt deduplication independent of mutable credit commitments; defined partial allocation and reopen behavior.
- Supported expiry mechanism whose promised window cannot be shortened by unrelated traffic.
- Bound issuer pricing, non-delivery/cancellation/dispute compensation, default and debt-preserving lifecycle; repeated refund/repayment tests.
- Borrower accountability, exposure/risk policies and reconciliation. Draw freezing is one control, not underwriting or recovery.

**Exit evidence:** a construction-level privacy argument under an explicit observer/leakage/side-information model and negligible-advantage criterion, plus full transcript/history/metadata attack tests and a justified fail-closed borrower/activity threshold; finite tests alone do not prove privacy; unrelated traffic preserves intended validity; refunds/repayments/default/reopen retain exact debt and backing. Full-private or production-credit claims remain unavailable until evidence passes.

## D — Private fleets and policy operations

**Outcome:** concurrent independent agents use organization purchasing infrastructure with isolated books and controlled aggregate exposure. PD-11 and extensions of A–C.

- Fleet issuance/recovery, per-agent isolation, aggregate exposure/backing allocation, concurrency and durable sequencing.
- Policy packs for merchants/categories/time windows through supported changes within twelve circuits.
- Throughput, proving/finality/service latency, replenishment and reconciliation benchmarks under concurrency/failure.
- Delegation/revocation/key rotation, enterprise administration, authorized reporting and custody options.

**Exit evidence:** concurrent agents cannot impersonate one another, violate delegated allocations or overwrite openings; aggregate backing survives adversarial interleavings; performance/effort satisfy actual pilot requirements. Repeating singleton demos does not establish a shared fleet pool.

## E — Independent credit and institutional operation

**Outcome:** capital providers price, fund, monitor and recover defined credit exposure with informed buyer/merchant agreement.

- Syndication with contribution, authority, priority, loss allocation, withdrawal and default rules.
- Issuer-approved fee/interest accrual/collection, measured unit economics, borrower responsibility and recovery.
- Borrower-controlled portable underwriting evidence (PD-17): authenticated issuer/facility provenance, period completeness/freshness, anti-duplication/reset lineage, purpose-limited selective disclosure, consent, correction/dispute, future revocation and retention. Do not expose raw histories or mistake an agent score for borrower evidence.
- Institutional/multiparty custody, incident response, audit/recovery and independent security review.
- Safe protocol/policy upgrade governance and migration must be accepted before institutional operation (PD-18).

**Exit evidence:** commercial/operational responsibility, authentic funding/allocation, syndication/default/recovery tests, collected economics and reviewed risk/security. A history credential is not creditworthiness; counters are not income.

## F — Additional rails and interoperability

**Outcome:** service/payment integrations across supported ecosystems preserve authority, privacy and finality.

- SDK/merchant adapter, schemas, discovery and actual protocol handshakes. x402 compatibility requires its implemented payment requirements; a Line note alone does not establish it.
- Direct shielded assets and additional denominations with explicit custody/units.
- Cardano/EVM or other cross-chain rails remain in scope, with verified bridge/attestation/finality, domain/replay protection and failure/refund policy.
- Portable platform integrations retain ownership of private state, backup/recovery and selective disclosure.

**Exit evidence:** actual interoperable requests/payments; duplicate/reorg/timeout/wrong-domain checks; independently checked finality and disclosed bridge/operator trust. A UI link or note export is not cross-chain settlement.

## Adoption and releases across every milestone

PD-14 needs real buyer/merchant evidence. No customer contacts exist today. Compare three cohorts separately: production agent-platform operators buying for themselves, enterprise internal agent operators, and platforms integrating for a named customer-buyer. Keep treasury-only control interviews separately labeled. For each, validate protected information, recent transaction baseline, verifier need, contracting/budget owner, legal borrower, liquidity owner and failure. Review actual merchant integration/settlement acceptance. Record consented observations and objections, not invented traction. Validate pricing/channel and measure the same task against existing procurement, including wallets, private gateways, x402/MPP and invoice/batch-settlement paths. [PRODUCT_VALIDATION.md](PRODUCT_VALIDATION.md) defines the evidence collection; [x402 batch settlement](https://docs.x402.org/schemes/batch-settlement) is a concrete existing claim/settlement baseline.

Every release retains commit/version evidence, generated artifacts, meaningful functional/adversarial/recovery results, deployment/payment receipts for corresponding claims, measured latency/cost, disclosure boundaries and accessible walkthrough.

The [AKINDO Midnight wave](https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG) can evaluate incremental work. Dates do not waive requirements. Overall readiness requires actual evidence for the full product contract; open milestones stay open.
