# Authenticated Preprod readers — 18 October 2026

The standalone organization server now supplies same-origin HTTP and WebSocket
readers without returning its Blockfrost credential. These routes query public
ledger data; they cannot construct, sign, prove or submit a payment.

The connected wallet's usable indexers remain preferred. Missing Blockfrost
credentials use the authenticated fallback, while the historical token helper is
requested only on loopback. Fallback metadata must identify Preprod and the exact
same-origin routes. Wallet submission and wallet-selected proving are unchanged.

The proxy accepts one bounded read-only GraphQL operation against fixed server
endpoints. It rejects mutations, multiple operations, introspection roots, named
fragments and caller-supplied destination parameters. It forwards no caller
cookies, authorization headers or connection-init credentials upstream. Responses
exclude provider diagnostics and redact configured URL credentials. HTTP bodies,
responses, deadlines, concurrent requests, sessions and subscriptions are bounded.

All eight SDK promise reads and two observable entry points authenticate before
starting. Expired/revoked sessions trigger wallet sign-in through an explicit
authentication rejection; near-expiry sessions renew before another read. No
contract action or payment is retried by this adapter. Logout, expiration,
session eviction and shutdown immediately invalidate idle subscriptions.

## Actual read evidence

The [Chromium/Preprod report](../artifacts/organization-product/provider-routing-preprod-read.json)
records the installed browser Midnight SDK reading the historical canonical
contract through the actual server routes. HTTP decoded twelve registered
operations. After signing out, the same reader reauthenticated and decoded the
same twelve operations. A historical subscription delivered a real earlier
contract state with one operation. The observed Preprod head was 3,030,683.
No provider credential appeared in browser request URLs. The check started no
native wallet and submitted no transaction; its isolated catalog boundary is
explicitly not acceptance of the funded supplier runtime or actual Lace.

The initial subscription verifier incorrectly waited for a fresh update to the
historical contract in a current block. It timed out without changing chain
state. The corrected verifier requests historical contract actions (`type: all`)
and receives the actual earlier state; the unsuccessful log is retained locally.

The complete core run passes 626 of 627 cases, with one intentional skip and no
failures or cancellations. All nine organization browser cases pass. Focused
transport, cryptographic sign-in, reader admission and idle revocation checks
pass. Both review axes found no remaining actionable issue after the renewal and
idle-subscription fixes. Build/typecheck and credential scans are recorded in
the accompanying verification artifact.

## Submission scope

The owner changed the immediate target to a submission-ready Wave 2 prototype.
Production supplier cold start/funding, a new wallet-owned organization's full
funded lifecycle and public service deployment remain future product work.
The already finalized two-merchant test-token checkout is separate, valid
Preprod prototype evidence; it is not customer-money settlement or full-history
privacy. See the [submission package](SUBMISSION_READY_2026-10-18.md).
