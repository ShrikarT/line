# Agent handoff

Read this before touching Line.

## Product

Line is **not** a wallet spend-cap and **not** a private IDO. It is issuer-backed revolving credit. Merchants get a one-time draw authorization. The public ledger stores line-state commitments, quote commitments, nullifiers, and status.

## Non-negotiables

1. Agents cannot call repay. Only `acknowledgeRepayment` (issuer) reduces `B`.
2. Do not claim the merchant was paid in assets. Wave 1 is authorization only (Option A).
3. Failed circuits write nothing. UI copy: "Clearance could not be proven." Never leak "insufficient balance" to the public view.
4. Quote preimages stay off the ledger. Public `Q` is opaque.
5. Nullifiers include the agent secret (draws) or issuer receipt nonce (repays) plus a domain tag.
6. One issuer, one merchant, one live line per identity in v1.
7. Keep Compact and the TypeScript engine semantically aligned. If they drift, the engine tests win for the demo; then update Compact.

## Where things live

| Path | Owner |
|---|---|
| `contracts/line.compact` | Circuit spec for Midnight judges |
| `src/lib/line/protocol.ts` | Executable reference |
| `src/lib/line/protocol.test.ts` | Adversarial suite |
| `src/routes/` | Desks + explorer |
| `mcp/line-mcp.mjs` | Thin `draw` tool |
| `docs/` | Plan, progress, pitch |

## Demo sequence (do not invent a cooler one)

`L = 150` private.

1. Issuer `openLine`
2. Explorer shows `C0` + `open` — no 150
3. Merchant `postQuote` 40 — explorer shows opaque `Q`
4. Agent `draw` 40 — `C0 → C1`
5. Replay draw fails
6. Quote 120 — draw fails locally
7. Off-chain payment narrated
8. Issuer `acknowledgeRepayment(40)` — `C1 → C2`
9. Draw 120 succeeds; then `setStatus(defaulted)` blocks further draws

## Next agent after Wave 1

Wave 2: shielded escrow redeemable by `N_draw`; note-style unlinkable draws; portable issuer credential; second merchant.
