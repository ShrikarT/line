# Line

Agent spending controls and verifiable merchant checkout on Midnight.

An organization approves purchasing capacity. An agent proves each purchase fits
its allowance. A merchant redeems its own single-use claim before releasing its
service. Line is a working prototype; private credit is the longer-term goal.

[Submission package](docs/SUBMISSION_READY_2026-10-18.md) |
[Slide deck](artifacts/wave2/line-wave2.html) |
[Video](https://github.com/ShrikarT/line/releases/download/wave2-submission-2026-10-19/Line-Wave2-Product-Walkthrough.mp4) |
[Privacy](docs/PRIVACY.md) |
[Deployment](docs/DEPLOYMENT.md)

## Verified for Wave 2

- A two-merchant Preprod test-token checkout: 21 finalized transactions in the
  published checkpoint, with 25 test units paid to A and 20 to B. Raw outputs,
  registered recipients and wallet balances agree. [Settlement evidence](docs/TEST_TOKEN_PAYOUT_2026-10-16.md).
- Twelve Compact circuits with private witnesses, role authentication,
  contract-instance separation, one-time redemption and reserve accounting.
- Encrypted account/transaction recovery, retained request identities, replay
  rejection and generic failed-clearance feedback.
- 644 regression cases: 643 pass, one intentional skip. Nine organization browser
  checks pass. The actual browser SDK also reads Preprod over authenticated HTTP
  and WebSocket routes without receiving the server's provider token.

Wave 1 exposed five circuits. Wave 2 adds merchant registration, claim redemption,
reserve controls, expiry/recovery, a two-supplier checkout and actual test-token
settlement. The new wallet-owned organization product is a separate preview.

## Run and evaluate

Use Node.js 22.18 or newer; the current checks use 26.7.0.

```bash
npm ci
npm test
npm run typecheck
npm run dev
```

Open the URL printed by Vite. The configured local recording instance uses
`http://127.0.0.1:5174`. Private network credentials and custody records are not
in Git. Read [deployment instructions](docs/DEPLOYMENT.md) before enabling funded
Preprod operations. A second signer must not open the running operator wallet.

| Route | Scope |
| --- | --- |
| `/test-payout` | Actual operator-run Preprod test-token checkout and receipts |
| `/preprod` | Separate deployed accounting profile; no token payout |
| `/app` | Wallet-owned organization workspace preview; full funded acceptance pending |
| `/checkout` | Local generated-Compact evaluation; no network transaction |
| `/contracts` | Circuit and contract reference |

Install the compiler separately from npm with `bash scripts/install-compact.sh`
(Linux or WSL). On Windows, the wrapper uses the `Ubuntu` WSL distribution;
`WSL_DISTRO` and `COMPACT_BIN` select a different distribution/compiler manager.
Compile with the pinned Compact 0.31.1 toolchain:

```bash
npm run compact:compile
npm run organization:compile
git diff --exit-code contracts/managed/
npm run build:deploy
```

The deploy build requires the validated full organization proving release;
`npm run organization:release` creates it. Release generation is not a deployment
and does not submit a transaction.

## Scope and source

Test assets have no monetary value. Amounts, recipients and public history remain
observable; private witnesses do not establish complete historical book privacy.
The suppliers are first-party deterministic services. No customer traction,
independent commercial custody or production credit service is claimed.

- `contracts/line.compact`: canonical accounting source.
- `contracts/experimental/line-test-settlement.compact`: the deployed test-token settlement profile.
- `contracts/organization/line.compact`: organization-funded asset profile.
- `src/`: browser product and runtime adapters.
- `server/`: durable checkout, wallet ownership and authenticated readers.
- `tests/`, `e2e/`: generated, transport, recovery and browser checks.
- `artifacts/`: scoped machine-readable evidence and submission assets.

[Architecture](docs/PRODUCT_ARCHITECTURE.md), [protocol](docs/PROTOCOL.md),
[encoding](docs/ENCODING.md), [engineering status](docs/ENGINEERING_STATUS.md),
[roadmap](docs/ROADMAP.md), [contributing](CONTRIBUTING.md).
Historical audit reports are retained in
[Git history at 1088cf9](https://github.com/ShrikarT/line/tree/1088cf9/docs).

Midnight-related code is licensed under [Apache 2.0](LICENSE). Built with Midnight
Compact, Midnight.js, the Wallet SDK and the DApp Connector API.
