# Progress

Branch `feat/wave-2-private-settlement` on https://github.com/ShrikarT/line (following PR #1 and PR #2 merges, and `wave1-final` tag).

## Wave 2 — Private Credit Settlement Prototype

- **Compact is the source of truth**: `contracts/line.compact` compiles with toolchain **0.34.0** (language `0.26.0`, runtime `0.19.0`).
- **Wave 1 preserved**: Preserved at `contracts/v1/line.compact`; tagged at `wave1-final` (`ed45ca4`).
- **Contract-instance domain separation**: Constructor accepts `(issuerPk, initialMerchantPk, instanceNonce: Bytes<32>)` creating unique `contractDomain`.
- **Reserve accounting pool**:
  - Ledgers: `totalReserve`, `encumberedReserve`, `redeemedReserve`.
  - Circuits: `fundReserve`, `withdrawUnencumberedReserve`.
  - Invariants: $\text{encumbered} + \text{redeemed} \le \text{totalReserve}$.
  - Anti-rug protection: Issuer cannot withdraw funds encumbered by active draw notes.
- **Multi-merchant registry**:
  - Ledger: `registeredMerchants: Map<Bytes<32>, Boolean>`.
  - Circuit: `registerMerchant`.
  - Tested with Merchant A and Merchant B.
- **Private merchant-bound draw notes**:
  - `DrawNotePreimage` committed via `persistentCommit` ($D$).
  - `NoteMeta` on ledger hides merchant identity: stores only amount, status, expiry, and generation.
  - Agent `draw` circuit enforces reserve solvency ($\text{withdrawable} \ge A$), encumbers reserve, and emits note $D$.
- **One-time merchant redemption**:
  - Circuit: `redeemDraw` proves merchant ownership ($sk \to \text{merchantPk}$ matching private preimage opening).
  - Nullifier: $N_{\text{redeem}} = \text{persistentHash}([\text{pad}(32, \text{"line:v2:redeem"}), sk, D, \text{domain}])$.
  - Moves encumbered reserve to redeemed reserve.
  - Double-redemption and cross-merchant redemption attacks strictly rejected.
- **Note cancellation & expiry**:
  - Circuit: `cancelOrExpireNote` releases unredeemed expired notes when $\text{actionClock} \ge \text{expiry}$.
- **Comprehensive test suite (92 tests)**:
  - 39 Compact simulator tests (`compact.test.ts`) across 11 test suites.
  - 31 Reference engine tests (`protocol.test.ts`) across 10 test suites.
  - 13 Scripted demo tests (`demo.test.ts`) covering all 19 lifecycle steps and attacks.
  - 4 Cross-language commitment vector tests (`encoding.test.ts`).
  - 4 Wave 2 MCP server tests (`mcp/line-mcp.test.mjs`) covering all 8 tools.
  - 1 State-machine model checker test (`model.test.ts`) verifying all 10 invariants across 50 transitions.
- **UI Desks updated**:
  - Issuer desk: reserve funding, unencumbered withdrawal, merchant registration.
  - Merchant desk: Merchant A / Merchant B switcher, note inbox, one-click redemption.
  - Agent desk: private books, note history, draw issuance.
  - Explorer desk: public reserve breakdown, anonymous settlement notes, contract domain.
  - Attack Lab: executable attacks for wrong merchant redemption, double-spend, issuer reserve rug, and cross-instance replay.
- **MCP Server (8 tools)**:
  - `line.status`, `line.reserve.status`, `line.seed`, `line.quote`, `line.draw`, `line.note.status`, `line.redeem`, `line.repay`.
- **Honest status**: Local simulator prototype. No unverified Preprod contract addresses or live token payouts claimed.
