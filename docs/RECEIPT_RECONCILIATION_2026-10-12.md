# Finalized receipt reader — 12 October 2026

The previous canonical receipt audit compared indexer action metadata, raw transaction hash, finality height and canonical block hash, but did not compare the indexer's named action against the actions actually encoded in those raw transaction bytes. A fabricated address, circuit name or action kind could therefore pass that particular boundary if the other provider fields were consistent. This is a defensive validation gap, not evidence of a compromised provider or a fabricated reported deployment.

`scripts/finalized-contract-receipt.mjs` now provides a reusable read-only reader. `scripts/verify-preprod-receipts.mjs` uses it for the twenty reported canonical deployment/key-registration/call receipts. The canonical audit retains its exact verifier-key inventory and public-ledger decoding checks. Each output report fingerprints the audit script, reader and endpoint resolver.

## Actual checks

For each receipt the reader freshly queries the configured RPC finalized head/header, the indexer transaction by hash, and the canonical block hash at its reported height. It requires complete success, boolean successful segment outcomes, a unique target action and matching action type/entry point. The inclusion block must be at or below the fresh finalized height and match the RPC canonical hash.

It then decodes the actual bound transaction and contract state with the pinned ledger SDK, requires exact serialization roundtrips, compares the transaction hash and full identifier list, and checks the target address/action type/entry point against the encoded raw actions. The SDK's 33-byte tagged transaction identifier is distinct from a 32-byte transaction hash; both are validated with their correct widths. Deployment and maintenance registration are not labeled as circuit execution.

HTTPS endpoints and configured credentials are required. Requests refuse redirects and use a 30-second abort signal. Advertised and streamed response bodies are bounded at four MiB. Invalid or oversized responses fail closed; rejected streams are canceled. Public errors contain fixed categories, without provider body text, credential URLs, signing keys or financial openings.

The reader's authority remains the operator-configured TLS indexer and RPC. Matching their responses is not a light-client inclusion proof, independent full-node execution or local cryptographic re-verification of each network proof. Decoding a state does not independently prove its transition. The canonical consumer separately checks registered verifier keys against the pinned source-bound fixture.

## Verification scope

`npm run network:receipts:test` passes **36 tests**: eleven retained metadata controls and 25 new reader controls. The new controls cover a real previously published public call transaction, raw/indexer action disagreement, wrong contract, mislabeled maintenance, identifier mismatch/width, malformed/trailing bytes, partial success, missing segment outcomes, ambiguous receipts, unfinalized blocks, RPC correlation/header failures, canonical-block disagreement, missing credentials, insecure transport, oversized streams and safe error text. Deployment/maintenance serialization examples have no contract proof requests and make no network-validity claim. Provider responses are simulated; these tests do not confirm the reported Preprod transactions.

A fresh invocation of the read-only canonical audit still exits with `PREPROD_READ_ONLY_TOKEN_MISSING`, zero receipt checks, `complete:false` and `networkMetadataIndependentlyRequeried:false`. No wallet, funded deployment, transaction submission or asset transfer was used. The result is saved locally in `.compact-keys/receipt-reader-network-check/verification.json`.

Canonical Compact compilation and zero managed drift pass. The full sequenced local code regression passes **510 tests / 60 suites**. Build/typecheck and production key/credential scans pass. The 36 receipt tests are separate from the 510-test core command and are already included by the CI receipt-check command. Native proof reports keep their original helper fingerprints; their code was not modified or relabeled by this reader change. Fresh remote CI is required for this implementation.

## Remaining coordinator integration

The subsequent [network financial journal boundary](NETWORK_FINANCIAL_JOURNAL_2026-10-12.md) adds internally fetched bootstrap/confirmation, durable submitted identifiers/bytes and owner-pinned verifier policy. Preprod can no longer use the journal's synthetic bare-state methods. It also handles the tested SDK merge form by preserving saved bound intents. This is an application/storage integration with simulated-provider controls; the actual worker/wallet/deployment path and live finality remain open. The paragraph below describes the worker scope, not permission for a network journal to trust copied state.

The private coordinator still initializes only a synthetic scope and its journal `confirm` accepts a caller-observed candidate. This patch does not present that API as finalized network confirmation. A safe network integration must first pin the actual candidate deployment/source/verifier set, preserve the exact balanced submitted transaction and identifiers before dispatch, fetch receipt authority internally, compare the confirmed public effect with the saved private candidate, and publish the checkpoint atomically. Timeout, partial execution, wrong identity, state mismatch and ambiguous confirmation must retain the candidate and block replacement work.

The local native candidate uses synthetic time and disabled balancing; its public proof bytes cannot simply be treated as a fee-funded Preprod submission. Its deployment, DUST/wallet balancing, independently reconciled bootstrap, all-twelve durable recovery and concurrency remain separate work. Authentic settlement and full-history privacy remain open even after a receipt is verified.
