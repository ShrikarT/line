# Explicit address-bound private coordinator

This continues the [owner/service increment](ADDRESS_BOUND_OWNER_REVIEW_2026-10-13.md). The goal is to execute the same private financial lifecycle through address-bound v2 owners rather than silently selecting the original approval ABI. Canonical Compact and existing deployments/journals are not migrated.

## Implementation

`privateOfferApprovalProfile` permits only `line-private-offer/v1` or `line-private-offer/v2`, selecting their actual Compact sources. The default remains explicit legacy compatibility. The fixture accepts `approvalABI`; its CLI selects v2 with `--address-bound`. Every v2 owner policy and TLS client pins the initialized instance address. The worker places that address in the saved approval descriptor before requesting the role's signature.

For existing journals the worker requires the scope's source and executable hashes to match its selected source and compiled executable before opening the store. A source/ABI substitution cannot silently reinterpret a journal with the earlier source. V2 client ABI/address pins must match the worker's selected ABI and journal address. The native configuration selects the same source profile and still requires the complete source-bound key manifest; no old v1 keys or proofs become v2 evidence.

Fresh fixture reports fingerprint `scripts/address-bound-approval.mjs` as a transitive approval dependency. Addressed reports include explicit approval ABI and contract address; the metadata publisher selects the corresponding source and requires a separate publication destination. Older reports retain their recorded helper revisions.

## Verification ledger

The new public integration test requests the addressed ABI and asserts the source hash returned at initialization. Before implementation, it fails with the original source hash `ae970672...657d` instead of the addressed source `f5f92ef2...0b4e`. This proves the old fixture silently selected v1.

The first post-change isolated two-merchant run reached its 240-second supervisor limit without an accepted result. This is incomplete execution, not a contract assertion failure or a successful lifecycle. A revised bounded harness copies reviewed public source and installed dependency files into disposable scratch, then compiles and runs there to avoid repeated Windows bind-mount reads. The revised test passes without skips: **10 calls, eight deliberate exits, six controls and 46 worker invocations**. The generated execution itself takes 45.8 seconds after staging. Both merchants receive real durable-owner approvals, and exact prepared operations survive worker restart and response loss. Its all-twelve compensation run is now active and remains pending.

The container uses no external network, read-only source/toolchain/root, UID/GID 65534, no capabilities or privilege escalation, isolated IPC, two CPUs, 1 GiB memory/no swap, 64 processes, 256 descriptors, zero core dumps, a 16 MiB per-file limit and 256 MiB tmpfs scratch. The parent enforces a ten-minute wall bound and 8 KiB output disclosure bound. Environment is cleared and repopulated with scratch-local paths and the existing OpenSSL configuration. All test identities, policies, records and TLS material are synthetic. No target-created file is retained.

The ten-call v2 generated recovery increment is verified. Whole v2 generated lifecycle, native proofs, real network execution, assets, independent administration, fleet recovery and full-history privacy remain unverified until their respective evidence is recorded. CI explicitly runs the compiled two-merchant regression and separately compiles/runs the addressed all-twelve compensation lane; pending CI results are not inferred.
