# Encoding Specification (Wave 2)

Compact compiler **0.34.0**, language **0.26.0**, runtime **0.19.0**.

TypeScript does not hash with SHA-256. It calls the exact same `persistentHash` / `persistentCommit` the compiler emits using CompactType descriptors.

Hex encode/decode in `encoding.ts` is local (no Node `Buffer`). compact-runtime's `toHex`/`fromHex` use `Buffer` and are not called from the browser.

---

## 1. Helper Primitives

### pad(32, s)
UTF-8 bytes of `s`, then zero-pad to 32 bytes. Matches Compact's `pad(32, "line:…")`.

### encodeU64
Compact: `n as Bytes<32>`.
Runtime: `convertBigintToBytes(32, n, "line.encodeU64")` — little-endian, 32-byte buffer.

---

## 2. Commitments & Preimages

### LinePreimage & Line Commitment ($C$)
Field order: `identity: Bytes<32>`, `limit: Uint<64>`, `outstanding: Uint<64>`, `epoch: Uint<64>`.
$$C = \text{persistentCommit}\langle\text{LinePreimage}\rangle(\text{preimage}, \text{salt})$$
where `salt: Bytes<32>`.

### Quote Commitment ($Q$)
$$\begin{aligned}
Q = \text{persistentHash}([&\text{pad}(32, \text{"line:v2:quote"}), \text{merchantPk}, \text{invoiceId}, \\
&\text{encodeU64}(A), \text{encodeU64}(\text{expiry}), \text{nonce}, \text{encodeU64}(\text{generation}), \text{contractDomain}])
\end{aligned}$$
Vector of 8 `Bytes<32>` elements. Binds invoice ID, amount, expiry action clock, nonce, generation, and contract domain.
`QuoteMeta` on-chain struct: `{ merchantPk: Bytes<32>, expiry: Uint<64>, lineGeneration: Uint<64>, used: Boolean }`.

### Draw Note Preimage & Commitment ($D$)
Field order in `DrawNotePreimage`:
1. `domain: Bytes<32>`
2. `lineGeneration: Uint<64>`
3. `identity: Bytes<32>`
4. `quoteCommit: Bytes<32>`
5. `merchantPk: Bytes<32>`
6. `amount: Uint<64>`
7. `noteNonce: Bytes<32>`
8. `expiry: Uint<64>`

$$D = \text{persistentCommit}\langle\text{DrawNotePreimage}\rangle(\text{notePreimage}, \text{noteSalt})$$
`NoteMeta` on-chain struct: `{ amount: Uint<64>, redeemed: Boolean, cancelled: Boolean, expiry: Uint<64>, lineGeneration: Uint<64> }`.
Note: Merchant identity is hidden from `NoteMeta` and protected inside $D$.

---

## 3. Nullifiers

### Draw Nullifier
$$N_{\text{draw}} = \text{persistentHash}([\text{pad}(32, \text{"line:v2:draw"}), \text{agentSecret}, Q, \text{contractDomain}])$$

### Redemption Nullifier
$$N_{\text{redeem}} = \text{persistentHash}([\text{pad}(32, \text{"line:v2:redeem"}), \text{merchantSecret}, D, \text{contractDomain}])$$

### Repayment Nullifier
$$N_{\text{repay}} = \text{persistentHash}([\text{pad}(32, \text{"line:v2:repay"}), \text{nonce}, I, C, \text{encodeU64}(R), \text{paymentRef}, \text{contractDomain}])$$

---

## 4. Contract Domain

$$\text{contractDomain} = \text{persistentHash}([\text{pad}(32, \text{"line:v2:domain"}), \text{issuerPk}, \text{initialMerchantPk}, \text{instanceNonce}])$$

---

## 5. Domain Tags

| Tag | Target Primitive | Purpose |
|---|---|---|
| `line:issuer:pk` | `issuerPublicKey(sk)` | Issuer identity derivation |
| `line:merchant:pk` | `merchantPublicKey(sk)` | Merchant identity derivation |
| `line:id` | `agentId(sk)` | Agent identity derivation |
| `line:v2:domain` | `contractDomain` | Instance isolation with `instanceNonce` |
| `line:v2:quote` | `quoteCommit` | 8-element quote commitment |
| `line:v2:draw` | `drawNullifier` | 4-element draw nullifier |
| `line:v2:redeem` | `redeemNullifier` | 4-element redemption nullifier |
| `line:v2:repay` | `repayNullifier` | 7-element repayment nullifier |

---

## 6. Cross-Language Test Vectors

`src/lib/line/encoding.test.ts` boots the generated Compact contract in `@midnight-ntwrk/compact-runtime`, executes the circuits, and asserts that:
- `issuerPublicKey`, `merchantPublicKey`, `agentId`
- `contractDomain`
- `lineStateCommit` ($C$)
- `quoteCommit` ($Q$)
- `drawNoteCommit` ($D$)
- `drawNullifier` ($N_{\text{draw}}$)
- `redeemNullifier` ($N_{\text{redeem}}$)
- `repayNullifier` ($N_{\text{repay}}$)

match byte-for-byte between Compact's compiled circuits and the TypeScript reference replica.
