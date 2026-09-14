# Agent handoff

Read this before touching Line.

## Product

Line is **not** a wallet spend-cap and **not** a private IDO. It is issuer-backed revolving credit. Merchants get a one-time draw authorization. The public ledger stores line-state commitments, quote commitments, nullifiers, and status.

## Non-negotiables

1. Compact (`contracts/line.compact`) is the source of truth. TypeScript is a replica of Compact encodings, not a SHA-256 parallel.
2. Agents cannot call repay. Only `acknowledgeRepayment` (issuer) reduces `B`.
3. Do not claim the merchant was paid in assets. Wave 1 is authorization only.
4. Failed circuits write nothing. UI copy: "Clearance could not be proven."
5. Quote preimages stay off the ledger. Public `Q` is opaque.
6. Nullifiers are domain-separated (`line:draw` / `line:repay`) and secret-bound.
7. One issuer, one merchant, one live line per instance in v1.
8. `CLOSED` cannot `setStatus` back to OPEN. A new line requires `openLine` (fresh `C0`).

## Where things live

| Path | Owner |
|---|---|
| `contracts/line.compact` | Protocol source of truth |
| `contracts/managed/line` | Compiler output (skip-zk) |
| `src/lib/line/encoding.ts` | compact-runtime encodings |
| `src/lib/line/protocol.ts` | Reference engine (UI / MCP) |
| `src/lib/line/compact.test.ts` | Compact simulator tests |
| `src/lib/line/protocol.test.ts` | Reference-engine tests |
| `mcp/line-mcp.mjs` | Local `status` / `draw` / `seed` |
| `docs/ENCODING.md` | Hash / pad / Uint packing |

## Demo sequence (do not invent a cooler one)

`L = 150` private. 11 snapshots (0–10). Replay, over-limit, and post-default failure **execute**, they are not narrated.

## Compiler

Toolchain 0.34.0, language 0.26.0, runtime 0.19.0.

```bash
bash scripts/install-compact.sh
npm run compact:compile
npm run compact:test
```
