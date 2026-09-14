# Line — Wave 1 plan

Private revolving credit authorization for autonomous agents.

**One-liner:** An agent proves a purchase fits an issuer-backed line. The chain never sees score, limit, balance, or counterparty.

**Wave 1 promise:** The merchant receives an issuer-backed, non-replayable draw authorization. Simulated settlement happens at the issuer desk. Asset movement is Wave 2.

**Privacy promise:** Line hides amounts, limits, balances, and counterparties. It does **not** hide that a given line commitment changed at a time.

## Source of truth

`contracts/line.compact` compiled with Compact toolchain **0.34.0** (language 0.26). TypeScript is a tested replica of Compact encodings via `@midnight-ntwrk/compact-runtime` 0.19.0.

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
| M1 | Compact source + TypeScript replica + tests | Tests green |
| M2 | Three desks + public explorer + scripted demo | Demo 11 snapshots |
| M3 | MCP wrapper, README, pitch | Hackathon-ready |
| M4 | Attack lab, dual ledger, Compact simulator tests | Compact is source of truth |

## Stack

- Compact contract in `contracts/line.compact`
- Generated bindings in `contracts/managed/line` (`--skip-zk`)
- TypeScript replica in `src/lib/line/`
- Web desks: issuer / merchant / agent / explorer
- MCP: `mcp/line-mcp.mjs` (local simulator)

## Out of Wave 1

Shielded escrow, note/UTXO unlinkability, portable issuer credentials, multi-issuer, interest, fees, Cardano settlement, Midnight Preprod deployment, production MCP discovery.
