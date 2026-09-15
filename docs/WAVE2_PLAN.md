# Line — Wave 2 Design Document: Private Credit Settlement Prototype

- **Repository:** https://github.com/ShrikarT/line
- **Wave 1 Tag & Commit:** `wave1-final` at commit [`ed45ca4`](https://github.com/ShrikarT/line/commit/ed45ca4)
- **Wave 1 Contract Preserved:** `contracts/v1/line.compact`
- **Wave 2 Working Branch:** `feat/wave-2-private-settlement`

---

## 1. Product Goal

In Wave 1, **Line** proved that an autonomous agent can draw against a confidential, revolving credit line without revealing its limit $L$, balance $B$, available capacity $L - B$, quote amount $A$, or counterparty on-chain. Wave 1 was **authorization only**; no settlement took place.

**Wave 2 turns authorization into private, non-replayable settlement:**
When an agent draws against its private line, the contract encumbers funds from an **issuer-funded reserve** and issues a **merchant-bound private draw note** ($D$). The intended merchant can privately prove ownership of this note and **redeem it exactly once** against the issuer's reserve. An issuer may only withdraw funds that are **unencumbered**. An agent's repayment restores credit line capacity and reconciles accounting.

Line Wave 2 demonstrates **two registered merchants** (Merchant A and Merchant B), proving that Line is a multi-merchant protocol rather than a single hard-coded pairing.

---

## 2. Roles & Actors

1. **Issuer:**
   - Deploys contract instance with a unique `instanceNonce`.
   - Registers authorized merchants (`registerMerchant`).
   - Funds the settlement reserve (`fundReserve`).
   - Opens the agent's revolving line with private limit $L$ (`openLine`).
   - Acknowledges agent repayments (`acknowledgeRepayment`).
   - Sets line status (`setStatus`: `OPEN`, `DEFAULTED`, `CLOSED`).
   - Withdraws unencumbered reserve (`withdrawUnencumberedReserve`).
2. **Merchant (A & B):**
   - Holds private signing key $sk_M$ and role public key $pk_M = \text{persistentHash}([\text{pad}(32, \text{"line:merchant:pk"}), sk_M])$.
   - Posts opaque quote commitments $Q$ for agent invoices (`postQuote`).
   - Receives private draw-note openings via private off-chain response.
   - Proves note ownership and redeems note against issuer reserve (`redeemDraw`).
3. **Agent:**
   - Holds private secret $sk_A$ and identity commitment $I = \text{persistentHash}([\text{pad}(32, \text{"line:id"}), sk_A])$.
   - Proves knowledge of private line preimage $(I, L, B, \text{epoch}, \text{salt})$ opening public $C$.
   - Proves invoice fits capacity: $B + A \le L$.
   - Calls `draw`, spending draw nullifier $N_{\text{draw}}$, rotating $C \to C'$, encumbering reserve, and creating public draw-note commitment $D$.
   - Performs off-chain repayment to issuer.
4. **Public Explorer / Observers:**
   - Views commitments ($C$, $Q$, $D$), nullifiers, line generation, status, contract domain, action clock, and reserve totals.
   - **Never learns:** $L$, $B$, $A$, invoice IDs, agent secret, merchant identities, note openings, or repayment details.

---

## 3. Wave 2 Asset & Settlement Model Decision

### Honest Assessment & Selected Path
- **Investigated Environment:** Compact toolchain `0.34.0`, Compact language `0.26.0`, `@midnight-ntwrk/compact-runtime` `0.19.0`.
- **Selected Path:** **Exact Compact Settlement-Accounting Prototype**.
- **Honest Claims:**
  - This is an **on-chain Compact settlement accounting state machine**, not a live token/USDC payout.
  - Native Midnight shielded coin / zswap contracts require full Midnight node networks, preprod wallets, and proving key infrastructure that are not accessible locally without testnet faucet credentials.
  - Therefore, we implement mathematically strict, verifiable reserve accounting in Compact: tracking total reserve, encumbered claims, redeemed claims, and withdrawable reserve.
  - When true Midnight token transfer or Preprod settlement is introduced in Wave 3, the circuit interfaces (`fundReserve`, `redeemDraw`, `withdrawUnencumberedReserve`) directly map to coin minting/burning/transfer.
  - We do **not** claim token movement, Cardano bridge settlement, or mainnet readiness.

---

## 4. Contract-Instance Domain Separation

Every contract instance must possess a globally distinct domain, preventing any cross-instance replay of quotes, draw notes, or nullifiers.

### Constructor Specification
```compact
constructor(
  issuerPk: Bytes<32>,
  initialMerchantPk: Bytes<32>,
  instanceNonce: Bytes<32>
)
```

### Domain Derivation
```
contractDomain = persistentHash([
  pad(32, "line:v2:domain"),
  issuerPk,
  initialMerchantPk,
  instanceNonce
])
```
Even if the same issuer and merchant deploy multiple instances, `instanceNonce` guarantees that:
$Domain_A \ne Domain_B \implies Q_A \ne Q_B, D_A \ne D_B, N_{\text{draw},A} \ne N_{\text{draw},B}, N_{\text{redeem},A} \ne N_{\text{redeem},B}$.

---

## 5. Reserve Accounting & Invariants

The contract maintains three reserve counters on the ledger:
1. `totalReserve: Uint<64>`: Cumulative funds deposited by issuer.
2. `encumberedReserve: Uint<64>`: Reserve committed to outstanding (unredeemed) draw notes.
3. `redeemedReserve: Uint<64>`: Cumulative reserve redeemed by merchants.

### Core Invariants
1. **Solvency Invariant:**
   $$\text{encumberedReserve} + \text{redeemedReserve} \le \text{totalReserve}$$
2. **Withdrawable Capacity:**
   $$\text{withdrawableReserve} = \text{totalReserve} - (\text{encumberedReserve} + \text{redeemedReserve})$$
3. **Draw Reserve Check:**
   Before a draw note of amount $A$ can be issued:
   $$A \le \text{withdrawableReserve}$$
   On successful draw:
   $$\text{encumberedReserve}' = \text{encumberedReserve} + A$$
4. **Redemption Accounting:**
   On redemption of a note for amount $A$:
   $$\text{encumberedReserve}' = \text{encumberedReserve} - A$$
   $$\text{redeemedReserve}' = \text{redeemedReserve} + A$$
5. **Withdrawal Check:**
   Issuer withdrawing amount $W$:
   $$W \le \text{totalReserve} - (\text{encumberedReserve} + \text{redeemedReserve})$$
   $$\text{totalReserve}' = \text{totalReserve} - W$$
   **Issuer cannot withdraw encumbered funds.**

---

## 6. Draw-Note & Redemption Architecture

### Draw-Note Preimage (`DrawNotePreimage`)
```compact
struct DrawNotePreimage {
  domain: Bytes<32>,
  lineGeneration: Uint<64>,
  identity: Bytes<32>,
  quoteCommit: Bytes<32>,
  merchantPk: Bytes<32>,
  amount: Uint<64>,
  noteNonce: Bytes<32>,
  expiry: Uint<64>,
}
```

### Public Draw-Note Commitment ($D$)
```compact
D = persistentCommit<DrawNotePreimage>(notePreimage, noteSalt)
```
- Stored on ledger in `notes: Map<Bytes<32>, NoteMeta>`:
  ```compact
  struct NoteMeta {
    amount: Uint<64>,
    merchantPk: Bytes<32>,
    redeemed: Boolean,
    cancelled: Boolean,
    expiry: Uint<64>,
    lineGeneration: Uint<64>,
  }
  ```

### Merchant Redemption Nullifier ($N_{\text{redeem}}$)
```compact
N_redeem = persistentHash<Vector<4, Bytes<32>>>([
  pad(32, "line:v2:redeem"),
  merchantSecret,
  D,
  contractDomain
])
```
- Bound to merchant's private signing secret, the public note commitment $D$, and the contract domain.
- When $N_{\text{redeem}}$ is recorded in `nullifiers: Set<Bytes<32>>`, the note can never be redeemed again.

---

## 7. Multi-Merchant Support

- Ledger stores `registeredMerchants: Map<Bytes<32>, Boolean>`.
- Constructor registers `initialMerchantPk` as active (`true`).
- Issuer can register additional merchants via `registerMerchant(merchantPk: Bytes<32>)`.
- `postQuote` asserts `registeredMerchants.member(merchantPk) && registeredMerchants.lookup(merchantPk) == true`.
- Quotes bind the posting merchant's `merchantPk`.
- `draw` transfers that binding into the `DrawNotePreimage`.
- `redeemDraw` proves that the caller's private secret derives the exact `merchantPk` bound in the note.
- **Merchant A cannot redeem Merchant B's note.**

---

## 8. Circuits Specification (10 Circuits)

| # | Circuit | Caller | Public Inputs | Private Witnesses | Preconditions | State Changes |
|---|---|---|---|---|---|---|
| 1 | `registerMerchant` | Issuer | `merchantPk` | `callerSecret` | Issuer auth, merchant not already registered | `registeredMerchants[merchantPk] = true` |
| 2 | `fundReserve` | Issuer | `amount` | `callerSecret` | Issuer auth, `amount > 0`, no overflow | `totalReserve += amount` |
| 3 | `openLine` | Issuer | `limit`, `expiry` | `callerSecret`, `agentSecret`, `salt` | Issuer auth, status NONE or CLOSED, `limit > 0` | `lineCommit = C0`, `lineGeneration++`, `status = OPEN` |
| 4 | `postQuote` | Merchant | `quoteCommit`, `expiry` | `callerSecret`, `inv`, `amount`, `nonce` | Merchant registered & authenticated, `status == OPEN`, `amount > 0` | `quotes[Q] = QuoteMeta` |
| 5 | `draw` | Agent | `quoteCommit`, `noteCommit`, `newCommit`, `drawNullifier` | `agentSecret`, preimages, salts | Line OPEN, $B+A \le L$, reserve available, quote unspent & matches gen | Rotate $C \to C'$, spend $N_{\text{draw}}$, create $D$, `encumberedReserve += A` |
| 6 | `redeemDraw` | Merchant | `noteCommit`, `redeemNullifier` | `merchantSecret`, note preimage, note salt | Note exists, unredeemed, uncancelled, not expired, merchant auth | Spend $N_{\text{redeem}}$, note marked redeemed, `encumberedReserve -= A`, `redeemedReserve += A` |
| 7 | `acknowledgeRepayment` | Issuer | `repayCommit`, `repayNullifier` | `callerSecret`, receipt, preimages | Issuer auth, $0 < R \le B$, line not NONE | Rotate $C \to C'$, spend $N_{\text{repay}}$ |
| 8 | `cancelOrExpireNote` | Issuer / Merchant | `noteCommit` | `callerSecret` | Note exists, unredeemed; either expired or cancelled by both parties | Note marked cancelled, `encumberedReserve -= A` |
| 9 | `setStatus` | Issuer | `newStatus` | `callerSecret` | Issuer auth, valid transitions | `status = newStatus` |
| 10 | `withdrawUnencumberedReserve` | Issuer | `amount` | `callerSecret` | Issuer auth, $W \le \text{total} - (\text{encumbered} + \text{redeemed})$ | `totalReserve -= amount` |

---

## 9. Domain Tags

| Tag | Purpose |
|---|---|
| `line:issuer:pk` | Issuer public key derivation |
| `line:merchant:pk` | Merchant public key derivation |
| `line:id` | Agent identity derivation |
| `line:v2:domain` | Instance domain derivation (includes `instanceNonce`) |
| `line:v2:quote` | Quote commitment (Vector of 8 elements) |
| `line:v2:draw` | Draw nullifier |
| `line:v2:redeem` | Note redemption nullifier |
| `line:v2:repay` | Repayment nullifier |

---

## 10. Privacy Map

### Strictly Confidential
- Line limit $L$, outstanding balance $B$, available capacity $L - B$.
- Quote amount $A$, invoice ID, quote nonce.
- Agent secret $sk_A$, salts, note salt.
- Repayment receipt details, repayment amount $R$, payment reference.
- Merchant graph: which merchant was paid for which invoice is hidden from public observers (draw note $D$ is opaque).

### Disclosed On-Chain
- Identity commitment $I$, line commitment $C$, status, line generation.
- Quote commitments $Q$, draw-note commitments $D$.
- Nullifiers ($N_{\text{draw}}, N_{\text{redeem}}, N_{\text{repay}}$).
- Reserve totals: `totalReserve`, `encumberedReserve`, `redeemedReserve` (disclosed for verifiable solvency).
- `actionClock` state-transition counter.
- Registered merchant public keys.

---

## 11. Explicit Non-Goals (Wave 2)
- No unshielded/external token bridge to Cardano or Ethereum.
- No automated liquidation or slashing.
- No decentralized dispute arbitration court.
- No mainnet or preprod deployment without real funded wallets.
