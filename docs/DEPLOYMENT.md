# Deployment & Operations Guide

## Overview

Line supports deployment across two environments:
1. **Midnight Preprod Testnet:** Target network for public zero-knowledge verification and multi-agent testing.
2. **Local Development Environment:** Local simulator environment powered by `@midnight-ntwrk/compact-runtime`.

---

## Toolchain Requirements

| Dependency | Required Version | Verification Command |
|---|---|---|
| **Compact Compiler** | `0.34.0` | `node scripts/compile-compact.mjs --version` |
| **Compact Language** | `0.26.0` | `node scripts/compile-compact.mjs --language-version` |
| **Compact Runtime** | `0.19.0` | `node scripts/compile-compact.mjs --runtime-version` |
| **Ledger Model** | `9.1.0.0-rc.3` | `node scripts/compile-compact.mjs --ledger-version` |
| **Node.js** | `>= 22.0.0` | `node --version` |
| **TypeScript** | `^5.7.0` | `npx tsc --version` |
| **Vite** | `^8.2.0` | `npx vite --version` |

---

## Proving Artifacts & Compilation Policy

### 1. Fast Development Build (`--skip-zk`)
```bash
npm run compact:compile
```
- **Command:** `node scripts/compile-compact.mjs --skip-zk contracts/line.compact contracts/managed/line`
- **Output:** ZKIR representations, TypeScript contract types, and `contract-manifest.json`.
- **Purpose:** Rapid local development, CI drift verification (`git diff --exit-code contracts/managed/`), and simulator test execution. Proving keys are omitted to keep the repository lightweight and deterministic.

### 2. Full Release Compilation
```bash
npm run compact:compile:release
```
- **Command:** `node scripts/compile-compact.mjs contracts/line.compact contracts/managed/line`
- **Output:** Full cryptographic proving keys (`.bincode`), verifying keys, and deployable circuit constraints.
- **Requirement:** 16GB+ RAM and substantial compilation time.

---

## Network Deployment Procedure

### Step 1: Network Configuration
Configure the following environment variables (in `.env` or CI environment):

```bash
# Target Midnight Network
export MIDNIGHT_NETWORK_ID="midnight-preprod"
export MIDNIGHT_NODE_URI="https://rpc.preprod.midnight.network"
export MIDNIGHT_INDEXER_URI="https://indexer.preprod.midnight.network"

# Deployer credentials (funded with tDUST from Midnight faucet)
export MIDNIGHT_DEPLOYER_SEED="your twelve word mnemonic or hex seed here"
```

### Step 2: Faucet & Balance Check
Ensure your deployer address has sufficient testnet `tDUST` to pay for deployment gas and contract storage fees. Obtain funds from the official Midnight Preprod faucet.

### Step 3: Dry-Run Validation
Run the deployment script in dry-run mode to verify compiled artifacts:
```bash
npm run contract:deploy
```
If credentials are not yet configured, the script outputs dry-run verification and lists the required credentials.

### Step 4: Deploy Contract
With funded credentials configured:
```bash
npm run contract:deploy
```
The script will:
1. Connect to the Midnight Preprod RPC.
2. Submit the deployment transaction with the contract bytecode.
3. Await transaction finality.
4. Output the deployed contract address and transaction hash.

### Step 5: Verify Deployment with Smoke Test
```bash
export MIDNIGHT_CONTRACT_ADDRESS="<DEPLOYED_CONTRACT_ADDRESS>"
npm run network:smoke
```

---

## Joining an Existing Contract

To connect an application instance or agent to an existing Line contract deployment:
```bash
npm run contract:join <CONTRACT_ADDRESS>
```

---

## Continuous Integration Verification

In GitHub Actions, the entire pipeline is verified on every push and pull request:
```bash
npm ci
npm run compact:compile
git diff --exit-code contracts/managed/
npm run compact:test
npm test
npm run typecheck
npm run build
npm run network:smoke
```
