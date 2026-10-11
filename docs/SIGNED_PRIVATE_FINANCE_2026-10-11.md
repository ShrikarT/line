# Signed approvals and private finance — 11 October 2026

The next-version candidate now compiles with the project-pinned **Compact 0.31.1 / runtime 0.16.0** and executes all twelve circuit names. It replaces public reserve totals and note/quote metadata with commitments, removes financial amounts from exported arguments, and keeps role signing scalars inside separate signer processes. **This is an experimental ABI, not a canonical migration, independent institutional custody, a cryptographically proven private flow or a full-history privacy pass.**

## Implementation and evidence

| Candidate | Source | Fresh generated execution | Scope |
|---|---|---|---|
| Signed approvals with the old financial disclosures | `contracts/experimental/line-signed-pool.compact` | 39 accepted lifecycle calls, 44 rejection controls, 16 additional signature controls | All twelve names; preserves the public-amount and historic-root counterexamples. |
| Private finance with signed approvals | `contracts/experimental/line-private-signed.compact` | 38 accepted lifecycle calls, 40 rejection controls | All twelve names; eight rejection controls exercise signature arithmetic/points; two additional controls preserve compensation/refund authority after the cancellation fix. |

Current private-finance source SHA-256 after the cancellation fix: `cb5a869f460d7a9bbb4703f36290fb792597f9c5d3ced0c894d352d62264c307`. Opening-fixed predecessor: `237b641549ce1649c24864b95c9133b882601403a2f8a76ef95ea0cf1285bb03`; original predecessor: `074103baec37c33c088c9de0efd7ad3cedf020911c26b0f32e2fbe79ad015f85`. Signed comparator source: `d0958efeb29d082c60440ca12925f13eaf8e48649f75b4e58e6a679a6f11a9c7`. Fingerprints are provenance, not substitutes for Compact hashes. [Current generated evidence](private-signed-2026-10-11-evidence/feasibility.json); [opening-fixed generated evidence](private-signed-2026-10-11-evidence/opening-fixed-feasibility.json); [original generated evidence](private-signed-2026-10-11-evidence/pre-hoist-feasibility.json); [signed comparator evidence](private-signed-2026-10-11-evidence/signed-comparator.json).

Both fresh local runs compile their own generated bindings and capture matching source/artifact fingerprints. Earlier cached runs explicitly record `freshCompilation: false` and do not establish source binding by that run. Fresh compilation initially encountered a WSL VM connection timeout; a later fresh run completed. Full twelve-circuit key generation completed for the private-finance predecessor. Its merchant registration and funding proofs passed separate native Rust verification, but opening caused repeated HTTP 500 check responses with a `subtle::CtOption` backend panic. This is [partial proof evidence](private-signed-2026-10-11-evidence/pre-hoist-partial-proof.json), not an all-circuit result or a rejected corrupt-proof control.

The opening fix moves signature verification outside the consent/issuer branches and keeps the issuer identity check in the issuer path. Fresh generated execution still passes 38 accepted operations and 38 rejection controls. Both borrowers' consent and issuer acceptance subsequently passed real proving and native Rust verification. This resolves the observed opening panic; the exact backend treatment of inactive curve inputs still needs independent review. Nine contract calls across registration, funding, opening and quotes passed. The first draw lost its prover during `/prove`: Docker reports an OOM event and exit 137 under an approximately 4 GB engine budget. No draw proof or corrupted-proof control passed in that run. A retry recycles only the owned prover on circuit changes; full lifecycle coverage remains pending.

The opening circuit received new proving/verifier keys. Eleven other freshly generated textual ZKIR files were byte-identical to their source-bound predecessor, so their existing keys and binary ZKIR were reused after fingerprint checks. This is an explicit exact-IR cache, **not full fresh key generation for the changed source**; [the manifest records every circuit](private-signed-2026-10-11-evidence/opening-key-generation.json). The proof driver validates that manifest, the fresh source-bound executable and each applied public transition. It requires separate Rust verification and attempts decodable corrupted-draw controls. Private checkpoint candidates are staged until that verification hook accepts. Existing canonical/pool proof receipts cover different sources. The deployed canonical contract is a different ABI/source and is not a deployment of this candidate.

[The post-fix partial report](private-signed-2026-10-11-evidence/opening-fixed-partial-proof.json) is explicitly incomplete and includes the independent Docker exit check. It records two facilities' consent/acceptance and quote proofs alongside funding/registration. It does not establish draws, corrupted controls, compensation or all twelve names.

The subsequent [recycled-prover run](private-signed-2026-10-11-evidence/recycled-partial-proof.json) verified **25 contract calls across eight circuit names**, and a separate native Rust process rejected **five decodable corrupted draw proofs**. Its valid calls include both facilities, both merchants, five draws, repayment, default/resume, closure and reopening. It stopped at expiry/cancellation with the same curve-check backend panic. These results belong to source `237b6415`, not the current cancellation-fixed source. Recycling avoided the observed OOM in that run; it does not establish a production memory budget or proof latency.

The cancellation fix likewise makes approval verification unconditional before branching. Expiry accepts any valid signing key and gains request-integrity/replay protection; allocation remains borrower-or-issuer authorized and refund reporting remains issuer-only. Fresh generated execution passes 38 accepted calls and 40 controls, including explicit unauthorized allocation/refund rejection. The cancellation circuit has new keys; eleven byte-identical freshly generated textual IRs reuse fingerprinted predecessor artifacts. [The cancellation manifest](private-signed-2026-10-11-evidence/cancellation-key-generation.json) records this cache. A full native run against this exact new source is pending. The isolated zero-cash compensation branch is exercised by generated execution only and is not counted as a native proof.

The [first cancellation-fixed native run](private-signed-2026-10-11-evidence/cancellation-fixed-partial-proof.json) verified eleven calls across five names and rejected two corrupted draws. It stopped during prover recycling before redemption: Docker had returned from `stop` while automatic container removal was still pending. This was an automation failure, not a rejected contract proof. The helper now waits for the exact owned container ID to disappear and refuses incompatible container configuration; two consecutive owned start/stop cycles pass. The retry additionally fingerprints that helper. Cancellation itself and all remaining names still need native verification for this source.

The [merchant-membership experiment](PRIVATE_MERCHANT_2026-10-11.md) extends this accounting construction with current registered/enabled merchant roots. It passes fresh generated execution and removes selected merchant identifiers from quote/draw views; native proof coverage and complete privacy remain pending for that separate source.

## Signing-key and reserve-opening boundary

Six child processes generate their own random Jubjub signing scalars. They compute action-specific approval messages and return points, signatures and reduction witnesses. The trusted Compact executor/prover never receives those scalars. Its ABI has no `callerSecret` or `agentSecret` witness. Instance domain, operation, relevant commitments, exact action terms and one-use authorization nonce bind approvals. Stable enrollment/payment nullifiers use a separately committed non-signing key.

The challenge shape follows the [Midnight verifiable-credentials proof semantics](https://github.com/midnightntwrk/midnight-verifiable-credentials/blob/main/spec/proof-semantics.md). This is a custom compatibility implementation for the pinned older toolchain, not an assertion that the newer runtime's Schnorr API exists in 0.16.0 or that the construction is independently approved.

The pinned compiler limits `Uint` widths to 248, below a full embedded scalar/challenge. The implementation uses 128-bit limbs, canonical scalar bounds, and bounded integer carry equations. Challenge limbs must represent an integer below the base-field modulus. A fixture signs the alternative `H+p` challenge deliberately; Compact rejects it at the canonical challenge check. Nonidentity and subgroup checks, response/remainder bounds, wrong carries/quotients, altered actions/amounts and replay are also exercised. Real constraint/proof verification and independent cryptographic review are still required.

The issuer-authorized, explicitly trusted book/reserve prover holds private reserve and book openings. Agents and merchants receive their selected purchase/action terms; reserve openings and the nullifier key are excluded from signer IPC. This allows exact reserve accounting without transferring aggregate openings to unrelated signers or transferring their signing keys to the prover. The prover still sees financial witnesses. These processes share one host and administrator, and the synthetic signer fixtures approve requested test actions. No independent organization, hardware-backed key protection, legal borrower consent UI, credential revocation policy or durable institutional custody is established.

## Private accounting and state integrity

`ReserveBook` commits domain, epoch and `T,E,R,F,P,U,X`. Every reserve-changing call proves the current opening, derives the exact next book, enforces `E+R+F+P+U+X <= T`, checks widths/epoch overflow, and rotates the commitment. Issuer approvals for funding and withdrawals bind the current reserve commitment. A funding counter is still not a deposit.

Private note/quote-state commitments bind their domain, note/quote identifier and exact metadata. Compact's `rememberReserve`, `rememberNote` and `rememberQuote` witnesses return candidates for off-chain persistence; independent runtime encodings match each resulting public commitment. These are synthetic in-memory candidates, not a durable journal or confirmed network state. Publishing them before finality would be unsafe.

The lifecycle includes two agents and two merchants; exact private fee and capacity checks; stale historic-root rejection; competing spends; merchant-bound redemption and replay; repayment-reference reuse; default/resume and zero-debt closure; reopening; exact expiry; zero-cash and partial-cash compensation; old-generation compensation preserving new debt; disabling new quotes while honoring existing claims; and fee/free-reserve withdrawal limits. The final synthetic accounting is `T=198979, R=947, X=198`, with other holds zero. These are test units, not money or customer balances.

`MerkleTree.checkRoot` checks the current common book root. The first attempt called `HistoricMerkleTree.root()` inside a circuit; the pinned compiler correctly rejected that runtime-only API. The candidate instead uses the supported current-root tree. Independent book updates therefore need fresh paths/rebasing; the harness does this. Durable concurrency, uncertain confirmation, recovery and finite tree capacity remain acceptance work.

## Disclosure verification and remaining privacy failures

The first private-finance draft removed public ledger totals but retained funding amounts and fees in exported arguments. Generated inputs exposed them. The current version moves funding/withdrawal amounts, fee terms, draw fee and requested status to witnesses. The harness checks empty funding/withdrawal/status inputs and the absence of the fixture fee from draw/opening inputs. It also checks selected identity/input-book/salt absence from draw views, distinctive principal words, and private reserve/note/quote commitments against the generated ledger. Rejection controls must fail during generated execution; a parent-side validation failure cannot count as a circuit rejection.

These checks close particular disclosure paths. They do **not** prove complete observer indistinguishability. Selected merchant lookup, quote/note identifiers, expiry/time bounds, action shape, participant side information, fixed-price catalogs, sender/DUST metadata and proving infrastructure remain observable or unresolved. A catalog and known fee/zero baseline can still imply a purchase debt even when numeric fields are committed. Neither additional agents nor hidden field names are a privacy certificate.

Next: remove selected-merchant query linkage with a supported revocable membership construction; specify complete authorized/public views and test counterfactual histories; generate all twelve candidate proving artifacts and verify actual/corrupted proofs natively; integrate durable signer/prover state and recovery; then reconcile a versioned migration. Existing public histories cannot be erased. Authentic deposits, fulfillment, payouts, repayment/refunds and customer demand remain separate gates.

## Reproduction

```bash
npm run signed:spike
npm run privacy:spike
npm test
git diff --exit-code contracts/managed/
```

For real local proving, first build the native verifier with `npm run proof:native:build`, fully compile the experimental source into a separate new target directory with `scripts/compile-compact.mjs` (omit `--skip-zk`), and run a fresh `privacy:spike`. Then run:

```bash
node --experimental-strip-types scripts/private-signed-proof.mjs <full-managed-dir> --compiled-check <fresh-fixture-managed-dir> --recycle-prover
```

The proof driver requires Docker and exclusively manages its labeled loopback coordinator prover on port 6301. It refuses an already-existing container. The recycling option discards completed circuit caches before another circuit name; it does not change global Docker/WSL settings or certify a memory requirement. It records proof/verification timings for the retry. Signers retain scalars; the financial prover is trusted. Synthetic time, disabled fee balancing, public evidence files and no network submission are deliberate scope limits. Full native verification is separate from generated execution and from live deployment receipts.

The two experiment commands compile fresh by default into ignored temporary directories and never replace canonical bindings. `--compiled-dir` is only a diagnostic convenience; cached execution is labeled explicitly and cannot establish fresh compilation/source binding. CI runs both fresh commands. No experiment command funds a wallet or submits a transaction.
