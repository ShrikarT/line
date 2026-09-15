# Line — Architecture & Plan

Private revolving credit and settlement authorization for autonomous agents.

**One-liner:** An agent proves a purchase fits an issuer-backed credit line and reserve pool. The chain never sees credit limit, outstanding balance, invoice amount, or merchant identity.

**Wave 1 Foundation:** Issuer-backed revolving credit authorization, opaque quote commitments, single-use nullifiers, and deterministic state transitions.

**Wave 2 Delivery (Current):** Exact Compact settlement accounting prototype. Verified reserve pool escrow, multi-merchant support (Merchant A & Merchant B), merchant-bound private draw notes, single-redemption nullifiers ($N_{\text{redeem}}$), anti-rug reserve protections, and contract-instance domain separation.

**Privacy promise:** Line hides credit limits, balances, invoice amounts, and merchant counterparties. It discloses reserve pool totals, anonymous note commitments, nullifiers, status, and `actionClock` transition timing.

---

## Source of Truth

`contracts/line.compact` compiled with Compact toolchain **0.34.0** (language `0.26.0`, runtime `0.19.0`). TypeScript is an exact replica of Compact encodings via `@midnight-ntwrk/compact-runtime`.

---

## Compact Circuits (Ten)

1. `registerMerchant` — Issuer onboards merchant public key to `registeredMerchants: Map<Bytes<32>, Boolean>`.
2. `fundReserve` — Issuer deposits liquidity into `totalReserve`.
3. `withdrawUnencumberedReserve` — Issuer withdraws unencumbered liquidity (`totalReserve - (encumbered + redeemed)`).
4. `openLine` — Issuer initializes confidential line commitment $C_0$.
5. `postQuote` — Merchant commits to opaque quote $Q$.
6. `draw` — Agent proves capacity and reserve solvency, issues private note $D$, encumbers reserve.
7. `redeemDraw` — Merchant opens $D$ in ZK, spends $N_{\text{redeem}}$, shifts encumbered to redeemed reserve.
8. `cancelOrExpireNote` — Releases expired unredeemed reserve back to unencumbered.
9. `acknowledgeRepayment` — Issuer acknowledges off-chain cash, restores agent capacity privately, spends $N_{\text{repay}}$.
10. `setStatus` — Issuer manages line status (`OPEN`, `DEFAULTED`, `CLOSED`).

---

## Completed Milestones

| ID | Milestone | Status |
|---|---|---|
| M0 | Wave 1 Authorization Core (PR #1 & PR #2) | Merged & tagged `wave1-final` |
| M1 | Wave 2 Technical Plan & Architecture (`docs/WAVE2_PLAN.md`) | Completed |
| M2 | Contract-Instance Domain Separation (`instanceNonce`, `contractDomain`) | Completed |
| M3 | Compact Settlement Accounting (Reserves, Notes, 10 Circuits) | Completed & Compiled |
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
