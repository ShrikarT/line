# AGENTS.md — Line

You are working on **Line**, a Midnight Buildathon project.

## Goal

Ship a compiling Compact contract (`contracts/line.compact`) and a TypeScript replica of its encodings that powers a three-role demo: issuer, merchant, agent. Public explorer never shows books.

## Hard constraints

- Five circuits only: `openLine`, `postQuote`, `draw`, `acknowledgeRepayment`, `setStatus`.
- Compact is the source of truth. Do not invent Compact APIs. Do not replace `persistentHash` with SHA-256.
- Issuer authenticates open / repay-ack / status.
- Merchant authenticates quotes.
- Agent authenticates draws.
- Wave 1 settlement is authorization, not asset transfer.
- Privacy: hide `L`, `B`, `A`, merchant identity. Admit `C → C'` timing.

## Workflow

1. Read `docs/HANDOFF.md` and `docs/ENCODING.md`.
2. Change Compact first; compile; then encoding / engine / tests.
3. Update `docs/PROGRESS.md`.
4. Do not expand scope into escrow, multi-issuer, or credentials unless the user asks for Wave 2.
