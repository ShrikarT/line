# Progress

Branch `fix/line-lifecycle-hardening` on https://github.com/ShrikarT/line (following PR #1 `fix/compact-source-of-truth` merge).

## Compact is the source of truth

- `contracts/line.compact` compiles with toolchain **0.34.0** (language 0.26, runtime 0.19.0).
- `C = persistentCommit<LinePreimage>({I,L,B,epoch}, salt)`.
- DApp-scoped role separation: `line:issuer:pk` and `line:merchant:pk` prevent cross-role key reuse.
- Constructor accepts `(issuerPk, merchantPk)` directly, removing secret exposure from deployers.
- Credit line generation isolation: `lineGeneration: Uint<64>` increments on `openLine`.
- Quotes are generation-isolated: `postQuote` requires `status == OPEN`; `draw` checks `meta.lineGeneration == lineGeneration`. Quotes from an earlier generation cannot be drawn against a reopened line.
- `actionClock: Counter` honestly tracks contract action counts for quote expiry (explicitly non-wall-clock).
- Quote commitments bind generation into an 8-element vector ($Vector<8, Bytes<32>>$).
- TypeScript replica uses `@midnight-ntwrk/compact-runtime` byte-for-byte — not SHA-256.
- 87 total automated tests passing (44 Compact simulator + 33 protocol replica + 7 demo + 3 MCP).
- Cross-language vectors assert byte equality for I, C, Q, N_draw, N_repay.
- Hex encode/decode is local (no Node `Buffer`) so the desks run in the browser.
- Scripted demo (11 snapshots, 0–10) actually executes replay, over-limit, repayment, default, post-default fail.
- MCP `line.status` / `line.draw` / `line.seed` against a local state file.
- Full Apache-2.0 LICENSE.
- CI compiles Compact and runs Compact tests (does not skip if the compiler is missing).

## Deployment

Local/simulator. Not on Midnight Preprod.

