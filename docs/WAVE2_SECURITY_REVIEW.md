# WAVE2_SECURITY_REVIEW.md — Line Security & Threat Analysis

> **Archive notice (10 October 2026):** Historical security-review snapshot. Some privacy, attribution, reserve-backing and toolchain statements below are stale or disproven by the current transcript/history audit. In particular, merchant-to-quote unlinkability is not established: `draw` discloses the selected merchant pseudonym; public note amounts and reserve deltas remain visible; `identityCommit` is cross-instance linkable when an agent reuses its secret; reserve counters do not represent deposited assets. The current line commitment is domain-bound. Do not repeat archived statements that observers never learn amounts or merchant identities. Use [PRIVACY.md](PRIVACY.md), [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md), and [FULL_AUDIT_2026-10-07.md](FULL_AUDIT_2026-10-07.md) for current boundaries.

## 1. Executive Summary

Line is a private spending-guardrail and settlement prototype engineered for autonomous agent fleets on Midnight Compact (`0.26.0`, toolchain `0.34.0`, runtime `0.19.0`).

Wave 2 advances Line from Wave 1 authorization to a complete **Compact Settlement-Accounting Prototype**. In this model, an issuer deposits liquidity into a verifiable reserve pool, an agent proves capacity in ZK and issues cryptographically committed, merchant-bound draw notes, and registered merchants redeem those notes directly against the reserve pool. Credit limit $L$, outstanding balance $B$, epoch, and per-quote invoice amounts are **hidden in ZK witnesses** — never in public inputs or ledger state. The ledger discloses by design: reserve totals and their deltas, settled note amounts (anonymous flows, unattributable), commitments, nullifiers, the registered-merchant allowlist, `actionClock`, and fee amounts. Amounts are visible as anonymous flows; attribution is what the ZK hides.

This security review itemizes the threat model, formal invariants, attack mitigations, test evidence, and honest operational boundaries.

---

## 2. Architecture & Domain Separation

### 2.1 Role Keys & Authentication
- **Issuer**: Authenticates `fundReserve`, `withdrawUnencumberedReserve`, `withdrawFees`, `registerMerchant`, `disableMerchant`, `openLine`, `acknowledgeRepayment`, and `setStatus`. Public key is derived via `persistentHash([pad(32, "line:issuer:pk"), sk])`.
- **Merchants (Merchant A & Merchant B)**: Authenticate `postQuote` and `redeemDraw`. Public keys are derived via `persistentHash([pad(32, "line:merchant:pk"), sk])`. Multiple merchants are tracked on-chain in `registeredMerchants: Map<Bytes<32>, Boolean>`. The allowlist SET is public; which member quoted a given quote is hidden in ZK.
- **Agent**: Authenticates `draw`. Identity is `I = persistentHash([pad(32, "line:id"), sk])`. Credit limit $L$, outstanding $B$, and epoch are **private witnesses** in `openLine`, `draw`, and `acknowledgeRepayment` — never public circuit parameters; the stale check binds each caller's copy to the committed line state. What stays in the agent's private store: the secret identity preimage (`sk`), salts, and nonces.

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
   $$\text{encumberedReserve} + \text{redeemedReserve} + \text{feeReserve} \le \text{totalReserve}$$
   Enforced in `draw`, `withdrawUnencumberedReserve`, `withdrawFees`, `redeemDraw`, and `cancelOrExpireNote`.
2. **Withdrawable Capacity Guarantee**:
   $$\text{withdrawableReserve} = \text{totalReserve} - (\text{encumberedReserve} + \text{redeemedReserve} + \text{feeReserve})$$
   Issuer cannot withdraw any funds that are encumbered by outstanding draw notes, claimed by redeemed notes, or accrued as fees.
3. **Solvent Note Issuance**:
   Every agent `draw` asserts in-circuit that $\text{withdrawableReserve} \ge A + F$ (note amount plus issuer fee) before incrementing $\text{encumberedReserve}$ by $A$ and $\text{feeReserve}$ by $F$.
4. **Non-Replayable Merchant Redemption**:
   A draw note $D$ can be redeemed at most once. Redemption spends $N_{\text{redeem}}$ into `nullifiers` and flips `note.redeemed = true`.
5. **Merchant↔Quote↔Note Unlinkability (TRUE)**:
   `QuoteMeta` stores **no** `merchantPk` — the quotes map holds opaque commitments only. In `draw`, the agent supplies the quote's merchant as a private witness and proves in ZK that (1) the witness preimage recomputes to the public $Q$ and (2) the witness `merchantPk` is on the public `registeredMerchants` allowlist. No observer can link a quote or note to a merchant, or a note to an agent's budget. Merchant B cannot redeem a note issued to Merchant A: redemption proves in-circuit that the caller's secret derives the `merchantPk` bound inside the private note preimage.
6. **Anti-Rug Issuer Protection**:
   An issuer attempting to drain reserves via `withdrawUnencumberedReserve` is constrained by the remaining unencumbered balance. Active merchant notes are strictly protected.
7. **Expiry & Cancellation Safety**:
   Expired, unredeemed draw notes can be cancelled via `cancelOrExpireNote` only when $\text{actionClock} \ge \text{expiry}$. This returns $\text{encumberedReserve}$ to unencumbered reserve without moving funds to redeemed.
8. **Revolving Credit Limit Invariant**:
   $$B + A + F \le L$$
   Enforced in ZK in `draw` with $L$, $B$, and epoch as private witnesses. Over-limit transactions fail with generic error: `"Clearance could not be proven."`
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
3. **Timing & Amount Visibility (honest boundary)**:
   - The public ledger displays `actionClock` increments and transitions $C \to C'$. Observers can see that an operation occurred.
   - Observers **can** see settled amounts: `NoteMeta.amount` is public ledger state, and `encumberedReserve`/`redeemedReserve`/`feeReserve` deltas are visible per draw/redeem — a single anonymous draw's size is visible as a counter delta. What observers **cannot** see: credit limit $L$, outstanding $B$, epoch, per-quote invoice amounts, or any attribution — which budget drew, which merchant a quote or note belongs to, or how much capacity remains. Amounts are visible as anonymous flows; attribution is what the ZK hides.
   - What observers cannot deduce: secrets, salts, nonces, the agent identity preimage, quote contents (invoice IDs, nonces), and the reasoning behind any draw or failure.
4. **Advisory expiry — issuer trusted not to grind `actionClock` (H4)**:
   - `actionClock` is a **transaction counter, not a clock**: every circuit increments it by 1, and anyone can spam cheap transactions (`fundReserve(1)`, `postQuote`, …) to advance it.
   - `cancelOrExpireNote` is permissionless and requires only `meta.expiry <= actionClock`. An issuer (or any grinder) can therefore push the counter past a note's `expiry`, cancel the note, release the encumbered reserve, and withdraw it — unilaterally destroying a merchant's redemption right.
   - Expiry is therefore **advisory** in Wave 2: the issuer is trusted not to grind. Production hardening (block-height binding or merchant-countersigned grace window) is Wave 3 scope.
