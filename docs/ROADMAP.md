# Line roadmap

Private revolving credit authorization for autonomous agents.

Wave 1 is the **credit state machine**. Wave 2 is **settlement + credentials**. Wave 3 is **network + distribution**.

---

## Wave 1 — credit authorization (this repo)

Judges should be able to attack the machine, not just watch a happy path.

### Shipped

- Five circuits: `openLine`, `postQuote`, `draw`, `acknowledgeRepayment`, `setStatus`
- `C = H(line:state, I, L, B, e, s)` with stale-C protection
- Issuer-only repayment (no fake self-repay)
- Opaque quotes, domain-separated nullifiers
- Dual-ledger desks + public explorer
- Scripted demo: 40 clears, 120 dies, issuer ack, 120 lives, default
- Adversarial tests (forged issuer, replay, stale C, wrong merchant, receipt reuse)
- Compact circuit spec + TypeScript reference engine
- Attack lab, circuit inspector, dual public/private view
- Thin MCP transport

### Wave 1 still in this wave (not “later”)

These belong in Wave 1 because they prove the product is not a guest-list demo:

| Item | Why it is Wave 1 |
|---|---|
| Attack lab (replay, fake repay, over-limit, stale C, wrong agent) | QA 15% is adversarial, not screenshots |
| Dual view: public vs private after every circuit | Communication 10% |
| Step-through demo, not a dump of the final ledger | Product |
| Receipt objects visible only on the issuer desk | Fake-repay story |
| Compact + TS field table kept in lockstep | Engineering |
| Tests for expiry, closed status, overflow, zero amounts | Judges grep for these |

### Explicitly not Wave 1

On-chain token movement, multi-issuer, interest, slashing court, production MCP discovery, Cardano.

**Promise in Wave 1:** merchant gets a non-replayable, issuer-backed authorization. Not a USDC transfer.

---

## Wave 2 — settlement and unlinkability

Same product. Same repo. New circuits.

1. **Issuer escrow pool**  
   Issuer deposits shielded test assets. Merchant redeems with `N_draw`. This upgrades Option A → Option B without changing `draw`.

2. **Per-invoice notes**  
   Outstanding is no longer one pooled `B`. Each draw creates a note; repay burns that note. Enables partial, invoice-accurate settlement.

3. **Unlinkable draws**  
   Note/UTXO design so `C → C'` is not a public activity tape. Full unlinkability was deferred on purpose.

4. **Portable issuer credential**  
   Signed `(I, L, expiry)` the agent carries. `openLine` verifies membership instead of the issuer calling the circuit. Needed before a second issuer.

5. **Second merchant + second issuer**  
   Same agent, two counterparties, still no public merchant graph.

6. **`compactc` on Midnight testnet**  
   Replace the TypeScript engine as the *runtime*. Keep TS as the spec test oracle.

7. **Lace / Midnight wallet**  
   Agent secret lives in a wallet, not localStorage.

8. **Dispute window (no slash math)**  
   Issuer can mark `defaulted` with a public due epoch. Fair evidence and bond slashing stay Wave 3.

---

## Wave 3 — network

1. Protocol fee on draws (basis points, private amount, public fee commitment).
2. Human BNPL skin (Polaris-like) on the same line.
3. Cardano-side settlement / NIGHT.
4. Pay-per-crawl and paid-API policy packs as merchant templates.
5. Production MCP (`line.draw` against live quotes, discovery, auth).
6. Selective disclose / auditor unwrap for one invoice.
7. Issuer marketplace (underwriting as a business).
8. Build Club / mainnet packaging.

---

## What would make Wave 1 look basic (avoid)

- Wallet spend-cap branded as credit
- `canPay` as a reusable on-chain yes
- Agent-initiated `repay(R)` with no receipt
- Publishing amounts “for the demo”
- Skipping failed-proof cases
- Claiming the merchant was paid on-chain
