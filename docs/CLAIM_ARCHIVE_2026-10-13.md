# Commitment-keyed claim custody — 13 October 2026

The private coordinator retained only `offers[merchant]` and `notes[merchant]`. Another purchase at the same supplier replaced the earlier quote terms and draw-note nonce/salt. The generated private note metadata remained, but that metadata is not the original draw-note opening. This could strand an older unredeemed claim. The original two-supplier fixture did not exercise this case.

The coordinator now retains immutable `offerRecords[quoteCommit]` and `noteRecords[noteCommit]` inside the encrypted financial checkpoint. Latest supplier records remain convenience selectors. A new candidate first imports any retained legacy latest records, then archives new quote/note openings before publishing. Note records also preserve their original borrower identity. Conflicting replacement of an archived opening fails closed.

Draw optionally accepts a public `quoteCommit` selector; redemption optionally accepts a public `noteCommit` selector. Selection verifies the record's supplier against the configured role point and requires the selected commitment to match its archive key. The stored private salt/nonce supplies the Compact opening. A missing, spent or foreign selection is rejected before another approval intent is staged. Completed exact retries still bind their original semantic request. No opening, salt, fee policy or book is added to supplier RPC payloads or public reports.

## Recovery evidence

Three additional controls test replacement of current supplier selectors while retaining old nonce/salt records, foreign/missing/malformed selection, legacy latest-record import and rejection of an archived nonce change. They complement the actual generated scenario; they do not prove every operational history.

The new repeated-supplier fixture performs **13 Compact calls**: two quotes and two unsettled draws at Merchant A, explicit selection of its older quote after the newer quote, and redemption of its older note after the newer draw. It then redeems the current note and separately completes Merchant B's purchase. Each normal call restores its prepared packet in a new worker. Three draw sequences exercise write-ahead/approval/prepared/confirmed reply loss, giving twelve deliberate exits. Twelve controls pass, including spent/foreign selectors and an empty authorization/pending state afterward. The recorded fixture uses 63 successful/deliberately interrupted worker invocations; rejected control invocations are not included in that historical counter convention.

The prices are 10, 10 and 15 credit units, with the existing exact fee rule. The issuer/agent/supplier policy limits are unchanged; this remains within the existing agent authorization budget. Public selectors are discovered from generated public state, and the parent receives no private witness packet. [Source/helper-bound generated report](private-signed-2026-10-11-evidence/owner-coordinator-repeat-supplier.json).

Reproduce with `npm run owner:coordinator:compact -- --repeat-supplier`. CI now includes this separate scenario in addition to the original ten-call fixture. The original fixture also passes its ten calls, eight exits, six controls and 46 counted invocations with the new archive code. Both generated scopes retain their separate reports.

The full local regression passes **535 tests / 60 suites**, with eight coordinator unit controls and 36 separate receipt controls. Canonical compile/zero drift, build/typecheck and production key/credential scans pass. A source-bound native driver recognizes the separate repeat-supplier schema and requires all 13 calls, three actual prover interruptions, three exact proof recoveries and three corrupted-draw rejections before completion. The native run is still pending and is not inferred from generated execution.

## Limits and compatibility

Legacy imports preserve only openings still present in the checkpoint. Already-overwritten secrets cannot be reconstructed by this change; use an authenticated owner backup if one exists. Old pending witness packets are restored unchanged. Archives are never silently evicted to make room for new work; the existing bounded journal requires explicit archival once its operation capacity is reached. External anti-rollback anchors, device loss, backup/migration and independently administered custody remain separate requirements.

The fixture covers first-generation quote/draw/redemption across six names. It does not implement the other coordinator lifecycle actions or prove refund/compensation recovery, all-twelve durable execution, parallel workers, fee-funded network confirmation, real assets or full-history privacy. Retained openings provide required data for those future actions, not evidence that the actions now work. Canonical and experimental Compact sources and the twelve exported names remain unchanged.
