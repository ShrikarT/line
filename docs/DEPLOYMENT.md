# Deployment and release operations

Updated: 10 October 2026. Public Preprod is the integration target; no confirmed deployment or asset payout is established by this document. Local `/checkout` executes generated logic without submitting proofs or payments. [Readiness](PRODUCT_DIRECTION.md) needs separate network, funding, delivery and payout evidence.

## Selected compatible stack

| Component | Selected target / requirement |
|---|---|
| Compact compiler | `0.31.1` |
| Compact language | `0.23` |
| Compact runtime | `0.16.0` |
| Compiler ledger model | `8.0.2`; public ledger major 8 |
| Midnight.js | `4.1.1` |
| DApp Connector API | `4.0.1` |
| Proof server | `8.1.3` |
| Wallet SDK | Pinned `1.2.0`; browser adapter locally tested, funded CLI execution unverified |
| Node.js | `22.18+`; locally evaluated with `26.7.0` |

Migration must regenerate artifacts and pass current checks; this is a selected stack, not proof every installed component matches or a transaction succeeded. Inspect package metadata, compiler queries, compiler/contract-info.json, Line-owned line-release.json and service versions. [Official matrix](https://docs.midnight.network/relnotes/support-matrix).

Previous compiler 0.34 / runtime 0.19 artifacts target ledger 9 and are incompatible with the public stack. Changing endpoints or combining old JavaScript with the new runtime does not fix this. Historical 0.34 proving-key metrics are not current release evidence. Native/WSL installations must select the same compiler; avoid bare updates selecting a different newest version.

## Compile and verify without funded activity

```bash
npm ci
npm run compact:compile
git diff --exit-code contracts/managed/
npm run compact:test
npm test
npm run typecheck
```

`compact:compile` uses `--skip-zk`, emitting managed code/types and ZKIR, not the full key package. For intentional source/compiler changes review the regenerated delta; after accepting that baseline, repeat compilation should produce zero content drift.

Before a deployable release:

```bash
npm run compact:compile:release
npm run compact:release:validate
```

The command compiles into a new versioned directory under `.compact-keys/releases/`, refuses existing output, validates and seals hashes in `line-release.json`, and publishes `.compact-keys/current-release.json` only after success. Deployment validates that pointer or explicit `LINE_ZK_DIR` before wallet initialization. Older `.compact-keys/line` is not overwritten.

Generate all twelve binary `.bzkir`, `.prover` and `.verifier` artifacts for the exact source/compiler/runtime. Record hashes, sizes, source commit and proof-server version; verify every key matches the release. Do not reuse 0.34 keys or metrics, invent minimum hardware requirements or equate key generation with a proving benchmark. Resource/time requirements need actual release-environment measurement.

The pinned wrapper forwards these compiler queries:

```bash
node scripts/compile-compact.mjs --version
node scripts/compile-compact.mjs --language-version
node scripts/compile-compact.mjs --runtime-version
node scripts/compile-compact.mjs --ledger-version
```

Inspect actual output. Compilation/tests need no wallet credentials.

## Preprod endpoints changed on 9 October

Midnight-hosted Preprod RPC/indexer retirement starts **22:00 UTC on 9 October 2026**, or **03:30 IST on 10 October 2026**. Blockfrost supplies replacement Preprod endpoints requiring a Midnight Preprod project token. Preview endpoints remain unchanged; do not silently substitute Preview for Preprod. [Official endpoints](https://docs.midnight.network/relnotes/network).

| Service | Preprod base |
|---|---|
| Node RPC | `https://rpc.midnight-preprod.blockfrost.io` |
| Node WebSocket | `wss://rpc.midnight-preprod.blockfrost.io` |
| Indexer GraphQL | `https://midnight-preprod.blockfrost.io/api/v0` |
| Indexer WebSocket | `wss://midnight-preprod.blockfrost.io/api/v0/ws` |

Append `?project_id=<PREPROD_PROJECT_TOKEN>` as the provider documents. A Mainnet token does not authenticate Preprod. Configure node/indexer/WebSocket consistently in browser and CLI. Treat token-containing URLs as credentials in logs/evidence; browser-delivered tokens are visible to that operator and require an intentional provider/proxy policy.

Browser runtime and deploy/join/smoke scripts share current defaults and accept `MIDNIGHT_BLOCKFROST_PROJECT_ID`. Retired endpoints are rejected; explicit custom services remain supported. Verify transport before network operations. A proof service, commonly configured at `http://127.0.0.1:6300`, is separate; its URL does not prove version 8.1.3 or its witness-confidentiality boundary.

## Deployment preparation

Inspect actual scripts/providers before giving them a funded wallet. **`npm run contract:deploy` is not a dry run** and can attempt funded activity. An absent-credential failure is not deployment validation.

1. Complete migration and exact encoding/generated-execution checks. Validate provider/wallet key/transaction interfaces against installed SDK types.
2. Generate/verify full assets and configure the ZK provider to their exact release.
3. Prepare a network-matching wallet and supported resource/faucet flow. A wallet resource balance or reserve counter does not prove a cash deposit.
4. Use secure environment/secret management. The script reads `MIDNIGHT_DEPLOYER_MNEMONIC` and legacy `MIDNIGHT_DEPLOYER_SEED`; inspect its exact phrase validation. Never place recovery phrases in tracked files/public evidence.
5. Configure `MIDNIGHT_NETWORK_ID`, `MIDNIGHT_NODE_URI`, `MIDNIGHT_INDEXER_URI`, `MIDNIGHT_INDEXER_WS_URI`, `MIDNIGHT_PROOF_SERVER_URI`. Match the SDK/wallet canonical network identifier rather than substituting prose labels.
6. Required: supply exact 32-byte `MIDNIGHT_ISSUER_PK` / `MIDNIGHT_INITIAL_MERCHANT_PK` public keys and instance nonce. Derive keys with `encoding.ts` tagged Compact primitives, not untagged shortcuts. Verify intended secrets authenticate generated circuits.
7. `MIDNIGHT_STORAGE_PASSWORD` is required (at least 16 characters), through the SDK password callback. Make private-state encryption recoverable with the correct provider password callback and durable secrets. An ephemeral generated password is not recovery.
8. Use bounded sync/submission/finalization waits and cleanup. Repair unresolved audit blockers before funded operations; scripts existing is not acceptance.

The deployment header describes other key/domain/storage/cache settings. Preserve legitimate local wallet configuration during integration and never print/overwrite credentials to diagnose version mismatches.

## Execution and acceptance

After preparation, `npm run contract:deploy` is the deployment action. Successful deployment needs finalized success, exact address, independently decoded constructor/public state and artifact hashes. Submission hash or connected wallet alone is insufficient.

Inspect an already confirmed deployment with:

```bash
npm run contract:join -- <CONTRACT_ADDRESS>
```

Configure its address and use:

```bash
npm run network:smoke
```

Connectivity does not prove a write lifecycle. Capture confirmed fund/open/quote/draw/redemption/repayment/status transactions and independently decode state. Exercise wrong merchant, replay, rejected clearance and recovery through actual providers/roles.

Actual funding/payout is separate. Current Compact reserve/redemption counters do not move tokens. Attach rail-specific payment receipts and reconciliation before claiming settlement.

## Browser asset serving

Vite dev/preview serves only validated keys and binary ZKIR at `/line-zk`, verifies requested file hashes and rejects missing/stale releases. Network setup resolves an absolute root. Static hosting does not publish the ignored release directory automatically; supply matching assets and a suitable CORS/cache policy.

## CI and evidence

Read `.github/workflows/ci.yml` for actual executed CI. Do not list browser/network checks as CI when absent. Retain current compiler/tests/build/scanner/artifact results and separately authorized network/payment evidence. [Engineering status](ENGINEERING_STATUS.md), [audit](FULL_AUDIT_2026-10-07.md), [pitch checklist](PITCH.md).
