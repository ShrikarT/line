# Checkout restart recovery — 10 October 2026

The generated-Compact checkout evaluation now has an optional encrypted disk checkpoint store. Configured sessions recover their credit book, ledger, role capabilities, purchase intentions, quote/note openings, acknowledgement references and completed service results after a server process restart. The unconfigured default remains volatile. This closes a local restart failure path; it does not establish production checkout, independent custody, network finality or asset settlement.

## Configure a dedicated store

Set both server environment variables before starting development or preview:

- `LINE_CHECKOUT_STORAGE_DIR`: an absolute path to a dedicated private directory. A new directory is created; an existing one must contain only Line checkpoint, temporary and lease entries.
- `LINE_CHECKOUT_STORAGE_PASSWORD`: a user-supplied password containing at least 16 characters. No default password or committed encryption key exists. Use a strong independently generated secret and a separate protected backup.

For PowerShell, these commands request the password without displaying it. They do not place it in command-line arguments:

```powershell
$env:LINE_CHECKOUT_STORAGE_DIR = Join-Path (Get-Location) '.line-checkout-private'
$checkoutPassword = Read-Host 'Checkout storage password' -AsSecureString
$env:LINE_CHECKOUT_STORAGE_PASSWORD = [System.Net.NetworkCredential]::new('', $checkoutPassword).Password
npm run dev
# After stopping the server:
Remove-Item Env:LINE_CHECKOUT_STORAGE_PASSWORD
Remove-Item Env:LINE_CHECKOUT_STORAGE_DIR
```

The example directory is gitignored. These variables belong to the server process; do not prefix them with `VITE_`, publish them to clients or include their values in logs. Vite development and preview await recovery before accepting checkout requests and release the lease on graceful shutdown. Static production hosting still does not supply the checkout API.

Missing one variable, a short password, another live directory owner, an incompatible checkpoint or failed authentication rejects startup. An incorrectly configured directory containing unrelated project files is refused before its permissions are changed. Never point the store at the repository root or another general-purpose directory.

## What is persisted and when

`server/checkout-engine.ts` serializes the actual generated ledger using Compact runtime `ContractState.serialize()` and reconstructs it with `ContractState.deserialize()`. Generated circuits remain the accounting source of truth. No replacement protocol simulator or replacement commitment/hash is used. SHA-256 binds file/version provenance only.

Each checkpoint includes the public ledger state and all private execution inputs required to resume it: issuer/agent/merchant secrets, private credit opening, immutable request terms and quote/note openings, per-order phase and result, repayment reference allocations, funding/opening state, session identity/capabilities and creation time. The saved form preserves big integers and byte arrays through the vault codec.

Mutations are serialized per session. Checkpoints are committed after funding and opening separately; after preparing an intention and each quoted, authorized, redeemed, declined or delivered order phase; and after each repayment acknowledgement. The ledger and its corresponding private opening/phase are published together in one authenticated encrypted checkpoint. Reads wait for the operation queue; direct reads during publication fail closed.

The store uses scrypt-derived AES-256-GCM with fresh salt/IV. Authentication binds the format, session ID and execution source/version fingerprint. A private temporary file is flushed before same-directory atomic rename. On Unix, the directory is also synced; Windows does not provide that directory sync through this implementation. A checkpoint failure stops further work on the affected session. Restart resolves publication uncertainty by loading the last authenticated file instead of continuing from tentative memory. Failed session creation also stops further creation until restart/recovery.

The directory has one process owner, enforced by an exclusive lease. A lease from a dead process can be reclaimed under a recovery guard; a live owner is refused. An interrupted lease/recovery-guard publication may require operator inspection. Unix storage requires current ownership and mode 0700; Windows removes inherited directory access, grants current-user/System access and rejects unrelated explicit grants. Files are created privately. This does not protect against compromise of the owning OS account or the executing process.

## Verified evidence

`server/checkout-durability.test.ts` adds 15 tests. Together with the existing checkout and resilience tests, the focused run passed **28/28 tests** with no skips. The tests execute the generated Compact contract and cover:

- Recreated-store recovery at prepared, quoted, authorized, redeemed and delivered boundaries, retaining the original quote/note and a single accounting charge, claim and recorded delivery under concurrent exact retries.
- Recovery after funding but before opening, preserving original facility terms without funding twice.
- Repayment reference deduplication across later purchases and restarts.
- Fail-stop behavior after failed checkpoint writes, actual filesystem publication failure and rejection of reads while a checkpoint is pending.
- Disk inspection for absence of plaintext document, books and capabilities; rejected wrong passwords, ciphertext tampering, swapped session files and incompatible source fingerprints.
- Refusal of a second live writer and refusal to adopt a directory containing unrelated files.
- An actual child process exiting without releasing its lease, followed by recovery in the parent process.
- Recreated HTTP middleware retaining capability authorization and the exact completed receipt; an agent capability still cannot acknowledge repayments.

TypeScript checking also passed. These results support local restart recovery within the following limits, not a broader exactly-once or production-readiness claim.

## Limits that remain open

New purchases close 30 minutes after creation; this cutoff does not revoke API authorization for exact order retries, status reads or issuer reconciliation. The request-time reaper removes an expired session and its checkpoint only after the evaluation has no debt, unredeemed authorization or refund budget requiring reconciliation. Sessions with obligations remain retained and continue to count against the 20-session capacity. If the browser loses its in-memory capability/IDs, the current service has no operator lookup/recovery interface, so an unresolved session can become stranded and consume capacity indefinitely. This protects local evaluation evidence from silent deletion but is not a funded production ledger or regulatory/audit archive. A public deployment needs bounded admission, authorized orphan recovery, explicit archival/retention and capacity management that never discards live obligations.

The browser keeps capabilities, purchase IDs and acknowledgement IDs in page memory. Reload/navigation loses them; encrypted server recovery does not provide browser account recovery. Keeping the original page open lets it retry the original IDs after a server restart before expiry. A lost password or lost storage directory is not recoverable through this implementation; institutional backup/restore and key rotation remain required.

The fingerprint covers Compact source/generated code, checkout execution/storage, harness, encodings, codec and pinned/installed runtime versions. A changed execution version is rejected instead of silently interpreting old openings. A version migration/import tool is not implemented. Protect and retain an old store when upgrading; do not treat deletion or a new evaluation as migration of real obligations.

Authenticated encryption rejects modification and record swapping, but does not detect deliberate rollback to an older authentic complete checkpoint. There is no independent monotonic checkpoint authority, replicated journal or disaster-recovery guarantee. Windows power-loss durability of the rename is not asserted; the evidence establishes process restart behavior.

Local service delivery is deterministic computation whose completed output is stored. A crash before output publication may cause the same computation to run again. No external merchant delivery, charge or payout happens, so this is not evidence of exactly-once external side effects. Network submission/finality uncertainty, supplier reconciliation, genuine payment verification, compensation/refunds and durable production obligation retention remain open.

All role secrets remain in one process and one encrypted store. The evaluator still receives both issuer and agent capabilities. Encryption and API scope checks do not constitute independent issuer, agent and merchant custody. Public protocol amounts/deltas and historical debt inference are unchanged. No submitted ZK proof, confirmed network transaction, genuine cash collection or token transfer is claimed.
