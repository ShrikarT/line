# CLAUDE.md — Line

Developer and agent instructions for working in this repository.

## Overview

Line: **Private credit and checkout infrastructure for autonomous agents**.

Compact contract (canonical protocol) + managed bindings + runtime architecture (`MidnightNetworkRuntime`, `LocalDevelopmentRuntime`, `InMemoryTestRuntime`) + multi-role web consoles (Issuer, Merchant A/B, Agent, Explorer, Attack Lab) + standard Model Context Protocol (MCP) server.

## Verification Commands

```bash
npm ci
npm run compact:compile
git diff --exit-code contracts/managed/
npm run compact:test
npm test
npm run typecheck
npm run build
npm run network:smoke
```

MCP:
```bash
npm run mcp        # Production network runtime
npm run mcp:dev    # Local developer runtime
npm run mcp:test   # MCP test suite
```

## Protocol Rules

- Compact (`contracts/line.compact`) is the source of truth.
- Zero-knowledge credit books: $L$, $B$, and available capacity $(L - B)$ are never public fields.
- Repayments require issuer receipt confirmation.
- Multi-merchant support: Merchant A and Merchant B with role separation and contract domain separation.
- Reserve solvency: $\text{encumberedReserve} + \text{redeemedReserve} \le \text{totalReserve}$.
- Failed proofs leave state unchanged with generic error copy: `"Clearance could not be proven."`
- Pinned toolchain: Compact 0.34.0 / language 0.26 / runtime 0.19.0.

## Commitment State Machine

```text
contractDomain = persistentHash(["line:domain", issuerPk, initialMerchantPk, instanceNonce])
C = persistentCommit<LinePreimage>({ domain, identity: I, limit: L, outstanding: B, epoch }, salt)
D = persistentCommit<DrawNotePreimage>({ domain, lineGen, I, quoteCommit: Q, merchantPk, amount: A, noteNonce, expiry }, noteSalt)
draw proves B + A <= L and reserve solvency, rotates C -> C', emits D, encumbers reserve
redeemDraw proves merchant ownership of D in ZK, spends N_redeem, shifts encumbered -> redeemed reserve
acknowledgeRepayment opens C and spends N_repay; only way B decreases
```

Refer to:
- `docs/PRODUCT_ARCHITECTURE.md`
- `docs/PROTOCOL.md`
- `docs/PRIVACY.md`
- `docs/SECURITY.md`
- `docs/DEPLOYMENT.md`
