# Protocol Specification & Cryptographic Reference

## Overview

Line implements a confidential credit facility using Midnight Compact built-ins:
- `persistentCommit<T>(value: T, salt: Bytes<32>): Bytes<32>`
- `persistentHash<T>(value: T): Bytes<32>`

All encodings are validated in Compact simulator tests (`compact.test.ts`) and cross-language TypeScript encodings (`encoding.test.ts`).

---

## 1. Domain Separation

To isolate contract instances and eliminate cross-instance replay attacks:

$$\text{contractDomain} = \text{persistentHash}([\text{pad}_{32}(\text{"line:v2:domain"}), \text{issuerPk}, \text{initialMerchantPk}, \text{instanceNonce}])$$

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

$$C = \text{persistentCommit}\langle\text{LinePreimage}\rangle(\{ \text{contractDomain}, I, L, B, \text{epoch} \}, \text{salt})$$

`LinePreimage` is domain-bound, so identical identity/books/salt values in different instances produce different roots. Opening also requires an agent-secret witness in an issuer-authenticated call, so separate issuer/agent custody is not established. Field hiding does not prove complete-history confidentiality; see [PRIVACY.md](PRIVACY.md).
- $I$: Agent identity commitment ($\text{Bytes}\langle 32\rangle$).
- $L$: Revolving credit limit ($\text{Uint}\langle 64\rangle$).
- $B$: Current outstanding debt ($\text{Uint}\langle 64\rangle$).
- $\text{epoch}$: Monotonic state transition counter ($\text{Uint}\langle 64\rangle$).
- $\text{salt}$: 32-byte blinding factor refreshed on every state rotation.

---

## 4. Quote Commitment ($Q$)

Merchants post purchase quotes as opaque hashes:

$$Q = \text{persistentHash}([\text{pad}_{32}(\text{"line:v3:quote"}), \text{merchantPk}, \text{invoiceId}, \text{encodeU64}(A), \text{encodeU64}(\text{expiry}), \text{nonce}, \text{encodeU64}(\text{generation}), \text{domain}, \text{encodeU64}(\text{feeFlat}), \text{encodeU64}(\text{feeBps})])$$

- $\text{merchantPk}$: Public key of registered merchant.
- $A$: Purchase amount in credit units.
- $\text{invoiceId}$: Plaintext invoice reference (known only to merchant and agent).
- $\text{expiry}$: Absolute Unix-seconds cutoff, checked against ledger block time; the resulting note must retain this merchant-authenticated deadline.
- $\text{nonce}$: Cryptographic salt ensuring quote uniqueness.
- $\text{generation}$: Current credit line generation.
- $\text{domain}$: Contract domain.
- `feeFlat`, `feeBps`: Public issuer-approved fee terms fixed at opening for this generation. The exact fee is `feeFlat + ceil(A * feeBps / 10000)`; basis points must be between 0 and 10000. Quotes bind the policy even though the purchase amount remains a witness during posting.

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
  fee: Uint<64>;
  noteNonce: Bytes<32>;
  expiry: Uint<64>;
}
```

---

## 6. Nullifier Schemes

Double-spend and replay prevention is enforced by inserting spent nullifiers into the public ledger set `nullifiers: Set<Bytes<32>>`:

### Draw Nullifier
$$N_{\text{draw}} = \text{persistentHash}([\text{pad}_{32}(\text{"line:v2:draw"}), sk_{\text{agent}}, Q, \text{domain}])$$
Ensures each quote $Q$ can only be drawn once by the agent.

### Redemption Nullifier
$$N_{\text{redeem}} = \text{persistentHash}([\text{pad}_{32}(\text{"line:v2:redeem"}), sk_{\text{merchant}}, D, \text{domain}])$$
Proves merchant ownership of note $D$ in zero-knowledge and ensures single redemption.

### Repayment and Stable Payment Nullifiers
$$N_{\text{repay}} = \text{persistentHash}([\text{pad}_{32}(\text{"line:v2:repay"}), \text{receiptNonce}, I, C, \text{encodeU64}(A), \text{paymentRef}, \text{domain}])$$
The contract also computes `N_payment = persistentHash(Vector<4, Bytes<32>>, [pad(32, "line:v3:payment"), issuerSecret, paymentRef, domain])`. It rejects reuse and inserts both nullifiers before rotating the book. The stable hash excludes mutable `C`, amount, nonce, identity and generation; exact reference reuse is blocked even after intervening transitions or a new line in the same instance. Application references use the versioned full-string encoding in [ENCODING.md](ENCODING.md).

This establishes exact-reference replay protection within an issuer/domain, not one credit per genuine cash payment. The issuer still supplies the payment assertion; cash authenticity, alternative references, cross-facility reuse and partial allocations require independently reconciled settlement controls. The local checkout additionally checkpoints references when configured for encrypted durability.

---

## 7. The 12 Compact Circuits

| Circuit | Caller | Description |
|---|---|---|
| `registerMerchant` | Issuer | Whitelists merchant public key in `registeredMerchants` |
| `disableMerchant` | Issuer | Disables a registered merchant: blocks new quotes while preserving membership for existing quotes |
| `fundReserve` | Issuer | Allocates settlement reserve capacity backing agent draw notes |
| `withdrawUnencumberedReserve` | Issuer | Withdraws unencumbered reserve (subject to all six locked reserve budgets) |
| `withdrawFees` | Issuer | Releases earned claim-redemption fees from `feeReserve`; pending fees stay locked |
| `openLine` | Issuer | `openLine(expiry, flatFee, basisPoints)` establishes $C_0$ and immutable public pricing; credit limit $L$ is a private witness |
| `postQuote` | Registered Merchant | Commits to quote terms $Q$; invoice amount $A$ is a private witness |
| `draw` | Agent | Proves confidential credit clearance ($B + A + \text{fee} \le L$) in ZK; credit books and invoice details are witnesses |
| `redeemDraw` | Designated Merchant | Redeems note $D$ against reserve pool via nullifier $N_{\text{redeem}}$ |
| `cancelOrExpireNote` | Action-dependent | `(D, action, receiptExpiry)`: permissionless expiry (0), issuer/original-agent compensation (1), or issuer refund report (2) |
| `acknowledgeRepayment` | Issuer | Confirms off-chain payment and restores capacity; credit books and amount are witnesses |
| `setStatus` | Issuer | Sets facility status; `CLOSED` requires the authentic current private opening and zero debt |

## 8. Exact accounting and lifecycle boundaries

Let `T=totalReserve`, `E=encumberedReserve`, `R=redeemedReserve`, `F=feeReserve`, `P=pendingFeeReserve`, `U=refundReserve`, and `X=reportedRefundReserve`. `withdrawable=T-E-R-F-P-U-X`; invariant `E+R+F+P+U+X<=T`. A draw locks principal in E and fee in P, adding both to private debt. Merchant redemption moves principal E -> R and fee P -> F. Only F can be withdrawn as earned fee accounting.

`cancelOrExpireNote(D, action, receiptExpiry)` preserves the twelve-circuit interface:

- **Action 0:** anyone proves the unredeemed note expired. Principal/fee move E/P -> U as one full-cost budget. Private debt is unchanged; backing cannot disappear before allocation.
- **Action 1:** issuer or original agent proves the original fee-bound note opening. For the current generation, the authentic current book credits `min(B, principal+fee)` and rotates epoch/salt. A private `RefundPreimage={domain,lineGeneration,identity,noteCommit,amount}` commits any cash remainder. A zero remainder releases the entire budget; any positive remainder retains the entire original budget. An older-generation claim owes full original cost without changing the new borrower's book. Allocation can happen only once, including after a preceding permissionless expiry.
- **Action 2:** issuer proves the exact positive private refund opening and an unexpired report deadline, then consumes the shared stable payment-reference nullifier and binds it to this note in `refundPaymentNullifier`. The full original budget moves U -> X, while T is unchanged. X stays locked. This is an issuer report, not cash verification or permission to withdraw payout backing.

Compensation credit is fungible against the same borrower's current debt. It can cancel another outstanding purchase's debt when the original purchase was already repaid; the remainder is owed in cash. This is the implemented unredeemed-expiry policy. Redeemed-but-undelivered purchases and discretionary disputes require further terms and implementation. Public `cashRefundOwed` reveals a threshold, and a zero-cash allocation reveals full budget release; exact private cash remainders do not become partial reserve deltas. [Privacy boundary](PRIVACY.md).

Repayment decreases private debt without changing reserve counters. Funding/withdrawal adjust T; earned-fee withdrawal reduces T and F equally. Exact issuer pricing remains enforced. None of these accounting operations verifies a deposit, payout, service delivery or fee collection. Private cash refund records are encrypted with console recovery candidates; recovery requires the exact fresh note effect plus the associated book transition, and refund reports also require this note's exact bound payment nullifier and its global membership. An unrelated repayment consuming the same reference cannot establish this note's report. [Compensation evidence](COMPENSATION_2026-10-10.md).

All expiry values are absolute seconds since the Unix epoch. Opening/posting/draw/redemption/repayment require supported `blockTimeLt(deadline)` predicates; cancellation requires `blockTimeGte(noteExpiry)`. Exact equality is expired. The agent's note deadline must equal the authenticated merchant quote deadline. `actionClock` records transaction ordering only; no validity check depends on it, and administrative traffic cannot accelerate claim expiry.

The runtime's pre-submission execution uses local time; on-chain evaluation uses approximate block time. Near-deadline proving, propagation and finality may reject a transaction that passed local construction. Submit with a suitable margin and reconcile actual receipts; this is not a payout guarantee. [Official block-time semantics](https://docs.midnight.network/relnotes/compact/compact-0-17-25-0). Generated/model clocks are explicit trusted test context, never operation witnesses. Legacy action-count packages/checkpoints must not be reinterpreted as timestamps. [Expiry migration evidence](EXPIRY_2026-10-10.md).

One active line/identity exists per instance. `setStatus(CLOSED)` proves that the current opening matches `lineCommit` and its debt is zero; a forged zero opening or genuine indebted opening rejects. `DEFAULTED -> OPEN` preserves commitment, debt and generation. After zero-debt closure, `openLine` may establish a fresh generation; it does not delete debt. Outstanding merchant notes and their backing survive closure/reopening, with their original ownership/expiry rules. Successful public closure consequently discloses zero debt at that point. Underwriting, actual repayment authenticity and loss recovery remain separate requirements.

Generated-circuit/encoding tests are local evidence, not proof submission, network finality or asset settlement certification.

