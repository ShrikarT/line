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

Public pages and wallet connection do not load the ledger or Compact WASM engines.
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
