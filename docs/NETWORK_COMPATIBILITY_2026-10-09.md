# Ledger 8 migration: verified feasibility and remaining gates


> **10 October canonical implementation update:** The earlier isolated investigation below is historical. Canonical source is now language 0.23; package pins, wrapper/install/CI, generated bindings and runtime adaptations use compiler 0.31.1/runtime 0.16.0. All twelve circuits/twenty witnesses are retained. Full suite: **243/243**, browser **6/6**, build and fresh-output drift passed. A fresh full release contains **52 files / 67,603,930 bytes**, source SHA-256 `fba1713ebb4a8a1c833941dbb01110e28943517e180944e8b660fd3ccd11d229`. Release validator rejects stale ledger9 metadata, modified/missing keys and source/configuration drift; a current-release pointer selects the versioned output. Native/HTTP SDK asset loading, real binding and transaction construction up to a test proof boundary passed. Wallet v4 adapter and current Preprod token configuration implemented. Actual remote proving, balancing, submission/finality and asset payout remain unverified. See [current engineering status](ENGINEERING_STATUS.md).

**Review date:** 9 October 2026. **Result:** the existing twelve-circuit Line contract can compile under the supported ledger 8 toolchain and run its generated-Compact tests and product checkout evaluator after a small, verified runtime adaptation. This establishes migration feasibility. It is **not** evidence of a network deployment, proof generation, asset backing or token payout.

No canonical contract, managed bindings, package versions, wallet scripts or credentials were changed during this investigation. Compilation and adapted execution used isolated temporary directories. The user's default compiler remained `0.34.0`, verified after the experiment. This report describes that investigation snapshot; later canonical migration work must be verified separately.

## Supported stack and the current incompatibility

The official compatibility matrix updated on 9 October lists the following tested Preprod components. It explicitly identifies compiler `0.34.0` / runtime `0.19.0` as ledger 9 components incompatible with Midnight.js `4.1.1` and the public ledger 8 networks. Matching compiler/runtime versions alone does not make a ledger 9 contract deployable through that SDK. [Official compatibility matrix](https://docs.midnight.network/relnotes/support-matrix).

| Component | Supported Preprod version in the reviewed matrix |
|---|---|
| Compact devtools | `0.5.1` |
| Compact toolchain | `0.31.1` |
| Compact runtime | `0.16.0` |
| Compact JS | `2.5.1` |
| Platform JS | `2.2.4` |
| On-chain runtime | `3.0.0` |
| Midnight.js / testkit-js | `4.1.1` |
| Wallet SDK | `1.2.0` |
| DApp Connector API | `4.0.1` |
| Node | `1.0.400` |
| Preprod indexer | `4.3.302` |
| Proof server | `8.1.3` |

The inspected project directly installs runtime `0.19.0`, which imports `@midnightntwrk/onchain-runtime-v4`. Midnight.js installs a nested runtime `0.16.0` importing `@midnight-ntwrk/onchain-runtime-v3`. Those are distinct runtime/state models. The investigation intentionally used the SDK's actual nested `0.16.0` package for isolated execution, rather than loading the root `0.19.0` package.

Compiler `0.31.1` reports language `0.23.0`, runtime `0.16.0` and compiler ledger target **`ledger-8.0.2`**. The public ledger's compatible patch release is not required to be textually identical to that compiler target. Use the supported combination and ledger major/schema compatibility; do not reject the matrix-supported combination because a node reports `8.1.2`. Do not confuse the compiler target with the running node's verified version.

## Isolation and source provenance

- Inspected local HEAD: `ab9d3d3a75dd4d8d2e6f298ca2effc03ce7e2947`, with existing local changes left intact.
- Canonical `contracts/line.compact` SHA-256 file fingerprint: `df985459d1248a5cc4becd7885a8966761d67312f8d680d0e2e8060c3a86e250`.
- Temporary source SHA-256: `eedc405a642f7d0ca6de9eb0cacd63fdbc37b731498091b4a6468bf7d8179999`.
- The temporary source changed `0.26` to `0.23` in the pragma and language comment; all circuit bodies remained unchanged. These SHA-256 values fingerprint files only; Compact commitments/hashes remained canonical `persistentCommit` / `persistentHash`.
- Isolated WSL toolchain and output root: `/tmp/line-0311-audit-20261009`.
- Isolated Windows execution root: `C:\Users\Shrikar\AppData\Local\Temp\line-0311-b128ace71d2649bd866c3fd423dc5706`.
- Compiler binary: `/tmp/line-0311-audit-20261009/versions/0.31.1/x86_64-unknown-linux-musl/compactc.bin`.
- Runtime junction in the Windows execution root targets `C:\Users\Shrikar\line\node_modules\@midnight-ntwrk\midnight-js-protocol\node_modules\@midnight-ntwrk\compact-runtime`.

Temporary paths document this run and are not portable deployment configuration. A fresh checkout must create its own temporary directories and install/check the same supported package versions.

## Reproducible compiler experiment

The `compact` manager supports explicit `+<version>` selection and `--no-set-default`. Using a separate artifact directory avoids changing the user's installed default.

```sh
/home/shrikar/.local/bin/compact \
  --directory /tmp/line-0311-audit-20261009 \
  update --no-set-default 0.31.1

/home/shrikar/.local/bin/compact \
  --directory /tmp/line-0311-audit-20261009 \
  compile +0.31.1 --version

/home/shrikar/.local/bin/compact \
  --directory /tmp/line-0311-audit-20261009 \
  compile +0.31.1 --language-version

/home/shrikar/.local/bin/compact \
  --directory /tmp/line-0311-audit-20261009 \
  compile +0.31.1 --runtime-version

/home/shrikar/.local/bin/compact \
  --directory /tmp/line-0311-audit-20261009 \
  compile +0.31.1 --ledger-version
```

Observed outputs were `0.31.1`, `0.23.0`, `0.16.0`, `ledger-8.0.2`. Compiling the unmodified canonical pragma `0.26` failed with `language version 0.23.0 mismatch`, as expected. Then the temporary source was compiled:

```sh
sed s/0.26/0.23/g \
  /mnt/c/Users/Shrikar/line/contracts/line.compact \
  > /tmp/line-0311-audit-20261009/line.compact

/home/shrikar/.local/bin/compact \
  --directory /tmp/line-0311-audit-20261009 \
  compile +0.31.1 --skip-zk \
  /tmp/line-0311-audit-20261009/line.compact \
  /tmp/line-0311-audit-20261009/migrated-output
```

This compile exited successfully. `compiler/contract-info.json` reports **12 circuits**, **20 witnesses**, compiler `0.31.1`, language `0.23.0`, runtime `0.16.0`. The twelve exported names and public argument signatures are unchanged. There are no used cross-contract calls, events or newer curve APIs requiring ledger 9. The generated ZKIR uses version 2. `--skip-zk` does not generate or validate proving keys.

## Exact source/runtime adaptations required

| Location | Current `0.19` form | Verified `0.16` form |
|---|---|---|
| Contract pragma | `pragma language_version 0.26;` | `pragma language_version 0.23;` |
| Direct runtime package | `@midnight-ntwrk/compact-runtime@0.19.0` | Exact `0.16.0`, matching freshly regenerated bindings |
| `src/lib/line/encoding.ts` import and `encodeU64` | `convertBigintToBytes(32, n, src)` | `convertFieldToBytes(32, n, src)` |
| `src/lib/line/compact-harness.ts`, circuit context construction | `RT.createCircuitContext(op.name, CONTRACT_ADDR, COIN_PK, before, ps)` | `RT.createCircuitContext(CONTRACT_ADDR, COIN_PK, before, ps)` |
| Harness result state | `result.context.callContext.currentQueryContext.state` | `result.context.currentQueryContext.state` |
| Harness result private state | `result.context.callContext.currentPrivateState` | `result.context.currentPrivateState` |
| Direct transcript inspection | `result.context.callProofDataTrace[…].publicTranscript` | `result.proofData.publicTranscript` |

`convertFieldToBytes` is the **actual exported runtime `0.16` function used by compiler `0.31.1`'s generated `_encodeU64_0`**. It is not an invented helper or a replacement cryptographic hash. Existing Uint64 validation in `encoding.ts` remains. `createConstructorContext(privateState, coinPublicKey)` retains the existing argument order.

Repository search found direct context accesses in the canonical harness and the historical `docs/audit-2026-10-07-repro.mjs` at lines 19, 20 and 50. The versioned audit script is evidence for its original environment; if it is advertised as runnable on the migrated current stack, its context/transcript accesses must be adapted or its historical runtime prerequisite made explicit. Generated files must be regenerated from Compact, not hand patched.

## Executed regression evidence

The Windows temporary root contains copies of the selected Line sources and deterministic test fixtures, the newly compiled managed output and the SDK's runtime `0.16.0`. Only the temporary harness context accesses and encoding conversion were adapted. No credential files or user wallet state were copied.

From that temporary root:

```powershell
node --experimental-strip-types --test `
  src/lib/line/compact.test.ts src/lib/line/encoding.test.ts
```

**Result: 67 tests, 17 suites, 67 passed, 0 failed, 0 skipped.** The tests exercise constructor/domain derivation, issuer authorization, registry, reserve accounting, private opening, quote/draw reconstruction, merchant redemption, replay rejection, cancellation, repayment, lifecycle/generation, cross-instance rejection, fees, disabled merchants, expiry headroom and cross-language commitment vectors.

Current checkout engine, HTTP adapter and both checkout test files were then copied into the same temporary root and run against that adapted harness and freshly compiled contract:

```powershell
node --experimental-strip-types --test `
  server/checkout.test.ts server/checkout-resilience.test.ts
```

**Result: 13 tests, 2 suites, 13 passed, 0 failed, 0 skipped.** This includes useful service results, over-credit and exhausted-reserve declines, revolving acknowledgement, distinct merchants, incorrect merchant/replay rejection, duplicate request terms, live-session recovery, configuration retries, HTTP role boundaries, cross-origin/content rejection, bounded constructor work and malformed bearer rejection.

A separate check in that execution root printed:

```json
{
  "runtime": "0.16.0",
  "compiler": "0.31.1",
  "language": "0.23.0",
  "expectedRuntime": "0.16.0",
  "circuits": 12,
  "witnesses": 20,
  "manifestExists": false
}
```

These results establish compatibility for the exercised generated contract and checkout behavior. Existing tests whose names imply full observer privacy do not inspect every transcript/history inference; passing them does **not** resolve the audit's historical debt disclosure or merchant linkage findings. The separate checkout evaluator accurately remains shared-process custody, ephemeral sessions, evaluation units and no connected payout.

## Metadata, proving assets and scripts

Compiler `0.31.1` emits `compiler/contract-info.json`, generated JS/types/source map and twelve ZKIR files. In this clean `--skip-zk` output it emits **no `compiler/contract-manifest.json`**. The current locally modified deployment script requires that manifest at lines 75–85, so it must be made compatible with the real compiler metadata without overwriting unrelated user wallet edits.

An in-place `--skip-zk` compile can leave old `0.34` manifest files or ignored `keys/` assets in the output directory. Those stale artifacts must not be treated as evidence of a complete ledger 8 release. Generate full proving/verifier assets into a clean, versioned output directory, verify all twelve expected files and hashes, and publish the matching JS/ZKIR/keys as one release. Do not copy ledger 9 keys into ledger 8 output. Recompile managed bindings twice after the intentional migration and confirm the second run produces zero drift.

Required project follow-through:

1. Change Compact pragma first and compile with explicit toolchain `0.31.1` to regenerate bindings.
2. Pin the runtime to exact `0.16.0`; update project version metadata, installation script, compile wrappers and CI compiler selection. The wrapper should select the project version, rather than relying on whichever compiler the user last made default.
3. Apply the verified encoding/context adaptations and run the full current unit, checkout, build and browser suites. The isolated 80-test evidence does not replace the entire canonical suite.
4. Adjust deployment preparation for actual `contract-info.json` metadata, full-key validation and a supported version manifest. Preserve existing user-owned wallet work.
5. Align browser/CLI endpoint configuration, wallet SDK/connector adapters, proof server and asset hosting with the verified target environment.
6. Generate full keys, verify the real SDK binding/execution/proving/balancing path and record confirmed target-network transactions before claiming deployment.

The investigation makes the compiler/runtime migration concrete and reviewable. Wallet adaptation, deployment preparation, proof assets, receipt confirmation, economic settlement and full product privacy remain distinct required work.
