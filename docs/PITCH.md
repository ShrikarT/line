# Product Pitch: Line

## Slide 1 — The Problem

Autonomous AI agents need instantaneous purchasing power for compute, APIs, and micro-services.
- Prefunded agent wallets fragment scarce liquidity and create high-risk theft targets.
- Corporate cards and public credit lines leak commercial secrets: competitors and merchants observe credit limits, utilization rates, cash flows, and trade frequency.

## Slide 2 — The Solution: Line

Line delivers **private revolving credit and checkout infrastructure for autonomous agents**.

- **Issuer**: Underwrites confidential credit facilities and allocates verifiable reserve capacity.
- **Agent**: Evaluates purchase invoices and proves in zero-knowledge that $B + A \le L$ without disclosing credit limits or current balances.
- **Merchant**: Receives an issuer-backed, non-replayable claim note redeemable once against the issuer's reserve.
- **Public Explorer**: Verifies mathematical reserve solvency, commitment transitions ($C \to C'$), and spent nullifiers—never private credit books.

Revolving credit and checkout infrastructure, not a simple wallet spend cap.

## Slide 3 — The Lifecycle & Attack Resilience

Confidential limit $L = 150$, Reserve pool 500.

1. Line opens — explorer records commitment $C_0$, concealing the 150 limit.
2. Merchant A posts opaque invoice quote $Q_{40}$.
3. Agent draws 40: claim note $D_1$ issued; 40 reserve encumbered on-chain.
4. **Attack 1**: Merchant B attempts to steal and redeem $D_1$ -> **Rejected in zero-knowledge**.
5. Merchant A redeems $D_1$: 40 shifts from encumbered to redeemed reserve.
6. **Attack 2**: Merchant A attempts double-redemption -> **Rejected by nullifier**.
7. Merchant B posts quote 120.
8. Agent draws 120 -> **Rejected**: $40 + 120 > 150$ with generic clearance error.
9. Issuer acknowledges 40 repayment: agent revolving capacity restored.
10. Agent draws 120: note $D_2$ issued; 120 reserve encumbered.
11. **Attack 3**: Issuer tries to withdraw encumbered funds -> **Rejected: locked backing**.
12. Merchant B redeems $D_2$: 120 claimed from reserve.
13. Issuer transitions line to DEFAULTED. Subsequent draws halt immediately.

## Slide 4 — Architecture & Technical Maturity

- **Compact Smart Contract**: Formal on-chain reserve capacity, encumbered claims tracking, merchant-bound draw notes, and redemption nullifiers.
- **Real Compact 0.26 Code**: Compiles with Compact toolchain 0.34.0 into ZKIR and managed TypeScript bindings with zero drift.
- **Model-Checked Invariants**: 50 pseudo-random transitions verifying all 10 protocol and reserve invariants.
- **Production Runtime Architecture**: Seamless pluggability between `MidnightNetworkRuntime`, `LocalDevelopmentRuntime`, and `InMemoryTestRuntime`.
