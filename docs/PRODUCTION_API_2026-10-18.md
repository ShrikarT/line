# Authenticated organization server

This increment implements the standalone HTTP entry and wallet sign-in for the
organization product. It does not establish public deployment or funded customer
acceptance. Provider credential routing over HTTP/WebSocket remains open.

## Implemented path

`npm run start:organization` starts `server/organization-server.mjs`. One process
serves the built `dist` directory and owns one standalone supplier runtime. Its
organization API exposes the catalog, wallet sign-in, exact order polling, quote
requests and redemption. Historical operator and simulator endpoints are absent.
The static server confines real paths to the public build and rejects traversal.
`/healthz` is liveness; `/readyz` reports initialized service availability, not
spendable funds or a successful payment.

Configuration is runtime-only: `LINE_PUBLIC_ORIGIN` (HTTPS, or loopback HTTP for
local checks), `LINE_SUPPLIER_DATA_DIR` on a persistent disk,
`MIDNIGHT_SUPPLIER_MNEMONIC`, `MIDNIGHT_STORAGE_PASSWORD`,
`MIDNIGHT_BLOCKFROST_PROJECT_ID`, `MIDNIGHT_PROOF_SERVER_URI` and optional `PORT`.
The backend also needs the validated full organization release. A static frontend
export alone does not contain the running wallet or durable merchant controller.
No credentials or custody records belong in `dist` or a public image layer.

## Caller and order ownership

Sign-in uses the installed ledger's real Schnorr signature verification. Its
challenge binds the configured origin, Preprod network, receiving address,
random nonce and a two-minute expiry. The exact
[Connector signing prefix](https://github.com/midnightntwrk/midnight-dapp-connector-api/blob/main/docs/api/_media/SPECIFICATION.md)
uses the UTF-8 byte count. The signed bytes are computed from the saved challenge;
the client's returned `data` field cannot replace them. Each challenge is
single-use. Unsupported signature schemes are rejected explicitly.

Sessions last thirty minutes and use HttpOnly, SameSite=Strict cookies, with
Secure and the `__Host-` prefix for HTTPS. No bearer or role key is stored in the
client. A new unlocked account authenticates itself; an account header mismatch
requires reauthentication rather than silently using another tab's session.
Sign-in permits four pending challenges per browser initiation context and
recipient. The opaque HttpOnly initiation cookie and actual peer scope that
context, so requests containing a victim's public address cannot occupy another
browser's quota, including browsers sharing a proxy. There are four sessions per
recipient; only a verified signature can evict that recipient's older sessions. The transport
limits sign-in requests to 120 per minute per actual socket peer, with bounded
memory and expiry; forwarded IP headers are not trusted. Behind a shared proxy,
that peer budget is shared and needs deployment-specific traffic monitoring.

Before quoting, redeeming or returning a retained order, the service checks the
exact twelve organization verifier keys and matches the signed wallet to the
contract's immutable issuer payout recipient. It does not infer ownership from
knowledge of a facility address or request UUID. Pre-record failure/pending status
is also confined to its authenticated recipient. New quotes have a persistent
six-per-ten-minute organization budget; existing order recovery is not replaced
by another request when the budget is exhausted.

The browser client signs only the canonical challenge for its own address and
origin. It retries the identical saved request once after an explicit
`WALLET_AUTH_REQUIRED` response. A timeout, ambiguous submission or ordinary
operation failure never triggers a replacement payment.

## Storage and lifecycle fixes

Two reproduced journal regressions showed candidate state publishing before its
write committed and further work proceeding after a write failed. Reconciliation
now commits the candidate before publishing it; uncertain controller persistence
blocks further mutations until retained state is reopened. Service computation
results also remain unpublished until the encrypted delivery write commits.
Recovery from a failed delivery write starts from the original redeemed order
and computes the real result without another redemption.

The server stops accepting HTTP work, drains admitted jobs and closes its single
wallet owner. A failed wallet stop remains retryable after the listener has
closed. Signal handlers remain installed until cleanup succeeds. The existing
ownership lease is never released merely because observation timed out.

Storage tests now initialize the actual encrypted SDK controller independently
of proving providers, using checked-in validated bindings metadata. This removes
an accidental dependency on ignored local full-key releases from `npm test`.
The production factory still requires the full validated release before it can
initialize transaction providers.

## Evidence and remaining gates

The full `npm test` run discovers 618 cases: 617 pass, one is intentionally
skipped, and none fail or cancel. A subsequent browser regression exposed a lost
native `fetch` receiver in the supplier client. The client now invokes the
transport with the global receiver; all 55 affected organization checks and nine
organization browser cases pass after that fix. The full core run precedes only
that receiver fix. The production deploy build and typecheck were rerun afterward.
Both Compact regenerations have zero managed drift; no Compact source changed.
Credential graph and banned-pattern scans pass (88 production modules).

Focused checks exercise real ledger signatures, actual loopback HTTP, the
browser HTTP client, actual generated immutable recipients, encrypted disk/SDK
storage, failure injection at commit boundaries and shutdown retry. Network
service boundaries in those transport tests are controlled test doubles; they
do not generate funded receipts or prove an actual Lace approval.

Remaining: complete public network credential HTTP/WebSocket routing; verify
native supplier cold start, funding and fee balancing; package/deploy the
persistent service; complete a new organization's funded twelve-key lifecycle
and both supplier payouts; verify public restart/recovery and actual Lace
proving/approval. The full-history privacy redesign and broader autonomous-agent
integration remain in the complete [work ledger](REMAINING_WORK_2026-10-18.md).
