# Pitch — Line

## Slide 1 — Problem

Autonomous AI agents need instantaneous purchasing power for compute, APIs, and data.
- Prefunded agent wallets trap scarce liquidity and create massive theft targets.
- Public credit books leak competitive strategy: observers farm merchant counterparties, agent utilization, and trade frequency.

## Slide 2 — Product

Line delivers **private revolving credit and settlement authorization for autonomous agents**.

- **Issuer**: Underwrites confidential credit and deposits liquidity into an auditable reserve pool.
- **Agent**: Proves `outstanding + invoice ≤ limit` and reserve solvency without publishing limits, balances, or prices.
- **Merchant**: Receives a private, non-replayable draw note redeemable once against the issuer reserve pool.
- **Public Explorer**: Sees verified reserve solvency, commitment progression, and nullifiers—never private books or counterparties.

Revolving credit with reserve accounting, not a spend cap.

## Slide 3 — Demo (19 Real Steps)

Private limit $L = 150$, Reserve pool 500.

1. Line opens — explorer shows $C_0$, not 150.
2. Merchant A posts opaque quote $Q_{40}$.
3. Agent draws 40: note $D_1$ issued, 40 reserve encumbered.
4. **Attack 1**: Merchant B tries to steal and redeem $D_1$ -> **Rejected in ZK**.
5. Merchant A redeems $D_1$: 40 shifts from encumbered to redeemed reserve.
6. **Attack 2**: Merchant A attempts double-redemption -> **Rejected by nullifier**.
7. Merchant B posts quote 120.
8. Agent draws 120 -> **Rejected**: $40 + 120 > 150$.
9. Issuer acknowledges 40 repayment: agent balance restored to 0.
10. Agent draws 120: note $D_2$ issued, 120 reserve encumbered.
11. **Attack 3**: Issuer tries to withdraw encumbered funds -> **Rejected: locked backing**.
12. Merchant B redeems $D_2$: 120 claimed from reserve.
13. Issuer freezes line to DEFAULTED. Subsequent draws fail.

## Slide 4 — Wave 2 Honesty & Reality

- **Exact Compact Settlement Accounting**: Formal on-chain reserve pool, encumbered reserve tracking, merchant-bound draw notes, and redemption nullifiers.
- **Real Compact 0.26 Code**: Compiles with Compact toolchain 0.34.0 into ZKIR and managed TypeScript bindings.
- **Honest Boundary**: Local simulator prototype. No unverified Preprod contract addresses or live token disbursements claimed.
