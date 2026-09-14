# CLAUDE.md — Line

Instructions for Claude Code / Codex / Cursor working in this repository.

## What this is

Midnight Buildathon Wave 1 project: **private revolving credit for autonomous agents**.

Compact contract + TypeScript reference engine + three desks (issuer, merchant, agent) + public explorer.

## Commands

```bash
npm test                 # protocol tests
npm run typecheck
npm run dev              # web desks
```

MCP (optional):

```bash
node mcp/line-mcp.mjs
```

## Rules

- Do not add an on-chain `canPay` circuit.
- Do not let the agent reduce outstanding balance without an issuer receipt.
- Do not publish amounts, limits, or merchant identities on the public ledger view.
- Do not implement slashing economics in Wave 1.
- Failed proofs must leave ledger state unchanged.
- Keep `contracts/line.compact` comments in sync with `src/lib/line/protocol.ts`.

## Judging

Engineering 40% is the commitment state machine:

```
C = H(line:state, I, L, B, e, s)
draw proves B + A ≤ L and writes C'
acknowledgeRepayment is the only way B decreases
```

Read `docs/HANDOFF.md` and `docs/PLAN.md` before changing circuits.
