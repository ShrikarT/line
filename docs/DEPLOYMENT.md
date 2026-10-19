# Build and deployment

Updated 19 October 2026. Line has three separate contract profiles. The canonical
profile records accounting; the experimental test-settlement profile has verified
Preprod token payouts; the organization profile receives existing assets and is
still awaiting complete funded user acceptance. [Current evidence](ENGINEERING_STATUS.md).

## Reproducible build

Use Node.js 22.18+ (verified locally with 26.7.0), npm and the pinned Compact
compiler manager. `npm ci` installs JavaScript dependencies, not the compiler.

```bash
npm ci
bash scripts/install-compact.sh
npm run compact:compile
npm run organization:compile
git diff --exit-code contracts/managed/
npm test
npm run typecheck
```

Windows compilation uses WSL, default distribution `Ubuntu`. Set `WSL_DISTRO`
and `COMPACT_BIN` when using another distribution or compiler-manager path.
The project selects compiler 0.31.1, language 0.23, runtime 0.16.0 and ledger 8.
Do not replace those pins with the newest toolchain without a migration.

To install the exact published organization proving release without regenerating keys:

```bash
npm run organization:install-release
npm run organization:validate
npm run build:deploy
```

The download metadata pins the archive and release-manifest hashes. Installation
validates all 52 public files against the current source and refuses to replace
different existing keys. No wallet data is included. To generate a new release instead:

```bash
npm run organization:release
npm run organization:validate
npm run build:deploy
```

Release generation creates full public proving/verifier keys in `.compact-keys`.
The build exports 37 allowlisted files under `dist/organization-zk`; it copies
no wallet records or environment files. Regenerating keys does not submit a
transaction. Preserve the validated release matching any existing facility.

## Free Render host: wallet-operated workspace

Public app: **https://line-midnight.onrender.com/app**. Service
`srv-dbapj2mq1p3s73cjj1h0` is on the free plan in Singapore, with no paid disk or
signing wallet. Anonymous readiness and app access, all 37 public proving files,
signed session authentication, actual historical Preprod HTTP/WebSocket reads
and sign-out revocation were verified on 19 October.
[Exact deployment and evidence](../artifacts/organization-product/public-host-verification.json).
These read-only checks submit no transactions and do not establish fresh funded
organization acceptance. The Chrome workspace and installed Lace picker render.

The repository's `render.yaml` selects one free Node service, the `main` branch,
and `LINE_ORGANIZATION_MODE=wallet-only`. It installs the pinned public release,
builds all 37 browser proving assets and serves the app with authenticated HTTP
and WebSocket Preprod readers. `LINE_PUBLIC_ORIGIN` uses Render's actual HTTPS
URL; the provider credential stays in a private environment variable or
`/etc/secrets/line.env`. Automatic deployments are disabled until verified.

This mode starts no supplier signing wallet, writes no hosted custody records
and needs no persistent disk or hosted proof server. The user's encrypted
organization records stay in their browser, and their wallet handles signing and
proving. Independent merchants exchange public profiles, quotes and claims using
the existing role workspaces. Native facility setup and funding still require
the user's actual wallet approvals and confirmed receipts.

Hosted API suppliers are explicitly unavailable in this mode; order mutations
return 503 rather than accepting work. The existing persistent supplier service
below remains available under the default `supplier` mode. Render's free service
can sleep, so initial requests can take longer and a restart requires sign-in
again. Do not describe a live wallet connection as a funded facility acceptance.

## Configured local Preprod prototype

Keep credentials in an ignored `.env.local`, never in a `VITE_` variable or Git.
The local operator needs `LINE_LIVE_PREPROD=1`,
`MIDNIGHT_BLOCKFROST_PROJECT_ID`, `MIDNIGHT_DEPLOYER_MNEMONIC` and
`MIDNIGHT_STORAGE_PASSWORD`. Use a funded test wallet and preserve its encrypted
controller/cache. Do not replace a retained wallet or lose the storage password.

The proof server is `midnightntwrk/proof-server:8.1.3`, on loopback port 6300.
For the already configured container:

```bash
docker start line-preprod-proof-8-1-3
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Run `node scripts/check-preprod-readiness.mjs` and require the proof server/API
to be healthy, idle and free of pending transactions. `/test-payout` uses actual
transparent test tokens, `/preprod` uses accounting, and `/checkout` is a local
simulation. Their request identifiers and receipts are separate. Never run a
second signer process against the operator wallet. Resolve the exact saved
transaction through the existing reconciliation action before another purchase.

## Persistent organization service

`npm run start:organization` serves the built app and authenticated organization
API in one process. Supply runtime configuration:

| Variable | Meaning |
| --- | --- |
| `LINE_PUBLIC_ORIGIN` | Exact HTTPS origin; loopback HTTP allowed for local checks |
| `LINE_SUPPLIER_DATA_DIR` | Persistent private data directory |
| `MIDNIGHT_SUPPLIER_MNEMONIC` | Dedicated supplier fee-wallet seed; preserve its identity |
| `MIDNIGHT_STORAGE_PASSWORD` | Encryption password for retained custody |
| `MIDNIGHT_BLOCKFROST_PROJECT_ID` | Private Preprod provider credential |
| `MIDNIGHT_PROOF_SERVER_URI` | Supplier prover URL, default loopback 6300 |
| `PORT` | HTTP listen port, default 3000 |

The runtime needs the same full validated organization release. It acquires an
exclusive encrypted storage lease and drains admitted work before releasing
ownership. Wallet sign-in protects orders and same-origin provider readers.
`/healthz` reports liveness; `/readyz` reports initialized availability, not funding
or a successful payment. A static upload of `dist` alone supplies no supplier API.

A dedicated supplier wallet still needs native synchronization, DUST funding and
funded acceptance before operating the complete organization product. The latest
isolated empty-wallet cold-sync attempt exceeded its 180-second startup bound.
The browser HTTP/WebSocket read path is separately verified against Preprod.
No public production deployment or customer-facility acceptance is claimed.

## Container handoff (organization preview)

After the validated release and frontend build above:

```bash
npm run deployment:prepare
docker build -t line-organization .
cp .env.example .env
# Fill dedicated supplier credentials and the exact public origin locally.
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d
```

The context contains only source, the built frontend and the allowlisted full
public release. Private caches and environment files are excluded. The app runs
as a non-root user, and the named `supplier-data` volume preserves custody. Use
a reverse proxy with HTTPS/WebSocket support in front of loopback port 3000.
Run exactly one app replica; do not run the same supplier seed elsewhere.

This image serves the organization preview and its authenticated API. It does
**not** serve the historical operator `/test-payout` or `/preprod` endpoints;
those require the configured local runtime above. Hosting the recorded prototype
publicly remains open. Do not advertise the organization image as the recorded
funded checkout. Native startup, funding and a complete new facility still need
acceptance on the chosen persistent host. No public deployment is claimed.
