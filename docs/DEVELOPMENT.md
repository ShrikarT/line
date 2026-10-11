# Developer guide

Updated: 9 October 2026. Use Node **22.18+** for native TypeScript stripping; the local evaluation uses **26.7.0**. Selected Compact migration: compiler **0.31.1**, language **0.23**, runtime **0.16.0**, compiler ledger model **8.0.2**. Public environments use ledger major 8. [Deployment stack and acceptance](DEPLOYMENT.md).

## Install and run

```bash
git clone https://github.com/ShrikarT/line.git
cd line
npm ci
npm run dev
```

Open `http://localhost:5173/checkout`. Managed code supports generated local execution; regeneration needs the selected compiler. Vite dev/preview middleware supplies the HTTP API. Static `dist/` hosting alone does not supply it. Build plus `npm run preview` evaluates the production frontend locally, not public-network proofs/payments.

The plan buys A's text analysis and B's processing estimate. The default 40-unit limit and 200-unit reserve allow A's 25-unit purchase and decline B's 20-unit purchase. Issuer acknowledgment of 25 units followed by **Retry declined purchase** reuses delivered A and makes a new B attempt. [Walkthrough](PRODUCT_WALKTHROUGH.md) explains custody/capabilities/expiry/retries.

All evaluation roles share one process. Default sessions are volatile; [optional encrypted checkpoint configuration](CHECKOUT_DURABILITY_2026-10-10.md) enables generated-checkout server restart recovery. Generated circuits execute without submitted proofs or token transfers. `LocalDevelopmentRuntime` and `InMemoryTestRuntime` separately use the TypeScript model. Consoles acquire [encrypted candidate journals](OPERATION_RECOVERY_2026-10-10.md), but their local model resets on page reload. Role desks/Attack Lab retain independent-custody and other audit limitations.

## Contract workflow

Select the compiler explicitly, e.g. `compact update 0.31.1` after installing developer tools. Native Linux/macOS and Windows WSL should match. Inspect compiler wrapper, installer and CI to avoid default-newest version selection.

```bash
npm run compact:compile
git diff --exit-code contracts/managed/
npm run compact:test
```

Change Compact first, regenerate managed code/ZKIR and verify exact encoding. Intentional migration changes artifacts: review/accept the delta before using repeated zero drift as the gate. Never combine 0.31.1 output expecting runtime 0.16 with runtime 0.19, or old 0.34 / ledger 9 output with runtime 0.16. [Official matrix](https://docs.midnight.network/relnotes/support-matrix).

Fast compilation omits proving keys. Before deployment run `npm run compact:compile:release` and regenerate all twelve prover/verifier artifacts together. Historical 0.34 metrics are not current evidence; measure the new package.

## Checks

```bash
npm test
npm run test:checkout
npm run compact:test
npm run test:leakage
npm run mcp:test
npm run typecheck
npm run check:keys
npm run check:secrets
npm run test:e2e
npm run build
```

`npm test` includes generated/encoding/model/store/vault/adapter/MCP/checkout checks. `test:checkout` focuses on HTTP procurement/resilience. Install the required Playwright browser if missing. Report actual current counts and coverage; an omitted secret field, successful simulator or mocked submission does not establish historical privacy, proving or finality.

## Routes and integration

- `/`: Product direction and evaluation entry.
- `/checkout`: Generated-Compact local HTTP procurement task.
- `/issuer`, `/merchant`, `/agent`: Existing role/record workflows; audit limitations apply.
- `/explorer`: Public-state view; disclosure extends beyond rendered fields.
- `/lab`: Reference-model attack fixtures.
- `/circuits`, `/roadmap`: Technical interface and complete requirements.

Both MCP commands start the local simulator with demo/issuer capabilities and plaintext development persistence. It is not production agent custody. The bounded checkout API is distinct, excluding issuer operations from the agent token.

Live network work needs supported versions and current endpoints before funded activity. Midnight-hosted Preprod RPC/indexer retire from **03:30 IST on 10 October 2026**; replacement Blockfrost endpoints require a Preprod project token. [Official notice](https://docs.midnight.network/relnotes/network), [deployment preparation](DEPLOYMENT.md). Changing endpoint/compiler does not itself prove the wallet/provider lifecycle.

Keep twelve circuit names, exact persistent primitives, generic clearance error and role authentication. Record actually verified work in [engineering status](ENGINEERING_STATUS.md). Full requirements remain in [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md).
