# Issuer-approved pricing — 10 October 2026

Historical audit finding F18 allowed the agent to choose the public draw fee, including zero. Adding that supplied fee to debt did not enforce issuer pricing. This repair makes the issuer authorize a fixed schedule at line opening, binds it into the merchant quote, proves the exact charge in generated Compact execution, and discloses the complete price before the buyer authorizes a draw. Enterprise teams purchasing APIs and compute remain an unvalidated customer hypothesis; no pricing conversations, customers or willingness-to-pay evidence are claimed.

## Contract and quote policy

The authoritative twelve-circuit interface is retained. `openLine(expiry, flatFee, basisPoints)` authenticates the issuer, accepts only an inactive/closed line with the existing lifecycle rules, and sets public `feeFlat` and `feeBps` for the new generation. Rates above 10000 basis points reject. Active/defaulted status transitions cannot change pricing. A new policy requires an authenticated zero-debt close and a fresh generation; old merchant notes retain their original redemption rights and backing.

For positive principal `A`, the agreed charge is:

```text
fee = feeFlat + ceil(A * feeBps / 10000)
added debt = A + fee
merchant claim = A
```

Flat fee 3 and 250 basis points on principal 41 produce fee 5, because the percentage charge rounds up from 1.025 to 2. Underpayment and overcharging both reject; even an issuer-approved zero policy rejects a supplied nonzero charge. This prevents silent changes to the price accepted by the buyer.

Compact does not use a new witness or an invented division API. For positive rates, it proves `(variableFee - 1) * 10000 < A * feeBps <= variableFee * 10000`, with widened integer products. A zero rate requires zero variable fee. Existing Uint64, capacity, total-cost and reserve constraints continue to apply. Generated tests include values above JavaScript safe-integer precision. The off-chain helper uses bigint with Uint64 input/output bounds; numeric interfaces restrict accounting values to safe integers.

`Q` now uses the `line:v3:quote` tag and a ten-element typed persistent hash. It appends the two encoded policy fields to the prior quote fields. Compact posting and draw reconstruction use the authoritative ledger policy. TypeScript encoding agrees exactly; no SHA-256 replaces Compact commitments or hashes.

## Runtime, custody and product behavior

- Local and network opening adapters forward the policy. Actual Midnight.js construction exercises generated constraints up to a proving sentinel; forged/invalid inputs reject before proving. There is no proof submission or finalized network transaction in this evidence.
- Quote transfer v3 requires the policy marker, flat amount, rate and exact fee. Validation recomputes the charge. Console imports compare the current domain, generation and policy and reconstruct Q, rejecting altered but internally consistent packages. Draw note transfer remains v2 because its encoding is unchanged.
- Encrypted merchant quote records require priced terms; restored legacy records do not silently acquire zero fees. Agent opening records carry the immutable public policy. Recovery requires exact observed policy as well as the opening, domain, identity and generation; a matching C under different or absent terms cannot authorize restoration.
- Issuer controls expose flat units and basis points. Agent and merchant consoles show merchant price, Line fee and total added debt. The browser test enters issuer terms, opens the line, posts and accepts a quote, and checks principal/fee/debt accounting.
- The development MCP fixture can set issuer pricing when seeding. An omitted draw fee computes the agreed charge; explicit wrong fees reject. Old unpriced state requires an explicit development reset. MCP remains a privileged local fixture with plaintext development state, not independent production custody.
- Generated checkout explicitly opens a zero-fee evaluation policy. Its source-bound checkpoints reject the prior source release rather than rewriting outstanding commitments.

## Verified evidence

Current dirty worktree source SHA-256: `45bd4ab03182531b899fd563627bfc6881f2bdd6e20e20efac88b9c48597a445`. This file fingerprint is provenance, not a Compact cryptographic primitive.

| Check | Result |
|---|---|
| Full default test command | 404 tests, 58 suites; all pass, zero skipped |
| Chromium development browser tests | 19 pass, including issuer price entry and pre-authorization disclosures |
| TypeScript and production build | Pass; existing SDK browser externalization/WebSocket and large-bundle warnings remain |
| Pinned Compact compilation | 0.31.1 / language 0.23 / runtime 0.16.0; twelve circuits and twenty witnesses |
| Fresh managed-output comparison | All 16 generated files match; only source-map output location normalized |
| Full proving release and validation | 52 files / 74,810,486 bytes, twelve binary ZKIR/prover/verifier triples |
| Browser production credential graph | 48 modules inspected; fixture-key and banned-secret scans pass |
| Whitespace checks | Pass; intentional generated changes remain unstaged |

Release: `.compact-keys/releases/0.31.1-45bd4ab03182-8d30902f-d8ce-415a-bd76-1b04d913106f`. Public verifier fixtures match this exact source and generated release; they are SDK test data, not deployment artifacts. Logs and machine-readable results are in [fee-policy-2026-10-10-evidence](fee-policy-2026-10-10-evidence/verification.json).

## Remaining requirements

This closes the caller-selected-fee defect locally, not PD-09 as a whole. Fees currently enter debt and `feeReserve` at authorization. Expiry releases principal backing but leaves debt and fees charged. Correct pending/earned treatment, non-delivery compensation, dispute/refund rules, independent buyer consent records and actual billing/collection require further implementation. Reserve accounting and fee withdrawal do not transfer money or prove revenue.

The protocol permits a policy whose fees exceed the credit limit, making positive purchases unavailable. That is a valid restrictive policy, not proof of usable capacity or good economics. Operator guardrails, denomination/currency/scale, underwriting, verified reserves and payouts, proving costs and measured cost-to-serve remain necessary. No live deployment, finality, token payout, full-history confidentiality, independent role custody or external customer validation is established here. All eighteen product requirements remain active in [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md).
