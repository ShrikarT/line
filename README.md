# Line

**Private revolving credit and settlement authorization for autonomous agents.**

An issuer opens a confidential credit line and funds a verifiable settlement reserve pool. An agent proves in zero-knowledge that an invoice fits remaining credit capacity and that sufficient unencumbered reserve exists. A merchant receives a private, cryptographically-bound draw note redeemable once against the issuer reserve pool. An issuer-confirmed repayment restores credit capacity privately.

Wave 2 of the [Midnight Buildathon](https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG).

---

## Honest Wave 2 Boundary & Reality Check

- **Exact Settlement-Accounting Prototype**: Wave 2 implements the exact Compact settlement accounting model: on-chain reserve pools, encumbered reserve tracking, private merchant-bound draw notes ($D$), single-redemption nullifiers ($N_{\text{redeem}}$), and unencumbered reserve withdrawal protections.
- **Local Simulator Execution**: The Compact contract (`contracts/line.compact`) is written in Compact 0.26, compiled with Compact toolchain 0.34.0, and executed against `@midnight-ntwrk/compact-runtime` 0.19.0.
- **Not Deployed to Preprod**: There are no live on-chain contract addresses, Night/Dust token payouts, or live testnet transactions. Claiming a live Preprod address would be misleading.
- **Compilation Mode**: Local and CI verification uses `compact compile --skip-zk` to ensure instant builds and zero drift without distributing hundreds of megabytes of `.bincode` proving keys.

---

## What is Real vs Simulated

| Layer | Implementation Reality |
|---|---|
| **Compact Contract** (`contracts/line.compact`) | **Real Compact 0.26 source code** containing all 10 circuits, compiling cleanly with toolchain **0.34.0**. |
| **Generated Bindings** (`contracts/managed/line`) | **Real compiler output** (`--skip-zk`), checked into git and verified against compiler drift. |
| **Compact Simulator Tests** | **Real Compact execution** via `@midnight-ntwrk/compact-runtime` **0.19.0** running 39 circuit-level unit and attack tests. |
| **TypeScript Engine** (`protocol.ts`) | Strict replica of Compact encodings (`persistentHash`, `persistentCommit`) matching bytecode outputs byte-for-byte. |
| **Web Desks** (`/issuer`, `/merchant`, `/agent`, `/explorer`, `/lab`) | Interactive simulator UI for interacting with the 4 protocol roles and testing attack vectors. |
| **MCP Server** (`mcp/line-mcp.mjs`) | Standard JSON-RPC Model Context Protocol tools for autonomous AI agents. |
| **On-Chain Token Transfers** | Simulated on-chain reserve accounting. Asset bridge to Cardano/Midnight tokens is Wave 3. |

---

## Privacy Map

| Data Item | Public / Disclosed | Private / Confidential |
|---|---|---|
| **Credit Line Limits ($L$)** | ❌ Never disclosed | ✅ Kept exclusively in agent private witness |
| **Outstanding Balance ($B$)** | ❌ Never disclosed | ✅ Kept exclusively in agent private witness |
| **Invoice Amounts ($A$)** | ❌ Never disclosed | ✅ Encrypted in merchant/agent store; only commitments ($Q$, $D$) are public |
| **Merchant Identity** | ❌ Opaque in draw note $D$ | ✅ Merchant public key is committed inside private note preimage; proven in ZK |
| **Identity Commitment ($I$)** | ✅ Disclosed on ledger | ❌ Underlying agent secret is never revealed |
| **Line Commitment ($C \to C'$)** | ✅ Disclosed on ledger | ❌ Preimage parameters ($L, B$) are never revealed |
| **Reserve Totals** | ✅ Publicly auditable | ❌ Which agent or invoice encumbered what is private |
| **Transition Timing** | ✅ Disclosed via `actionClock` | ❌ Reasoning behind failures is hidden |

Failed draws always surface the generic error:
> **`Clearance could not be proven.`**

No observer can deduce whether a rejection was caused by credit capacity, reserve insolvency, merchant mismatch, default status, or bad signature.

---

## The 10 Compact Circuits

| Circuit | Role / Caller | Purpose & Invariant |
|---|---|---|
| `registerMerchant` | Issuer | Registers merchant public key in `registeredMerchants: Map<Bytes<32>, Boolean>`. |
| `fundReserve` | Issuer | Deposits liquidity into `totalReserve`. |
| `withdrawUnencumberedReserve` | Issuer | Withdraws unencumbered liquidity (`totalReserve - (encumbered + redeemed)`). |
| `openLine` | Issuer | Initializes credit line commitment $C_0$ with $B=0$, status `OPEN`. |
| `postQuote` | Merchant | Commits to opaque invoice $Q$ bound to `lineGeneration` and `contractDomain`. |
| `draw` | Agent | Proves $B+A \le L$ and reserve solvency, issues private note $D$, encumbers reserve. |
| `redeemDraw` | Merchant | Merchant opens $D$ with secret, spends $N_{\text{redeem}}$, moves encumbered to redeemed reserve. |
| `cancelOrExpireNote` | Issuer / Anyone | Releases encumbered reserve back to unencumbered if note expired unredeemed. |
| `acknowledgeRepayment` | Issuer | Proves receipt bound to current $C$, restores agent capacity privately, spends $N_{\text{repay}}$. |
| `setStatus` | Issuer | Toggles `OPEN`, `DEFAULTED`, `CLOSED`. |

---

## Cryptographic Commitments & Domain Separation

### Contract Domain
Every contract instance binds its state to an immutable contract domain generated from the constructor's `instanceNonce`:
$$\text{contractDomain} = \text{persistentHash}([\text{pad}(32, \text{"line:v2:domain"}), \text{issuerPk}, \text{initialMerchantPk}, \text{instanceNonce}])$$

### Draw Note Commitment ($D$)
When an agent draws, a merchant-bound private note is issued:
$$D = \text{persistentCommit}\langle\text{DrawNotePreimage}\rangle(\{ \text{domain}, \text{lineGen}, I, Q, \text{merchantPk}, A, \text{nonce}, \text{expiry} \}, \text{noteSalt})$$
- The on-chain `notes` map stores only $\{ A, \text{redeemed}, \text{cancelled}, \text{expiry}, \text{lineGen} \}$.
- The merchant's identity is **never recorded on the public ledger**.
- To redeem, the merchant must prove knowledge of $sk$ deriving $\text{merchantPk}$ matching the preimage opening.

### Redemption Nullifier ($N_{\text{redeem}}$)
$$N_{\text{redeem}} = \text{persistentHash}([\text{pad}(32, \text{"line:v2:redeem"}), sk_{\text{merchant}}, D, \text{contractDomain}])$$
Recorded in `nullifiers: Set<Bytes<32>>` to prevent double-redemption.

---

## 19-Step Scripted Demo Walkthrough

The demo executes a complete, non-trivial multi-merchant credit and settlement lifecycle:

0. **Genesis**: Empty ledger.
1. **Register Merchant B**: Issuer registers second merchant.
2. **Fund Reserve (500)**: Issuer deposits 500 liquidity into reserve pool.
3. **openLine 150**: Confidential line opened for agent ($L=150$).
4. **Merchant A: postQuote 40**: Merchant A posts opaque invoice $Q_{40}$.
5. **Agent: draw 40 -> Note D1**: Agent draws; note $D_1$ issued; 40 reserve encumbered.
6. **Attack: Merchant B tries to redeem D1**: Rejected: note opening invalid.
7. **Merchant A: redeem D1 (40)**: Merchant A redeems note; 40 moves from encumbered to redeemed.
8. **Attack: Merchant A tries to redeem D1 again**: Rejected: double-redemption blocked.
9. **Merchant B: postQuote 120**: Merchant B posts opaque quote $Q_{120}$.
10. **Over-limit failure**: Agent draw 120 rejected ($40 + 120 > 150$).
11. **Issuer: acknowledgeRepayment 40**: Issuer ack restores capacity ($B=0$).
12. **Merchant B: post fresh quote 120**: Fresh quote $Q_{120b}$ posted.
13. **Agent: draw 120 -> Note D2**: Agent draws 120; note $D_2$ issued; 120 reserve encumbered.
14. **Attack: Issuer tries to withdraw encumbered reserve**: Rejected: locked funds protected.
15. **Merchant B: redeem D2 (120)**: Merchant B claims 120 from reserve.
16. **Issuer: setStatus(DEFAULTED)**: Issuer marks line defaulted.
17. **Post-default draw fails**: Rejected: draws blocked while defaulted.
18. **Public Explorer Review**: Auditable proof that no private books were published.

---

## Model Checking & Test Coverage

Line maintains a comprehensive, reproducible test suite:
- **92 automated tests** passing with zero failures.
- **Cross-language commitment vectors**: Verifies that TypeScript replica produces byte-identical hashes and commitments to Compact.
- **Compact Simulator tests**: 39 contract-level tests covering all 10 circuits and attack vectors.
- **Deterministic state machine model checker**: 50 pseudo-random operations validating all 10 invariants across edge cases.
- **MCP server tests**: Validates all 8 tools and rejection handling over JSON-RPC.

---

## Quick Start

### Installation
```bash
git clone https://github.com/ShrikarT/line.git
cd line
npm install
```

### Verification & Testing
```bash
# Compile Compact contract (skip-zk for local simulation)
npm run compact:compile

# Run full test suite (92 tests)
npm test

# Run Compact simulator tests only
npm run compact:test

# Run MCP server tests
npm run mcp:test

# Typecheck and build frontend
npm run typecheck
npm run build
```

### Running Interactive Web Desks
```bash
npm run dev
```
Open `http://localhost:5173` to explore the interactive desks:
- `/` — Interactive 19-step narrative
- `/issuer` — Issuer underwriting and reserve management
- `/merchant` — Multi-merchant quote posting and note redemption
- `/agent` — Agent private console
- `/explorer` — Public explorer
- `/lab` — Security attack lab
- `/circuits` — Specification of all 10 Compact circuits

### Running Local MCP Server
```bash
npm run mcp
```

---

## Documentation Index

- [docs/WAVE2_PLAN.md](docs/WAVE2_PLAN.md) — Technical design and architecture specification
- [docs/WAVE2_SECURITY_REVIEW.md](docs/WAVE2_SECURITY_REVIEW.md) — Itemized threat model, invariants, and test matrix
- [docs/WAVE2_DEMO.md](docs/WAVE2_DEMO.md) — Detailed narrative of the 19-step lifecycle flow
- [docs/WAVE2_DEPLOYMENT.md](docs/WAVE2_DEPLOYMENT.md) — Proving key policy and deployment requirements
- [docs/ENCODING.md](docs/ENCODING.md) — Compact encoding specification
- [docs/WAVE2_PROGRESS.md](docs/WAVE2_PROGRESS.md) — Execution tracking checklist

---

## License

Apache License 2.0. See [LICENSE](LICENSE).
