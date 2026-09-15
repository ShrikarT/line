# Product Walkthrough: Multi-Role End-to-End Lifecycle

## Overview

Line implements an end-to-end, multi-role credit and settlement lifecycle for autonomous agents across five interfaces:
1. **Issuer Console:** Underwrites credit lines, allocates reserve capacity, authorizes merchants, confirms repayments, and manages lifecycle controls.
2. **Merchant A Console:** Creates quotes, receives private claim notes, and executes one-time redemptions.
3. **Merchant B Console:** Demonstrates multi-merchant support, independent quoting, and cross-merchant claim isolation.
4. **Agent Console:** Maintains confidential credit books ($L, B$), evaluates invoices, generates client-side capacity proofs, and submits draws.
5. **Public Explorer:** Displays only public state commitments, reserve totals, anonymous claim notes, logical action clock, and nullifiers. Credit books are never observable.

---

## The 19-Step Lifecycle & Attack Resilience

### Step 0: Genesis
- **Public View:** Empty ledger state; status `NONE`.
- **Private View:** Role keypairs generated for Issuer, Merchant A, Merchant B, and Agent.

### Step 1: Register Merchant B
- **Action:** Issuer calls `registerMerchant(merchantBPk)`.
- **Public View:** Merchant B's public key added to `registeredMerchants`.
- **Guarantee:** Establishes multi-merchant network; unauthorized merchants cannot post quotes.

### Step 2: Establish Settlement Reserve (500)
- **Action:** Issuer calls `fundReserve(500)`.
- **Public View:** `totalReserve` increases to 500. `encumberedReserve = 0`, `redeemedReserve = 0`, `withdrawableReserve = 500`.
- **Accounting:** Backs agent draw notes with declared reserve capacity.

### Step 3: Open Line 150 Privately
- **Action:** Issuer calls `openLine(150, expiry)`.
- **Public View:** Status transitions to `OPEN`. Commitment $C_0$ and agent identity $I$ published. Credit limit $L=150$ is not a public field.
- **Private View:** Agent witness store: $L=150, B=0, \text{available}=150$.

### Step 4: Merchant A Posts Quote 40
- **Action:** Merchant A calls `postQuote(40, "inv-A-40")`.
- **Public View:** Opaque quote hash $Q_{40}$ posted. Price and invoice terms hidden inside commitment.

### Step 5: Agent Draws 40 -> Emits Claim Note D1
- **Action:** Agent evaluates quote, verifies $0 + 40 \le 150$, and calls `draw(Q40)`.
- **Public View:** $C_0 \to C_1$. Nullifier $N_{\text{draw}}$ spent. Claim note commitment $D_1$ created. `encumberedReserve` increases to 40 (`withdrawable = 460`).
- **Private View:** Agent debt $B=40$, remaining capacity $=110$. Private note opening delivered to Merchant A.

### Step 6: Attack — Merchant B Attempts to Steal D1
- **Action:** Merchant B calls `redeemDraw(D1)` with Merchant B's private key.
- **Result:** **FAILED.** Compact circuit verifies that note preimage binds Merchant A's public key.
- **Public View:** State unchanged; zero fund movement.

### Step 7: Merchant A Redeems D1 (40)
- **Action:** Merchant A calls `redeemDraw(D1)` with Merchant A's private key.
- **Public View:** Nullifier $N_{\text{redeem}}$ spent. `encumberedReserve` decreases to 0; `redeemedReserve` increases to 40.
- **Guarantee:** One-time merchant claim settlement verified in ZK.

### Step 8: Attack — Merchant A Double Redemption Attempt
- **Action:** Merchant A attempts to call `redeemDraw(D1)` a second time.
- **Result:** **FAILED.** Nullifier $N_{\text{redeem}}$ already member of `nullifiers` set; `notes[D1].redeemed == true`.

### Step 9: Merchant B Posts Quote 120
- **Action:** Merchant B calls `postQuote(120, "inv-B-120")`.
- **Public View:** Opaque quote commitment $Q_{120}$ posted.

### Step 10: Attack — Over-Limit Draw Attempt
- **Action:** Agent attempts to draw 120 against remaining capacity 110 ($40 + 120 = 160 > 150$).
- **Result:** **FAILED.** Generic error: `"Clearance could not be proven."`
- **Privacy Boundary:** Neither merchant nor explorer learns whether rejection was due to limit, balance, or expiry.

### Step 11: Repayment of 40 Restores Capacity
- **Action:** Agent executes off-chain payment of 40 to Issuer. Issuer calls `acknowledgeRepayment(40)`.
- **Public View:** Nullifier $N_{\text{repay}}$ spent. Line commitment rotates $C_1 \to C_2$.
- **Private View:** Agent witness updated: $B = 40 - 40 = 0$, restoring available capacity to 150.

### Step 12: Merchant B Re-quotes 120
- **Action:** Merchant B posts fresh quote $Q_{120}'$ with fresh nonce.

### Step 13: Agent Draws 120 -> Emits Claim Note D2
- **Action:** Agent verifies $0 + 120 \le 150$, calls `draw(Q120')`.
- **Public View:** Commitment rotates $C_2 \to C_3$. `encumberedReserve` increases to 120 (`withdrawable = 340`). Note $D_2$ created.

### Step 14: Attack — Issuer Attempts Reserve Rug-Pull
- **Action:** Issuer calls `withdrawUnencumberedReserve(400)`.
- **Result:** **FAILED.** Invariant check: $\text{withdrawableReserve} = 500 - (120 + 40) = 340 < 400$.
- **Guarantee:** Active draw notes are irrevocably backed by committed reserve.

### Step 15: Merchant B Redeems D2 (120)
- **Action:** Merchant B calls `redeemDraw(D2)`.
- **Public View:** `encumberedReserve` decreases to 0; `redeemedReserve` increases to 160. Note marked redeemed.

### Step 16: Issuer Defaults Credit Facility
- **Action:** Issuer calls `setStatus(Status.DEFAULTED)`.
- **Public View:** Status field updates to `DEFAULTED`.

### Step 17: Attack — Post-Default Draw Attempt
- **Action:** Agent attempts draw while line is defaulted.
- **Result:** **FAILED.** `draw` circuit asserts `status == Status.OPEN`.

### Step 18: Reopen Facility (Generation 2)
- **Action:** Issuer closes defaulted facility and opens fresh facility with `openLine(200)`.
- **Public View:** `lineGeneration` increments to 2. Status returns to `OPEN`.
- **Guarantee:** Old quotes or notes from Generation 1 cannot be replayed.

### Step 19: Full Settlement Reconciliation
- **Final Accounting:**
  - `totalReserve`: 500
  - `encumberedReserve`: 0
  - `redeemedReserve`: 160
  - `withdrawableReserve`: 340
  - All invariants satisfied. Zero data leakage of private credit book.
