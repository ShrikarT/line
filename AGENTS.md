# AGENTS.md — Line

You are working on **Line**, a Midnight Buildathon project.

## Goal

Ship a compiling-quality Compact contract (source in `contracts/line.compact`) and a faithful TypeScript reference engine that powers a three-role demo: issuer, merchant, agent. Public explorer never shows books.

## Hard constraints

- Five circuits only: `openLine`, `postQuote`, `draw`, `acknowledgeRepayment`, `setStatus`.
- Issuer authenticates open / repay-ack / status.
- Merchant authenticates quotes.
- Agent authenticates draws.
- Wave 1 settlement is Option A (authorization, not asset transfer).
- Privacy: hide `L`, `B`, `A`, merchant identity. Admit `C → C'` timing.

## Workflow

1. Read `docs/HANDOFF.md`.
2. Change protocol in `src/lib/line/protocol.ts` and tests together.
3. Mirror circuit comments in `contracts/line.compact`.
4. Update `docs/PROGRESS.md`.
5. Do not expand scope into escrow, multi-issuer, or credentials unless the user asks for Wave 2.

## Demo

The scripted demo in the UI must match HANDOFF.md step-for-step. If you change the demo, change HANDOFF.md in the same commit.
