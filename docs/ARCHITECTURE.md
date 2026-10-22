# Architecture

Line combines Compact spending rules, wallet-approved Preprod transactions and
encrypted organization records. Organizations fund and control their own agents;
external borrowing and production credit underwriting are future work.

## Components

| Component | Responsibility |
| --- | --- |
| `contracts/line.compact` | Canonical accounting rules; no asset payout |
| `contracts/experimental/line-test-settlement.compact` | Separate valueless test-token settlement profile |
| `contracts/organization/line.compact` | Existing-asset funding, allowances and recipient-bound settlement |
| `contracts/managed/` | Compiler-generated bindings; regenerate from Compact |
| `src/lib/organization/` | Wallet-scoped account, transaction journal, finality and transfer packages |
| `src/lib/runtime/` | Wallet discovery, connector adapters, network/proof providers |
| `server/organization-server.mjs` | Built application, authenticated readers and organization API |
| `server/organization-wallet.mjs` | Optional persistent supplier signing runtime |
| `mcp/line-mcp.mjs` | Agent tool interface |

## Transaction lifecycle

1. Connect a compatible Midnight wallet and verify its Preprod identity.
2. Unlock the wallet-scoped encrypted organization account.
3. Validate the public proving release against the generated contract bindings.
4. Persist an exact private candidate before requesting wallet proof/signature.
5. Balance and submit through the wallet; retain the original transaction identity.
6. Observe finalized success before publishing the candidate as current state.

Failure before submission discards only the unsubmitted candidate. A submitted,
failed or uncertain operation retains the evidence needed for reconciliation.
Partial failure does not trigger a replacement payment. Backup restoration checks
wallet scope, private openings and observed contract state before replacing data.

After checking an unresolved signed transaction and clearing active wallet
requests, the owner can explicitly retry its original submission. A confirmation
dialog identifies the saved transaction. The account lock reloads the durable
operation and rejects a stale confirmation. The SDK checks the pinned release,
canonical signed bytes, identifier, action kind, call entry point, target and expiry before
forwarding the same bytes to the connected wallet. It does not prepare, balance
or prove another transaction. A rejected or timed-out retry retains the operation;
only the exact finalized receipt can publish its candidate state. Expired bytes
cannot be resent, and expiry or an absent receipt alone never clears the journal.
Expiry is a submission restriction, not a reconciliation restriction: an exact
finalized success can still publish the candidate, and an exact finalized total
failure can record the failure. Missing, unrelated or partial receipts retain it.

The expired fee-bearing reopening listed in [progress](PROGRESS.md) has a separate,
owner-reviewed recovery path scoped to that identifier, facility and release.
An authenticated fixed-purpose API pins node reads to a finalized hash, checks
Preprod genesis/runtime identity, reads `Timestamp.Now` and checks the indexer
agrees on the block. The complete serialized contract must equal the trusted
closure checkpoint at block 3,062,090, including all twelve release-matched keys
and maintenance counter 11. The checkpoint hash and state SHA-256 are pinned.

The argument depends on ordinary validated ledger-8 history: an existing contract
cannot be redeployed; only `openLine` changes generation after construction; its
Uint64 cast rejects overflow. Maintenance counter 11 is below saturation and
cannot return after a verifier or authority update, including authority
replacement. Thus this unchanged predecessor generation excludes a successful
opening in the intervening history. The exact canonical signed action is replayed
against the predecessor and must produce the retained generation-2 private book
and approved amount/fee terms. Every saved intent TTL is read separately from
the seven-day allowance expiry. Finalized block seconds must be strictly past
the latest TTL plus the node's 30-second time uncertainty; later block timestamps
cannot make those bound bytes valid again.

The relevant implementations are [ledger-8.1.2 replay and application rules](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.2/ledger/src/semantics.rs),
[maintenance validation](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.2/ledger/src/verify.rs),
the [observed node-1.0.300 block context](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.300/pallets/midnight/src/lib.rs),
and its Cargo.lock-pinned [timestamp monotonicity check](https://github.com/paritytech/polkadot-sdk/blob/2e4dd0bc22366a5af820492528869a493b5a5208/substrate/frame/timestamp/src/lib.rs#L259).
These are configured TLS provider assertions and audited implementation assumptions,
not a light-client proof or independent full-node verification.

Confirmation reloads the encrypted record under the account lock, rejects a stale
review, rereads provider evidence and rechecks wallet identity. One encrypted
commit archives the original bytes, predecessor, candidate and evidence before
unblocking. The candidate is never promoted and no receipt is invented. Recovery
history is bounded, outside candidate snapshots, retained by every commit and
validated during backup restore. Missing evidence, changed state/runtime/keys,
wallet changes or failed storage writes retain the pending operation. Recovery
does not prove that no network fees were charged or authorize another opening.

Encrypted backup export holds the same account lock and reloads the latest durable
record, including any pending operation. It requires the unlocked vault session
but remains available when the wallet's remote read API fails. Export rechecks
session validity after encryption; restore and mutations still verify the wallet.

Organization vault sessions last twelve hours per unlock. The selected wallet's
public provider/account identifiers are remembered in sessionStorage; refresh
reconnects that provider, verifies Preprod and rejects a changed receiving account.
One explicit transient connector failure may retry once during connection or
configuration reads. Permission rejection, cancellation and signing/submission
never enter this retry path.

A same-origin SharedWorker holds the organization passphrase and previously
verified configuration in memory across same-tab refreshes. Only a random resume
ticket is stored in sessionStorage. A document-lifetime browser lock excludes
duplicated tabs. Resume rereads the live Preprod session and both identities,
checks their original bindings and reloads the encrypted journal under its account
lock. It retains the original absolute expiry instead of starting another twelve
hours, and never recreates a missing record. Manual lock, disconnect or account
change revokes restoration. Browser restart or loss of the memory holder requires
the password again; unsupported browsers keep the vault locked after refresh.
No passphrase or private key is written to browser storage. Other consoles retain
their existing timeout.

Initial document navigations discard copied resume tickets before wallet
discovery. A copied tab cannot wait for the original tab to close and then claim
its released lock. Normal same-tab reloads retain their ticket.

Vault authentication and network readiness are separate UI states. A failed live
read during restoration retains a valid memory session for an explicit retry;
it does not ask for the password again or renew the original deadline. A network
setup failure after decryption keeps the vault and encrypted backup available,
while transaction tools remain unavailable until fresh checks pass. Missing or
expired memory records still require the password. A null resume reply is never
treated as a successful restored session.

Wallet identity probes are sequential. Unlock reads and validates service
configuration once, keeping a frozen copy only in the account's memory. Later
boundaries use the standard [`getConnectionStatus`](https://github.com/midnightntwrk/midnight-dapp-connector-api/blob/main/docs/api/_media/SPECIFICATION.md)
to check the live session and Preprod network, then reread both wallet identities.
A failed or disconnected session never falls back to the saved
settings. Reconnect and reopen the organization to adopt changed service URLs.
Only explicit rate-limit responses on these reads may retry within a bounded
deadline; each retry checks session validity. Signing, proving and submission
are outside that retry path.

Organization code-download failures are distinct from wallet or password errors.
They offer a workspace reload and stop further unlock/mutation attempts in the
stale document, while retaining encrypted records and any memory resume ticket.
Reload uses the current asset graph; code is never mixed across releases and
financial operations are never automatically retried. HTML is served with
`no-store`; content-hashed JS/CSS/WASM assets are immutable browser-cache entries.
An older open tab can still need a reload for an unfetched chunk after deployment.

The SDK wallet adapter is constructed through that same live account guard, using
its checked public keys and in-memory settings. It does not issue another
configuration RPC after a successful account check or fall back after a rejected
guard. Proof, balancing and submission boundaries retain their fresh checks.

HTTP wallet sign-in has a separate thirty-minute server deadline. After refresh,
the client first checks its existing HttpOnly cookie through the same-origin
`GET /api/organization/auth/session`, with the selected receiving wallet header.
The server requires an unexpired session for that exact wallet and returns only
its original expiry. This read does not renew the cookie. Missing or rejected
sessions use the existing nonce/signature flow; service failure or an invalid
resume response cannot initiate a signature or supplier action. A wallet lock
during that read prevents restoration from completing.

The wallet dialog also provides explicit read-only connection diagnostics. It
records the connection stage and probes configuration, shielded identities,
receiving address and live session separately, without opening a vault. Failed
verification may retain only these four read capabilities for diagnostics;
it never publishes a connected account. Results stay in memory, redact arbitrary
provider errors and stop on timeout or connection changes. Diagnostic success
cannot substitute for the live guards on recovery or transactions.

The treasury refresh control retries facility state as well as wallet balances
and supplier discovery. A failed facility read keeps spending controls disabled
until a successful read restores the required setup and status checks.

The treasury sequences its wallet-dependent facility summary and balance read.
Refreshes queue behind a still-running read and skip superseded work. Balance
maps are cached for local asset selection; typing does not issue wallet RPCs.
Balance waits are bounded, and stale work cannot update the current view.
Mutation controls wait for reads to settle and required facility data to load;
refresh remains available. No fresh identity check or transaction guard is removed.

Merchant invoice references preserve the protocol's existing 32-byte encoding:
UTF-8 text of at most 32 bytes, or a 64-digit hexadecimal ID with optional `0x`.
The form shares validation with the encoder and reports invalid input inline.
The SDK rejects oversized references before wallet identity or network reads;
it never truncates or substitutes a different invoice commitment.

Optional organization fees use a Uint64 flat amount and 0-10,000 basis points,
with zero defaults and whole-base-unit upward rounding. The policy is fixed by
`openLine`. Purchase previews show price, fee and total allowance consumption;
wallet network fees are separate. Pending fees become withdrawable only after
redemption. Withdrawals use the contract's fixed issuer recipient.

Merchant claim review reads the release-checked facility and binds the imported
opening to its public note metadata, merchant key and registered receiving
wallet. It shows the settlement asset, merchant payout, separately retained fee,
deadline and observed unspent/redeemed/cancelled status. Editing the package
invalidates the review. Redemption repeats the check under the account lock
before preparing a transaction, so a claim spent since review is rejected early.
Current allowance status/generation and merchant disabling do not invalidate an
older claim. Provider-observed state is not a finalized payout receipt or a
guarantee of payment; Compact still checks ledger time, custody and single use.

Hosted service orders persist the reviewed maximum fee in encrypted records and
backups. The SDK includes the fee in its capacity check and rejects a new quote
above that ceiling before drawing. Missing legacy ceilings mean zero. A retained,
already authorized claim can still recover; the ceiling does not cause another
draw or replace its original transaction identity.

## Contract rules

Exactly twelve public circuit names are shared across the profiles:

`registerMerchant`, `disableMerchant`, `fundReserve`,
`withdrawUnencumberedReserve`, `withdrawFees`, `openLine`, `postQuote`, `draw`,
`redeemDraw`, `cancelOrExpireNote`, `acknowledgeRepayment`, `setStatus`.

Issuer, agent and merchant roles authenticate their operations. `instanceNonce`
separates contract domains. Quote commitments bind merchant, invoice, amount,
expiry, generation and fee terms. A draw proves the current book opening and
capacity constraint, rotates the book and creates a merchant-bound claim.
Redemption consumes a single-use identity. Closing/reopening does not erase an
older merchant's valid claim or permit payment-reference replay.

Reserve accounting distinguishes unencumbered funds, outstanding claims,
redemptions, fees and refund obligations. The organization profile additionally
requires asset inputs and emits actual recipient-bound asset outputs. Its
acceptance must be established with new finalized receipts, not inferred from
the canonical accounting tests.

The treasury reads held transparent assets directly from `ContractState.balance`
in the same inspected contract snapshot. Wallet-style unshielded output queries
are not a source of contract custody. The UI distinguishes actual held assets
from `totalReserve` accounting and treats a failed summary as unavailable.
Redemptions and replenishments can make those two quantities differ.

## Runtime modes

**Wallet-only** serves the app and authenticated Preprod readers. The organization
keeps its encrypted account in the browser and uses its wallet to prove, sign and
submit. Independent merchants exchange public profiles, quotes and claims through
the role workspaces. This is the public free-host configuration.

**Supplier** additionally starts a dedicated signing wallet and durable supplier
storage. It needs separate funding, a proof service and exclusive process ownership.
Only one runtime may own the same wallet/cache. Automated supplier orders are
explicitly unavailable in wallet-only mode.

## Build and verification

The landing page, disconnected organization workspaces and wallet connection do
not load the ledger or Compact WASM engines.
Routes, protocol consoles and organization tools load when needed; vault opening
loads the organization SDK. Disconnecting during that load revokes the pending
unlock. A failed route download offers an explicit refresh instead of a blank page.

The compiler manager selects Compact 0.31.1, language 0.23, runtime 0.16.0 and
ledger generation 8. Managed output must match source. Public release installation
checks pinned archive size/hash, source/compiler inputs and every artifact before
selecting the release; it refuses to replace different existing keys.

`npm run build:deploy` typechecks, builds the frontend and exports 37 allowlisted
public proving files. It does not export wallet records, environment files or
private state. Tests cover generated Compact execution, role separation, replay,
fees, expiry, storage interruption, finality and transport/session recovery.

See [README](../README.md) for commands, [privacy](PRIVACY.md) for disclosures and
[progress](PROGRESS.md) for the current network acceptance boundary.
