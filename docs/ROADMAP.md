# Line Product Roadmap

Private revolving credit and checkout infrastructure for autonomous agents.

---

## Current Release (v0.3.0) — Private Credit Authorization & Settlement Accounting Platform
- **Status:** Shipped & Verified.
- **Ten Core Compact Circuits:**
  `registerMerchant`, `fundReserve`, `withdrawUnencumberedReserve`, `openLine`, `postQuote`, `draw`, `redeemDraw`, `cancelOrExpireNote`, `acknowledgeRepayment`, `setStatus`.
- **Private Revolving Balance:** $L$, $B$, and remaining capacity committed in zero-knowledge; never visible on-chain.
- **Settlement Reserve Accounting:** Verifiable on-chain capacity tracking (`totalReserve`, `encumberedReserve`, `redeemedReserve`, `withdrawableReserve`).
- **Multi-Merchant Architecture:** Registered merchant pseudonyms, domain-bound quotes, private merchant-bound draw notes, and single-use redemption nullifiers ($N_{\text{redeem}}$).
- **Contract Domain Separation:** Constructor `instanceNonce` binds all commitments and nullifiers to `contractDomain`.
- **Runtime Architecture:** `MidnightNetworkRuntime`, `LocalDevelopmentRuntime`, and `InMemoryTestRuntime`.
- **Client Vault:** WebCrypto AES-GCM 256-bit encrypted storage with PBKDF2-HMAC-SHA256.
- **Agent Integration:** Standard Model Context Protocol (MCP) server supporting 8 tools over JSON-RPC.
- **Machine-Checked Privacy:** Machine-checked privacy inventory (`docs/PRIVACY.md`) and leakage test suite (`src/lib/line/leakage.test.ts`).

---

## Release v0.4.0 — Direct On-Chain Shielded Asset Settlement
- **Midnight Preprod Public Testnet Deployment:** Publish contract to Midnight Preprod with full proving key packages.
- **Native Shielded Asset Integration:** Direct deposit and transfer of Midnight native assets or supported shielded coins.
- **Browser Wallet Connect:** Web3 wallet connector supporting Midnight Lace extension.
- **Automated Settlement Daemons:** Background watcher for merchants to auto-redeem confirmed draw notes upon invoice fulfillment.

---

## Release v0.5.0 — Multi-Issuer Syndication & Delegated Policy Modules
- **Syndicated Agent Credit Facilities:** Multiple issuers co-underwriting a single credit line with shared risk.
- **Programmable Policy Packs:** Time-window spend limits, category restrictions, and merchant whitelisting enforced in zero-knowledge.
- **Dynamic Interest & Fee Accrual:** Zero-knowledge interest calculation circuits for term revolving credit.

---

## Release v1.0.0 — Portable Agent Underwriting & Cross-Chain Settlement
- **Decentralized Agent Credit Scores:** Zero-knowledge credentials proving historical repayment track records without exposing transaction history.
- **Cross-Chain Bridge Settlement:** Settlement finality bridged to Cardano and EVM ecosystems.
- **Institutional MPC Custody:** Institutional multi-party computation integrations for enterprise agent fleets.
