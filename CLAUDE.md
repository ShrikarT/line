# CLAUDE.md — Line

Instructions for Claude Code / Codex / Cursor working in this repository.

## What this is

Midnight Buildathon Wave 1: **private revolving credit for autonomous agents**.

Compact contract (source of truth) + TypeScript encoding replica + three desks + public explorer.

## Commands

```bash
npm install
bash scripts/install-compact.sh
npm run compact:compile
npm run compact:test
npm run test:line
npm run typecheck
npm run dev
```

MCP:

```bash
npm run mcp
```

## Rules

- Compact is the protocol. The TypeScript engine is a replica.
- Do not add an on-chain `canPay` circuit.
- Do not let the agent reduce outstanding balance without an issuer receipt.
- Do not publish amounts, limits, or merchant identities on the public ledger view.
- Do not implement slashing economics in Wave 1.
- Failed proofs must leave ledger state unchanged.
- Do not invent Compact APIs. Pin toolchain 0.34.0 / language 0.26 / runtime 0.19.0.

## Judging

Engineering is the commitment state machine:

```
C = persistentCommit<LinePreimage>({I, L, B, epoch}, salt)
draw proves B + A ≤ L and writes C'
acknowledgeRepayment is the only way B decreases
```

Read `docs/HANDOFF.md`, `docs/ENCODING.md`, and `docs/PLAN.md` before changing circuits.
