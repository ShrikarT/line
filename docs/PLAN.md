# Line — Wave 1 plan

Private revolving credit authorization for autonomous agents (humans use the same contract).

**One-liner:** An agent proves a purchase fits an issuer-backed line. The chain never sees score, limit, balance, or counterparty.

**Wave 1 promise:** The merchant receives an issuer-backed, non-replayable draw authorization. Simulated settlement happens at the issuer desk. Asset movement is Wave 2.

**Privacy promise:** Line hides amounts, limits, balances, and counterparties. It does **not** hide that a given line commitment changed at a time.

## Circuits (five)

1. `openLine` — issuer
2. `postQuote` — merchant
3. `draw` — agent
4. `acknowledgeRepayment` — issuer
5. `setStatus` — issuer

No on-chain `canPay`. No agent-initiated repay. No economic slashing.

## Milestones

| ID | Milestone | Exit |
|---|---|---|
| M0 | Spec, handoff, license, repo skeleton | Docs on `main` |
| M1 | Compact source + TypeScript reference circuits + tests | Tests green |
| M2 | Three desks + public explorer + scripted demo | Demo 9 steps |
| M3 | MCP wrapper, README, pitch | Hackathon-ready |

## Stack

- Compact contract in `contracts/line.compact` (Midnight-shaped source of truth)
- TypeScript reference engine in `src/lib/line/` (executable, tested, drives the demo)
- Web desks: issuer / merchant / agent / explorer
- Thin MCP: `mcp/line-mcp.mjs`

## Out of Wave 1

Shielded escrow, note/UTXO unlinkability, portable issuer credentials, multi-issuer, interest, fees, Cardano settlement, production MCP discovery.
