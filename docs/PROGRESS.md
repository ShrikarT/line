# Engineering Progress

- **Active Branch:** `feat/production-line-platform`
- **Product:** Line — Private Credit and Checkout Infrastructure for Autonomous Agents
- **Version:** `0.3.0`
- **Detailed Status:** See [docs/ENGINEERING_STATUS.md](ENGINEERING_STATUS.md)

## Summary of Shipped Capabilities

- **Compact is the source of truth**: `contracts/line.compact` compiles with toolchain **0.34.0** (language `0.26.0`, runtime `0.19.0`). Verified zero drift in `contracts/managed/line/`.
- **Contract-instance domain separation**: Constructor accepts `(issuerPk, initialMerchantPk, instanceNonce: Bytes<32>)` creating unique `contractDomain`.
- **Line State Commitment ($C$)**: Binds `contractDomain`, `identity`, `limit`, `outstanding`, and `epoch`.
- **Reserve accounting pool**:
  - Ledgers: `totalReserve`, `encumberedReserve`, `redeemedReserve`.
  - Circuits: `fundReserve`, `withdrawUnencumberedReserve`.
  - Invariants: $\text{encumbered} + \text{redeemed} \le \text{totalReserve}$.
  - Anti-rug protection: Issuer cannot withdraw funds encumbered by active draw notes.
- **Multi-merchant registry**:
  - Ledger: `registeredMerchants: Map<Bytes<32>, Boolean>`.
  - Circuit: `registerMerchant`. Tested with Merchant A and Merchant B.
- **Private merchant-bound claim notes**:
  - `DrawNotePreimage` committed via `persistentCommit` ($D$).
  - Agent `draw` circuit enforces reserve solvency ($\text{withdrawable} \ge A$), encumbers reserve, and emits note $D$.
- **One-time merchant redemption**:
  - Circuit: `redeemDraw` proves merchant ownership ($sk \to \text{merchantPk}$ matching private preimage opening).
  - Nullifier: $N_{\text{redeem}} = \text{persistentHash}([\text{pad}(32, \text{"line:redeem"}), sk, D, \text{domain}])$.
  - Moves encumbered reserve to redeemed reserve.
- **Runtime architecture**:
  - `MidnightNetworkRuntime`: Production adapter for Midnight RPC/indexer.
  - `LocalDevelopmentRuntime`: Local development adapter.
  - `InMemoryTestRuntime`: Isolated in-memory adapter.
- **Security vault**:
  - WebCrypto AES-GCM 256-bit encryption with PBKDF2-HMAC-SHA256 and IndexedDB envelope storage.
- **Comprehensive test suite (99 passing tests across 27 suites)**:
  - 46 Compact simulator & cross-language encoding tests (`npm run compact:test`).
  - 31 Reference engine tests (`src/lib/line/protocol.test.ts`).
  - 13 Scripted demo tests (`src/lib/line/demo.test.ts`).
  - 4 Leakage & privacy tests (`src/lib/line/leakage.test.ts`).
  - 4 Runtime architecture tests (`src/lib/runtime/runtime.test.ts`).
  - 4 Client security vault tests (`src/lib/security/vault.test.ts`).
  - 4 MCP server tests (`mcp/line-mcp.test.mjs`).
  - 1 State-machine model checker test (`src/lib/line/model.test.ts`).
