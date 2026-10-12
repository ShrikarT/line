# Public transaction encoding review — 12 October 2026

All eleven saved private-offer pairs now have a measured field-level account of their byte-length differences. [Source-bound results](private-signed-2026-10-11-evidence/offer-native-wire.json) retain each difference, including public opcode positions and widths. This resolves the finite size-accounting uncertainty, not complete-history privacy or indistinguishability of the public values.

The pinned Rust reader decodes 22 actual public transactions from the completed 65-call native run, requires exact serialization roundtrips and checks every measured component's size hint against its actual encoding. It reads no keys, proof preimages or financial journals and emits no scalar/cell values. Truncated and trailing-byte controls reject. It does not cryptographically reverify proofs; validity remains bound to the exact earlier native report and each artifact's hash.

| Pair / trace indices | Transaction delta, right minus left | Measured field account |
|---|---:|---|
| Confidential-fee consent, 3 / 8 | -1 byte | Binding reply +1; public transcript program -2 |
| Acceptance, quote, draw, 4 / 9, 5 / 10, 6 / 11 | 0 | No measured component-width changes |
| Redemption, 7 / 12 | +2 | Binding reply +1; transaction binding randomness +1 |
| Enrollment consent, 36 / 37 | 0 | No measured component-width changes |
| Enrollment acceptance, 38 / 39 | +1 | Public transcript program +2; transaction binding randomness -1 |
| Refund repayment, 48 / 52 | +1 | Transaction binding randomness +1 |
| Refund allocation/cash report, 49 / 53, 50 / 54 | 0 | No measured component-width changes |
| Refund acknowledgment, 51 / 55 | -1 | Binding reply -1 |

Every transaction, intent, call and transcript delta equation has zero arithmetic residual in these samples. Absolute standalone component lengths are not generally additive because embedded objects use a storage graph. Proof lengths and transcript gas/effects/version widths contribute no additional variation here.

Consent's nominal `Bytes<32>` cell has normalized payload widths 32 / 31 at opcode positions 49 and 53. These repeat the identical public push operation; graph sharing makes the two uses contribute one two-byte program difference. Enrollment acceptance has the opposite 31 / 32 change at position 92. Base-crypto's `ValueAtom` normal form removes trailing zero bytes. Its length prefix uses one byte at length 31 and two at 32. This encodes an already-public transcript value; it is not newly returned private witness data. Privacy of the underlying public commitment/query values still requires a separate construction argument.

The binding reply and transaction binding randomness have variable-width public field encodings. The earlier [standalone review](private-signed-2026-10-11-evidence/offer-native-components.json) explained the reply only. Its narrower historical scope remains intact; this report adds transcript and transaction-randomness measurements.

## Reproduction

[The public corpus](../tests/fixtures/private-offer-public-pairs/manifest.json) contains 22 synthetic proven transaction files totaling 141,100 bytes. Every hash matches its indexed transaction in the original public native report. It contains no private journals, preimages, role/TLS keys or operator wallet data. Reproduction needs no private keys or new proof generation.

```bash
CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --manifest-path scripts/native-public-components/Cargo.toml --target-dir .compact-keys/public-reader-target
node scripts/private-offer-wire-review.mjs tests/fixtures/private-offer-public-pairs .compact-keys/public-reader-target/debug/line-native-public-components
```

On Windows, the verified build used `cargo rustc --locked --offline --manifest-path scripts/native-public-components/Cargo.toml --target-dir .compact-keys/native-proof-target --bin line-native-public-components -- -C debuginfo=0 -C link-arg=/DEBUG:NONE`. A separate target exhausted disk space; Cargo removed that new incomplete cache. A debug link then hit a PDB limit; disabling PDB generation succeeded. Existing prover/verifier executables, proof artifacts and keys were retained. These are build diagnostics, not acceptance evidence. The library versions/source files, helper files and reader binary are fingerprinted in the report.

The publisher checks source/helper/binary hashes, corpus and original public report hashes, all eleven residuals and both rejection controls. CI builds the reader and repeats the fixed public corpus comparison. Canonical Compact/bindings are unchanged. The complete local regression passes **510 tests / 60 suites**; compilation/zero drift and production key/credential scans pass. Implementation `ca4b20c` passes [push CI](https://github.com/ShrikarT/line/actions/runs/38258200162) and [PR CI](https://github.com/ShrikarT/line/actions/runs/38258207143): the freshly built Linux reader reproduces all eleven zero-residual comparisons, alongside 508 Linux tests with two platform skips, both Windows ACL controls, 20 browser checks and existing compile/build/scans/zero-drift checks. The local Windows full suite passes all 510 tests. No network, fee balancing or asset flow is involved.

## Remaining privacy gate

Explaining these lengths does not establish indistinguishable commitments, signatures, nullifiers or complete histories. Equal lengths do not establish equal contents; an explained difference does not certify its underlying value. Caller/actor attribution, timing, chosen-price probing, public lifecycle disclosures, externally known invoices/fees, prover access, live DUST/asset events and operational integration remain in the [observer acceptance model](PRIVACY_OBSERVER_MODEL_2026-10-11.md). Canonical deployed history still reveals debt increments. No full-history privacy pass, canonical migration or Wave 2 privacy-demo gate closure is claimed.
