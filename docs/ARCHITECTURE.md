# Architecture

Line combines Compact spending rules, wallet-approved Preprod transactions and
encrypted organization records. Organizations fund and control their own agents;
external borrowing and production credit underwriting are future work.

## Target product architecture (planned, not deployed)

The owner-directed product reset and delivery gates are in
[Progress](PROGRESS.md#product-direction-reset--23-october-2026). The target is
one real agent completing a useful paid-service task within explicit delegated
authority, without human JSON transport or routine purchase-by-purchase signing.
The current wallet-only path remains assisted checkout until those gates pass.

| Boundary | Planned responsibility |
| --- | --- |
| Owner control plane | Guided setup, funding, explicit agent authorization, budget/supplier/fee policy, pause/revocation and exceptions |
| Agent MCP/API adapter | Real tool execution against production task/order APIs; never the seeded local simulator |
| Durable execution runner | Scoped signer/prover, private-book ownership, serialized updates, task/order journal, original-transaction reconciliation and restart recovery |
| Supplier service | Authenticated catalog/quotes, automatic claim transport, single-use settlement, actual fulfillment and durable result retrieval |
| User task workspace | Goal input, progress, approvals only when policy requires, useful result and total cost |
| Activity/Explorer | Organization-scoped transaction history and task-linked evidence; simulation and provider-backed archives distinctly labeled |

### Runner foundation under review - 24 October

The new backend modules are local work; public startup does not activate them.
`AgentStore` reuses `EncryptedCheckoutStore.openBound` to commit tasks, grant
counters, book, signed operation and receipts in one checkpoint. Storage binding
and contract source fingerprint are separate values. Persistence failure stops
further writes until reopen. Admission stops at 50 tasks or a 1 MB encoded archive
to leave journal space; authenticated archival remains future work.

Grants bind the existing Midnight wallet message signature to exact terms,
runner origin/key, facility/domain, owner, generation, source and initial book.
Signature verification does not establish the browser writer fence. Activation
requires the separate pairing component; its absent verifier fails closed.

`MidnightAgentAdapter` constructs/proves a real SDK draw and balances it with an
explicitly started fee wallet, checking that the call transcript is preserved.
Preparation cannot submit. The runner commits canonical signed bytes and their
candidate before recording a submission attempt and sending those bytes. The
receipt reader's existing `read` stays success-only; explicit `readOutcome` also
accepts exact total failure after checking raw bytes and node-pinned finality.
Partial/missing outcomes remain unresolved under the same TLS provider trust.

The supplier client composes with the real owner-operated supplier in-process,
checking its signed owner scope and facility ownership. Remote grant headers
are rejected; browser HTTP keeps wallet-cookie authentication. A draw creates
an authorized claim. A paid result requires finalized redemption, exact claim
metadata and its fixed-recipient asset output. Evidence must match source slices
before `result_ready`; an external agent supplies a cited brief for completion.

Production MCP composition, pairing activation, browser fencing/handback, actual
wallet/prover setup and full product acceptance remain outstanding. Fixture tests
and historical bytes do not establish live autonomous purchasing or current-release
acceptance. The decisions below still govern the remaining implementation.

A controlled integration test now runs the generated organization draw through
the installed SDK's `createUnprovenCallTx` and reaches the external prover
boundary. It uses synthetic ledger state and historical public operation-key
encodings; it does not prove, balance, sign or submit a transaction. Policy-denied
tasks retain the original quote and cost, stop before preparation and remain
denied on retries. Supplier cached results also validate the claim commitment's
actual persistent opening; paid delivery retries use unchanged stored input.
Payout verification additionally binds the release's public `notes.member(D)`
query to the exact claim; a previously redeemed note plus an unrelated same-value
payout is insufficient. The query parser is release-specific and exercised with
the generated SDK redemption transcript.

Pairing helpers use WebCrypto X25519, HKDF-SHA256 and AES-256-GCM with purpose
separation and the complete signed grant digest in authenticated data. The grant
separately pins runner encryption/signing keys and the browser return key. These
helpers capture allowlisted material before asynchronous work and reject altered
or oversized envelopes. They do not establish durable staging, runner retirement,
authenticated handback, offer consumption or browser writer exclusion. Those
lifecycle steps remain prerequisites for activating any delegation.

The ownership branch now stages a fence and browser return key in encrypted
account metadata outside transaction snapshots. It checks the current facility,
retains the exact encrypted owner-authorized export before returning it, and
refuses conflicting browser writes. The emergency `setStatus(DEFAULTED)` pause
preserves the fence. Ordinary commits, backup restoration and reload cannot
silently remove it; owner rejection, wallet changes and an aborted IndexedDB
write leave staging intact. No runner activation or unfencing path is exposed.
Retired-checkpoint handback is still required. This
coordinates cooperating current clients, not old applications or copied keys;
chain commitment equality alone cannot exclude a restored old copy before any
draw has changed the commitment.

`AgentPairingInbox` now retains its distinct X25519 and Schnorr identities and
bounded offers in the same encrypted `AgentStore` checkpoint. Import verifies
the owner signature, independently configured facility pins, exact private-book
opening and the adapter's current owner/asset/state/all-twelve-key checks. One
write consumes the offer, retains the exact encrypted package, imports grant/book
and saves a signed acknowledgement. Exact lost-response retries return that
acknowledgement, including after expiry, without resetting counters. Failed
storage stops writes until reopen. The acknowledgement confirms retained import;
it is neither a handback nor evidence of exclusive custody on other devices.
This local composition seam has no public HTTP route, automatic wallet startup
or UI activation. Runner retirement, complete claim handback and browser release
remain prerequisites for enabling it in the product. The signed handover relies
on the cooperating owner's fenced browser flow; the runner cannot remotely prove
that every historical browser copy has honored it.

### P02 decision - owner-operated runner first

The current release can authenticate a draw without issuer material: `draw`
checks `agentSecret`, the current private book opening and quote/note witnesses.
A separate headless fee wallet can balance and sign the transaction using the
existing SDK pattern in `server/organization-wallet.mjs`. This establishes a
feasible integration seam, not a tested autonomous runner or completed delegation.
The runtime also needs a release-matched prover and actual funded fee capability.
No owner mnemonic or browser password is required by Compact for a draw.

Choose one owner-operated persistent Node runner for the first slice. A hosted
operator would receive equivalent agent/book access and introduces a different
custody decision; defer hosted custody and paid provisioning until explicitly
reviewed. The runner gets agent material only, never issuer, merchant or maintenance
secrets. Agent material can also authorize mode-1 compensation; a draw-only tool
API restricts the implementation, not the cryptographic capability of a stolen key.

| Boundary | Actual release behavior / planned runtime responsibility |
| --- | --- |
| Compact | Agent identity, current book commitment, outstanding-capacity limit, OPEN status, line/quote expiry, generation, committed fees, registered merchant membership, reserve backing and single use |
| Compact merchant disabling | Stops new quotes; already-posted quotes remain drawable and valid existing claims remain redeemable |
| Runner policy | Approved service/supplier subset, per-task and aggregate authorized spend ceilings, maximum fees, operational expiry, request admission and rate limits |
| Compromised runner | May bypass runtime policy and use agent material up to contract constraints; replenishment/compensation can restore capacity, so outstanding limit is not a lifetime spend cap |
| Owner chain control | Pause blocks draws ordered after it on-chain; it cannot undo a preceding draw or valid merchant claim. Closure additionally requires a current zero-outstanding book |

**Required pairing protocol:** explicit owner-reviewed encrypted transfer to a
pinned runner encryption identity, bound to the origin, Preprod facility/domain,
release, generation, owner receiving identity, grant ID/nonce, scope, expiry and
initial book commitment. Owner signs the exact grant with the existing wallet
message-signature format; runner verifies owner receiving identity against the
facility and validates every imported book/agent commitment. Use authenticated
transport and encrypted persistent storage. No plaintext secret package download,
whole-vault export, implicit credential copying or automatic pairing is allowed.
This protocol and its exact schema still need implementation and targeted review.

**Single writer and issuer synchronization:** before transfer, browser account
lock reloads durable state and refuses any pending operation. A staged handover
marks that facility delegated in encrypted browser storage before the runner can
be activated; crashes leave it fenced. Browser agent/book-changing actions must
honor the fence, across reload and backup restore. The runner uses an exclusive
persistent-store lease plus a serialized facility queue. A file lease alone does
not exclude a browser or historical copied key. Compact's stale-commit check is
the final conflict check, not a recovery strategy for competing writers.

For issuer replenishment/closure or writer return, quiesce new runner work and
reconcile every signed operation first. Where needed, finalize an owner pause
before changing the book. Transfer an authenticated monotonic checkpoint and
verify its private opening against current chain commitment; never overwrite it
from an older browser snapshot. Perform the issuer mutation while the runner is
fenced, verify exact finality and synchronize the new opening before resuming.
A lost runner/checkpoint leaves the facility paused or recovery-needed; it never
silently resets debt, keys or the facility. Old copied credentials remain a risk
until owner chain controls, applicable on-chain line expiry or identity rotation
fence them. Runtime grant expiry does not revoke a copied key. No stronger rollback
resistance or adversarial exclusive custody is claimed.

**Implementation seams:** isolate `AgentRunner` state/policy and encrypted
`AgentStore`; production transaction gateway reuses generated Compact witnesses,
Node SDK wallet balancing and the fixed finalized receipt reader. Persist signed
bytes, all intent deadlines, predecessor/candidate and task/order bindings before
submission. Guard the latest applicable TTL at submission; do not assume a typical
DUST window. Every uncertain quote/draw/redemption keeps its exact identity and
blocks conflicting work. Exact finalized success promotes; total failure records
failure; partial/missing outcomes remain unresolved. Expiry alone never clears
anything. Existing provider-backed archives remain narrowly scoped, separate
from receipts, and do not generalize to arbitrary new runner transactions.

Task, claim authorization, redemption/payment and fulfillment have separate
states. Automatically move exact quote/claim packages through authenticated
order APIs, then expose useful result/status through production MCP. Keep the
old simulator separate. The model is an untrusted proposer and receives no
signing witnesses. Supplier failure after payout cannot be repaired by claiming
that expired-note compensation reverses a redeemed purchase.

**Operating baseline:** owner-operated hardware adds no new hosting subscription,
but requires an awake host, disk, network, a prover and separately authorized fee
wallet; electricity, proof-provider and network costs are not asserted zero.
EncryptedCheckoutStore provides a reusable exclusive-store/durable-write seam;
its documented Windows power-loss limits remain. Benchmark actual SDK/prover
memory before choosing hosted capacity. Health reports must distinguish ready,
locked, syncing, pending payment, uncertain storage and service failure.

As a budget illustration checked 24 October 2026, Render lists $7/month for
0.5 CPU/512 MB compute and $0.25/GB-month disks: one such process plus 10 GB is
$9.50/month before proof service, bandwidth, backups, taxes or additional processes.
This is arithmetic, not a capacity guarantee or deployment approval. A separately
hosted supplier adds its own resources. [Official pricing](https://render.com/pricing),
[free service limitations](https://render.com/docs/free) and
[persistent disks](https://render.com/docs/disks) confirm the existing free host
cannot retain local runner state across restarts or attach a persistent disk.
No paid resource or new signing authority has been provisioned by this decision.

The planned information architecture is Tasks/Home, Agents, Budget, Suppliers,
Activity/Explorer and Settings. Each route has one primary purpose. Setup is
resumable, exceptions are contextual, and technical packages/recovery diagnostics
remain under advanced details. Do not repeat all role tabs and the full history
on every page. Preserve the palette while rebuilding hierarchy and task flow.

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
| `mcp/line-mcp.mjs` | Local protocol simulator exposed as MCP; not a deployed autonomous purchaser |

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

The two expired fee-bearing reopenings listed in [progress](PROGRESS.md) have a
separate, owner-reviewed recovery path scoped to their exact identifiers, facility
and release. Naming an identifier only admits the checks; it never substitutes
for canonical signed-byte decoding or replay of the retained private candidate.
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

One separate `disableMerchant` identifier, `0054af76...8649cce6`, is scoped to the
verified Merchant 2 draw checkpoint at block 3,102,203. The complete public state
and release keys must still match that checkpoint, with maintenance counter 11,
OPEN generation 2 and the exact Merchant 2 key active at its registered recipient.
In this release, disabling preserves map membership with value false;
`registerMerchant` rejects existing membership and no circuit removes it. Thus
an active key at the unchanged post-expiry checkpoint excludes prior application
under the same validated-ledger assumptions. The exact retained signed action
must replay to disable that key and match a candidate whose only private change
is that merchant's disabled flag. Every signed intent TTL still needs the
finalized-time margin. Evidence has its own `line:expired-disable-evidence/v1`
schema and archive disposition, distinct from opening recovery and finalized
failure receipts. Confirmation rereads evidence and identities under the account
lock; storage failure, stale review or a backwards checkpoint keeps it pending.
No replacement disable is prepared or approved by archival.

One `cancelOrExpireNote` identifier, `00dd26b2...c73c3c27`, has a separate
mode-1 compensation recovery scoped to Merchant 2's exact claim at the same draw
checkpoint. The complete state, maintenance counter and release keys must remain
unchanged, and the claim must still be unredeemed, uncancelled and unallocated.
`draw` rejects existing note membership; mode 1 permanently sets
`compensationAllocated`; neither expiry nor redemption can reset an allocated
claim. Canonical replay must cancel and allocate this exact note, remove its
100,000 principal and 2,000 pending fee encumbrance, and match the retained
102,000 private book credit and refund opening. No other private candidate
change is admitted. Finalized time must pass the latest of **all** intent TTLs
plus the uncertainty margin, even when DUST has an earlier deadline. Atomic
review/archive uses its own `line:expired-compensation-evidence/v1` schema and
`expired-compensation-not-applied` disposition; it retains the unpromoted
candidate and original bytes. It neither performs compensation nor approves a
replacement. Backup restoration dispatches each archived disposition to its
corresponding evidence/candidate validator, including the older disable record.

One retained Merchant 2 `postQuote`, `0077dc71...744dfd53`, is scoped to the
verified compensation checkpoint at block 3,104,191. The exact quote commitment
must be absent and the complete state, maintenance counter and twelve release
keys unchanged. `postQuote` rejects existing quote membership; `draw` preserves
membership while marking used; no release circuit removes it. Canonical replay
must insert the exact commitment from the merchant account's retained opening,
bind its private merchant role and preserve its other private records. The
candidate is one appended quote, never an issuer book mutation. The server reads
only this fixed checkpoint. Recovery still waits past every signed intent TTL
plus uncertainty, with an explicit time message when the shorter DUST deadline
has passed but the contract intent remains live. Its separate evidence schema
and archive disposition are validated and retained through backup restore.

Saved-transaction inspection uses that account lock to reload the durable pending
operation without wallet RPCs or storage writes. The original decoder checks the
release, canonical bytes, identifier, action and target before an allowlisted
report exports only public signed bytes, identifiers/hash, action metadata and
all intent TTLs. It excludes the snapshot, private candidate, role secrets and
provider URLs. Inspection remains available after signed expiry and does not
renew the vault session, submit, clear or replace an operation. The UI identifies
TTL separately from allowance and claim deadlines and binds the display to the
current pending identifier and bytes.

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

The SDK immediately passes a wallet-balanced transaction to its submission
provider. Line checks session revocation on return from balancing and performs
one fresh network/both-identity check at that submission boundary. It retains the
fresh check before balancing, and avoids repeating the same wallet RPCs between
balancing and submission. After saving canonical signed bytes durably, the
initial send now checks every signed intent deadline before calling the wallet,
just as explicit resubmission does. An already-expired wallet result remains
saved and blocked for reconciliation; no replacement is prepared automatically.

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

Transfer exports open a named dialog with the complete JSON selected, an explicit
clipboard action and a download fallback. Closing restores focus to the opener;
locking the vault removes the package. Clipboard failure selects the text for
manual copying and never reports success. Exporting a saved quote neither posts
another quote nor requests a proof, wallet signature or transaction submission.

Optional organization fees use a Uint64 flat amount and 0-10,000 basis points,
with zero defaults and whole-base-unit upward rounding. The policy is fixed by
`openLine`. Purchase previews show price, fee and total allowance consumption;
wallet network fees are separate. Pending fees become withdrawable only after
redemption. Withdrawals use the contract's fixed issuer recipient.

Saved claims expose a separate expiry-only action (`cancelOrExpireNote`, mode 0).
It rechecks the exact claim opening and current provider state under the account
lock, rejects early/spent/cancelled claims and prepares no private book credit or
asset transfer. Compact checks ledger time; an accepted expiry moves principal
and pending fees into locked refund backing. The local `expiryRecorded` marker
is promoted only by exact finalized success, remains in an uncertain candidate,
and is explicitly validated in backups and against cancelled chain state during
restore. Older backups without the marker remain compatible. Compensation
allocation (mode 1) and the actual issuer-recipient asset refund (mode 2) remain
separate wallet-approved actions. Existing one-step claim recovery still works.

Merchant claim review reads the release-checked facility and binds the imported
opening to its public note metadata, merchant key and registered receiving
wallet. It shows the settlement asset, merchant payout, separately retained fee,
deadline and observed unspent/redeemed/cancelled status. Editing the package
invalidates the review. Redemption repeats the check under the account lock
before preparing a transaction, so a claim spent since review is rejected early.
Saved claim cards prioritize newer allowance generations and show payout, fee
and total charge. A recorded redemption is explicitly local; absent local records
require a current Merchant workspace check. Older claims remain exportable.
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
