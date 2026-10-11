# Real local proofs and independent verification — 11 October 2026

[Recorded evidence](proof-2026-10-11-evidence/verification.json) establishes **19 real contract proofs across all twelve canonical circuits**, plus a synthetic deployment. Proof server **8.1.3** generated the proofs. A separate Rust process using `midnight-ledger` **8.1.3**, its `proof-verifying` feature, and explicit `ProofVerificationMode::Real` accepted each proven public transaction. No mock proving or verification feature is used.

Three negative controls alter an interior block of the actual draw proof while retaining a decodable transaction. The Rust verifier rejects each at proof verification. The installed ledger WASM accepts the same corrupted transactions despite requested verification flags. WASM execution and those flags alone are **not** evidence of cryptographic verification. The [upstream feature documentation](https://github.com/midnightntwrk/midnight-ledger) describes verification being disabled by default for WASM builds.

The source fingerprint is `35ebd14e19ce682230b685f6f3729923a9c56b0719eb17a684e44e4a39c73eff`. A validated compiler 0.31.1 release supplies every binary ZKIR/prover/verifier triple. Rust verification is separate from the compiler/runtime and HTTP prover; it is not a separate cryptographic implementation or an independent security audit.

## Observed lifecycle

1. Synthetic deployment; register Merchant B; record reserve funding of 100; open a 40-unit facility with a one-unit flat fee.
2. A quotes 25; the agent draws 26 of debt. Replayed draw rejects. B quotes 20; a further 21-unit draw rejects for insufficient private headroom.
3. Wrong-merchant redemption rejects; A redeems once; replay rejects. Issuer acknowledges an evaluation repayment of 26.
4. B's previously declined quote now draws 21; B redeems. Reusing the previous payment reference after the new draw rejects. A fresh acknowledgement clears the book.
5. A fresh five-unit quote draws six units of debt. Premature expiry rejects. Earned fees and ten unencumbered reserve units are withdrawn as counters; B is disabled.
6. After the actual wall-clock deadline, permissionless expiry and authenticated compensation produce verified proofs. Compensation clears the debt without creating a cash remainder. Zero-debt closure proves the final commitment.

Final public accounting is `T=88`, `E=0`, `R=45`; fee and refund counters are zero. The private final opening is checked in memory against the public commitment. Evidence publishes public counters, transaction-byte fingerprints, sizes and outcome labels. These fingerprints are **not network transaction IDs**. Signing secrets, books, salts, proof preimages and witness outputs are not persisted or published by the script.

## Reproduce

Install JavaScript dependencies and Rust. Run `npm run compact:compile:release` and `npm run proof:native:build`, then start the supported loopback service and run the experiment:

```text
docker run --detach --rm --name line-proof-server-8-1-3 --publish 127.0.0.1:6301:6300 midnightntwrk/proof-server:8.1.3 midnight-proof-server -v
npm run proof:local
```

The command validates provenance and server version and requires the native verifier. `--allow-wasm-only` is diagnostic and cannot establish independent verification. Fresh reports and public state/proven transaction files stay under ignored `.compact-keys/local-proof-*`. No private proving payload is written there. The Rust lockfile fixes dependency versions; Cargo's feature tree can confirm the absence of `mock-verify`.

## Limits

**Fee balancing is disabled.** No funded wallet, submission, finality, testnet deployment, deposit, token transfer, payment receipt or merchant payout is established. The issuer's repayment assertions authenticate a role/reference, not cash. Verification does not make these synthetic transactions network-valid.

All canonical signing keys/openings share one orchestrator process. The loopback proof server receives private preimages. This does not verify independent role custody or the [two-phase opening experiment](CUSTODY_SPIKE_2026-10-11.md). Historical privacy still fails. Refund-report action 2, positive cash remainder, old-generation compensation, default/resume and every adversarial branch are not covered by this proof run; generated-execution tests are a different evidence layer.

The next network gate needs actual fee funding/balancing, compatible endpoint/wallet configuration, submitted IDs, finalized receipts and independently decoded state. Custody, privacy, settlement and customer gates remain open.
