# Line — full product, protocol, implementation and Wave 2 audit

**Audit date:** 7 October 2026. **Target:** AKINDO, Build Privacy-First Apps on Midnight, Wave 2.

> **10 October commitment-domain update:** `LinePreimage` now commits `contractDomain`; generated Compact, TypeScript encoding, console recovery, source provenance and snapshot version 4 were aligned. Full release artifacts were freshly regenerated and validated. Current verification is **462/462 tests across 60 suites**, **20/20 browser tests**, build/typecheck, zero managed drift, and clean fixture-key/secret scans. The findings and original results below preserve their historical inspection context; see [current engineering status](ENGINEERING_STATUS.md) and [product direction](PRODUCT_DIRECTION.md).

> **10 October issuer-pricing update:** Historical F18 is repaired locally: issuer opening fixes public flat/basis-point terms, quote v3 binds them, and Compact proves the exact rounded charge. Zero underpayment and overcharging reject. Imports authenticate current policy and quote commitment; recovery checks observed pricing as well as C. Issuer controls and buyer/merchant consoles expose the complete price before authorization. **404 tests / 58 suites**, **19 browser tests**, build, fresh generated comparison, validated full proving release and scanners pass. Pending/earned fees, compensation, cash collection, independent consent/custody, full-history privacy and live settlement remain open; PD-09 is only partly complete. [Pricing evidence and limitations](FEE_POLICY_2026-10-10.md). Historical findings below retain their dated evidence.

> **10 October expiry/navigation update:** Supported Compact ledger-time comparisons now govern all expiry; unrelated activity cannot expire an unexpired merchant claim. Notes must retain the merchant-authenticated quote deadline. V2 Unix-seconds packages/checkpoints reject old units; SDK/local/generated checks exercise real constraints and exact cutoffs. Consoles display UTC deadlines and confirmed claim status. A browser test exposed role navigation reloading away the session; internal history navigation now preserves it, including back/forward. **380 tests / 56 suites**, **18 browser tests**, build, fresh generated-output check, new full proving release and scanners pass. Live time/finality, compensation, pricing, actual settlement, independent custody and historical privacy remain open. [Current expiry evidence](EXPIRY_2026-10-10.md). Earlier sections retain their historical snapshots.

> **10 October repayment/lifecycle update:** Compact now blocks exact payment-reference replay within one issuer/domain across changed commitments, amounts/nonces, later draws and reopening. Closure requires the authentic zero-debt opening; default/resume preserves debt and clean reopening preserves merchant claims. Full-string reference adapters and journaled closing openings align. **359 tests / 54 suites**, **17 browser tests**, build, fresh managed-output drift and validated regenerated proving release pass. This advances historical F09 and PD-07/12; genuine cash/global allocations, independent custody, expiry/compensation/fee policy, historical confidentiality and live finality/payout remain open. [Current remediation evidence](REPAYMENT_LIFECYCLE_2026-10-10.md), [engineering status](ENGINEERING_STATUS.md). Older updates and findings below retain their dated evidence.

> **10 October recovery update:** The current worktree adds prewritten encrypted candidates for all twelve console operations, exclusive browser journal leases, submission-ID persistence before network dispatch and exact receipt/public-effect reconciliation. Configured checkout storage recovers actual generated Compact state and service stages after child-process death. Failed confirmation or legacy mirror publication no longer discards the recoverable opening; consumed quotes and acknowledged console references cannot execute again. **333 tests / 50 suites pass.** Live proving/finality, contract-level stable repayment replay prevention, independent role custody, portable backups, historical confidentiality and real settlement remain open. See [current engineering status](ENGINEERING_STATUS.md), [operation recovery evidence](OPERATION_RECOVERY_2026-10-10.md) and [checkout durability](CHECKOUT_DURABILITY_2026-10-10.md). Historical findings below remain the baseline, with remediation tracked separately.

> **9 October implementation update:** The historical findings/evidence below remain the baseline. Product-direction remediation now includes a generated-Compact `/checkout` flow with two actual deterministic local services, agent/issuer HTTP scopes, generic declines, issuer evaluation acknowledgement and retrying only declined purchases. Thirteen new tests cover role isolation, merchant theft/replay, concurrent idempotency, partial redemption/configuration and creation capacity. Current totals: **195 tests / 40 suites**, **5 browser tests**, passing build, compilation, managed-content drift and scanners. See [current engineering status](ENGINEERING_STATUS.md), [full product direction](PRODUCT_DIRECTION.md) and [walkthrough](PRODUCT_WALKTHROUGH.md). These changes do not close independent custody, actual network/payout, historical confidentiality, durable recovery or external customer evidence. The full product ambition remains in scope; competition deadlines do not waive acceptance requirements.

> **10 October remediation update:** Compiler/runtime migration, fresh full release validation, actual SDK binding/construction up to proving, connector-v4 adaptation, current endpoint configuration and wallet setup gating are implemented. **243 tests / 43 suites**, **6 browser tests**, build and fresh-output drift pass; npm audit reports zero known vulnerabilities after the source-map-js patch. The ledger9 mismatch is resolved locally. Network proving/submission/finality, history privacy, durable recovery and real settlement/customer evidence remain open. Findings below describe the historical audit; [current engineering status](ENGINEERING_STATUS.md) records remediation. All eighteen product requirements remain in scope.

> **10 October private-state update:** Vault timeout now revokes decrypted console state and blocks new privileged execution. Stale sessions/disposed providers cannot return credentials; typed encrypted openings survive actual browser reload, and aborted IndexedDB transactions reject saves while preserving the previous opening. Issued agent identity replacement is blocked with visible recovery guidance. **273 tests / 46 suites**, **12 browser tests**, build, fresh managed-output check and scanners pass. The old empty/wrong-database browser test now requires populated encrypted console records, and navigation rejects all page errors. These fixes address local portions of F10/F11 and improve F18 coverage; crash-durable journaling, backups, independent role custody and the full PD-10 acceptance remain open. [Detailed evidence and limitations](PRIVATE_STATE_SAFETY_2026-10-10.md).

> **10 October fee/compensation update:** The live worktree now has fee-bearing note commitments, pending-versus-earned fee accounting, permissionless expiry, exact-note private debt/refund allocation, full-cost backing retained for positive refunds and issuer refund reports bound to the same stable payment nullifier stored on that note. Refund report counters remain accounting only; they do not attest to external cash. **462 tests / 60 suites and 20 browser tests pass**, as do typecheck/build, generated drift, fresh release validation and production key/secret scans. Buyer/merchant cash authenticity, independent custody, supported live proofs/finality, full-history privacy, global/partial payment allocation and product-market evidence remain unresolved. Current details: [engineering status](ENGINEERING_STATUS.md), [compensation evidence](COMPENSATION_2026-10-10.md), [product direction](PRODUCT_DIRECTION.md). The findings below and earlier count blocks are dated 7 through 10 October snapshots, not current code status.

**Current direction verdict (updated 10 October):** Keep Line's complete destination; do not cut fleet support, independent capital, the required private credit book, or actual settlement for a Wave deadline. The repository contains a substantive local Compact implementation and adversarial tests, not a fully confidential or network-settled product. The leading product blocker is proving that unauthorized observers cannot infer $L$, $B$ or remaining capacity from complete histories while preserving the documented public note amounts, reserve deltas and transaction disclosures. Independent role custody, customer/economic model, verified asset settlement and launch-market review also remain open. The next work should reduce those product uncertainties and keep every capability claim tied to current evidence.

This is an engineering and product audit, not a certification that every possible vulnerability has been eliminated. No live transaction, token payout, or Preprod deployment was performed or confirmed in this audit. “P0” below means a blocker to the proposed submission promise; it does not imply an exploitable loss of real funds in this accounting prototype.

## 1. Exactly what was reviewed

The [9 October compatibility experiment](NETWORK_COMPATIBILITY_2026-10-09.md) additionally proves source-level migration feasibility: compiler 0.31.1/runtime 0.16.0 preserved all twelve circuits and twenty witnesses and passed 80 relevant contract, encoding and checkout tests in an isolated copy. It did not migrate the canonical project, submit a network proof or confirm deployment. Fresh metadata/proving artifacts and runtime-context updates are required.

This report preserves the 7 October source-level findings and evidence; the leading dated updates and current disposition below describe the later worktree. Do not read a historical finding descriptions and original severity labels as a claim about current code without checking its disposition.

- Local HEAD: `ab9d3d3a75dd4d8d2e6f298ca2effc03ce7e2947`.
- Fetched GitHub main: `eb3d53fbc67b0e0d0318eef7c5be7cfe8de0bb4a`. Its committed tree matched local HEAD at inspection; the extra commits were merges.
- Included local modifications to `package.json`, `package-lock.json`, and `scripts/contract-deploy.mjs`. Deployment observations explicitly distinguish that working script from committed code.
- Twelve circuits are now the authoritative requirement. Having twelve circuits is **not** an audit finding.
- Reviewed the Compact source, generated signatures/runtime behavior, encodings, TypeScript reference model, both runtime adapters, wallet integration, vault, Zustand store, transfer records, MCP server, pages/components, tests, CI, scripts, architecture/privacy/protocol and submission documentation.
- Ran the current test suite, build, compiler/drift check, browser suite, scanners, dependency audit, and eleven additional reproductions. Inspected the production preview and its simulator switch in a browser.
- Untracked wallet experiments were not executed. Existing wallet credentials, balances and recovery phrases were not used. A real wallet lifecycle, hosted demo, mobile layouts and a recorded pitch remain unverified.

Useful evidence: [reproduction script](audit-2026-10-07-repro.mjs), [machine-readable results](audit-2026-10-07-evidence/reproductions.json), and the command logs in [audit evidence](audit-2026-10-07-evidence/).

### Improvements already made since the first inspection

These should receive credit and should not reappear as unresolved findings:

| Earlier problem | Current result |
|---|---|
| Eight missing network witnesses | All twenty witnesses now supplied to the generated constructor |
| Private values still passed as obsolete public arguments | Public argument shapes corrected for open, quote, draw, redeem and repayment |
| Runtime lacked two exported circuits | `disableMerchant` and `withdrawFees` added to runtime interfaces/adapters/store |
| Store omitted fees from debt transitions | Fee forwarding and fee-inclusive balance update added |
| Missing explicit draw-note expiry | Required expiry validation and store forwarding added |
| Ten-circuit requirement conflicted with source | Updated requirement permits exactly the twelve existing circuits |
| Deployment/join/smoke scripts used old endpoints and incomplete witnesses | Committed scripts improved; local deployment script adds wallet-facade work. Browser runtime still has separate issues |

The new `tests/network-proof.test.ts` checks argument forwarding. It does not generate a cryptographic proof or complete SDK binding, despite its filename.

## 2. Verification results

| Check | Refreshed result | What this proves / does not prove |
|---|---|---|
| `npm test` | **182 passed, 38 suites, 0 failures, 0 skipped** | Good regression coverage within the tested models/mocks |
| `npm run compact:compile` | **Passed** | Generated contract is compilable with the configured compiler |
| `git diff --exit-code contracts/managed/` | **Passed, zero content drift** | Managed artifacts agree with source; Windows CRLF notices are not semantic drift |
| `npm run build` | **Passed** | TypeScript and Vite production build succeed; SDK integration still has `any` escape hatches |
| `npm run test:e2e` | **4 passed** | Pages render and current shallow browser assertions pass |
| `npm run check:keys` | **Passed, 38 production modules** | Fixture scanner’s selected frontend dependency graph is clean |
| `npm run check:secrets` | **Passed** | No banned patterns in its selected scope; not an exhaustive secret audit |
| Eleven audit reproductions | **All reproduced** | Specific remaining defects/design limits described below |
| `npm audit --json` | **One high advisory** | Transitive `source-map-js`; investigate tooling exposure and update lockfile |
| Preprod transaction / actual proof benchmark | **Not verified** | Do not infer this from simulator, key generation, or mock receipts |

The browser binary was initially absent; installing the official Playwright Chromium dependency allowed all four tests to run. One build attempt overlapped generated-file rewriting and saw a transient partial-file parse error; the sequential rebuild passed. This was audit execution interference, not a retained product finding.

## 3. Hackathon fit and submission readiness

**Historical event-page observations from 7 October are not verified current requirements.** At that inspection, the event widget appeared to list Engineering **40%**, QA **15%**, Product **15%**, UX **15%**, Communication **10%**, and Business Development **5%**, plus a compiling Compact contract and specified public repository/submission artifacts. The linked event page now exposes only its static shell in this review, so those weights, gate, artifact requirements and personal-submission rule must not be presented as confirmed Wave 2 rubric. The current official Midnight Buildathon schedule and AKINDO's general guidance are recorded in [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md); AKINDO's general guidance is not a substitute for the entrant dashboard.

The official [Midnight Buildathon schedule](https://midnight.network/hackathon/buildathon) currently lists Wave 2 build through **17 October 2026**, judging through **27 October**, and a **$4,000** pool. Treat 17 October as the internal freeze unless the authenticated entrant dashboard confirms otherwise; its exact timezone and submission state have not been verified. The 7 October widget/schedule discrepancy above is a dated observation, not a claim about the current page.

| Historical review lens (not a confirmed current rubric) | 7 October snapshot strength | Gap noted in 7 October review |
|---|---|---|
| Engineering | Real Compact, generated bindings, exact note accounting | Compatible target stack and one real SDK lifecycle |
| QA | 182 tests, negative contract tests, drift CI | Model/mocks dominate integration evidence; add production browser lifecycle |
| Product | Private eligibility plus merchant claims is a coherent use case | Define actual buyer, liquidity source, trust and payout boundary |
| UX | Consistent visual language and role-oriented pages | Navigation/state resets, one merchant key, confusing onboarding |
| Communication | Pitch outline and substantial documentation | Accurate claims, actual deck/video links, concise Wave 1→2 evidence |
| Business | Plausible agent procurement direction | Customer validation, measurable benefit, adoption path |

**7 October repository snapshot:** GitHub metadata then showed Apache-2.0 and the `midnightntwrk` topic, with an empty repository homepage. These metadata were not rechecked against the current GitHub UI in this pass. A 10 October local-tree scan found no slide deck or recorded video; that does not establish whether externally hosted artifacts exist. The current local `/checkout` is not evidence of a public deployment, and no public demo URL or live deployment has been verified.

There is no credible way to assign a winning probability or guarantee a win from repository inspection. The 7 October snapshot appeared to prioritize engineering and QA, but current Wave 2 scoring is unverified. Engineering and reliability remain strong product-evidence priorities because they make behavior reproducible and reviewable, not because a current scoring weight has been confirmed.

## 4. Product direction: what to keep and change

The current decision record is [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md); [PRODUCT_VALIDATION.md](PRODUCT_VALIDATION.md) holds the interview, competitor, pilot and economics gates. This section summarizes what the audit recommends retaining and changing. The [next decisions/build order](PRODUCT_DIRECTION.md#next-decisions-and-build-order) and [funded-customer entry gate](PRODUCT_DIRECTION.md#entry-gate-for-a-real-funded-customer-pilot) make those recommendations executable. A through F in the roadmap are dependent workstreams, not permission to fund a customer pilot before privacy, custody and terms pass. This section does not certify market or operational readiness.

### Keep the complete intended product; keep current capability claims narrow

Keep Line's full destination: private credit authorization across fleets, independent capital, merchant-bound claims, authentic repayment and asset settlement, auditable delivery/payment evidence, default/dispute handling, and safe recovery. These are not optional scope cuts for Wave 2. Keep the protocol primitives evidenced locally: Compact-enforced private-witness credit checks, issuer/merchant/agent role checks, one-time merchant-bound claims, replay rejection, reserve accounting, fee policy, ledger-time expiry, compensation and tested local recovery. These are meaningful Wave 1-to-2 engineering progress.

Change the product promise. The strategic bet is privacy-preserving organization credit and checkout for agent purchases from independent suppliers, with a named organization as borrower and separately identified capital/settlement roles. The customer is not selected: compare agent-platform operators buying for themselves, enterprise teams operating agents internally, and platforms integrating for a named customer-buyer. The enterprise-team hypothesis remains live. Select a lead segment only after real purchase, workflow owner, software budget owner, contracting buyer, liable borrower, existing control and route to adoption are evidenced. No buyer, merchant, lender or paid pilot evidence exists. Issuer-verifiable authorization is a protocol capability, not proven customer differentiation. Do not say companies can currently buy within a confidential allowance: public note amounts and reserve changes disclose use, and linked history reconstructs debt from the known-zero opening before repayment. The required privacy target remains hard; this incompatibility is a product/release blocker, not permission to dilute the target or describe UI redaction as privacy.

### Qualify the buyer and purchase from observed behavior

Do not privilege one buyer cohort yet. Apply the same evidence checklist in [PRODUCT_VALIDATION.md](PRODUCT_VALIDATION.md) to three cohorts: (A) a platform operator buying for its own workflow, (B) an enterprise team operating agents internally, and (C) a platform integrating for a named customer that is the buyer/borrower. For each, identify last purchase/attempt, workflow and software budget owners/budget line, contracting/liability roles, measured harm, incumbent comparison, payer/capital/settlement map and route to adoption. Keep outcomes separate, include counterexamples and choose the lead segment from comparative evidence rather than a small-sample vote. Compare high-volume low-value calls separately from larger API/compute invoices. Do not count generic procurement pain or future agent plans as product demand.

The first use case must reproduce a recent buyer task with a measured, decision-relevant cost, harm or unmet requirement; do not assume privacy is the purchase trigger before discovery. It may require one service or several; only claim a multi-step workflow when later services consume or materially depend on earlier results. The existing A/B demo runs two independent local services on the same input, so it is plumbing rehearsal, not observed workflow evidence. Its 25+20-unit path against a 40-unit limit includes a simulated issuer acknowledgment: call that an evaluation-credit transition, never a real repayment. Keep fleet and multi-supplier capability in the destination; let customer evidence select the first purchase and settlement profile.

### Resolve the cash-flow and evidence contract before calling it credit

The strategic destination is organization borrowing from independent capital with named settlement, but launch topology remains unselected until counterparties agree. Buyer-funded procurement control, external credit and supplier credit are separate experiments with different payers, borrowers/creditors and evidence. A buyer funding its own purchases tests policy control, not credit. Supplier credit requires the supplier to accept receivable and default/recourse terms. Keep all three models in scope and do not let a positive control experiment stand in for financing validation.

Write the full asset path for one purchase: funded custody balance; private authorization and reserve encumbrance; merchant redemption; separate actual payout; authenticated buyer repayment; debt acknowledgment; and independently verified reserve replenishment. The worked 100/25-unit example in [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md#first-pilot-economic-model-and-decision-gate) shows why `T` is cumulative inflow accounting, `redeemedReserve` consumes capacity, debt repayment does not increase `T`, and an actual incoming receipt must be mirrored separately. Compact counters establish no cash custody. Redemption is not payout, issuer refund reports are not cash receipts, and fees are not collected revenue. Require quote-bound compensation terms, verifiable merchant fulfillment receipts, rail/custodian payment receipts, stable idempotency identities, and explicit dispute/reversal rules, implemented with the existing twelve circuits and supported APIs.

### Make privacy a design gate, not a slogan

State the observer model separately for the borrower organization, issuer, agent, each merchant, unrelated merchants, public readers, relayer, prover and settlement operator. The target protects the borrower-level credit book and additional purchase attribution while allowing each merchant/buyer their own purchase knowledge and preserving public note amounts/fees and reserve deltas. The anonymity unit must be independently accountable borrower organizations, not agent leaves; low activity, known counterparties and transaction metadata can collapse it. Current public amounts/deltas and history do not meet that target. Keep present disclosure accurately documented and test complete public transcripts, state diffs, outcomes, timing and identity linkage. If the required hidden values cannot coexist with accepted disclosures and the twelve-circuit interface, leave privacy-dependent release blocked; do not relabel leakage as acceptable.

Fix role custody before claiming independent actors: `openLine` is issuer-authenticated but requires the agent secret witness. The issuer must not receive the agent's signing key. A proof host also sees the inputs it processes. A redacted explorer cannot prevent direct chain inspection.

### Compete on measured end-to-end value

Agent spending controls, paid-service APIs, delegated smart-wallet permissions, x402/MPP payment flows and x402 batch claims already provide budgets, payments and retry behavior. A prior Midnight hackathon report describes Latch, an AI-assistant wallet with private transaction limits, total budget, category and spend state, so private agent spending alone is not a defensible novelty claim. Line's plausible distinction is shared organization credit from independent capital across suppliers, with accepted claims and real settlement while keeping the wider book confidential; none of that commercial/privacy distinction is proven today. Compare alternatives with a private operator gateway and conventional billing under the same buyer workload; don't claim those alternatives lack controls or claim Line is unique because it has claims. If Line claims privacy-preserving independent verification as the differentiator, a budget owner must identify and price that specific need against the actual disclosure boundary. The initial buyer trigger may instead be another valued component, but validating a wedge does not validate the full destination or waive its privacy, custody, financing, settlement and risk requirements. The complete flow must meet a pre-agreed total-cost-per-successful-task improvement or an accepted priced premium for a measured buyer-valued benefit, including liquidity and settlement assurance as well as privacy/verification. Include proving/finality, fees, actual funding terms, integration, support, failures, refunds and disputes; attribute costs to the responsible party without counting the same funding or risk cost twice. Manual-intervention reduction is a secondary metric, not a substitute for economics. [Prior Midnight hackathon examples](https://midnight.network/blog/celebrating-seven-winners-from-mlh-x-midnight-july-hack).

Separate interview interest, sandbox design-partner agreement, funded pilot and paid adoption. Pilot readiness requires written acceptance from a buyer, independent supplier and named settlement/capital operator for liability, denomination, asset custody, claim evidence, payout/refund terms and loss allocation. Paid adoption requires a completed, paid or equivalently binding engagement. Do not turn compliments, test totals or willingness to discuss into traction.

### Present Wave 2 for the actual Buildathon

Midnight describes three connected waves for privacy-first projects and values visible progress and iteration; its official schedule gives Wave 2 build through **17 October 2026**. AKINDO's general guidance describes deployed, theme-aligned products and names public GitHub activity, demo quality and on-chain metrics. That is general guidance, not confirmed Wave-2-specific scoring; the event page's full rubric, artifact list, timezone and entrant state remain unverified. [Official Buildathon schedule](https://midnight.network/hackathon/buildathon), [AKINDO general guidance](https://akindo.io/), [event page](https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG).

Show the verified Wave 1 tag against the exact Wave 2 source/release: what became private witness inputs, what merchant claims/reserve/expiry/recovery now execute in generated Compact, and what remains unproved. Pair each statement with reproducible code/test or finalized on-chain evidence where it exists. A public deployment would support product review under AKINDO's general guidance, but no public deployment is verified here; the present checkout is local and has no confirmed network lifecycle. Label it accurately and do not fabricate a deployment or treat tests as on-chain metrics. Make the privacy conflict visible as the central research/design problem. Freeze the exact submission revision, validate the entrant dashboard's requirements, and publish only consented customer evidence. The full destination stays in scope beyond this Wave.
## 5. Priority findings and acceptance criteria

### F01 — P0: browser network binding still uses the wrong SDK contract object

**Evidence:** `src/lib/runtime/network.ts:569` constructs `new Contract(witnesses)`, then calls `findDeployedContract` with `{ contract, ... }`. Installed Midnight.js 4.1.1 destructures **`compiledContract`**, then passes it to `ContractExecutable.make`. The `as any` bypasses the real API type. R01 supplies read-only mock indexer responses and reaches the actual SDK, which fails reading a symbol on the undefined compiled contract.

**Impact:** Fixing the twenty witnesses and argument count was necessary, but does not make network writes operational.

**Fix:** Construct the SDK’s real `CompiledContract` with witnesses/assets, pass it as `compiledContract`, and remove the cast hiding the call configuration. Keep generated function signatures as the authority.

**Acceptance:** An integration test goes through actual `getBoundContract`, SDK execution and generated contract, without replacing `boundContract.callTx` with a success stub. Then demonstrate a confirmed target-network lifecycle with address, transaction IDs and decoded post-state.

### F02 — P0: toolchain and browser defaults do not match current Preprod

**Evidence:** `package.json` pins compiler 0.34.0/runtime 0.19.0/ledger 9.1.0.0-rc.3. The official matrix updated 6 October lists Preprod compiler **0.31.1**, runtime **0.16.0**, Midnight.js **4.1.1**, connector **4.0.1**, proof server **8.1.0**; the release overview lists ledger **8.1.2**. Compiler 0.35 release notes explicitly warn ledger 9 is not deployed on the public networks. `network.ts:181` still defaults to `midnight-testnet` and `testnet-02/api/v1` even though CLI scripts now use Preprod.

**Fix:** Select and document one supported stack end to end. For public Preprod, port/recompile against the verified compatibility matrix, regenerate bindings/keys together, and rerun encodings/contract tests. Alternatively label a ledger-9 local-network environment accurately. Do not merely install the newest compiler.

**Acceptance:** A version manifest covering compiler, runtime, ledger, SDK, wallet, indexer and proof server; working endpoints in both browser and CLI; one confirmed transaction. [Compatibility matrix](https://docs.midnight.network/relnotes/support-matrix), [release overview](https://docs.midnight.network/relnotes/overview), [compiler warning](https://docs.midnight.network/relnotes/compact/toolchain-0.35.0), [endpoints](https://docs.midnight.network/relnotes/network).

### F03 — P0: browser wallet is not adapted to Midnight.js provider interfaces

**Evidence:** `network.ts:getProviders` uses the connector object directly as `walletProvider` and `midnightProvider` unless it has custom nested providers. Installed connector 4.0.1 exposes methods such as `getShieldedAddresses`, `balanceUnsealedTransaction` and `submitTransaction`; SDK providers require `getCoinPublicKey`, `getEncryptionPublicKey`, `balanceTx` and `submitTx`. `wallet.ts` detects missing capabilities but intentionally does nothing in that branch.

**Impact:** A normal wallet connection is not evidence that proving/balancing/submission can work. An arbitrary empty object can also be marked connected in mocks.

**Fix/acceptance:** Implement a typed adapter with correct transaction serialization and key/address conversion, reject unsupported wallets, enforce network agreement, and test against the real connector shape. Check the browser build warning that `ws.WebSocket` is undefined; explicitly provide a browser-compatible WebSocket implementation if needed. Exercise a subscription/finalization path in the production build.

### F04 — P0 for deployment: working deployment script still has deterministic blockers

**Scope:** the locally modified `scripts/contract-deploy.mjs`, not just the older stub. The wallet-facade integration, `CompiledContract` construction, full-key checks and HTTP submission are real improvements.

**Remaining evidence:** the script passes **`privateStoragePassword`**, whereas the installed Level provider requires **`privateStoragePasswordProvider`** and throws if absent. Default issuer/merchant public keys use `persistentHash(Bytes32, seed)`, whereas the contract requires the tagged role-key derivations used in `encoding.ts`. Those default keys cannot be authenticated by the corresponding intended secrets. A randomly generated storage password is not persisted for restart/recovery. The manifest is logged but not checked against the target network’s compatibility requirements.

**Fix:** Use the correct password callback and durable secret management; require explicit role keys or derive them through the exact canonical encoding; validate hex length; fail incompatible artifacts before wallet sync. Add bounded sync timeouts and guaranteed cleanup on failure. Keep wallet experiments and any secret-print debugging out of the release path.

**Acceptance:** Run the deployment preparation without funded-wallet activity in a test harness, demonstrate all constructor keys authenticate in generated Compact, then obtain a real deployment receipt. Do not run these wallet experiments as an audit test.

### F05 — P0 for privacy claims: merchant identity is disclosed in public execution transcripts

**Evidence:** `line.compact:330` discloses `mPk` and queries the public merchant map; `line.compact:409` discloses the draw’s merchant witness for map membership. R03 inspects generated Compact `publicTranscript` and finds the exact merchant public key.

**Impact:** Removing `merchantPk` from `QuoteMeta` does not create merchant unlinkability. A public observer can link the quote’s execution to a merchant pseudonym, then quote consumption to a note. The singleton identity/line state provides further linkage. This does not reveal a secret key or necessarily a merchant’s legal identity, but contradicts counterparty-hiding claims.

**Fix:** Immediately correct website/README/security claims. For actual merchant anonymity, redesign the authorization proof around private membership against a public root or another supported construction, and examine the entire transcript. That is architectural work, not a field-removal patch.

**Acceptance:** Public-transcript tests for quote, draw and redemption, with an explicit observer model. [Midnight CallProofData documentation](https://docs.midnight.network/api-reference/compact-runtime/interfaces/CallProofData).

### F06 — P0 for “B always hidden”: public history reconstructs initial debt

**Evidence:** `openLine` starts debt at zero; each note amount and fee is public. Before the first private repayment, **B equals the sum of successful draw amounts plus fees**. R04 demonstrates an initial draw of 80 and publicly visible note amount 80. Cancellation does not reduce B.

**Boundary:** This does not reveal L exactly, and private repayments can make later exact B uncertain. Nevertheless, subsequent draws reveal increments and successful draws imply lower bounds on the limit. Single-line accounting supplies no multi-user anonymity set.

**Fix:** Say precisely that L/B are private witness fields and commitments hide their openings, while disclosed amounts and history leak information about utilization. If hiding B from a full-history observer is a hard requirement, the current public-note/single-line architecture does not meet it; design changes to amounts, state aggregation and linkage are necessary.

**Acceptance:** A privacy table covering direct fields, transaction transcripts, deltas, history, wallet metadata, counterparties and proof-provider visibility. Remove “100%,” “zero-leakage,” and “observers learn only clearance.”

### F07 — P1: action-count expiry can be accelerated to cancel merchant claims

**Evidence:** `line.compact:605` allows OPEN→OPEN and increments `actionClock`. A registered merchant can also advance it by posting quotes. R06 draws 80 with fee 5 and expiry 8, advances the clock through no-op status calls, cancels the expired note, then withdraws 495 reserve units.

**Impact:** Redemption windows depend on other participants’ transaction activity, not elapsed time. Issuer authorization does not excuse this if the advertised guarantee is protection against an issuer withdrawing a merchant’s backing. Transactions cost resources on a real network, but that does not provide a reliable duration guarantee.

**Fix:** Define the actual settlement-liveness assumption. Use only a time/slot validity mechanism supported and verified for the selected Compact version; do not invent APIs. Removing no-op clock increments alone is insufficient because other successful operations still advance the clock. Until redesigned, explicitly disclose this trusted-issuer/action-clock limitation.

**Acceptance:** An adversarial liveness test shows unrelated operations cannot prematurely invalidate the intended merchant redemption window.

### F08 — P1: cancelled notes leave debt and fees charged

**Evidence:** `cancelOrExpireNote` at line 540 decreases E but does not change line commitment/B or fee reserve. R06 proves the post-cancellation witness still opens with B=85 and F=5.

**Impact:** An expired, unredeemed payment can leave a borrower owing for a purchase that never settled. That may be an explicit policy, but is not an automatic refund mechanism.

**Fix/acceptance:** Define merchant non-delivery and cancellation policy. Implement an authorized, idempotent compensating credit/refund flow or require a documented issuer reconciliation step. Test cancellation, refund, repeated refund, and later repayment without double credit.

### F09 — P1: repayment deduplication is tied to mutable line state

**Evidence:** `repayNullifier` at line 202 includes current C. R05 reuses the exact receipt nonce, payment reference and amount on successive valid books; both acknowledgements succeed because C changes. One receipt for 20 can reduce debt by 40 if processed twice.

**Threat model:** The issuer must authorize both calls. This is an idempotency/reconciliation defect, not an unauthenticated agent attack.

**Fix:** Deduplicate a stable external payment identity within an explicit issuer/domain/line-generation namespace, independently of current C. Keep C as a transition precondition if needed, rather than using it to distinguish the same payment. Decide whether partial allocations need separate allocation identifiers.

**Acceptance:** Same external payment cannot be re-acknowledged after any intervening draw, repayment or reopen; distinct payments still succeed.

### F10 — P1: timeout locks the session but leaves usable decrypted credentials

**Evidence:** `vault.ts:291` schedules only `lockVaultSession`. Store secrets and `isVaultUnlocked` remain set. `doFundReserve` and other mutations read stored secrets without checking the live session. R10 locks that session and successfully funds one more unit through the store. `VaultPrivateStateProvider.getSigningKey` returns cached keys before checking lock (R07).

**Impact:** The advertised automatic lock does not revoke signing/operation capability. If the passphrase expires during an operation, later persistence is sometimes silently skipped.

**Fix:** Centralize lock state, clear all decrypted store/provider caches and gate every sensitive operation on a current session. Handle in-flight operations explicitly; do not abandon their recovery material after submission.

**Acceptance:** Fake-timer tests of the complete store/runtime/provider stack verify timeout blocks operations and cached key retrieval; explicit unlock restores authorized use.

### F11 — P1: private-state persistence cannot round-trip actual witness types

**Evidence:** JSON serialization in the encrypted provider does not encode bigint or revive Uint8Array. R07 shows bigint fails and bytes return as a plain object.

**Impact:** A generic `PrivateStateProvider<PS>` contract is not met for real Compact-style state. Encryption passing tests with simple JSON values is insufficient.

**Fix/acceptance:** Add a versioned, validated codec for bigint and bytes; test actual full private-state structures, missing/corrupt fields and migrations. Reject corrupt state visibly instead of proceeding with malformed witness data.

### F12 — P1: successful state transitions can lose their next commitment opening

**Evidence:** `store.ts:1001` writes updated line, notes and quotes after runtime success in separate async saves. Missing passphrase skips saves; import persistence at lines 1470/1536 swallows failures. Key re-import resets books/salt rather than recovering the latest opening. Provider export/import is unsupported.

**Impact:** A confirmed network draw followed by storage failure/reload can leave a valid public commitment without the private state needed for the next spend. Retrying can create ambiguity. This is an architectural failure scenario; a real on-chain crash was not exercised.

**Fix:** Encrypt and persist a pending transition plus next opening before submission, bind it to transaction/operation identity, reconcile confirmed state after restart, and atomically promote records. Provide encrypted backup and recovery of full private state, not only the secret key. Coordinate concurrent tabs/processes.

**Acceptance:** Fault injection at each save/submission boundary, refresh after confirmation, duplicate invocation and stale witness reconciliation all preserve recovery.

### F13 — P1: Merchant A/B in the production store are labels on the same key

**Evidence:** `store.ts:220` changes only `activeMerchant`. The single `merchantRecord` supplies `doQuote` at line 716 and `doRedeem` at line 1040. R09 posts A/B quotes and verifies identical merchant public keys. The issuer’s “Register Merchant B” action falls back to that same record; it does not provision an independent B identity.

**Impact:** The actual Compact contract supports distinct merchants, and its negative ownership tests are useful. The main UI does not demonstrate that separation. A fixture Attack Lab is separate from the production role flow.

**Fix/acceptance:** Store identities by role/merchant ID, bind registry and transfer records to those IDs, and demonstrate two independent browser profiles/processes. B must fail to redeem A’s note using B’s genuine key.

### F14 — P1: role separation and agent secret ownership are underspecified

**Evidence:** One browser vault holds issuer, merchant and agent records. `openLine` authenticates the issuer but also witnesses `agentSecret`; the main issuer repayment flow needs current agent books/openings. There is no independent synchronization/co-signing workflow for these parties.

**Impact:** Tabs labelled with roles are not security boundaries. “Sovereign/non-custodial agent” requires qualification if the issuer knows the spending secret. A legitimate enterprise operator may choose shared custody, but that is a different trust model.

**Fix/acceptance:** Choose and document whether the issuer also custodies agents. Otherwise redesign enrollment around a public agent identifier and authenticated commitment establishment, with an explicit private-state exchange/cooperative repayment protocol. Never suggest that distinct UI pages alone isolate secrets.

### F15 — P1: navigation resets runtime and the production simulator switch does not stick

**Evidence:** `shell.tsx` and home use ordinary anchors; `App.tsx` handles popstate but does not intercept navigation. Runtime and local ledger are module-memory objects. The shell sets a local runtime then reloads, and the factory defaults production back to network. This exact switch failure was observed in `npm run preview`.

**Impact:** A judge follows the normal role navigation and loses the active simulator session/unlocked state. Switching out of unconfigured production network mode fails. Encrypted records can survive while the local ledger/domain is fresh and inconsistent.

**Fix/acceptance:** Use client-side navigation and explicit durable runtime configuration; define simulator reset/restore behavior; load current public state on start/join. Test fund→open→navigate→quote→draw→redeem, including refresh, using the production build and separate role sessions.

### F16 — P1/P2: reserve views omit fees and can overstate spendable reserve

**Evidence:** `local.ts:69` and `:95`, network status conversion, home and join CLI subtract E+R but omit F. R08 constructs T=100,E=20,R=10,F=5: runtime shows 70 available instead of 65. Explorer can show fee reserve as zero because runtime data omits it.

**Impact:** The Compact withdrawal check includes fees, so this is misleading UI/API accounting and unexpected transaction failure, not proof that contract backing can be withdrawn directly.

**Fix/acceptance:** Use one canonical reserve projection including F on every surface; test nonzero fees, withdrawal and fee withdrawal. Preserve Uint64 exactly using bigint/decimal strings rather than unsafe `Number` conversions for network state.

### F17 — P2: line-state commitment is not domain-bound as documented

**Disposition, 10 October:** Fixed locally. `LinePreimage` now includes `contractDomain` in Compact and the TypeScript encoder, with generated cross-instance assertions. The current release was freshly regenerated and validated. Checkpoint schema is version 4; old source-bound openings/journals reject and have no migration path. The remainder below records the original reproduced finding.

**Evidence:** `LinePreimage` at line 56 contains I,L,B,epoch, with no domain or generation. R02 creates two different contract domains and gets the same C for identical books/salt. Architecture/privacy/status documents include domain in the formula.

**Boundary:** Quotes, notes and several nullifiers do include domain; this finding is not a demonstrated cross-contract note theft. Fresh salts reduce accidental equality, but do not make the documented commitment scheme correct.

**Fix/acceptance:** Bind domain and, if required by the lifecycle, generation in the canonical Compact preimage; regenerate encodings/vectors. Otherwise explicitly correct the design claim and test the narrower intended boundary.

### F18 — P1 for fee business model: the agent chooses the fee

**Evidence:** `draw` accepts public `fee` without a committed issuer policy/minimum or quote fee binding. R04 succeeds with zero. Recent store changes correctly add supplied fees to B, but that does not make the amount mandatory. A transfer package’s optional fee is also outside the quote commitment.

**Fix/acceptance:** Either explicitly specify optional fees and stop claiming protocol-enforced revenue, or commit/authenticate an issuer fee policy and enforce the calculation in Compact. Test zero, tampering, rounding and maximum values. A UI default is not enforcement.

### F19 — P1 for agent product: MCP remains a fixture-backed local demo

**Evidence:** `mcp/line-mcp.mjs` always imports the demo and fixture keys, exposes `line.seed`, executes the TypeScript model and writes full local state to `.line-mcp-state.json`. The `mcp` and `mcp:dev` commands do not create separate production security models. Default issuer tools and keys are available in the same server as agent tools.

**Impact:** An agent connected to this server can invoke issuer-side demo capabilities rather than face independent spending governance. This is a local demo boundary, not an unauthenticated remote internet exploit. The frontend fixture scanner does not establish that MCP is fixture-free or encrypted.

**Fix/acceptance:** Label this server demo-only. Implement an agent-only tool surface backed by the real runtime and encrypted state, with issuer/merchant tools in separate authorized processes. Use isolated temporary state in MCP tests rather than the default operator state file. Show an actual agent purchase and no ability to self-credit repayment.

### F20 — P2: TypeScript model and generated contract still diverge

**Evidence:** `protocol.ts:285` checks the truthiness of a merchant flag when registering. Disabled merchants have false flags and can be registered again. Compact checks map membership and rejects any existing key. R11 demonstrates the difference. The local runtime directly calls this TypeScript model; it does not execute the generated Compact contract as some docs claim. Its first issuer action also rebases the issuer key after genesis/domain construction.

**Fix/acceptance:** Use the generated simulator for the judge’s authoritative local execution or run differential lifecycle tests comparing both implementations, including disabled merchants, fees, cancellation, closing/reopening and boundary values. Name the reference model accurately.

### F21 — P2: test coverage currently permits false confidence

**Evidence:** the new witness test populates a context then checks those same entries; it does not invoke all generated witness functions. Network success tests inject `boundContract`, bypassing F01/F03. E2E privacy test opens **`line-secure-vault/vault_records`**, while the real vault is **`line_vault_db/encrypted_keys`**; absence is treated as success. It does not establish populated encrypted storage correctness. Browser error checks filter only “Buffer is not defined.” The model test exercises one seed/50 operations and four invariant groups, omits F from solvency, and does not prove all ten advertised invariants. CI does not run the browser suite.

**Fix/acceptance:** Use meaningful seeded private data, inspect the actual database, fail on unexpected page errors, cover production runtime selection, and test binding with the real SDK. Add state-machine tests with valid and invalid fee/cancel/disable/receipt transitions and transcript/history privacy tests. Wire the important checks into CI. Call simulation tests simulations.

### F22 — P2: transfer validation and errors need hardening

**Evidence:** `types.ts:350` validators check a few strings and `amount > 0`, but not all required fields, safe integers, nonce/commitment byte lengths, expiry, fee range or generation. A positive Infinity passes that numeric check in direct JS use. Import persistence errors are swallowed. Several draw preconditions throw detailed messages before the generic-failure catch; the latest missing-expiry test explicitly expects one of those messages.

**Impact:** Malformed packages can poison local state or cause crashes; the contract remains the final cryptographic boundary. Not every explanatory setup error is a privacy leak, but the external rejected-draw copy does not consistently meet the stated requirement.

**Fix/acceptance:** Validate a complete versioned schema, bound payload size, recompute commitments/context, surface persistence failure, and ensure external draw rejection is exactly “Clearance could not be proven.” Keep detailed diagnostics local and secret-free.

### F23 — P2: operational and dependency hardening remains

The dependency audit reports `source-map-js` before 1.2.2 as a high-severity indexed-source-map denial of service. This is not evidence of token theft or an exposed remote endpoint in Line. Update the affected lockfile dependency and retest the build. [Advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

The production build emits large WASM assets (about 10.14 MB plus two about 1.4 MB files) and a main JS asset about 0.76 MB uncompressed. Measure cold loading and proof asset download; lazy-load network/proving/lab code. Serve versioned full proving assets and verify their hashes: the current public directory does not supply the default network ZK assets. Ensure hosting rewrites do not return HTML for missing keys.

Do not rely on locally patched `node_modules` or untracked wallet experiments for a reproducible submission. The working tree contains scripts modifying wallet internals and debug scripts; they need a separate review before inclusion. Pin the supported dependency set and prove setup from a clean checkout. No clean-install wallet deployment was performed here.

## 6. All twelve circuits: assessment

| Circuit | Positive finding | Remaining concern |
|---|---|---|
| `registerMerchant` | Issuer authentication; duplicate membership check | TS model disabled-key divergence |
| `disableMerchant` | Issuer-only; preserves existing quote membership | Repeated calls advance expiry clock; no re-enable policy in Compact |
| `fundReserve` | Positive amount and authenticated counter update | No assets deposited; external backing is trusted |
| `withdrawUnencumberedReserve` | Checks E+R+F locked capacity | Expiry manipulation; views omit fees |
| `withdrawFees` | Authenticated F release and T decrement | No token payout; fee policy/revenue claim |
| `openLine` | Private limit witness; creates zero-debt commitment | Issuer needs agent secret; singleton state; no domain in C |
| `postQuote` | Merchant authentication; domain/generation/nonce binding | Merchant lookup is public; operational quote spam advances clock |
| `draw` | Agent authentication; current opening; capacity/reserve checks; single-use quote | Public amounts/history; optional fee; note-expiry policy |
| `redeemDraw` | Note opening and merchant key required; spent guard/nullifier | Action-clock liveness; redemption is bookkeeping |
| `cancelOrExpireNote` | Rejects unexpired/used notes; releases E | Debt/fees persist; permissionless after accelerated expiry |
| `acknowledgeRepayment` | Issuer-only; validates book/range and rotates C | Same external receipt can be credited repeatedly across C |
| `setStatus` | Issuer-only control over further lending | OPEN no-op clock; closing with debt then opening new generation needs explicit accounting policy |

Reserve bookkeeping is internally more developed than the product integration. With T total, E encumbered, R redeemed and F fees, the relevant locked-capacity invariant is **E+R+F ≤ T**. A draw adds A to E and f to F; redemption moves A from E to R; cancellation removes A from E; fee withdrawal decreases T and F; repayment decreases private B but does not replenish T. Those are meaningful rules, but cash-backing and cash-return assumptions must be explicit. Closed/defaulted lines retaining valid merchant claims is useful behavior and should be preserved deliberately.

## 7. Privacy and trust model that the submission should actually teach

| Party | What it knows / controls today |
|---|---|
| Public observer | Issuer/merchant pseudonyms, identity commitment, line/status timing, Q/D activity, public amounts, reserves/fees and their deltas; merchant keys in lookup transcript; initial debt inferable |
| Agent | Its secret, limit, debt, salts, quotes and outgoing notes; chooses current fee parameter |
| Merchant | Its secret, quote opening, incoming note opening and amount; can identify its own customer out of band |
| Issuer | Admin authority, accounting funding and repayment attestation; current enrollment/store design gives access to agent secret/books |
| Proof provider | Depends on deployment: HTTP proving is a trust boundary. A local prover and a third-party prover are different privacy models; document what private material crosses the boundary |
| Browser origin/operator | Decrypted role state while unlocked; all roles share custody in current main console |

Recommended immediate copy: **“Line uses Midnight Compact to verify purchases against a privately committed credit limit and outstanding balance. This prototype publicly reveals claim amounts, reserve changes and merchant pseudonyms; transaction history can reveal utilization. Settlement is accounting-only until a payout integration is confirmed.”**

This narrower statement does not fix the architecture, but makes the demonstration truthful. If the desired product needs full counterparty anonymity or continuously hidden B, explicitly make that a subsequent design milestone and evaluate supported shielded/aggregated constructions before promising it.

## 8. UX and presentation audit

The production desktop preview has a consistent dark palette, readable main headline and a clear role vocabulary. Keep that foundation. The largest UX problems are behavioral and explanatory.

1. **Make one judge path obvious:** primary action “Run the purchase demo,” secondary “Inspect the contract.” Four equally prominent desks require judges to understand internal roles before seeing value.
2. **Show honest execution state:** distinguish reference-model execution, generated Compact simulation, proof generation, submission, confirmation and payout. Do not label a local state transition a proven network transaction.
3. **Remove decorative evidence:** the green verification snippet, `<80ms`, “100%” privacy and “instant fraud elimination” are not supported. Benchmark real proving separately from local evaluation and report hardware, cold/warm timings and sample count.
4. **Repair setup:** explain first-time vault creation, role selection, required identity and next action. Disable mutations with clear prerequisite text. A blank network state is not a live verified ledger. Initialize/refresh store status on startup and contract join.
5. **Use actual separate merchants:** display the active merchant public-key fingerprint and correct note ownership/status. Show redeemed/cancelled/expired status instead of permanently “Active.”
6. **Replace hardcoded transaction buttons:** keep presets as demo shortcuts but allow validated amounts, quote expiry and merchant identity input. Expose the two new admin operations coherently if they are part of the product.
7. **Reduce repetition:** issuer page renders duplicate public-ledger panels; the homepage reads more like a protocol manual than a purchase outcome. Move detailed internals to an inspection view.
8. **Accessibility follow-up:** give the vault/contract inputs persistent accessible labels, announce errors, preserve focus and keyboard navigation, and test 390px viewport/contrast. Desktop inspection is not an accessibility or mobile certification.

The refreshed home still says “10 Compact Circuits” in its pipeline while other sections say twelve, and some formulas omit fees. Engineering status still claims 123 tests and a domain-bound C. Progress docs reference absent `contracts/v1/` files and stale branch/completion state. Synchronize these from one current truth table.

## 9. Practical plan to the Wave 2 freeze

These are effort estimates, not guarantees. Prioritize dependencies in this order; do not try to build a general credit marketplace before the deadline.

| Window | Work | Exit condition |
|---|---|---|
| Oct 7–8 | Correct privacy/settlement claims; freeze target stack; repair compiled-contract/provider setup | Clean build/compile plus real generated-contract binding test; truthful mode labels |
| Oct 9–10 | Fix role identities, navigation/runtime persistence, vault timeout and private-state codec | Two merchants remain separate through navigation; expiry locks all credentials; state round-trips |
| Oct 11–12 | Fix receipt idempotency, recovery journal and fee/reserve projections; define expiry/cancellation limitation | Adversarial cases covered; no silent lost opening; invariant includes F |
| Oct 13–14 | End-to-end integration and actual agent purchase | Independent merchant receives/verifies note and returns a service result; network evidence if claiming network mode |
| Oct 15–16 | Customer evidence, deck/video, fresh-clone judge walkthrough and production E2E | Submission links tested anonymously, reproducible setup, factual Wave delta |
| Oct 17 | Internal submission freeze | Tag final commit, record exact artifacts, submit personally after verifying AKINDO deadline |

If network deployment cannot be made reliable, submit a clearly labelled **generated-Compact local prototype** with reproducible evidence and honest remaining milestones. A compile gate is not a requirement to fabricate Preprod receipts. Full network functionality would strengthen the submission; deceptive or nonworking network claims would weaken it.

Defer pooled multi-agent credit, underwriting marketplace, mainnet, yield, token issuance, complex fee markets and a broad redesign until the narrower flow is verified. Full historical utilization privacy may require substantial protocol work; a rushed hidden-field patch will not establish it.

## 10. Concrete demo and pitch changes

### Three-minute demo, after the blockers are addressed

| Time | Show | Evidence |
|---|---|---|
| 0:00–0:20 | Company agent needs two API services; spending limit is confidential | Concrete task and audience |
| 0:20–0:45 | Issuer opens a line and allocates accounting capacity | Public vs private fields; execution mode plainly visible |
| 0:45–1:15 | Real agent gets A’s quote and draws; merchant returns service response | Generated contract/network result and application output |
| 1:15–1:40 | B fails to claim A’s note; A succeeds; replay fails | Distinct public-key fingerprints and receipts |
| 1:40–2:05 | Purchase beyond capacity fails with generic message | No fabricated proof or hidden precomputed success |
| 2:05–2:30 | Issuer acknowledges one repayment; repeated receipt fails; agent retries | Idempotency and revolving behavior |
| 2:30–2:50 | Public observer view with explicit leakage explanation | Actual fields/transcript, not just a redacted UI |
| 2:50–3:00 | Wave 2 delta and next pilot | Commit tag, measured tests and specific next milestone |

Keep a recorded fallback for prover/network latency, labelled with its run date and environment. Do not claim an edited video proves an unrehearsed production flow.

### Suggested six-slide deck

1. **Buyer and pain:** one operator, one agent purchase, one confidential policy.
2. **Why the merchant can trust clearance:** quote → proof → claim → redemption, with trust boundary.
3. **What is private and what is public:** truthful disclosure table, including history leakage.
4. **Working implementation:** twelve circuits, generated execution, tests, measured latency and deployment evidence if available.
5. **Wave 1 → Wave 2:** specific new merchant claims/reserve/replay functionality, linked commits and tests. Audit findings and fixes are useful progress evidence.
6. **Adoption:** target pilot, integration effort, pricing hypothesis, remaining technical milestones.

Avoid saying corporate cards universally publish balance sheets, that x402 lacks all spend controls, that simulation is a proof, or that reserve counters guarantee real cash. Explain the narrower advantage clearly.

## 11. Release acceptance checklist

- [ ] Actual SDK binding and browser wallet adapter work on the selected compatible stack.
- [ ] Full proving assets match the deployed contract and resolve from hosting; no HTML fallback for missing keys.
- [ ] Two merchants use distinct keys and independent custody contexts.
- [ ] Production navigation, mode selection, refresh and startup synchronization work.
- [ ] Vault timeout revokes all decrypted credential access; real private-state types round-trip.
- [ ] Confirmed transitions survive persistence failures/restarts through a recovery journal.
- [ ] Stable receipt deduplication works across commitment changes.
- [ ] Expiry, cancellation/refunds, fees and line closure have explicit tested policies.
- [ ] Privacy claims agree with ledger, transcripts, deltas and historical inference.
- [ ] Reserve projections include fees and preserve numerical precision.
- [ ] Agent MCP has no issuer powers/default fixture secrets; demo state is isolated.
- [ ] Meaningful browser lifecycle, differential tests and transcript privacy checks run in CI.
- [ ] README, engineering status, architecture, diagrams and pitch agree on current behavior.
- [ ] Public demo/deck/video links work; final commit tag and Wave delta are recorded.
- [ ] No claim of deployment, proof latency or token payout without corresponding evidence.

## 12. Evidence limits and follow-up

The current audit provides concrete reproductions and code-level reasoning, not formal verification of the ZK system or an assessment of third-party wallet/ledger internals. No fuzzing campaign, load test, independent cryptographic review, real settlement reconciliation or customer interview was completed. Passing unit tests and successful compilation do not discharge these gaps.

The local working tree is actively evolving. Recheck findings against subsequent edits; use the evidence manifest and commit IDs to identify this snapshot. Resolved findings should gain an acceptance test and be marked closed, rather than simply changing descriptive text.

**Recommended decision:** continue Line, focus Wave 2 on a credible private-authorization and merchant-claim demonstration, and make the implemented trust/privacy boundary central to the pitch. The existing contract work gives you something substantial to demonstrate. Integration correctness and honest evidence now matter more than feature breadth.
