# WAVE2_DEMO.md — Line Wave 2 Narrative & Scripted Flow

Line Wave 2 implements a 19-step end-to-end lifecycle demonstration across four distinct roles:
1. **Issuer Desk**: Underwrites credit, funds the settlement reserve pool, registers merchants, confirms off-chain cash repayment, and freezes/reopens credit status.
2. **Merchant A Desk**: Posts opaque quotes, receives private draw notes, and redeems notes against issuer reserves.
3. **Merchant B Desk**: Demonstrates multi-merchant isolation, posts quotes, receives notes, and demonstrates failure when attempting cross-merchant note theft.
4. **Agent Console**: Keeps credit limit $L=150$ and balance $B$ completely private, clears invoices within limit, and issues merchant-bound draw notes.
5. **Public Explorer**: Discloses only public status, reserve pool totals, anonymous note commitments, action clock progression, and nullifiers. Credit books ($L, B, A$), merchant names, and counterparty bindings are never revealed.

---

## The 19-Step Scripted Demo Walkthrough

### Step 0: Genesis
- **Public View**: Empty ledger. Status is `NONE`. No line commitment, no quotes, no notes, no nullifiers. Total reserve is 0.
- **Private View**: Issuer, agent, and merchant private secrets exist off-chain.

### Step 1: Register Merchant B
- **Action**: Issuer calls `registerMerchant(Merchant B PK)`.
- **Public View**: Merchant B public key added to `registeredMerchants`.
- **Private View**: Issuer enables second merchant for multi-merchant settlement.

### Step 2: Fund Reserve (500)
- **Action**: Issuer calls `fundReserve(500)`.
- **Public View**: `totalReserve` increases to 500. Encumbered is 0, redeemed is 0, withdrawable is 500.
- **Private View**: Issuer capital deposits into settlement pool to back agent purchases.

### Step 3: openLine 150
- **Action**: Issuer calls `openLine(150)`.
- **Public View**: Status becomes `OPEN`. Line commitment $C_0$ published. Identity commitment $I$ published. Limit is absent.
- **Private View**: Agent private store: $L=150, B=0, \text{available}=150$.

### Step 4: Merchant A: postQuote 40
- **Action**: Merchant A calls `postQuote(40, "inv-A-40")`.
- **Public View**: Opaque quote commitment $Q_{40}$ posted to `quotes` map. Amount and merchant identity are hidden.
- **Private View**: Invoice 40 stored in Merchant A's private store.

### Step 5: Agent: draw 40 -> Issue Note D1
- **Action**: Agent proves capacity, calls `draw(Q40)`.
- **Public View**: Line commitment rotates $C_0 \to C_1$. Draw nullifier $N_{\text{draw}}$ spent. Draw note commitment $D_1$ created. `encumberedReserve` increases by 40 (withdrawable becomes 460).
- **Private View**: Agent store: $B=40, \text{available}=110$. Private note opening delivered to Merchant A.

### Step 6: Attack — Merchant B tries to redeem D1
- **Action**: Merchant B attempts to call `redeemDraw(D1)` with Merchant B's secret.
- **Public View**: Redemption rejected: note opening invalid. Ledger remains completely unchanged.
- **Private View**: Merchant B cannot steal Merchant A's claim because $D_1$ commits to Merchant A's public key.

### Step 7: Merchant A: redeem D1 (40)
- **Action**: Merchant A calls `redeemDraw(D1)` with Merchant A's secret.
- **Public View**: Redemption nullifier $N_{\text{redeem}}$ spent. Encumbered reserve decreases from 40 to 0; redeemed reserve increases from 0 to 40.
- **Private View**: Merchant A claims 40 settlement against issuer reserve.

### Step 8: Attack — Merchant A tries to redeem D1 again
- **Action**: Merchant A attempts to call `redeemDraw(D1)` a second time.
- **Public View**: Redemption rejected: note already redeemed. Double-spend blocked.
- **Private View**: Double-claim prevented by on-chain nullifier tracking and status check.

### Step 9: Merchant B: postQuote 120
- **Action**: Merchant B calls `postQuote(120, "inv-B-120")`.
- **Public View**: Opaque quote commitment $Q_{120}$ posted by Merchant B.
- **Private View**: Invoice 120 stored in Merchant B's private store.

### Step 10: Over-limit failure (40 + 120 > 150)
- **Action**: Agent attempts to draw 120 against remaining 110 available capacity.
- **Public View**: Clearance could not be proven. Public error is completely generic. Ledger unchanged.
- **Private View**: In-circuit check $B + A \le L$ fails because $40 + 120 = 160 > 150$.

### Step 11: Issuer: acknowledgeRepayment (40)
- **Action**: Issuer confirms off-chain cash payment and calls `acknowledgeRepayment(40)`.
- **Public View**: Line commitment rotates $C_1 \to C_2$. Repayment nullifier spent.
- **Private View**: Agent balance reset to $B=0$, available restored to 150.

### Step 12: Merchant B: post fresh quote 120
- **Action**: Merchant B posts a fresh quote commitment $Q_{120b}$ for the invoice.
- **Public View**: Opaque quote commitment $Q_{120b}$ posted.
- **Private View**: Merchant B re-issues invoice.

### Step 13: Agent: draw 120 -> Issue Note D2
- **Action**: Agent calls `draw(Q120b)`.
- **Public View**: Line commitment rotates $C_2 \to C_3$. Draw note commitment $D_2$ created. Encumbered reserve increases to 120. Withdrawable capacity is $500 - (120 + 40) = 340$.
- **Private View**: Agent store: $B=120, \text{available}=30$. Note delivered to Merchant B.

### Step 14: Attack — Issuer tries to withdraw encumbered reserve
- **Action**: Issuer attempts to withdraw 500 (or entire remaining reserve) while 120 is encumbered.
- **Public View**: Withdrawal rejected: funds backing $D_2$ are locked.
- **Private View**: Issuer cannot rug active merchant settlement notes.

### Step 15: Merchant B: redeem D2 (120)
- **Action**: Merchant B calls `redeemDraw(D2)`.
- **Public View**: $D_2$ redeemed. Encumbered reserve drops to 0; total redeemed reserve becomes 160.
- **Private View**: Merchant B claims 120 from issuer reserve pool.

### Step 16: Issuer: setStatus(DEFAULTED)
- **Action**: Issuer calls `setStatus(DEFAULTED)`.
- **Public View**: Line status changes to `DEFAULTED`.
- **Private View**: Credit line frozen due to nonpayment or issuer policy.

### Step 17: Post-default draw fails
- **Action**: Agent attempts to draw against a quote while line is defaulted.
- **Public View**: Clearance could not be proven. Ledger unchanged.
- **Private View**: Circuit asserts `status == Status.OPEN`.

### Step 18: Public Explorer Review
- **Public View**: Explorer shows total reserve (500), redeemed reserve (160), commitments ($C_3$), 4 quotes, 4 nullifiers, 2 notes, and contract domain. No credit limits, balances, or invoices appear anywhere on the ledger.
- **Private View**: Full privacy preserved across complete multi-role lifecycle.

---

## Reproducing the Demo Locally

### Interactive Web Desks
Start the development server:
```bash
npm run dev
```
Navigate to `http://localhost:5173`. Use the **Next demo step** button on the home page, or visit `/issuer`, `/merchant`, `/agent`, `/lab`, and `/explorer`.

### Automated CLI Demo Test
To execute all 19 demo transitions programmatically in sequence:
```bash
npm test
```
The test suite in `src/lib/line/demo.test.ts` executes every step against the state machine and verifies ledger invariants after each transition.
