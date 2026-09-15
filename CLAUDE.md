# CLAUDE.md — Line

Instructions for Claude Code / Codex / Cursor working in this repository.

## What this is

Midnight Buildathon Wave 2: **private revolving credit and settlement prototype for autonomous agents**.

Compact contract (source of truth) + TypeScript encoding replica + four desks (Issuer, Merchant A/B, Agent, Explorer) + Attack Lab + MCP server.

## Commands

```bash
npm install
bash scripts/install-compact.sh
npm run compact:compile
npm run compact:test
npm test
npm run test:line
npm run mcp:test
npm run typecheck
npm run build
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
- Support multi-merchant (Merchant A and Merchant B) with role-separated domain keys.
- Enforce reserve solvency: $\text{encumberedReserve} + \text{redeemedReserve} \le \text{totalReserve}$.
- Failed proofs must leave ledger state unchanged. Copy: `"Clearance could not be proven."`
- Do not invent Compact APIs. Pin toolchain 0.34.0 / language 0.26 / runtime 0.19.0.
- Honest claims: Compact settlement accounting prototype; not live token payouts or Preprod deployment.

## Architecture

Engineering is the commitment state machine:

```
C = persistentCommit<LinePreimage>({I, L, B, epoch}, salt)
D = persistentCommit<DrawNotePreimage>({domain, lineGen, I, Q, merchantPk, A, nonce, expiry}, noteSalt)
draw proves B + A ≤ L and reserve solvency, emits D, encumbers reserve
redeemDraw proves merchant ownership of D, spends N_redeem, shifts encumbered -> redeemed reserve
acknowledgeRepayment is the only way B decreases
```

Read `docs/HANDOFF.md`, `docs/WAVE2_PLAN.md`, `docs/WAVE2_SECURITY_REVIEW.md`, and `docs/ENCODING.md`.
