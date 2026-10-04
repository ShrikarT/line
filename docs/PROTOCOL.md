# Protocol Specification & Cryptographic Reference

## Overview

Line implements a confidential credit facility using Midnight Compact built-ins:
- `persistentCommit<T>(value: T, salt: Bytes<32>): Bytes<32>`
- `persistentHash<T>(value: T): Bytes<32>`

All encodings are validated in Compact simulator tests (`compact.test.ts`) and cross-language TypeScript encodings (`encoding.test.ts`).

---

## 1. Domain Separation

To isolate contract instances and eliminate cross-instance replay attacks:

$$\text{contractDomain} = \text{persistentHash}([\text{pad}_{32}(\text{"line:domain"}), \text{issuerPk}, \text{initialMerchantPk}, \text{instanceNonce}])$$

where:
- $\text{issuerPk} = \text{persistentHash}([\text{pad}_{32}(\text{"line:issuer:pk"}), sk_{\text{issuer}}])$
- $\text{initialMerchantPk} = \text{persistentHash}([\text{pad}_{32}(\text{"line:merchant:pk"}), sk_{\text{merchant}}])$
- $\text{instanceNonce}$ is an immutable 32-byte value provided to the contract constructor.

---

## 2. Agent Identity Commitment

The agent's identity commitment $I$ binds the credit line to the agent without publishing the secret key:

$$I = \text{persistentHash}([\text{pad}_{32}(\text{"line:id"}), sk_{\text{agent}}])$$

---

## 3. Line State Commitment ($C$)

The public ledger stores commitment $C$, sealing the agent's limit $L$ and outstanding debt $B$:

$$C = \text{persistentCommit}\langle\text{LinePreimage}\rangle(\{ \text{domain}, I, L, B, \text{epoch} \}, \text{salt})$$

- $\text{domain}$: Contract domain ($\text{Bytes}\langle 32\rangle$).
- $I$: Agent identity commitment ($\text{Bytes}\langle 32\rangle$).
- $L$: Revolving credit limit ($\text{Uint}\langle 64\rangle$).
- $B$: Current outstanding debt ($\text{Uint}\langle 64\rangle$).
- $\text{epoch}$: Monotonic state transition counter ($\text{Uint}\langle 64\rangle$).
- $\text{salt}$: 32-byte blinding factor refreshed on every state rotation.

---

## 4. Quote Commitment ($Q$)

Merchants post purchase quotes as opaque hashes:

$$Q = \text{persistentHash}([\text{pad}_{32}(\text{"line:quote"}), \text{merchantPk}, A, \text{invoiceId}, \text{expiry}, \text{nonce}, \text{generation}, \text{domain}])$$

- $\text{merchantPk}$: Public key of registered merchant.
- $A$: Purchase amount in credit units.
- $\text{invoiceId}$: Plaintext invoice reference (known only to merchant and agent).
- $\text{expiry}$: Logical action clock cutoff.
- $\text{nonce}$: Cryptographic salt ensuring quote uniqueness.
- $\text{generation}$: Current credit line generation.
- $\text{domain}$: Contract domain.

---

## 5. Draw Note Commitment ($D$)

A successful draw produces a merchant-bound claim note:

$$D = \text{persistentCommit}\langle\text{DrawNotePreimage}\rangle(\text{preimage}, \text{noteSalt})$$

Preimage fields:
```compact
struct DrawNotePreimage {
  domain: Bytes<32>;
  lineGeneration: Uint<64>;
  identity: Bytes<32>;
  quoteCommit: Bytes<32>;
  merchantPk: Bytes<32>;
  amount: Uint<64>;
  noteNonce: Bytes<32>;
  expiry: Uint<64>;
}
```

---

## 6. Nullifier Schemes

Double-spend and replay prevention is enforced by inserting spent nullifiers into the public ledger set `nullifiers: Set<Bytes<32>>`:

### Draw Nullifier
$$N_{\text{draw}} = \text{persistentHash}([\text{pad}_{32}(\text{"line:draw"}), sk_{\text{agent}}, Q, \text{domain}])$$
Ensures each quote $Q$ can only be drawn once by the agent.

### Redemption Nullifier
$$N_{\text{redeem}} = \text{persistentHash}([\text{pad}_{32}(\text{"line:redeem"}), sk_{\text{merchant}}, D, \text{domain}])$$
Proves merchant ownership of note $D$ in zero-knowledge and ensures single redemption.

### Repayment Nullifier
$$N_{\text{repay}} = \text{persistentHash}([\text{pad}_{32}(\text{"line:repay"}), \text{receiptNonce}, I, C, A, \text{paymentRef}, \text{domain}])$$
Ensures that an off-chain wire payment or settlement receipt cannot be credited multiple times.
