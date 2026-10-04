# Security Architecture & Threat Analysis

## Executive Summary

Line implements a zero-knowledge revolving credit and settlement state machine compiled with the Midnight Compact compiler (`0.34.0`, Compact language `0.26.0`, runtime `0.19.0`).

This document details the threat model, formal protocol invariants, attack defenses, circuit constraints, automated tests, and remaining operational limitations.

> [!NOTE]
> **Audit Status:** Line has completed internal security reviews, automated invariant model checking, and multi-party test suites. It has not yet undergone an external third-party institutional security audit. Production deployment with institutional capital must follow a formal independent audit.

---

## Threat Matrix & Formal Defenses

| Threat | Impact | Defense & Mechanism | Enforcing Compact Circuit | Automated Test |
|---|---|---|---|---|
| **Forged Issuer** | Attacker opens line, alters reserves, or defaults line. | Circuit enforces `issuerPublicKey(callerSecret) == issuer` stored during constructor. | `fundReserve`, `withdrawUnencumberedReserve`, `openLine`, `acknowledgeRepayment`, `setStatus` | `compact.test.ts: "forged issuer is rejected"` |
| **Forged Merchant** | Attacker posts spam quotes or steals claims. | Issuer whitelists `merchantPk` in `registeredMerchants`. `postQuote` checks `registeredMerchants.member(merchantPk)`. | `registerMerchant`, `postQuote` | `compact.test.ts: "unregistered merchant cannot post quotes"` |
| **Forged Agent** | Attacker attempts to draw against agent's credit line. | Circuit enforces $\text{agentId}(k) == \text{identityCommit}$. | `draw` | `compact.test.ts: "wrong agent fails draw"` |
| **Cross-Role Key Substitution** | Issuer tries to post quotes or Merchant tries to acknowledge repayment. | Role keys use domain separation tags (`"line:issuer:pk"`, `"line:merchant:pk"`, `"line:id"`). Substitution produces invalid hashes. | All circuits | `protocol.test.ts: "role separation"` |
| **Cross-Instance Replay** | Note, quote, or state from Contract A replayed on Contract B. | Constructor derives unique `contractDomain` using `instanceNonce`. All commitments and nullifiers include `contractDomain`. | All circuits | `compact.test.ts: "cross-instance replay rejection"` |
| **Cross-Generation Replay** | Quote or note from previous facility generation reused after closing/reopening. | Monotonic `lineGeneration` increments on new `openLine`. Circuits enforce `generation == lineGeneration`. | `openLine`, `postQuote`, `draw`, `cancelOrExpireNote` | `compact.test.ts: "quote from generation 1 cannot be drawn on generation 2"` |
| **Quote Replay** | Same quote drawn multiple times by agent. | Quote record marked `used = true` upon first draw; draw spends nullifier $N_{\text{draw}}$. | `draw` | `compact.test.ts: "reused quote fails draw"` |
| **Double Redemption** | Merchant redeems note multiple times. | Spends unique nullifier $N_{\text{redeem}} = \text{persistentHash}([\text{"line:redeem"}, sk_M, D, \text{domain}])$. Marks `notes[D].redeemed = true`. | `redeemDraw` | `compact.test.ts: "double redemption fails"` |
| **Repayment Replay** | Agent reuses previous payment receipt to restore capacity twice. | Spends unique nullifier $N_{\text{repay}} = \text{persistentHash}([\text{"line:repay"}, \text{nonce}, I, C, R, \text{paymentRef}, \text{domain}])$. | `acknowledgeRepayment` | `protocol.test.ts: "receipt used"` |
| **Stale Commitment $C$** | Agent draws against outdated credit balance. | Circuit enforces $\text{persistentCommit}(\{ \text{domain}, I, L, B, e \}, s) == \text{lineCommit}$. Old salt fails. | `draw`, `acknowledgeRepayment` | `protocol.test.ts: "rejects a stale line-state commitment"` |
| **Fake Limit $L$ or Debt $B$** | Agent provides fraudulent witness values for $L$ or $B$. | Commitment $C$ binds $(I, L, B, \text{epoch})$. Any modification yields a mismatched hash. | `draw`, `acknowledgeRepayment` | `compact.test.ts: "tampered amount fails quote reconstruction"` |
| **Over-Limit Arithmetic** | Agent draws more than available capacity. | Circuit enforces constraint $B + A \le L$ inside zero-knowledge. | `draw` | `compact.test.ts: "over-limit draw fails"` |
| **Underflow on Repayment** | Repayment amount exceeds current outstanding debt $B$. | Circuit asserts $A \le B$ before decrementing $B' = B - A$. | `acknowledgeRepayment` | `compact.test.ts: "repayment greater than B fails"` |
| **Zero-Value Operations** | Attacker spams zero-amount funds, quotes, or draws. | Circuits assert `amount > 0`. | `fundReserve`, `postQuote`, `draw`, `acknowledgeRepayment` | `compact.test.ts: "zero fund is rejected"` |
| **Insufficient Reserve** | Agent draws when issuer reserve pool cannot back the claim. | Circuit asserts $\text{totalReserve} - (\text{encumberedReserve} + \text{redeemedReserve}) \ge A$. | `draw` | `compact.test.ts: "draw fails when reserve is insufficient"` |
| **Issuer Rug-Pull** | Issuer withdraws reserve backing active merchant claim notes. | `withdrawUnencumberedReserve` asserts $\text{amount} \le \text{totalReserve} - (\text{encumberedReserve} + \text{redeemedReserve})$. | `withdrawUnencumberedReserve` | `compact.test.ts: "issuer cannot withdraw funds backing an outstanding draw note"` |
| **Premature Cancellation** | Issuer cancels note before expiry to reclaim encumbered funds. | `cancelOrExpireNote` asserts `actionClock > expiry`. | `cancelOrExpireNote` | `compact.test.ts: "unexpired note cannot be cancelled"` |
| **Default Evasion** | Agent draws after line is marked defaulted by issuer. | `draw` asserts `status == Status.OPEN`. Defaulting immediately halts draws. | `draw`, `setStatus` | `compact.test.ts: "defaulted line rejects draw"` |
| **Cross-Merchant Claim Theft** | Merchant B attempts to redeem Merchant A's claim note. | Note preimage privately commits to `merchantPk`. `redeemDraw` proves ownership in ZK: $\text{publicKey}(sk_M) == \text{merchantPk}$. | `redeemDraw` | `compact.test.ts: "Merchant B cannot redeem Merchant A's note"` |

---

## Information Leakage & Mitigation Summary

1. **Credit Book ($L, B$):** Fully private in zero-knowledge witness. Tested in `leakage.test.ts`.
2. **Settlement Amounts ($A$):** Public on-chain metadata in `notes[D].amount` and observable via reserve delta $\Delta \text{encumberedReserve} = A$. Documented in `docs/PRIVACY.md`.
3. **Merchant Identity:** Private in claim note commitment $D$, but linkable at quote time via `QuoteMeta.merchantPk`.
4. **Logical Clock Sequencing:** Logical `actionClock` increments per transaction, eliminating block-timestamp manipulation and miner extractable value (MEV) timestamp arbitrage.

---

## Client-Side Security & Key Management

- **Storage Vault:** `src/lib/security/vault.ts` implements WebCrypto AES-GCM 256-bit encryption with PBKDF2-HMAC-SHA256 (100,000 rounds). Keys are never stored unencrypted in `localStorage`.
- **Randomness:** Uses `crypto.getRandomValues()` in browser and Node environments. No `Math.random()` in any cryptographic path.
- **Institutional Warning:** Browser storage is intended for evaluation and local agent testing. Production systems must integrate institutional hardware security modules (HSM) or multi-party computation (MPC) signers.
