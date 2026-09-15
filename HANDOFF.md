# Engineer Handoff: Line Platform

Read this before contributing to Line.

## Product Context

Line is **private revolving credit and checkout infrastructure for autonomous agents**.
An issuer underwrites confidential credit and allocates verifiable reserve capacity. An agent proves in zero-knowledge that an invoice fits remaining capacity ($B + A \le L$) and that reserve backing exists. A merchant receives an issuer-backed, non-replayable private claim note redeemable once against the reserve pool. An issuer-confirmed repayment restores capacity privately.

## Core Invariants & Rules

1. **Compact is the source of truth**: `contracts/line.compact` is the protocol. TypeScript encodings strictly mirror Compact via `@midnight-ntwrk/compact-runtime`.
2. **Honest settlement scope**: Exact Compact settlement accounting (reserve capacity, private claim notes, redemption nullifiers). Do not claim live token payouts or live Midnight Preprod deployment unless on-chain transactions are confirmed.
3. **Multi-merchant isolation**: Support multiple merchants via `registeredMerchants: Map<Bytes<32>, Boolean>`. Notes are bound to the specific merchant's public key; Merchant B cannot redeem Merchant A's notes.
4. **Reserve solvency**: Total reserve must always back all encumbered and redeemed claims: $\text{encumberedReserve} + \text{redeemedReserve} \le \text{totalReserve}$. Draws assert $\text{withdrawable} \ge A$.
5. **Anti-rug protection**: An issuer can only withdraw unencumbered reserve funds. Active draw notes are strictly protected against issuer withdrawal.
6. **One-time redemption**: Draw notes can be redeemed at most once using $N_{\text{redeem}} = \text{persistentHash}([\text{pad}_{32}(\text{"line:redeem"}), sk_{\text{merchant}}, D, \text{domain}])$. Double redemption must fail.
7. **Instance domain separation**: The constructor takes `(issuerPk, initialMerchantPk, instanceNonce: Bytes<32>)` creating unique `contractDomain`.
8. **Private failure string**: Failed circuits write nothing to public storage. Any failed draw surfaces: `"Clearance could not be proven."`
9. **Private books**: Limits $L$, balances $B$, and remaining capacity remain hidden. Note settlement claim amounts $A$ and reserve deltas are public on-chain metadata as documented in `docs/PRIVACY.md`.
10. **10 Circuits only**: `registerMerchant`, `fundReserve`, `withdrawUnencumberedReserve`, `openLine`, `postQuote`, `draw`, `redeemDraw`, `cancelOrExpireNote`, `acknowledgeRepayment`, `setStatus`.

## File Map

| Path | Purpose |
|---|---|
| `contracts/line.compact` | Canonical protocol source of truth (Compact 0.26) |
| `contracts/managed/line` | Generated Compact artifacts (`--skip-zk`) |
| `src/lib/line/encoding.ts` | compact-runtime encodings and commitments |
| `src/lib/line/protocol.ts` | Reference engine (replica for UI / MCP) |
| `src/lib/runtime/` | Runtime architecture (`MidnightNetworkRuntime`, `LocalDevelopmentRuntime`, `InMemoryTestRuntime`) |
| `src/lib/security/vault.ts` | WebCrypto AES-GCM 256-bit client-side security vault |
| `src/lib/line/compact.test.ts` | Compact simulator tests (46 tests across 13 suites) |
| `src/lib/line/leakage.test.ts` | Machine-checked privacy & state-delta leakage tests |
| `src/lib/line/model.test.ts` | Deterministic state machine invariant model tester |
| `src/lib/line/demo.ts` | 19-step scripted lifecycle demo flow and state snapshots |
| `mcp/line-mcp.mjs` | Standard MCP server exposing 8 tools for autonomous agents |
| `docs/PRODUCT_ARCHITECTURE.md` | Architecture and technical specification |
| `docs/PROTOCOL.md` | Cryptographic specifications and commitment schemes |
| `docs/PRIVACY.md` | Complete machine-checked privacy inventory |
| `docs/SECURITY.md` | Threat matrix, invariants, and attack defenses |
| `docs/DEPLOYMENT.md` | Network deployment and toolchain verification |
| `docs/PRODUCT_WALKTHROUGH.md` | Narrative walkthrough of all 19 lifecycle steps |
| `docs/ENGINEERING_STATUS.md` | Delivery tracking and component checklist |

## Toolchain & Verification

Compact toolchain `0.34.0`, language `0.26.0`, runtime `0.19.0`, Node `>= 22`.

```bash
npm run compact:compile    # compile Compact contract
git diff --exit-code contracts/managed/  # check for drift
npm run compact:test       # run Compact simulator tests
npm test                   # run complete test suite (99 tests)
npm run typecheck          # TypeScript check
npm run build              # Frontend build
npm run network:smoke      # Network connectivity smoke test
```
