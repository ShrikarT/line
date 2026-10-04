# AGENTS.md — Line

You are working on **Line**, private credit and checkout infrastructure for autonomous agents.

## Goal

Ship a compiling Compact contract (`contracts/line.compact`), managed bindings, runtime architecture, and multi-role consoles (issuer, agent, Merchant A, Merchant B). Public explorer never shows credit books.

## Hard Constraints

- Ten circuits only: `registerMerchant`, `fundReserve`, `withdrawUnencumberedReserve`, `openLine`, `postQuote`, `draw`, `redeemDraw`, `cancelOrExpireNote`, `acknowledgeRepayment`, `setStatus`.
- Compact is the source of truth. Do not invent Compact APIs. Do not replace `persistentHash` or `persistentCommit` with SHA-256.
- Issuer authenticates reserve funding, withdrawal, merchant registration, line opening, repay-ack, and status.
- Merchant authenticates quotes and note redemption.
- Agent authenticates draws.
- Exact Compact settlement accounting (reserve capacity, private merchant-bound draw notes, single-redemption nullifiers). Do not claim live token payouts or live Preprod deployment unless on-chain transactions are confirmed.
- Multi-merchant support: Merchant A and Merchant B with role separation and contract domain separation (`instanceNonce`).
- Privacy: hide $L$, $B$, and remaining capacity. Acknowledge public note amounts and reserve state deltas as documented in `docs/PRIVACY.md`.
- Generic error copy on rejected draws: `"Clearance could not be proven."`

## Workflow

1. Read `docs/PRODUCT_ARCHITECTURE.md`, `docs/PROTOCOL.md`, and `docs/PRIVACY.md`.
2. Change Compact first; compile (`npm run compact:compile`); verify zero drift (`git diff --exit-code contracts/managed/`).
3. Update encoding / runtime / tests.
4. Update `docs/ENGINEERING_STATUS.md`.
5. Ensure all 99 tests pass (`npm test`).
