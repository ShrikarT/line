# Organization product verification

The current recovery increment is recorded in [recovery-verification.json](recovery-verification.json): 594 core passes, one intentional skip, 32 focused organization passes and seven organization browser passes; build, release/drift checks and scans pass. The evidence below describes the earlier checkpoint.

See [the readiness report](../../docs/ORGANIZATION_READINESS_2026-10-18.md) and [machine-readable scope](verification.json).

The committed screenshots show disconnected or metadata-connector browser UI with zero finalized customer transactions. They are visual verification, not actual Lace signing, a funded customer facility, or network settlement evidence. The browser fault test uses a synthetic receipt solely to verify actual IndexedDB transaction-abort recovery. Only the owner separately confirmed actual Lace connection and organization vault opening.

Local ignored logs retain the full core result (579/582, one failure, one cancellation, one intentional skip), affected core reruns, full browser result (41/43) and successful focused reruns of the two affected UI cases. All four organization browser cases and all nineteen focused organization unit/generated checks pass. Build/typecheck and both sixteen-file Compact drift checks pass. No new organization deployment, deposit, payout or public hosting is claimed.

Public proving releases are generated locally, not committed. Rebuild with `npm run organization:release` and validate with `npm run organization:validate` on another machine.
