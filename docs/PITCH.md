# Pitch — Line

## Slide 1 — Problem

Agents need purchasing power. Prefunded wallets trap capital. Public credit books get farmed: counterparties, utilization, and timing leak strategy.

## Slide 2 — Product

Line makes **capacity** privately verifiable.

- Issuer underwrites a limit and later acknowledges cash received.
- Agent proves `outstanding + invoice ≤ limit` without publishing either number.
- Merchant receives a one-time, issuer-backed draw authorization.
- Public ledger sees commitments and status, not books.

This is not a wallet spend-cap. This is revolving credit.

## Slide 3 — Demo

Private limit 150.

1. Line opens — explorer shows a commitment, not 150.
2. Draw 40 clears. Replay dies.
3. Draw 120 cannot be proven.
4. Issuer acknowledges repay 40.
5. Draw 120 clears. Default freezes the line.

## Wave 1 honesty

No on-chain asset settlement. The merchant is authorized, not auto-paid in tokens. Wave 2 adds a shielded escrow redeemable with the same draw nullifier.
