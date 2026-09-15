# Line Roadmap

Private revolving credit and settlement authorization for autonomous agents.

---

## Wave 1 — Credit Authorization (Shipped)
- **Status:** Complete. Tagged `wave1-final` (`ed45ca4`). Preserved at `contracts/v1/line.compact`.
- Five circuits: `openLine`, `postQuote`, `draw`, `acknowledgeRepayment`, `setStatus`.
- Private revolving balance, issuer receipts, opaque quotes, attack lab.
- Compact simulator tests, TypeScript replica, cross-language vectors.

---

## Wave 2 — Private Credit Settlement Prototype (Shipped)
- **Status:** Complete on `feat/wave-2-private-settlement`.
- **Exact Compact Settlement Accounting**:
  1. **Issuer Reserve Escrow Pool**: `totalReserve`, `encumberedReserve`, `redeemedReserve`, and circuits `fundReserve`, `withdrawUnencumberedReserve`.
  2. **Multi-Merchant Support**: `registeredMerchants` map with Merchant A & Merchant B, authenticated by domain keys.
  3. **Merchant-Bound Draw Notes**: Private `DrawNotePreimage` committed to $D$, hiding merchant identity on ledger and proving ownership in ZK.
  4. **Single-Use Redemption Nullifiers**: $N_{\text{redeem}}$ spent upon redemption, eliminating double-claims.
  5. **Anti-Rug Protections**: Active draw notes lock reserves; issuer cannot withdraw encumbered funds.
  6. **Note Expiry & Cancellation**: Circuit `cancelOrExpireNote` returns expired unredeemed note reserves to unencumbered balance.
  7. **Domain Separation**: Constructor argument `instanceNonce: Bytes<32>` binds all state to `contractDomain`, preventing cross-contract replays.
  8. **Deterministic State-Machine Model Checker**: 50 pseudo-random transitions testing 10 invariants.
  9. **19-Step Scripted Demo**: Complete multi-role lifecycle flow with 4 executable attack steps.
  10. **Wave 2 MCP Server**: 8 JSON-RPC tools for autonomous agents (`mcp/line-mcp.mjs`).

---

## Wave 3 — Midnight Testnet & Cross-Chain Settlement (Next)
1. **Midnight Preprod / Testnet Deployment**: Compile full ZK proving and verifier keys (`.bincode`), deploy contract to Midnight network, replace local simulator with on-chain contract address.
2. **On-Chain Token Settlement**: Direct payout integration with Midnight native tokens (Night / Dust) and Cardano cross-chain settlement bridge.
3. **Wallet & Key Management**: Lace / Midnight wallet integration for agent and issuer private secret custody.
4. **Decentralized Underwriting**: Portable zero-knowledge issuer credentials and credit ratings.
5. **Protocol Fees & Marketplace**: Fee on draws, autonomous issuer liquidity marketplace, and agent policy packs.
