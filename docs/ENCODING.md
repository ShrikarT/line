# Canonical Compact encoding

Updated: 10 October 2026. Selected migration: compiler **0.31.1**, language **0.23**, runtime **0.16.0**, compiler ledger model **8.0.2**. Regenerated artifacts/tests must establish compatibility; version guidance alone does not. [Deployment stack](DEPLOYMENT.md).

Compact source and generated bindings are authoritative. `src/lib/line/encoding.ts` uses runtime `persistentHash`/`persistentCommit` with the compiler's typed descriptors, field order and vector lengths. Do not replace them with SHA-256. Descriptor/protocol changes need Compact-first regeneration and new exact-match evidence.

## Primitive representation

- `Bytes<32>` is exactly 32 bytes: `new CompactTypeBytes(32)`.
- `Uint<64>` is bigint within `[0, 18446744073709551615]`; struct fields use `CompactTypeUnsignedInteger(max, 8)`.
- `pad32(label)` zero-pads UTF-8 bytes and rejects overflow; matches Compact `pad(32, "line:…")`.
- `encodeU64(n)` matches `n as Bytes<32>` using `convertBigintToBytes(32, n, "line.encodeU64")`, little-endian 32 bytes. This vector-element encoding differs from typed `Uint<64>` struct fields.
- Local hex avoids browser `Buffer`. `fromHex` requires 32-byte hex with optional `0x`. Generic `hexToBytes` has different length semantics and alone does not validate a witness.
- Canonical invoice ID decodes 64-character hex; other identifiers use UTF-8 padding and fail above 32 bytes, without silent hashing/truncation.

## Exact tags and keys

| Tag label | Primitive |
|---|---|
| `line:issuer:pk` | `persistentHash(Vector<2, Bytes32>, [tag, issuerSecret])` |
| `line:merchant:pk` | `persistentHash(Vector<2, Bytes32>, [tag, merchantSecret])` |
| `line:id` | `persistentHash(Vector<2, Bytes32>, [tag, agentSecret])` |
| `line:v2:domain` | Four-element domain vector |
| `line:v3:quote` | Ten-element quote vector including issuer fee policy |
| `line:v2:draw` | Four-element draw nullifier |
| `line:v2:redeem` | Four-element redemption nullifier |
| `line:v2:repay` | Seven-element repayment nullifier |
| `line:v3:payment` | Four-element stable payment nullifier |

Every tag means `pad32(label)`. `line:protocol:2:quote` does not match current source. Untagged secret hashing does not produce its role key.

## Domain and line commitment

```text
domain = persistentHash(Vector<4, Bytes32>, [
  pad32("line:v2:domain"), issuerPk, initialMerchantPk, instanceNonce
])
```

Current typed `LinePreimage` field order:

1. `domain: Bytes<32>`
2. `identity: Bytes<32>`
3. `limit: Uint<64>`
4. `outstanding: Uint<64>`
5. `epoch: Uint<64>`

```text
C = persistentCommit(LinePreimageType, preimage, salt)
```

Salt is Bytes32. The domain is `contractDomain`, derived by the Compact constructor from issuer, initial merchant and `instanceNonce`. Generated Compact and the TypeScript encoder must agree on this exact five-field order. The line commitment is deployment-bound; line generation remains a separate public lifecycle counter.

## Quote

```text
Q = persistentHash(Vector<10, Bytes32>, [
  pad32("line:v3:quote"), merchantPk, invoiceId,
  encodeU64(amount), encodeU64(expiry), nonce,
  encodeU64(generation), domain, encodeU64(feeFlat), encodeU64(feeBps)
])
```

Invoice precedes amount. Public `QuoteMeta` is `{expiry: Uint<64>, lineGeneration: Uint<64>, used: Boolean}`. Removing merchantPk from that struct does not hide merchant lookup pseudonyms in public transcripts. Expiry is absolute Unix seconds, checked with ledger block-time predicates. Draw must copy the authenticated quote's deadline exactly into the note; neither party's adapter may reinterpret an old action count.

## Draw note

Typed `DrawNotePreimage` fields in order:

1. `domain: Bytes<32>`
2. `lineGeneration: Uint<64>`
3. `identity: Bytes<32>`
4. `quoteCommit: Bytes<32>`
5. `merchantPk: Bytes<32>`
6. `amount: Uint<64>`
7. `fee: Uint<64>`
8. `noteNonce: Bytes<32>`
9. `expiry: Uint<64>`

```text
D = persistentCommit(DrawNotePreimageType, notePreimage, noteSalt)
```

Public `NoteMeta` contains `amount`, `fee`, `redeemed`, `cancelled`, `expiry`, `lineGeneration`, `compensationAllocated`, `refundCommitment`, `cashRefundOwed`, `refundAcknowledged` and `refundPaymentNullifier`. Ownership is privately committed, but public amount and same-action correlation expose linkage. This establishes merchant ownership, not anonymity.

Current private transfer formats are `line:quote-package:v3` and `line:note-package:v3`, both requiring `deadlineUnits: "unix-seconds"` and a bounded integer expiry. Quote v3 additionally requires `feePolicy: "flat-plus-ceil-bps-v1"`, `feeFlat`, `feeBps` and exact `fee`. Validators recompute the agreed fee; console imports check the current domain/generation/policy and reconstruct Q. V1/v2 quotes or missing policy reject before import. Note v3 requires its exact original fee. Adding fee to the typed preimage changes D even for zero fees. Legacy v2 notes cannot be relabelled as v3; historic deployments need their matching source and bindings. Source-bound journals/checkpoints reject older releases; relabelling old hashes does not migrate their commitments or semantics.

`requiredDrawFee(amount, flat, bps)` uses bigint Uint64 inputs, rates at most 10000, exact ceiling and a Uint64 output bound. The TypeScript model, console and transfer packages additionally restrict numeric values to safe integers. Compact multiplies in widened integers and proves the ceiling by inequalities, without a new witness or an invented division API. Fee and total debt arithmetic are separately constrained. [Fee evidence](FEE_POLICY_2026-10-10.md).

## Private refund commitment

`RefundPreimage` field order is `domain: Bytes32`, `lineGeneration: Uint64`, `identity: Bytes32`, `noteCommit: Bytes32`, `amount: Uint64`. `refundCommit` uses runtime `persistentCommit(RefundPreimageType, preimage, salt)` with the allocation's fresh salt. The exact cash remainder is a private opening; public metadata stores only its commitment and whether it is positive. Issuer reporting consumes the same stable payment nullifier as repayment and stores it in this note's public metadata. Before reporting, that field is all-zero. This binds receipt attribution while the global set provides cross-operation deduplication.

## Nullifiers

```text
N_draw = persistentHash(Vector<4, Bytes32>, [
  pad32("line:v2:draw"), agentSecret, Q, domain
])
N_redeem = persistentHash(Vector<4, Bytes32>, [
  pad32("line:v2:redeem"), merchantSecret, D, domain
])
N_repay = persistentHash(Vector<7, Bytes32>, [
  pad32("line:v2:repay"), receiptNonce, identity, currentC,
  encodeU64(repayAmount), paymentRef, domain
])
N_payment = persistentHash(Vector<4, Bytes32>, [
  pad32("line:v3:payment"), issuerSecret, paymentRef, domain
])
```

Repayment checks and inserts both nullifiers atomically. `N_repay` binds the receipt to its particular transition. `N_payment` excludes mutable commitment, amount, nonce, identity and generation, preventing reuse of the exact payment reference within the same issuer/domain after draws, repayments or reopening. Its issuer secret must be high entropy. This does not verify actual cash or deduplicate allocations across different domains.

Application adapters derive the `paymentRef: Bytes32` witness from an exact external string using `canonicalPaymentReferenceBytes`. It uses `persistentHash(Vector<n, Bytes32>, [pad32("line:payment-ref:v1"), encodeU64(UTF8_byte_length), ...zero_padded_32_byte_chunks])`. References are case sensitive; hex-looking strings are still strings. Empty/surrounding-whitespace, malformed Unicode and more than 4096 UTF-8 bytes reject. No Unicode normalization, truncation or SHA-256 is used. Direct generated callers supply the exact resulting bytes themselves; Compact does not parse external strings.

Choose a rail-specific identity that includes network/currency and an immutable event/output identifier. A transaction hash alone may identify multiple transfers. Partial allocation needs a separate verified allocation ledger and distinct allocation identities bounded by the actual payment; changing a reference does not establish new cash.

## Exact-match verification

```bash
npm run compact:compile
npm run compact:test
```

`encoding.test.ts` compares generated-circuit results with canonical TypeScript keys/identity/domain/C/Q/D/nullifiers; generated authorization/replay tests complement these vectors. Inspect coverage/output before claiming verification under the selected stack. Meaningful vectors must track descriptor/witness/tag/arithmetic changes.

Recompile/retest the migration and regenerate release keys separately. Previous 0.34 test output/key metrics do not prove this source/version set. After reviewing intentional generated changes, repeated compilation should produce zero drift. [Protocol](PROTOCOL.md), [privacy](PRIVACY.md), [release guide](DEPLOYMENT.md).
