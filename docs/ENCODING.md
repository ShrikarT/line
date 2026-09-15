# Encoding spec

Compact compiler **0.34.0**, language **0.26.0**, runtime **0.19.0**.

TypeScript does not hash with SHA-256. It calls the same `persistentHash` / `persistentCommit` the compiler emits.

Hex encode/decode in `encoding.ts` is local (no Node `Buffer`). compact-runtime's `toHex`/`fromHex` use `Buffer` and are not called from the browser.

## pad(32, s)

UTF-8 bytes of `s`, then zero-pad to 32 bytes. Matches Compact `pad(32, "line:…")`.

## encodeU64

Compact: `n as Bytes<32>`. Runtime: `convertBigintToBytes(32, n)` — little-endian, 32-byte buffer.

## LinePreimage

Field order: `identity: Bytes<32>`, `limit: Uint<64>`, `outstanding: Uint<64>`, `epoch: Uint<64>`.

`C = persistentCommit<LinePreimage>(preimage, salt)` with `salt: Bytes<32>`.

## Quote commitment

`Q = persistentHash([pad(32, "line:quote"), merchantPk, invoiceId, encodeU64(A), encodeU64(expiry), nonce, encodeU64(generation), contractDomain])`

A Vector of 8 `Bytes<32>` elements. Binds invoice ID, amount, expiry action clock, nonce, generation, and contract domain.

`QuoteMeta` on-chain struct: `{ used: Boolean, expiry: Uint<64>, lineGeneration: Uint<64> }`.

## Domain tags

| Tag | Use |
|---|---|
| `line:issuer:pk` | `issuerPublicKey(sk)` — issuer identity |
| `line:merchant:pk` | `merchantPublicKey(sk)` — merchant identity |
| `line:id` | `agentId(sk)` — agent identity |
| `line:domain` | constructor domain from issuer pk + merchant pk |
| `line:quote` | quote commitment prefix (vector of 8 elements) |
| `line:draw` | draw nullifier |
| `line:repay` | repay nullifier |

## Cross-language tests

`src/lib/line/encoding.test.ts` boots the generated Contract, runs constructor / openLine / postQuote / draw / acknowledgeRepayment, and asserts byte-for-byte equality with `src/lib/line/encoding.ts`.
