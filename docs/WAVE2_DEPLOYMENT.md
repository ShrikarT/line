# WAVE2_DEPLOYMENT.md — Line Wave 2 Deployment & Proving Architecture

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
   Full ZK proving keys for 10 circuits generate hundreds of megabytes of `.bincode` constraint matrices and proving keys. Generating and checking these keys into Git repositories would slow down developer onboarding and CI runners.
2. **Simulator Compatibility**:
   The Compact simulator (`@midnight-ntwrk/compact-runtime`) executes circuits in interpreter mode via ZKIR representation, verifying arithmetic constraints, witness proofs, ledger transitions, and state commitments without needing full cryptographic proof generation.
3. **Reproducibility**:
   Compiling with `--skip-zk` produces deterministic, verifiable `contract-manifest.json` and `.zkir` files that are verified in CI for zero drift (`git diff --exit-code contracts/managed/`).

### Transition to Full ZK on Midnight Testnet (Wave 3)
To produce complete cryptographic proving and verifying keys for deployment to Midnight Preprod / Testnet:
```bash
# Full ZK compilation (requires 16GB+ RAM and substantial compilation time)
compact compile contracts/line.compact contracts/managed/line
```
This produces:
- `proving-key.bincode`
- `verifier-key.bincode`
- On-chain deployment transaction package

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
# Run all 92 automated tests (Compact simulator, reference engine, demo, MCP, model checker)
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
- `/issuer` — Issuer underwriting and reserve management desk
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
