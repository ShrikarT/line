# WAVE2_SECURITY_REVIEW.md — Line Security & Threat Analysis

## 1. Executive Summary

Line is a private revolving credit authorization and settlement prototype engineered for autonomous agents on Midnight Compact (`0.26.0`, toolchain `0.34.0`, runtime `0.19.0`).

Wave 2 advances Line from Wave 1 authorization to a complete **Compact Settlement-Accounting Prototype**. In this model, an issuer deposits liquidity into a verifiable reserve pool, an agent proves capacity and issues cryptographically committed, merchant-bound draw notes, and registered merchants redeem those notes directly against the reserve pool without disclosing invoice prices, merchant identities, or agent credit books to the public explorer.

This security review itemizes the threat model, formal invariants, attack mitigations, test evidence, and honest operational boundaries.

---

## 2. Architecture & Domain Separation

### 2.1 Role Keys & Authentication
- **Issuer**: Authenticates `fundReserve`, `withdrawUnencumberedReserve`, `registerMerchant`, `openLine`, `acknowledgeRepayment`, and `setStatus`. Public key is derived via `persistentHash([pad(32, "line:issuer:pk"), sk])`.
- **Merchants (Merchant A & Merchant B)**: Authenticate `postQuote` and `redeemDraw`. Public keys are derived via `persistentHash([pad(32, "line:merchant:pk"), sk])`. Multiple merchants are tracked on-chain in `registeredMerchants: Map<Bytes<32>, Boolean>`.
- **Agent**: Authenticates `draw`. Identity is `I = persistentHash([pad(32, "line:id"), sk])`. Credit limits $L$ and outstanding balances $B$ are kept exclusively in the agent's private store.

### 2.2 Instance-Level Domain Separation
Cross-contract replays are eliminated by binding every commitment, nullifier, and quote to a contract-specific domain tag:
$$\text{contractDomain} = \text{persistentHash}([\text{pad}(32, \text{"line:v2:domain"}), \text{issuerPk}, \text{initialMerchantPk}, \text{instanceNonce}])$$
where `instanceNonce` is an immutable 32-byte nonce passed to the contract constructor.

---

## 3. Cryptographic Primitives & State Invariants

### 3.1 Commitment Primitives
- **Line State Commitment ($C$)**:
  $$C = \text{persistentCommit}\langle\text{LinePreimage}\rangle(\{ I, L, B, \text{epoch} \}, \text{salt})$$
- **Quote Commitment ($Q$)**:
  $$Q = \text{persistentHash}([\text{pad}(32, \text{"line:v2:quote"}), \text{merchantPk}, \text{invoiceId}, A, \text{expiry}, \text{nonce}, \text{generation}, \text{domain}])$$
- **Draw Note Commitment ($D$)**:
  $$D = \text{persistentCommit}\langle\text{DrawNotePreimage}\rangle(\{ \text{domain}, \text{lineGen}, I, Q, \text{merchantPk}, A, \text{nonce}, \text{expiry} \}, \text{noteSalt})$$

### 3.2 Nullifier Primitives
- **Draw Nullifier**: $N_{\text{draw}} = \text{persistentHash}([\text{pad}(32, \text{"line:v2:draw"}), sk_{\text{agent}}, Q, \text{domain}])$
- **Redeem Nullifier**: $N_{\text{redeem}} = \text{persistentHash}([\text{pad}(32, \text{"line:v2:redeem"}), sk_{\text{merchant}}, D, \text{domain}])$
- **Repay Nullifier**: $N_{\text{repay}} = \text{persistentHash}([\text{pad}(32, \text{"line:v2:repay"}), \text{nonce}, I, C, R, \text{paymentRef}, \text{domain}])$

---

## 4. Formal Protocol Invariants

1. **Reserve Accounting Solvency**:
   $$\text{encumberedReserve} + \text{redeemedReserve} \le \text{totalReserve}$$
   Enforced in `draw`, `withdrawUnencumberedReserve`, `redeemDraw`, and `cancelOrExpireNote`.
2. **Withdrawable Capacity Guarantee**:
   $$\text{withdrawableReserve} = \text{totalReserve} - (\text{encumberedReserve} + \text{redeemedReserve})$$
   Issuer cannot withdraw any funds that are encumbered by outstanding draw notes or claimed by redeemed notes.
3. **Solvent Note Issuance**:
   Every agent `draw` asserts that $\text{withdrawableReserve} \ge A$ in-circuit before incrementing $\text{encumberedReserve}$ by $A$.
4. **Non-Replayable Merchant Redemption**:
   A draw note $D$ can be redeemed at most once. Redemption spends $N_{\text{redeem}}$ into `nullifiers` and flips `note.redeemed = true`.
5. **Role-Separated Merchant Ownership**:
   The `NoteMeta` stored on the ledger stores only amount, status, expiry, and generation—**never** the merchant's public key. The merchant's identity is sealed within the private note preimage and proven in zero-knowledge via $sk_{\text{merchant}} \to \text{merchantPk}$. Merchant B cannot redeem a note issued to Merchant A.
6. **Anti-Rug Issuer Protection**:
   An issuer attempting to drain reserves via `withdrawUnencumberedReserve` is constrained by the remaining unencumbered balance. Active merchant notes are strictly protected.
7. **Expiry & Cancellation Safety**:
   Expired, unredeemed draw notes can be cancelled via `cancelOrExpireNote` only when $\text{actionClock} \ge \text{expiry}$. This returns $\text{encumberedReserve}$ to unencumbered reserve without moving funds to redeemed.
8. **Revolving Credit Limit Invariant**:
   $$B + A \le L$$
   Enforced in ZK in `draw`. Over-limit transactions fail with generic error: `"Clearance could not be proven."`
9. **Single-Use Repayment Receipts**:
   Repayments require an issuer receipt nonce and spend $N_{\text{repay}}$. Agents cannot forge repayments or decrease $B$ unilaterally.
10. **Cross-Instance Isolation**:
    Notes, draws, and quotes are strictly bound to `contractDomain`. A note issued on Instance 1 is completely invalid on Instance 2.

---

## 5. Threat Vectors & Test Verification Matrix

| Threat Vector | Mitigation Mechanism | Verification Test |
|---|---|---|
| **Cross-Merchant Note Theft** (Merchant B attempts to redeem Merchant A's note) | Note opening asserts $sk \to \text{merchantPk}$ matching committed preimage $D$. | `compact.test.ts`: *"Merchant B cannot redeem Merchant A's note (role separation)"* |
| **Double Redemption Attack** (Merchant attempts to redeem note twice) | Nullifier check: $N_{\text{redeem}} \notin \text{nullifiers}$ and `!meta.redeemed`. | `compact.test.ts`: *"double redemption fails (nullifier spent)"* |
| **Issuer Liquidity Rug** (Issuer attempts to withdraw funds backing active draw note) | Contract asserts $\text{withdrawable} \ge \text{amount}$. | `compact.test.ts`: *"issuer cannot withdraw funds backing an outstanding draw note"* |
| **Insolvent Draw Note** (Agent attempts to draw when reserve < invoice) | `draw` checks $\text{withdrawable} \ge A$. | `compact.test.ts`: *"draw fails when reserve is insufficient for draw note"* |
| **Premature Note Cancellation** (Issuer tries to cancel note before expiry) | `cancelOrExpireNote` asserts $\text{actionClock} \ge \text{expiry}$. | `compact.test.ts`: *"unexpired note cannot be cancelled"* |
| **Cross-Instance Replay** (Attacker applies note from one contract to another) | Preimage domain matches `contractDomain`. | `compact.test.ts`: *"draw note from instance A cannot be redeemed in instance B"* |
| **Unregistered Merchant Quote** (Unauthorized actor posts quote) | `postQuote` checks `registeredMerchants[mPk] == true`. | `compact.test.ts`: *"unregistered merchant cannot post quotes"* |
| **Duplicate Merchant Registration** (Registering existing merchant again) | `registerMerchant` checks `!registeredMerchants[mPk]`. | `compact.test.ts`: *"cannot register the same merchant twice"* |
| **Draw Replay / Stale State** (Agent replays consumed quote or stale witness) | Draw nullifier $N_{\text{draw}}$ spent; $C$ opening required. | `compact.test.ts`: *"reused quote fails draw"* |
| **Over-Limit Draw** (Agent draws beyond credit limit $L$) | In-circuit check $B + A \le L$. | `compact.test.ts`: *"over-limit draw fails and leaves state unchanged"* |
| **Agent Self-Repayment / Forgery** (Agent attempts to forge repayment) | `acknowledgeRepayment` verifies issuer authentication. | `compact.test.ts`: *"agent-initiated fake repayment fails"* |
| **Default Evasion** (Agent draws while line is defaulted) | Circuit asserts `status == Status.OPEN`. | `compact.test.ts`: *"defaulted line rejects draw"* |
| **Cross-Generation Quote Reuse** (Reopening line after close and reusing quote) | Circuit asserts `meta.lineGeneration == lineGeneration`. | `compact.test.ts`: *"quote from generation 1 cannot be drawn after closing and reopening"* |

---

## 6. Deterministic Model-Checker Verification

The state machine model checker in `src/lib/line/model.test.ts` subjects the protocol to 50 pseudo-random operations drawn from:
- `fundReserve`, `withdrawReserve`
- `registerMerchant`
- `postQuote`
- `draw`
- `redeemDraw`
- `acknowledgeRepayment`
- `setStatus`
- `cancelOrExpireNote`

After every step, the model tester verifies all 10 invariants simultaneously. The suite runs with zero failures and passes cleanly.

---

## 7. Honest Limitations & Operational Boundaries

1. **Simulation Scope**:
   - The Compact contract compiles with Compact 0.34.0 using `--skip-zk`.
   - Prover keys (`.bincode` proving keys) are not bundled in repository due to size and build time.
   - The Compact simulator test suite runs against `@midnight-ntwrk/compact-runtime` WASM.
2. **Asset Transfer vs Settlement Accounting**:
   - Wave 2 implements exact Compact on-chain settlement accounting.
   - It does not make live token payouts (Night / Dust tokens) on a live Midnight Testnet node.
3. **Timing Leakage**:
   - The public ledger displays `actionClock` increments and transitions $C \to C'$. Observers can see that an operation occurred, but cannot deduce the amount, counterparty, or balances.
