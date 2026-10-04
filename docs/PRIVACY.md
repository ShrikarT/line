# Privacy Architecture & Ledger Inventory

## Executive Summary

Line provides private credit and checkout infrastructure for autonomous agents.
The cryptographic and state boundaries are designed so that an autonomous agent proves purchase capacity without disclosing its credit limit ($L$), outstanding debt ($B$), or available capacity $(L - B)$ to public ledger observers or merchants.

This document details the exact public disclosure model, state-delta inference vectors, and privacy guarantees implemented in `contracts/line.compact` and verified in `src/lib/line/leakage.test.ts`.

---

## Core Privacy Invariant: Private Credit Book

The agent's financial credit book $(L, B, \text{capacity})$ is strictly confidential:
- **Private Witness Only:** $L$ (limit) and $B$ (outstanding debt) exist only within the agent's private circuit witness during execution of `draw`.
- **State Commitment $C$:** The public ledger records only $C = \text{persistentCommit}(\{ \text{domain}, I, L, B, \text{epoch} \}, \text{salt})$. Observers cannot determine $L$, $B$, or $(L - B)$ from $C$.
- **ZK Capacity Proof:** The circuit enforces $B + A \le L$ inside zero-knowledge. Observers learn only that the constraint was satisfied.
- **Generic Failure Response:** If an invoice exceeds available capacity, the protocol rejects the draw with a generic error: `"Clearance could not be proven."` No margin or reason is revealed.

---

## Complete Ledger Field Inventory

Every public ledger field in `contracts/line.compact` is documented below:

| Field Name | Source / Type | Public? | Directly Sensitive? | Delta Inference? | Identity Linkage? | Purpose & Justification | Mitigation / Privacy Boundary |
|---|---|---|---|---|---|---|---|
| `contractDomain` | `Cell<Bytes<32>>` | Yes | No | No | No | Domain separation across contract deployments. Prevents cross-instance replays. | Cryptographically derived from deployer public keys and `instanceNonce`. |
| `issuer` | `Cell<Bytes<32>>` | Yes | Low | No | Identifies Issuer | Authenticates admin circuits (`openLine`, `fundReserve`, `repayAck`, `setStatus`). | Issuer is the capital provider; public authority is required for governance. |
| `identityCommit` | `Cell<Bytes<32>>` | Yes | No | No | Pseudonymous | Binds active credit line to agent identity commitment $I = \text{agentId}(k)$. | Agent secret key $k$ is never revealed; $I$ is an opaque persistent hash. |
| `lineCommit` | `Cell<Bytes<32>>` | Yes | No | No | No | Cryptographic root $C$ representing current $(I, L, B, \text{epoch})$. | Commitment hides $L$ and $B$; rotated to fresh $C'$ with random salt on each transition. |
| `lineExpiry` | `Cell<Uint<64>>` | Yes | Low | No | No | Enforces temporal validity of credit facility. | Standard loan lifecycle parameter. |
| `status` | `Cell<Enum>` | Yes | Low | No | No | Public facility status (`NONE`, `OPEN`, `DEFAULTED`, `CLOSED`). | Required for merchants to know if line is active before quoting. |
| `lineGeneration`| `Cell<Uint<64>>` | Yes | Low | No | No | Monotonic counter isolating successive lines. | Eliminates cross-generation quote or note reuse. |
| `actionClock` | `Counter` | Yes | Low | Timing | No | Logical sequence ordering transitions. | Eliminates wall-clock dependencies; prevents front-running. |
| `totalReserve` | `Cell<Uint<64>>` | Yes | Moderate | Yes | No | Total capital allocated by issuer to back draw notes. | Reveals aggregate issuer capacity. |
| `encumberedReserve` | `Cell<Uint<64>>` | Yes | Moderate | Yes ($\Delta = A$) | No | Capital committed to outstanding unredeemed draw notes. | **Delta Analysis:** Increases by draw amount $A$. See State Delta Analysis below. |
| `redeemedReserve` | `Cell<Uint<64>>` | Yes | Moderate | Yes ($\Delta = A$) | No | Cumulative claims settled by merchants. | **Delta Analysis:** Increases by note amount $A$ upon redemption. |
| `registeredMerchants` | `Map<Bytes<32>, Boolean>` | Yes | Low | No | Pseudonymous | Authorizes registered merchant public keys (`merchantPk`). | Prevents spam quotes from unauthorized parties. |
| `quotes[Q]` | `Map<Bytes<32>, QuoteMeta>` | Yes | Moderate | No | Links Merchant | Tracks quote validity and prevents reuse. Contains `merchantPk`. | Quote amount is hidden in hash $Q$; `merchantPk` is public pseudonym. |
| `notes[D]` | `Map<Bytes<32>, NoteMeta>` | Yes | Moderate | Reveals $A$ | No | Authorizes one-time merchant redemption. Contains `amount`, `expiry`. | `amount` is public on-chain metadata for settlement claims. Merchant identity is hidden in commitment $D$. |
| `nullifiers[N]` | `Set<Bytes<32>>` | Yes | No | No | No | Prevents replay of quotes, note redemptions, and repayment receipts. | Nullifiers are pseudorandom one-way hashes; unlinked to preimage. |

---

## State Delta & Amount Disclosure Analysis

### 1. What Is Public
- **Draw Note Amount $A$:** `NoteMeta.amount` is stored in the public `notes` ledger map so the contract and indexer can track settlement solvency.
- **Reserve Deltas:** When a draw executes, $\Delta \text{encumberedReserve} = +A$. When a merchant redeems a note, $\Delta \text{encumberedReserve} = -A$ and $\Delta \text{redeemedReserve} = +A$.

### 2. What Remains Confidential
- **Credit Limit $L$:** Never revealed on-chain or through deltas.
- **Current Debt $B$:** Never revealed on-chain or through deltas.
- **Available Remaining Line:** $(L - B)$ is never observable. A $40 draw reveals only that $40 was drawn and that $B + 40 \le L$. Observers cannot tell whether $L = 100, 1000, \text{or } 1,000,000$.
- **Agent Identity & Secrets:** The agent's private signing key $k$ and commitment salts are never leaked.
- **Invoice Reference:** Plaintext invoice IDs and purchase descriptions remain off-chain between agent and merchant.

---

## Merchant Linkability Boundary

1. **Quote Phase:** A merchant posts an opaque quote commitment $Q = \text{persistentHash}([\text{pad}(32, \text{"line:quote"}), \text{merchantPk}, A, \text{invId}, \text{expiry}, \text{nonce}, \text{gen}, \text{domain}])$. Public `QuoteMeta` records `merchantPk`.
2. **Draw Phase:** When an agent accepts quote $Q$, it constructs draw note $D = \text{persistentCommit}(\text{DrawNotePreimage}, \text{noteSalt})$. The preimage privately binds `merchantPk` without writing `merchantPk` into `NoteMeta`.
3. **Linkage Vector:** Because quote consumption and draw note creation occur in the same on-chain action, a public ledger observer who monitors the transaction can correlate that note $D$ was generated in response to quote $Q$ by `merchantPk`.
4. **Redemption Phase:** Only the holder of `merchantSk` corresponding to the committed `merchantPk` can satisfy `redeemDraw`. Merchant B cannot redeem Merchant A's note.

---

## Machine-Checked Verification

The test suite in `src/lib/line/leakage.test.ts` validates:
1. Public ledger serialization contains no `limit`, `outstanding`, `capacity`, or private keys.
2. Reserve deltas and note metadata accurately match transaction amounts.
3. Merchant pseudonyms and quote linkages operate within documented boundaries.
4. MCP tool outputs (`line.status`, `line.reserve.status`) never leak credit books or secrets.
