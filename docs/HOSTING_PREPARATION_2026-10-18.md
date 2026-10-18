# Organization deployment preparation

The owner authorized publication after verification. This is preparation, not a
public deployment or acceptance of the failed customer facility creation.

Subsequent progress: the [authenticated production entry](PRODUCTION_API_2026-10-18.md)
now serves the built app and organization API under a configured origin, with
standalone supplier custody, wallet ownership checks, bounded sign-in/quote
admission and retryable shutdown. Public provider credential routing, packaging,
funded acceptance and deployment remain pending. The original checkpoint below
retains its historical test counts.

## Verified build artifact

`npm run build:deploy` builds the frontend and runs `organization:export-assets`.
The exporter requires the validated full organization release and a clean frontend
build. It publishes `dist/organization-zk/release.json`, twelve verifier keys,
twelve prover keys and twelve binary ZKIR files. It copies no unlisted files,
wallet snapshots, role secrets or application records. The same public manifest
function serves the development route and the static build. Changed source,
modified proving files and existing output fail closed. The final directory is
published only after all copied hashes and release inputs are checked again.

Three export integrity tests use clearly synthetic public key material; they
prove lifecycle/allowlist behavior, not ZK validity. A separate export of the
actual 52-file organization release successfully prepares its 37 public files.
The release fingerprint stays
`057aa57267c0b8afd537cfb8950946db99bda45954a259c521877bdbb23e5157`.

The complete `build:deploy` command passes. A temporary loopback static server
serves the actual exported files to the installed `FetchZkConfigProvider`:
twelve verifier fetches and the draw prover/binary-ZKIR fetches match the release.
All 36 proving-file hashes also match. The full core run passes 598 of 599 tests
with one intentional skip, and all eight organization browser checks pass.
These checks neither start a signing wallet nor submit a chain transaction.
[Machine-readable scope](../artifacts/organization-product/hosting-preparation-verification.json).

## Hosting architecture

The existing `vercel.json` only serves the SPA. A static frontend upload does not
run the native supplier wallet, encrypted LevelDB journal or proof server.
Vercel's container runtime is stateless and expects durable data in backing
services ([official comparison](https://vercel.com/kb/guide/docker-on-vercel-vs-render)).
Therefore the present supplier backend cannot be deployed there unchanged.

For the current filesystem-based implementation, the direct deployment path is
a Vercel frontend plus a single-instance backend on a host with an attached
persistent disk. Render is one supported option: its disks preserve the mounted
path across restarts, require a paid service and restrict the disk to one instance
([persistent disk documentation](https://render.com/docs/disks)). No paid resource
has been provisioned or charged. Moving the journal to a transactional managed
store would be a different implementation, not a configuration switch.

Before release, the backend still needs a production entry point, same-origin
routing, caller admission, persisted single-writer wallet ownership, supported
first-start synchronization, runtime-only secrets and a reachable matching proof
server. The existing local token-session convenience is loopback-only and cannot
serve as public network configuration. Customer-side wallet approval remains in
the browser. Supplier provisioning must preserve its actual receiving keys and
obligations; no existing private cache belongs in a public build or image.

## Acceptance still required

- Reproduce the owner's facility-creation failure, then confirm actual deployment
  and all twelve verifier keys on the new facility.
- Confirm deposit, allowance, both supplier outputs/results, replenishment,
  withdrawal and exact pending/reload recovery against independent network data.
- Start the production backend from its persistent state, restart it without
  duplicate payouts, and repeat the browser flow at the public URL.

The new incomplete-form regression demonstrates one no-alert path and its fix.
It is not proof that this was the owner's exact failure. The actual SDK
maintenance check reaches a deliberately rejecting wallet after ledger signing
and proof conversion, with zero submissions or finality observations; it does
not replace a live verifier-registration receipt.
