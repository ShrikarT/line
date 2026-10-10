# Line — Architecture & Plan

> **Archive notice (10 October 2026):** Historical Wave 2 planning snapshot; its product/privacy promises, compiler versions, tests and file map are superseded by [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md), [PRODUCT_VALIDATION.md](PRODUCT_VALIDATION.md), [ENGINEERING_STATUS.md](ENGINEERING_STATUS.md), and [PRIVACY.md](PRIVACY.md). Do not use this file as current product or security evidence.

Private spending guardrails for autonomous agent fleets — corporate cards for AI agents, Midnight-private.

**One-liner:** An enterprise finance admin issues a capped budget to an agent, backed by a funded reserve pool. The chain never sees secrets, salts, nonces, the agent identity preimage, the private books ($L$, $B$, epoch), per-quote invoice amounts, or any merchant↔quote↔note attribution — settled amounts and reserve totals are disclosed as anonymous escrow flows.

**Wave 1 Foundation:** Issuer-backed revolving credit authorization, opaque quote commitments, single-use nullifiers, and deterministic state transitions.

**Wave 2 Delivery (Current):** Exact Compact settlement accounting prototype. Verified reserve pool escrow, multi-merchant support (Merchant A & Merchant B), merchant-bound private draw notes, single-redemption nullifiers ($N_{\text{redeem}}$), anti-rug reserve protections, and contract-instance domain separation.

**Privacy promise:** Line hides the private books in ZK witnesses — credit limit $L$, outstanding $B$, epoch, per-quote invoice amounts, invoice IDs, nonces, and merchant↔quote↔note attribution never touch public inputs or ledger state. It discloses as public escrow accounting: reserve pool totals and their deltas, settled note amounts (`NoteMeta.amount`), fee amounts, note/quote commitments, the registered-merchant allowlist (the SET is public; which member quoted is not), nullifiers, status, and `actionClock` transition timing. Amounts are visible as anonymous flows; attribution is what the ZK hides.

---

## Source of Truth

`contracts/line.compact` compiled with Compact toolchain **0.34.0** (language `0.26.0`, runtime `0.19.0`). TypeScript is an exact replica of Compact encodings via `@midnight-ntwrk/compact-runtime`.

---

## Compact Circuits (Twelve)

1. `registerMerchant` — Issuer onboards merchant public key to `registeredMerchants: Map<Bytes<32>, Boolean>`.
2. `disableMerchant` — Issuer deactivates a merchant; blocks new quotes, existing quotes stay live.
3. `fundReserve` — Issuer deposits liquidity into `totalReserve`.
4. `withdrawUnencumberedReserve` — Issuer withdraws unencumbered liquidity (`totalReserve - (encumbered + redeemed + feeReserve)`).
5. `withdrawFees` — Issuer pays out the accrued issuer fee reserve.
6. `openLine` — Issuer initializes confidential line commitment $C_0$ with the limit as a private witness.
7. `postQuote` — Merchant commits to opaque quote $Q$ with the invoice amount as a private witness.
8. `draw` — Agent proves $B+A+F \le L$ with private witness books, issues private note $D$, encumbers reserve, accrues the issuer fee.
9. `redeemDraw` — Merchant opens $D$ in ZK, spends $N_{\text{redeem}}$, shifts encumbered to redeemed reserve.
10. `cancelOrExpireNote` — Releases expired unredeemed reserve back to unencumbered (permissionless, past advisory expiry).
11. `acknowledgeRepayment` — Issuer acknowledges off-chain cash, restores agent capacity with private witness books, spends $N_{\text{repay}}$.
12. `setStatus` — Issuer manages line status (`OPEN`, `DEFAULTED`, `CLOSED`).

---

## Completed Milestones

| ID | Milestone | Status |
|---|---|---|
| M0 | Wave 1 Authorization Core (PR #1 & PR #2) | Merged & tagged `wave1-final` |
| M1 | Wave 2 Technical Plan & Architecture (`docs/WAVE2_PLAN.md`) | Completed |
| M2 | Contract-Instance Domain Separation (`instanceNonce`, `contractDomain`) | Completed |
| M3 | Compact Settlement Accounting (Reserves, Notes, 12 Circuits) | Completed & Compiled |
| M4 | TypeScript Replica & Cross-Language Vectors (`encoding.test.ts`) | Completed (4/4 passed) |
| M5 | Compact Simulator Test Suite (`compact.test.ts`) | Completed (39/39 passed) |
| M6 | Deterministic State-Machine Invariant Model Tester (`model.test.ts`) | Completed (passed) |
| M7 | Scripted 19-Step Demo Flow & Tests (`demo.ts`, `demo.test.ts`) | Completed (13/13 passed) |
| M8 | Multi-Merchant UI Desks & Attack Lab | Completed (typechecked & built) |
| M9 | Local MCP Server & Wave 2 Tests (`mcp/line-mcp.test.mjs`) | Completed (4/4 passed) |
| M10 | Security Review & Verification Documentation | Completed |

---

## Out of Wave 2 (Future Wave 3 Scope)

Live Midnight Preprod / Mainnet token transfers (Night / Dust / Cardano ADA bridge), Lace wallet integration, portable decentralized identity credentials, and economic slashing.
