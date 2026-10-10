# WAVE2_DEPLOYMENT.md — Line Wave 2 Deployment & Proving Architecture

> **Archive notice (10 October 2026):** Historical deployment/proving snapshot. Versions, network status, proving and toolchain statements below are superseded. Use [DEPLOYMENT.md](DEPLOYMENT.md), [NETWORK_COMPATIBILITY_2026-10-09.md](NETWORK_COMPATIBILITY_2026-10-09.md), and [ENGINEERING_STATUS.md](ENGINEERING_STATUS.md).

## 1. Deployment Overview & Status

Line Wave 2 is deployed as a **reproducible local Compact simulator and settlement engine**.

- **Compact Contract**: `contracts/line.compact` (language version `0.26.0`, toolchain `0.34.0`).
- **Managed Bindings**: `contracts/managed/line` contains the compiler artifacts (manifest, compiler metadata, ZKIR circuits, and TypeScript interface).
- **Execution Target**: `@midnight-ntwrk/compact-runtime` `0.19.0` WASM simulator running in Node 22 and modern browsers.
- **Midnight Network Deployment**: **Not deployed to Midnight Preprod or Mainnet**. There are no live contract addresses, on-chain transaction hashes, or real token transfers. Any claim of a deployed Preprod contract address would be unverified and false.

---

## 2. Toolchain Versions & Requirements

| Component | Required Version | Purpose |
|---|---|---|
| **Compact Compiler** | `0.34.0` | Compiles `.compact` source to ZKIR and managed bindings |
| **Compact Language** | `0.26.0` | Compact syntax specification (`pragma language_version 0.26`) |
| **`@midnight-ntwrk/compact-runtime`** | `0.19.0` | Runtime ledger simulator, ZKIR interpreter, and commitment types |
| **Ledger (Compiler)** | `9.1.0.0-rc.3` | Ledger model targeted by the compiler |
| **Node.js** | `>= 22.0.0` | Native TypeScript stripping (`--experimental-strip-types`) |
| **Vite** | `8.x` / `v8.3.0` | Frontend web desk bundle |

---

## 3. Proving Key Policy (`--skip-zk`)

In local development and automated CI environments, `contracts/line.compact` is compiled using:
```bash
compact compile --skip-zk contracts/line.compact contracts/managed/line
```

### Rationale
1. **Compilation Speed & Asset Size**:
   Full ZK proving keys for 12 circuits generate hundreds of megabytes of `.bincode` constraint matrices and proving keys. Generating and checking these keys into Git repositories would slow down developer onboarding and CI runners.
2. **Simulator Compatibility**:
   The Compact simulator (`@midnight-ntwrk/compact-runtime`) executes circuits in interpreter mode via ZKIR representation, verifying arithmetic constraints, witness proofs, ledger transitions, and state commitments without needing full cryptographic proof generation.
3. **Reproducibility**:
   Compiling with `--skip-zk` produces deterministic, verifiable `contract-manifest.json` and `.zkir` files that are verified in CI for zero drift (`git diff --exit-code contracts/managed/`).

### 3.1 Full ZK Keygen Constraint & Key Size Matrix (October 4, 2026)

Full zero-knowledge proving and verifying keys generated via `compact compile contracts/line.compact contracts/managed/line` (Compact compiler `0.34.0`, language `0.26.0`, runtime `0.19.0`, ledger `9.1.0.0-rc.3`):

| Circuit | Rows | Halo2 Scale ($k$) | Prover Key Size | Verifier Key Size | Prover File | Verifier File |
|---|---|---|---|---|---|---|
| `registerMerchant` | 4,445 | $k=13$ | 2.69 MB | 2.07 KB | `registerMerchant.prover` | `registerMerchant.verifier` |
| `disableMerchant` | 4,442 | $k=13$ | 2.69 MB | 2.07 KB | `disableMerchant.prover` | `disableMerchant.verifier` |
| `fundReserve` | 4,338 | $k=13$ | 2.69 MB | 2.07 KB | `fundReserve.prover` | `fundReserve.verifier` |
| `withdrawUnencumberedReserve` | 4,346 | $k=13$ | 2.69 MB | 2.07 KB | `withdrawUnencumberedReserve.prover` | `withdrawUnencumberedReserve.verifier` |
| `withdrawFees` | 4,237 | $k=13$ | 2.69 MB | 2.07 KB | `withdrawFees.prover` | `withdrawFees.verifier` |
| `openLine` | 12,723 | $k=14$ | 4.98 MB | 2.07 KB | `openLine.prover` | `openLine.verifier` |
| `postQuote` | 15,564 | $k=14$ | 4.98 MB | 2.07 KB | `postQuote.prover` | `postQuote.verifier` |
| `draw` | 39,262 | $k=16$ | 18.60 MB | 2.07 KB | `draw.prover` | `draw.verifier` |
| `redeemDraw` | 19,565 | $k=15$ | 9.51 MB | 2.07 KB | `redeemDraw.prover` | `redeemDraw.verifier` |
| `cancelOrExpireNote` | 386 | $k=9$ | 0.15 MB | 1.32 KB | `cancelOrExpireNote.prover` | `cancelOrExpireNote.verifier` |
| `acknowledgeRepayment` | 21,623 | $k=15$ | 9.53 MB | 2.07 KB | `acknowledgeRepayment.prover` | `acknowledgeRepayment.verifier` |
| `setStatus` | 4,242 | $k=13$ | 2.69 MB | 2.07 KB | `setStatus.prover` | `setStatus.verifier` |

- **Total Key Size**: 63.92 MB (67,022,121 bytes across 24 `.prover` and `.verifier` artifacts)
- **Repository Policy**: Prover and verifier binaries are intentionally excluded from git tracking to maintain small repo footprint; deterministic `--skip-zk` managed bindings are committed.

---

## 4. Reproducible Local Execution

### 4.1 Installing the Environment
```bash
# Clone and install dependencies
git clone https://github.com/ShrikarT/line.git
cd line
npm install

# Install Compact toolchain 0.34.0
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.34.0
```

### 4.2 Verifying Contract Compilation
```bash
npm run compact:compile
```
This verifies that `contracts/line.compact` compiles cleanly without warnings or errors.

### 4.3 Running the Full Verification Suite
```bash
# Run all 182 automated tests across 38 suites (Compact simulator, reference engine, demo, MCP, model checker)
npm test

# Run Compact simulator contract tests specifically
npm run compact:test

# Run MCP test suite
npm run mcp:test

# Verify TypeScript types and build
npm run typecheck
npm run build
```

### 4.4 Launching Interactive Desks
```bash
npm run dev
```
Open `http://localhost:5173` to access the interactive web desks:
- `/` — Interactive 19-step narrative
- `/issuer` — Finance-admin budget issuance and reserve management desk
- `/merchant` — Multi-merchant quote posting and note redemption desk
- `/agent` — Agent private console
- `/explorer` — Public explorer
- `/lab` — Interactive security attack lab
- `/circuits` — Specification of all 10 Compact circuits

### 4.5 Running the Local MCP Server
Line includes a local Model Context Protocol (MCP) server for autonomous agents:
```bash
npm run mcp
```
The server exposes 8 JSON-RPC tools (`line.status`, `line.reserve.status`, `line.seed`, `line.quote`, `line.draw`, `line.note.status`, `line.redeem`, `line.repay`) over stdin/stdout.
