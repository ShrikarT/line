# Organization product verification

The latest authenticated API and durable publication increment is recorded in
[production-api-verification.json](production-api-verification.json): 617 core
passes plus one intentional skip, followed by 55 focused organization passes and
nine browser passes after the final native fetch receiver fix. Deploy build,
both Compact/drift checks and credential scans pass. These checks submit no
customer wallet transaction. Public provider routing, funded supplier bootstrap,
actual new organization acceptance and public deployment remain open. See
[scope](../../docs/PRODUCTION_API_2026-10-18.md).

The latest supplier-custody and wallet-proving increment is recorded in
[standalone-supplier-verification.json](standalone-supplier-verification.json):
605 core passes plus one intentional skip, seven focused wallet lifecycle checks
and eight organization browser passes. Deploy build, both Compact regenerations
with zero managed drift, typecheck and credential scans pass. Actual SDK creation
preparation uses the wallet proving adapter before deliberate rejection. Full
native synchronization of an isolated empty wallet timed out without submission.
No funded new organization or public hosting is claimed. See
[scope and unresolved gates](../../docs/STANDALONE_SUPPLIER_2026-10-18.md).

The earlier creation-feedback and hosting-preparation increment is recorded in
[hosting-preparation-verification.json](hosting-preparation-verification.json):
598 core passes plus one intentional skip, 36 focused organization passes and
eight organization browser passes. The deploy build exports the actual public
proving release, and its SDK static-transport checks pass. No new customer
deployment, funded payout or public hosting is claimed.

The earlier recovery increment is recorded in [recovery-verification.json](recovery-verification.json): 594 core passes, one intentional skip, 32 focused organization passes and seven organization browser passes; build, release/drift checks and scans pass. The evidence below describes an older checkpoint.

See [the readiness report](../../docs/ORGANIZATION_READINESS_2026-10-18.md) and [machine-readable scope](verification.json).

The committed screenshots show disconnected or metadata-connector browser UI with zero finalized customer transactions. They are visual verification, not actual Lace signing, a funded customer facility, or network settlement evidence. The browser fault test uses a synthetic receipt solely to verify actual IndexedDB transaction-abort recovery. Only the owner separately confirmed actual Lace connection and organization vault opening.

Local ignored logs retain the full core result (579/582, one failure, one cancellation, one intentional skip), affected core reruns, full browser result (41/43) and successful focused reruns of the two affected UI cases. All four organization browser cases and all nineteen focused organization unit/generated checks pass. Build/typecheck and both sixteen-file Compact drift checks pass. No new organization deployment, deposit, payout or public hosting is claimed.

Public proving releases are generated locally, not committed. Rebuild with `npm run organization:release` and validate with `npm run organization:validate` on another machine.
