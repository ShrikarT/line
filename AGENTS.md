# AGENTS.md — Line

You are working on **Line**, a Midnight Buildathon project.

## Goal

Ship a compiling Compact contract (`contracts/line.compact`) and a TypeScript replica of its encodings that powers a multi-role private credit and settlement demo: issuer, agent, Merchant A, Merchant B. Public explorer never shows credit books.

## Hard constraints

- Ten circuits only: `registerMerchant`, `fundReserve`, `withdrawUnencumberedReserve`, `openLine`, `postQuote`, `draw`, `redeemDraw`, `cancelOrExpireNote`, `acknowledgeRepayment`, `setStatus`.
- Compact is the source of truth. Do not invent Compact APIs. Do not replace `persistentHash` or `persistentCommit` with SHA-256.
- Issuer authenticates reserve funding, withdrawal, merchant registration, line opening, repay-ack, and status.
- Merchant authenticates quotes and note redemption.
- Agent authenticates draws.
- Wave 2 settlement is an exact Compact settlement-accounting prototype (reserve pool, private merchant-bound draw notes, single-redemption nullifiers). Do not claim live token payouts or live Preprod deployment.
- Multi-merchant support: Merchant A and Merchant B with role separation and contract domain separation (`instanceNonce`).
- Privacy: hide $L$, $B$, $A$, and merchant identity in notes. Admit $C \to C'$ and `actionClock` timing.
- Generic error copy on rejected draws: `"Clearance could not be proven."`

## Workflow

1. Read `docs/HANDOFF.md`, `docs/WAVE2_PLAN.md`, and `docs/ENCODING.md`.
2. Change Compact first; compile; then encoding / engine / tests.
3. Update `docs/WAVE2_PROGRESS.md` and `docs/PROGRESS.md`.
4. Ensure all 92 tests pass (`npm test`, `npm run compact:test`, `npm run mcp:test`).
