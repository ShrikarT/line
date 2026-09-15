# Engineering Status & Delivery Tracking

- **Product:** Line — Private Credit & Checkout Infrastructure for Autonomous Agents
- **Version:** `0.3.0`
- **Active Branch:** `feat/production-line-platform`
- **Canonical Contract:** `contracts/line.compact`
- **Managed Bindings:** `contracts/managed/line/` (verified zero drift)

---

## Component Status Checklist

### 1. Compact Smart Contract (`contracts/line.compact`)
- [x] Canonical single contract at `contracts/line.compact` (duplicate directories removed)
- [x] Contract-instance domain separation via `instanceNonce` and derived `contractDomain`
- [x] Domain-bound line-state commitment $C = \text{persistentCommit}(\{ \text{domain}, I, L, B, \text{epoch} \}, \text{salt})$
- [x] 10 standard circuits implemented:
  - `registerMerchant`
  - `fundReserve`
  - `withdrawUnencumberedReserve`
  - `openLine`
  - `postQuote`
  - `draw`
  - `redeemDraw`
  - `cancelOrExpireNote`
  - `acknowledgeRepayment`
  - `setStatus`
- [x] Multi-merchant registry with whitelisting (`registeredMerchants`)
- [x] Mathematical reserve solvency invariant: $\text{encumberedReserve} + \text{redeemedReserve} \le \text{totalReserve}$
- [x] Anti-rug withdrawal constraint: $\Delta \text{withdraw} \le \text{withdrawableReserve}$
- [x] Merchant-bound claim notes ($D$) with zero-knowledge ownership proof ($N_{\text{redeem}}$)
- [x] Fast compiler script (`scripts/compile-compact.mjs`) & release compilation script

### 2. Runtime Architecture (`src/lib/runtime/`)
- [x] `LineRuntime` interface defining unified operations and status queries
- [x] `MidnightNetworkRuntime`: Production adapter interfacing with Midnight network RPC, indexer, and wallet
- [x] `LocalDevelopmentRuntime`: Developer adapter running Compact simulator with explicit environment indicators
- [x] `InMemoryTestRuntime`: Isolated in-memory adapter for automated test suites
- [x] Runtime selection factory `getRuntime()` with environment variable control (`LINE_RUNTIME`)

### 3. Private State Management & Security Vault (`src/lib/security/`)
- [x] WebCrypto AES-GCM 256-bit encryption with PBKDF2-HMAC-SHA256 (100,000 iterations)
- [x] IndexedDB encrypted envelope persistence
- [x] Zero plaintext secret persistence in `localStorage`
- [x] Cryptographically secure randomness (`crypto.getRandomValues`) throughout
- [x] Institutional custody disclaimer documented and tested

### 4. Machine-Checked Privacy & Leakage Verification (`src/lib/line/leakage.test.ts`)
- [x] Verified: Credit limit $L$, debt $B$, and remaining capacity are never public
- [x] Verified: Agent secrets, commitment salts, invoice IDs, and quote nonces are never public
- [x] Verified: Public note amount and reserve deltas accurately match settlement claim amounts
- [x] Verified: Merchant pseudonyms and quote linkages operate within documented boundaries
- [x] Verified: MCP public endpoints conform to privacy inventory

### 5. Automated Verification Suite
- [x] 46 Compact simulator & cross-language encoding tests (`npm run compact:test`)
- [x] 31 Reference engine tests (`src/lib/line/protocol.test.ts`)
- [x] 13 Scripted demo snapshot tests (`src/lib/line/demo.test.ts`)
- [x] 1 Deterministic model checker test (`src/lib/line/model.test.ts`) verifying all 10 invariants across 50 operations
- [x] 4 Privacy & leakage tests (`src/lib/line/leakage.test.ts`)
- [x] 4 Runtime architecture tests (`src/lib/runtime/runtime.test.ts`)
- [x] 4 Security vault tests (`src/lib/security/vault.test.ts`)
- [x] 4 MCP JSON-RPC server tests (`mcp/line-mcp.test.mjs`)
- **Total:** **99 passing tests across 27 suites**

### 6. Developer & Deployment Operations
- [x] `npm run compact:compile`: Deterministic fast compilation with `--skip-zk`
- [x] `npm run compact:compile:release`: Full release compilation with proving key generation
- [x] `npm run contract:deploy`: Contract deployment with dry-run validation
- [x] `npm run contract:join`: Connect to existing deployed contract
- [x] `npm run network:smoke`: Network connectivity and state smoke test
- [x] `npm run mcp`: Production MCP server
- [x] `npm run mcp:dev`: Local development MCP adapter
