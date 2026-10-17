# Public transaction regression fixtures

These are serialized proven transactions, not private-state snapshots or wallet keys.

- `rejected-empty-fee.bin`: test-contract merchant registration rejected with RPC 1010 / Custom error 117 on 17 October 2026. Hash `15a7f853cf6dec6a1d350dd5410ed2425eaf3aa45968daacbdca719b905d7b0d`. The fee intent has zero DUST spends and zero registrations. The pinned ledger independently reproduces its normalization error.
- `confirmed-funded.bin`: confirmed 200-unit test-reserve mint. Hash `634a128b6275c58c817b25e5be4d6cdeaee2ed710763984200f685b9089c765a`. Its fee intent contains one DUST spend.

The test checks the actual failure shape and pre-submission guard. It does not submit either transaction or claim that a new transaction has confirmed.
