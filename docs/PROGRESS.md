# Progress

Branch `fix/compact-source-of-truth` on https://github.com/ShrikarT/line.

## Compact is the source of truth

- `contracts/line.compact` compiles with toolchain **0.34.0** (language 0.26, runtime 0.19.0).
- `C = persistentCommit<LinePreimage>({I,L,B,epoch}, salt)`.
- DApp-scoped `publicKey(sk)` authorization for issuer and merchant.
- TypeScript replica uses `@midnight-ntwrk/compact-runtime` — not SHA-256.
- Compact simulator tests execute the generated `Contract`.
- Cross-language vectors assert byte equality for I, C, Q, N_draw, N_repay.
- Hex encode/decode is local (no Node `Buffer`) so the desks run in the browser.
- Scripted demo actually runs replay, over-limit, repayment, default, post-default fail.
- MCP `line.status` / `line.draw` / `line.seed` against a local state file.
- Full Apache-2.0 LICENSE.
- CI compiles Compact and runs Compact tests (does not skip if the compiler is missing).

## Deployment

Local/simulator. Not on Midnight Preprod.
