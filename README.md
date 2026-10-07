# Line

**Private spending guardrails and checkout infrastructure for autonomous agents.**

> An autonomous agent proves that a purchase fits its issuer-backed credit line without exposing its private credit book.

---

## Problem

Autonomous AI agents are increasingly tasked with procurement, API billing, server provisioning, and automated commerce. However, existing payment and credit primitives force an unacceptable trade-off:
- **Exposed Corporate Books:** Providing agents with open balance sheets or corporate credit cards leaks private limits, available treasury balances, and cash flows to merchants and public blockchains.
- **Pre-funded Fragmented Wallets:** Locking discrete balances into hundreds of agent wallets is capital inefficient and creates unmanageable balance fragmentation.
- **Unverified Invoices:** Merchants lack cryptographic guarantees that an autonomous agent's purchase authorization is backed by a solvent underwriter.
- **Why not x402 / prefunded wallets:** x402 moves money with no privacy and no credit/budget semantics — every payment is a naked transfer. Prefunded agent wallets trap liquidity and are theft targets. Line provides the private budget-guardrail layer underneath.

---

## How Line Works

Line solves this by separating **confidential credit capacity** from **verifiable on-chain settlement claims**:

```text
  ┌──────────────┐         1. Establishes Line & Reserve         ┌─────────────────────────┐
  │    Issuer    │ ────────────────────────────────────────────> │ Line Compact Contract   │
  └──────────────┘                                               │ (Domain-Isolated State) │
                                                                 └─────────────────────────┘
                                                                   ▲                     ▲
                       2. Posts Opaque Quote (Q)                   │                     │
      ┌────────────────────────────────────────────────────────────┤                     │
      │                                                            │                     │
┌──────────────┐               3. Generates ZK Proof & Draws       │                     │
│   Merchant   │ <─────────────────────────────────────────────────┘                     │
└──────────────┘                                                                         │
      │                        4. Redeems Claim Note (D) via Nullifier (N)               │
      └──────────────────────────────────────────────────────────────────────────────────┘
```

1. **Credit Underwriting:** An issuer establishes a credit facility with a confidential limit $L$ and allocates settlement capacity in an on-chain reserve pool.
2. **Merchant Quoting:** A registered merchant posts an opaque quote commitment $Q$ for an invoice without revealing pricing parameters publicly.
3. **Autonomous ZK Draw:** The agent client-side evaluates the invoice against its private limit and debt ($B + A + F \le L$). The agent executes the `draw` circuit, rotating state $C \to C'$, encumbering reserve capacity, and emitting a merchant-bound private claim note $D$.
4. **Guaranteed Claim Redemption:** The designated merchant proves ownership of note $D$ in zero-knowledge and redeems it once against the issuer's reserve.
5. **Private Repayment:** Issuer-confirmed repayments restore the agent's revolving capacity without public ledger disclosure.

---

## Architectural Pillars

### 1. Zero-Knowledge Credit Books (Witness-Private)
The agent's credit limit $L$, outstanding balance $B$, epoch, and per-quote invoice amounts exist exclusively within private circuit witnesses. Observers inspecting the contract ledger see only the state commitment $C = \text{persistentCommit}(\{ \text{domain}, I, L, B, \text{epoch} \}, \text{salt})$. If an agent attempts an over-limit purchase, the transaction rejects with a generic error:
> **`Clearance could not be proven.`**

### 2. Verified Reserve Pool Solvency & Issuer Fees
Active draw notes are irrevocably backed by an on-chain reserve pool:
$$\text{withdrawableReserve} = \text{totalReserve} - (\text{encumberedReserve} + \text{redeemedReserve} + \text{feeReserve})$$
- Active notes encumber reserve capacity on-chain.
- The issuer is cryptographically barred from withdrawing encumbered funds backing outstanding claims.
- Protocol fees accrue to `feeReserve` and are withdrawable only by the issuer via `withdrawFees`.

### 3. Multi-Merchant Claim Isolation & Unlinkability
Merchants register with unique cryptographic pseudonyms (`merchantPk`). Draw notes commit privately to the designated merchant's identity. In `draw`, the agent proves in zero-knowledge that the merchant is on the registered allowlist without revealing which merchant was selected. Merchant B cannot redeem a claim note issued to Merchant A.

### 4. Instance-Level Domain Separation
Every contract instance derives an immutable `contractDomain` from an `instanceNonce` supplied at initialization. State commitments, quotes, notes, and nullifiers are strictly bound to this domain, preventing cross-contract replay attacks.

---

## Privacy Model & Information Boundaries

Line maintains an honest, machine-checked privacy boundary verified in `src/lib/line/leakage.test.ts`:

| Data Item | Public on Ledger | Private to Witness | Notes / Mitigations |
|---|---|---|---|
| **Credit Limit ($L$)** | ❌ Never disclosed | ✅ Private to Agent | Concealed in commitment $C$. |
| **Current Debt ($B$)** | ❌ Never disclosed | ✅ Private to Agent | Concealed in commitment $C$. |
| **Available Capacity** | ❌ Never disclosed | ✅ Private to Agent | Circuit evaluates $B + A + F \le L$ in zero-knowledge. |
| **Agent Secret ($k$)** | ❌ Never disclosed | ✅ Private to Agent | Identity is committed as $I = \text{agentId}(k)$. |
| **Per-Quote Amount** | ❌ Not in `QuoteMeta` | ✅ Private in witness | Sealed inside $Q$ commitment until settlement. |
| **Settled Amount ($A$)** | ⚠️ Public in `NoteMeta` | ❌ | Note metadata publishes $A$ to verify public escrow solvency. |
| **Reserve Deltas ($\Delta$)** | ⚠️ Public state deltas | ❌ | Anonymous flows for public solvency verification. |
| **Merchant Identity** | ❌ Unlinkable in `QuoteMeta` | ✅ Private in Note $D$ | Agent proves allowlist membership in ZK. |

See [docs/PRIVACY.md](docs/PRIVACY.md) for the complete field-by-field privacy inventory and delta-inference analysis.

---

## The 12 Compact Circuits

The contract is formally specified in `contracts/line.compact`:

| Circuit | Role | Purpose |
|---|---|---|
| `registerMerchant` | Issuer | Whitelists verified merchant public key in registry. |
| `disableMerchant` | Issuer | Deactivates a merchant; blocks new quotes, existing quotes stay live. |
| `fundReserve` | Issuer | Allocates settlement capacity to the reserve pool. |
| `withdrawUnencumberedReserve` | Issuer | Withdraws unencumbered reserve; active claims are protected. |
| `withdrawFees` | Issuer | Pays out the accrued issuer fee reserve. |
| `openLine` | Issuer | Initializes private credit facility commitment $C_0$ with witness limit. |
| `postQuote` | Merchant | Posts opaque quote commitment $Q$ for purchase invoice. |
| `draw` | Agent | Proves $B + A + F \le L$, rotates $C \to C'$, encumbers reserve, emits note $D$. |
| `redeemDraw` | Merchant | Proves note ownership in ZK, redeems note once via nullifier $N_{\text{redeem}}$. |
| `cancelOrExpireNote` | Authorized | Reclaims encumbered reserve for notes expired unredeemed. |
| `acknowledgeRepayment` | Issuer | Confirms off-chain payment, restores capacity via nullifier $N_{\text{repay}}$. |
| `setStatus` | Issuer | Toggles facility status (`OPEN`, `DEFAULTED`, `CLOSED`). |

### Proving Key & Constraint Matrix (Toolchain 0.34.0 — October 4, 2026)

Full zero-knowledge proving and verifying key generation across all 12 circuits (`compact compile contracts/line.compact contracts/managed/line` without `--skip-zk`):

| Circuit | Rows | Halo2 Scale ($k$) | Prover Key Size | Verifier Key Size |
|---|---|---|---|---|
| `registerMerchant` | 4,445 | $k=13$ | 2.69 MB | 2.07 KB |
| `disableMerchant` | 4,442 | $k=13$ | 2.69 MB | 2.07 KB |
| `fundReserve` | 4,338 | $k=13$ | 2.69 MB | 2.07 KB |
| `withdrawUnencumberedReserve` | 4,346 | $k=13$ | 2.69 MB | 2.07 KB |
| `withdrawFees` | 4,237 | $k=13$ | 2.69 MB | 2.07 KB |
| `openLine` | 12,723 | $k=14$ | 4.98 MB | 2.07 KB |
| `postQuote` | 15,564 | $k=14$ | 4.98 MB | 2.07 KB |
| `draw` | 39,262 | $k=16$ | 18.60 MB | 2.07 KB |
| `redeemDraw` | 19,565 | $k=15$ | 9.51 MB | 2.07 KB |
| `cancelOrExpireNote` | 386 | $k=9$ | 0.15 MB | 1.32 KB |
| `acknowledgeRepayment` | 21,623 | $k=15$ | 9.53 MB | 2.07 KB |
| `setStatus` | 4,242 | $k=13$ | 2.69 MB | 2.07 KB |

- **Total Key Size**: 63.92 MB (67,022,121 bytes across 12 `.prover` and 12 `.verifier` artifacts)
- **Compiler**: Compact `0.34.0` (`pragma language_version 0.26`, runtime `0.19.0`, ledger `9.1.0.0-rc.3`)
- **Repository Bindings**: Retained as deterministic `--skip-zk` managed bindings (zero drift verified)

---

## Runtime Architecture

```text
LineRuntime (Interface)
├── MidnightNetworkRuntime   (Production Midnight network RPC, indexer, and wallet)
├── LocalDevelopmentRuntime (Local Compact simulator with developer environment indicators)
└── InMemoryTestRuntime      (Isolated in-memory execution for unit tests)
```

- **Production Path:** `MidnightNetworkRuntime` connects to Midnight network RPC and browser wallet extensions. If credentials or network configuration are missing, it fails clearly with actionable setup instructions.
- **Developer Path:** `LocalDevelopmentRuntime` runs the compiler-generated contract bindings against a local environment.
- **Test Path:** `InMemoryTestRuntime` runs isolated test suites with zero external dependencies.

---

## Installation & Setup

### Prerequisites
- Node.js `>= 22.0.0`
- Compact compiler `0.34.0` (installed natively or via WSL on Windows)

```bash
git clone https://github.com/ShrikarT/line.git
cd line
npm ci
```

---

## Development & Testing

```bash
# 1. Compile Compact contract (generates ZKIR and TypeScript bindings)
npm run compact:compile

# 2. Verify zero drift in generated contract bindings
git diff --exit-code contracts/managed/

# 3. Run complete verification suite (145 passing tests across 32 suites)
npm test

# 4. Run Compact simulator and cross-language vector tests only
npm run compact:test

# 5. Run privacy and state-delta leakage tests
npm run test:leakage

# 6. Typecheck and build frontend
npm run typecheck
npm run build
```

---

## Running the Application

Start the local Vite development server:
```bash
npm run dev
```
Navigate to `http://localhost:5173`:
- `/`: Product Landing Page & Protocol Architecture
- `/issuer`: Issuer Underwriting & Reserve Management
- `/merchant`: Merchant Console & Claim Note Redemption (Merchants A & B)
- `/agent`: Autonomous Agent Private Console
- `/explorer`: Public Zero-Knowledge Explorer
- `/lab`: Security Invariant & Attack Lab
- `/circuits`: Compact Circuit Specification Inspector
- `/roadmap`: Capability Roadmap

---

## Agent Integration via Model Context Protocol (MCP)

Line provides a standard Model Context Protocol (MCP) server for autonomous agents over JSON-RPC:

```bash
# Run production MCP server
npm run mcp

# Run local development MCP server
npm run mcp:dev
```

Supported MCP tools:
- `line.status`: Query public contract status, action clock, and commitments.
- `line.reserve.status`: Query real-time reserve breakdown.
- `line.quote`: Post purchase quote commitment.
- `line.draw`: Execute client-side capacity proof and draw note generation.
- `line.note.status`: Check claim note redemption and expiry status.
- `line.redeem`: Merchant zero-knowledge claim redemption.
- `line.expireNote`: Cancel or release expired notes.
- `line.withdrawFees`: Issuer fee withdrawal.
- `line.disableMerchant`: Issuer merchant deactivation.
- `line.repay`: Issuer repayment confirmation.
- `line.seed`: Load deterministic lifecycle test snapshots.

See [docs/MCP.md](docs/MCP.md) for tool schemas and integration examples.

---

## Network Deployment

To deploy Line to the Midnight Preprod testnet:

1. Configure network variables:
```bash
export MIDNIGHT_NETWORK_ID="midnight-preprod"
export MIDNIGHT_NODE_URI="https://rpc.preprod.midnight.network"
export MIDNIGHT_INDEXER_URI="https://indexer.preprod.midnight.network"
export MIDNIGHT_DEPLOYER_SEED="your funded mnemonic here"
```

2. Validate and deploy:
```bash
# Dry run verification
npm run contract:deploy

# Run network smoke test
npm run network:smoke
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full deployment instructions.

---

## Documentation Directory

- [docs/PRODUCT_ARCHITECTURE.md](docs/PRODUCT_ARCHITECTURE.md) — Technical architecture and circuit designs
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — Cryptographic specifications, commitment schemes, and nullifiers
- [docs/PRIVACY.md](docs/PRIVACY.md) — Machine-checked privacy inventory and state-delta leakage analysis
- [docs/SECURITY.md](docs/SECURITY.md) — Itemized threat matrix, formal invariants, and attack defenses
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Testnet deployment, compilation policy, and toolchain versions
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — Developer setup and local workflows
- [docs/MCP.md](docs/MCP.md) — Model Context Protocol tools for autonomous agents
- [docs/PRODUCT_WALKTHROUGH.md](docs/PRODUCT_WALKTHROUGH.md) — Detailed 19-step multi-role lifecycle walkthrough
- [docs/ENGINEERING_STATUS.md](docs/ENGINEERING_STATUS.md) — Delivery tracking and component checklist
- [docs/ROADMAP.md](docs/ROADMAP.md) — Capability-driven product roadmap

---

## Security & Audit Limitations

- **Internal Verification:** Line has undergone automated model checking across 50 pseudo-random transitions and maintains 182 automated tests across 38 test suites.
- **Audit Limitation:** Line has not yet been audited by an independent external cybersecurity firm. Production deployments with institutional funds must follow a formal security audit.
- **Client Custody:** Browser storage uses WebCrypto AES-GCM 256-bit encryption for local testing. Institutional production deployments must use dedicated hardware security modules (HSM) or institutional MPC signers.

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
