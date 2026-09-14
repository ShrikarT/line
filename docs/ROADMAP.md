# Line roadmap

Private revolving credit authorization for autonomous agents.

Wave 1 is the **credit state machine**. Wave 2 is **settlement + credentials**. Wave 3 is **network + distribution**.

---

## Wave 1 — credit authorization (this repo)

Judges should be able to attack the machine, not just watch a happy path.

### Shipped

- Five circuits compiled with Compact 0.34.0
- `C = persistentCommit({I, L, B, epoch}, salt)` with stale-C protection
- Issuer-only repayment (no fake self-repay)
- Opaque quotes, domain-separated nullifiers
- Dual-ledger desks + public explorer
- Scripted demo: 40 clears, replay dies, 120 dies, issuer ack, 120 lives, default, post-default dies
- Compact simulator tests + TypeScript replica tests + cross-language vectors
- Attack lab, circuit inspector
- MCP local tools (`status`, `draw`, `seed`)

### Explicitly not Wave 1

On-chain token movement, multi-issuer, interest, slashing court, production MCP discovery, Cardano, Midnight Preprod deployment.

**Promise in Wave 1:** merchant gets a non-replayable, issuer-backed authorization. Not a USDC transfer.

---

## Wave 2 — settlement and unlinkability

1. **Issuer escrow pool** — merchant redeems with `N_draw`. Option A → Option B without changing `draw`.
2. **Per-invoice notes** instead of one pooled `B`.
3. **Unlinkable draws** (note/UTXO) so `C → C'` is not a public activity tape.
4. **Portable issuer credential**.
5. **Second merchant + second issuer**.
6. **Deploy Compact to Midnight testnet** — replace the TypeScript replica as *runtime*.
7. **Lace / Midnight wallet** for the agent secret.
8. **Dispute window** (no slash math).

---

## Wave 3 — network

1. Protocol fee on draws.
2. Human BNPL skin on the same line.
3. Auditor unwrap, issuer marketplace, Cardano settlement.
