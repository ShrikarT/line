# Custody compatibility and operational acceptance — 11 October 2026

Latest evidence: [enrollment](PRIVATE_ENROLLMENT_2026-10-11.md) verifies 52 local contract calls across all twelve names; [durable agent integration](DURABLE_ACTOR_2026-10-11.md) verifies six calls through two process restarts. These distinct synthetic runs are not the deployed canonical contract, independent institutional custody, complete financial recovery, full-history privacy or asset settlement.

The signed candidates demonstrate that Compact can verify external approvals without receiving role signing scalars. This closes a specific feasibility question, not independent institutional custody. Source `a8d14adf` has complete local native coverage; the separate merchant source `afb75b1` completes 39 lifecycle plus seven isolated native calls. Both use a trusted financial coordinator/prover that receives book and reserve openings.

## Hardware compatibility is unresolved

The approval is a custom Schnorr construction over the runtime's Jubjub group, using Compact persistent hashing and explicit integer challenge reduction. [The implementation report](SIGNED_PRIVATE_FINANCE_2026-10-11.md) explains its relationship to [Midnight's credential proof semantics](https://github.com/midnightntwrk/midnight-verifiable-credentials/blob/main/spec/proof-semantics.md). Similar challenge semantics and valid proofs do not constitute an independent signature-security review.

[AWS KMS's current key-spec reference](https://docs.aws.amazon.com/kms/latest/developerguide/symm-asymm-choose-key-spec.html) lists supported signing combinations without Jubjub. [Azure Key Vault's current key/algorithm reference](https://learn.microsoft.com/en-us/azure/key-vault/keys/about-keys-details) likewise lists its supported EC curves/ECDSA operations without this construction. **Inference:** their documented managed signing APIs are not drop-in signers for this approval scheme. This does not establish that every hardware device, custom enclave or MPC implementation is incompatible. Require an actual supported implementation and source-bound demonstration before claiming compatibility.

Wrapping a Jubjub scalar with a KMS encryption key can protect stored ciphertext. Unwrapping it into ordinary process memory to sign does not demonstrate non-extractable hardware signing. An Ed25519/ECDSA signature cannot simply be substituted in this Compact verifier. A different backend requires actual supported Compact verification, source-first compilation and new proofs/keys; none is established here.

## Current evidence and remaining work

| Boundary | Established | Required acceptance |
|---|---|---|
| Scalar separation | Six fixture children create scalars; executor ABI has no signing-scalar witness | Independent administrative control, appropriate host isolation and secret-free logging |
| Exact authorization | Domain, operation, terms/commitments and one-use nonce are covered; generated wrong-role/action/replay controls reject | Each actor derives the digest and applies its own authenticated policy; no unrestricted signing oracle |
| Data minimization | Reserve/nullifier openings stay out of signer IPC; expiry/reporting exclude book openings | Authenticated encrypted transport, role-specific schemas and authorization |
| Durable identity | Native fixture keys disappear on exit; separate encrypted software prototype preserves identity across restart | Encrypted durable ownership, controlled backup/restore, rollback resistance and recovery of the same public key |
| Approval recovery | Compact rejects a repeated accepted authorization; separate prototype journals before response and recovers committed approvals after process exit | Durable operation IDs, immutable terms and recovery of the original response before resolving uncertain submissions |
| Policy | Fixture signers approve requested actions | Issuer-approved borrowers/terms, agent limits and known offers, merchant-owned quotes/claims, explicit withdrawal authority |
| Key lifecycle | Issuer/nullifier commitments initialize; merchant registration/revocation exists | Recovery/migration plans; current ABI exposes no general issuer/agent key rotation or arbitrary claim reassignment |
| Financial state | Native verification gates in-memory candidates | Persist encrypted openings and submitted IDs before dispatch; advance only after confirmed exact transitions; restore/rebase safely |

Circuit authorization controls do not show that an independently owned signer rejects a malicious coordinator's policy-violating request. A different port or child process establishes neither ownership nor policy.

## Durable software prototype

[The new prototype](DURABLE_APPROVAL_SIGNER_2026-10-11.md) passes seventeen targeted tests, including a child process that commits an approval and exits before returning it. It uses the existing exact Compact action hashing and Jubjub approval semantics, encrypted storage, explicit role/domain policy binding and conservative persisted authorization budgets. It has no authenticated remote transport, independently controlled deployment, rollback-resistant store, native-fixture integration, key rotation or funded execution. Software encryption is not hardware-contained signing.

## Next implementation boundary

Retain the explicitly trusted issuer financial prover and external approvals while testing customer acceptance of that trust model. Put each signer behind an independently controlled authenticated policy boundary, with durable identity and an idempotent operation journal. A prototype can use accurately labeled encrypted software custody; hardware signing remains separate.

Acceptance first uses synthetic keys: restart each signer with unchanged public identity; deny wrong-domain/role/action requests; reject changed terms under reused operation IDs; recover the same approval after lost responses; deny replay/rollback; and show a compromised coordinator cannot obtain an out-of-policy approval. Then repeat the exact candidate lifecycle with native verification, funded finalized execution and crash/uncertain-submission recovery. Existing wallet seeds and the funded deployment script are unnecessary for the synthetic exercise.

Disabling merchants preserves old registered claims; it cannot reassign them after key loss. Reopening/registry controls are not general key rotation. Explain how backup, recovery and migration preserve liabilities, claims and nullifiers before onboarding capital or independent suppliers.

This acceptance design changes neither deployed ABI nor custody behavior, identifies no committed vendor/customer and certifies no institution, enclave or signature construction.
