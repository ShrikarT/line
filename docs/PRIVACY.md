# Privacy Architecture & Ledger Inventory

## Executive Summary

Line is a protocol prototype exploring agent purchasing; private credit and checkout are its unproven destination.
The target is purchase eligibility without exposing the credit book to unauthorized parties. The current contract hides plaintext witness fields, but **does not establish complete historical debt confidentiality**. From the known zero opening, public note amounts and draw fees reconstruct debt before the first private repayment. Later repayments can introduce uncertainty; increments and approval bounds remain observable. See [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md) for the complete requirement.

This document inventories the public disclosure model and tested state-delta inference vectors in `contracts/line.compact` and `src/lib/line/leakage.test.ts`. Those tests can falsify privacy claims; they do not prove complete historical confidentiality or the destination privacy guarantee.

---

## Core Privacy Invariant: Private Credit Book

The current field-level boundary is:
- **Private Witness:** $L$ (limit), $B$ (debt) and epoch are private inputs to the executing process for book transitions. They are absent as plaintext ledger fields; authorized issuer workflows also need the opening. The current opening circuit requires the agent secret as an issuer-side witness, an independent-custody gap.
- **State Commitment $C$:** $C = \text{persistentCommit}(\{ \text{contractDomain}, I, L, B, \text{epoch} \}, \text{salt})$ hides its opening and is bound to this contract instance. Hiding the opening alone does not hide debt inferable from public history.
- **Capacity Constraint:** The circuit enforces $B + A + \text{fee} \le L$ on private witnesses. Confirmed ZK execution requires its own proof/network evidence; local generated execution is not proof submission. Approvals disclose bounds as well as public amounts.
- **Generic Failure Response:** Rejected draws use `"Clearance could not be proven."` at the product boundary. This reduces explicit reason disclosure but does not eliminate probing, timing or public-history inference.

---

## Complete Ledger Field Inventory

Every public ledger field in `contracts/line.compact` across all 12 circuits is documented below:

| Field Name | Source / Type | Public? | Directly Sensitive? | Delta Inference? | Identity Linkage? | Purpose & Justification | Mitigation / Privacy Boundary |
|---|---|---|---|---|---|---|---|
| `contractDomain` | `Cell<Bytes<32>>` | Yes | No | No | No | Domain separation across contract deployments. Prevents cross-instance replays. | Cryptographically derived from deployer public keys and `instanceNonce`. |
| `issuer` | `Cell<Bytes<32>>` | Yes | Low | No | Identifies Issuer | Authenticates admin circuits (`openLine`, `fundReserve`, `acknowledgeRepayment`, `setStatus`, `withdrawFees`, `disableMerchant`). | Identifies protocol administration/authority, not necessarily the capital provider, creditor, custodian or settlement operator. Name the actual borrower, creditor/capital source and asset operator in facility terms; see [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md). |
| `identityCommit` | `Cell<Bytes<32>>` | Yes | Not a secret, but privacy-relevant | Book-event association | Stable within and across instances when the same agent secret is reused | Binds active credit line to agent identity commitment $I = \text{agentId}(k)$. | Agent secret key $k$ is never revealed, but `agentId` hashes a fixed tag and key without `contractDomain`; the public pseudonym is therefore cross-instance linkable and associates public line events. The domain-bound line commitment does not domain-scope this identity. |
| `lineCommit` | `Cell<Bytes<32>>` | Yes | No | No | No | Cryptographic root $C$ representing current `(contractDomain, I, L, B, epoch)`. | Commitment hides $L$ and $B$; domain-bound and rotated to fresh $C'$ with random salt on each transition. |
| `lineExpiry` | `Cell<Uint<64>>` | Yes | Low | Timing | No | Absolute Unix-seconds facility deadline, compared against ledger block time. | Public lifecycle timing; local construction and approximate chain time can differ. |
| `status` | `Cell<Enum>` | Yes | Moderate | Zero-debt closure | No | Public facility status (`NONE`, `OPEN`, `DEFAULTED`, `CLOSED`). | Successful closure proves the authentic current debt is zero; default/resume preserve debt. |
| `lineGeneration`| `Cell<Uint<64>>` | Yes | Low | No | No | Monotonic counter isolating successive lines. | New draws require current-generation quotes; earlier merchant claims retain their own generation and remain redeemable before their deadline. |
| `actionClock` | `Counter` | Yes | Low | Activity | No | Diagnostic sequence ordering transitions. | Counts successful actions only; it no longer controls expiry. |
| `totalReserve` | `Cell<Uint<64>>` | Yes | Moderate | Yes | No | Cumulative reserve-inflow accounting used to bound draw-note issuance. | Reveals aggregate accounting capacity, not money held by an issuer/custodian. `fundReserve` authenticates the issuer and changes a counter; it verifies no deposit. |
| `encumberedReserve` | `Cell<Uint<64>>` | Yes | Moderate | Yes ($\Delta = A$) | No | Capital committed to outstanding unredeemed draw notes. | **Delta Analysis:** Increases by draw amount $A$. See State Delta Analysis below. |
| `redeemedReserve` | `Cell<Uint<64>>` | Yes | Moderate | Yes ($\Delta = A$) | No | Cumulative redeemed claim accounting, not payout proof. | **Delta Analysis:** Increases by note amount $A$ upon redemption. |
| `feeReserve` | `Cell<Uint<64>>` | Yes | Moderate | Yes ($\Delta = \text{fee}$) | No | Earned fee accounting at merchant claim redemption; no actual collection or delivery established. | Moves pending fee into earned reserve on redemption; zeroed upon `withdrawFees`. |
| `pendingFeeReserve` | `Cell<Uint<64>>` | Yes | Moderate | Fee amount | No | Fees locked on draw, pending merchant claim redemption. | Public fee remains inferable from principal/policy. |
| `refundReserve` | `Cell<Uint<64>>` | Yes | Moderate | Full claim cost | No | Full original budgets backing expired claims awaiting allocation or cash reports. | Positive private remainders retain the full budget; no partial cash amount is disclosed. |
| `reportedRefundReserve` | `Cell<Uint<64>>` | Yes | Moderate | Full claim cost | No | Original budgets retained after issuer refund reports. | Not the actual cash amount; remains locked without cash verification. |
| `feeFlat` | `Cell<Uint<64>>` | Yes | Low | Pricing | Issuer/line | Fixed flat fee approved at opening. | Explicit public economic terms; quote commitment binds the policy. Does not reveal the private limit. |
| `feeBps` | `Cell<Uint<64>>` | Yes | Low | Pricing | Issuer/line | Fixed fee rate, 0–10000 basis points, approved at opening. | With public note amount, observers compute the exact fee; this does not improve historical debt confidentiality. |
| `registeredMerchants` | `Map<Bytes<32>, Boolean>` | Yes | Low | No | Pseudonymous | Authorizes registered merchant public keys (`merchantPk`). | Prevents spam quotes from unauthorized parties. |
| `quotes[Q]` | `Map<Bytes<32>, QuoteMeta>` | Yes | Moderate | No | Via transcript | Tracks quote validity and prevents reuse. | Metadata has `expiry`, `lineGeneration`, `used`; no merchant or amount field. Public query disclosures can link merchant. |
| `notes[D]` | `Map<Bytes<32>, NoteMeta>` | Yes | Moderate | Reveals $A$ | Through public draw transcript | Authorizes one-time merchant redemption. Contains principal, fee, expiry/generation, lifecycle flags, refund commitment, cash-owed boolean and exact note-bound refund payment nullifier. | The metadata struct omits `merchantPk`, and note opening binds it; however, `draw` also discloses that merchant pseudonym for the public allowlist lookup, so the full public transcript does not hide the association. |
| `nullifiers[N]` | `Set<Bytes<32>>` | Yes | No | Equality | Contextual | Detects draw/redemption reuse; each repayment inserts a transition receipt and stable payment hash; refund reports consume the same stable hash. | Stable hash binds issuer secret, exact payment reference and domain. It prevents exact-reference replay in that instance; high-entropy issuer keys are required. It does not establish cash authenticity. |

---

## State Delta & Amount Disclosure Analysis

### 1. What Is Public
- **Draw Note Amount $A$:** `NoteMeta.amount` is stored in the public `notes` ledger map so the contract and indexer can track settlement solvency.
- **Reserve Deltas:** When a draw executes, $\Delta \text{encumberedReserve} = +A$. When a merchant redeems a note, $\Delta \text{encumberedReserve} = -A$ and $\Delta \text{redeemedReserve} = +A$.
- **Deadlines and time bounds:** Facility, quote and note deadlines are public. Block-time predicates disclose validity bounds, including the repayment receipt deadline. None is a private credit-book amount; timing/correlation analysis remains part of the observer model.
- **Pricing:** `feeFlat` and `feeBps` are public and immutable for the generation. The draw fee is also public and equals `feeFlat + ceil(A * feeBps / 10000)`. Authenticating price prevents tampering; it does not hide debt increments.

### 2. What Remains Confidential
- **Credit Limit $L$:** No plaintext ledger field. Approvals/probing reveal bounds; hiding exact configured limit is distinct from hiding all information about it.
- **Current Debt $B$:** No plaintext field, but public amounts/fees reconstruct it from known zero until a private repayment; later uncertainty does not restore full-history confidentiality.
- **Zero-debt closure:** A successful public `CLOSED` transition proves debt was zero at closure. Subsequent zero-debt reopening creates another known baseline. This is an explicit lifecycle disclosure, not complete debt confidentiality.
- **Available Remaining Line:** No plaintext field. Exact limit is not published, but clearance outcomes expose constraints on capacity. A $40 draw reveals an amount and a successful inequality.
- **Agent Identity & Secrets:** The agent's private signing key $k$ and commitment salts are never leaked.
- **Invoice Reference:** Plaintext invoice IDs and purchase descriptions remain off-chain between agent and merchant.

---

## Compensation disclosure boundary

The exact refund remainder is committed privately. Public numeric `cost - min(B,cost)` would reveal B for a partially repaid purchase, so the contract retains the **full original cost** whenever any cash remainder is owed. Issuer reports move that full budget from refundReserve to reportedRefundReserve, leaving T and withdrawable backing unchanged. Two different positive private refund amounts therefore have the same reserve deltas. This avoids a new exact-remainder channel; it does not establish full historical debt privacy.

`cashRefundOwed` discloses whether current-generation B was below the original cost. A zero-cash allocation releases the full cost and reveals the complementary bound. Historical-generation allocations owe the full original cost. The public action number, allocation/ack flags, commitments, full-budget movements, generation, timing, stable-reference equality and the refund receipt?s association with its note remain observable. Allocation rotates C for the current book; old-generation allocation leaves the new book untouched. A report's private amount is not the public retained budget.

Original borrower/issuer authorization and single-allocation markers prevent arbitrary debt credit. The policy credits fungible current debt, including another purchase's debt when the original purchase was already repaid. Private refund openings belong only in authorized encrypted records, not explorer/tool/status responses. Tests check different positive remainder amounts and full-cost reserve conservation; independent proof-provider and complete-history analysis remain open.

## Merchant Linkability Boundary

1. **Quote Phase:** A merchant posts $Q$ using the exact encoding in [PROTOCOL.md](PROTOCOL.md). `QuoteMeta` has no `merchantPk`, but merchant authentication discloses its pseudonym through public queries. Field omission alone is insufficient for unlinkability.
2. **Draw Phase:** When an agent accepts quote $Q$, it constructs draw note $D = \text{persistentCommit}(\text{DrawNotePreimage}, \text{noteSalt})$. The preimage privately binds `merchantPk` without writing `merchantPk` into `NoteMeta`.
3. **Linkage Vector:** `draw` explicitly discloses the merchant witness for its public allowlist lookup. Quote consumption and note creation in the same transition provide another correlation path. Inspect public call arguments/transcripts as well as final ledger metadata; the merchant is not unlinkable in the current implementation.
4. **Redemption Phase:** Only the holder of `merchantSk` corresponding to the committed `merchantPk` can satisfy `redeemDraw`. Merchant B cannot redeem Merchant A's note.

---

## Machine-Checked Verification

The test suite in `src/lib/line/leakage.test.ts` validates:
1. Public ledger serialization contains no `limit`, `outstanding`, `capacity`, or private keys.
2. Reserve deltas and note metadata accurately match transaction amounts.
3. Merchant pseudonyms and quote linkages operate within documented boundaries.
4. Public tool response projections omit plaintext books and secrets. These tests do not prove privacy against transcripts or full histories.

## Local checkout custody and remaining requirements

The `/checkout` server executes generated Compact with fresh distinct role keys. Its agent HTTP capability cannot read issuer books, fund, open or acknowledge. Public/agent snapshots omit books and service outputs. The issuer response intentionally contains its private book.

All secrets still belong to one Node process and the evaluator's browser receives both issuer and agent capabilities. This is evaluation capability separation, **not independent production custody**. Capabilities remain in React memory. After 30 minutes, new purchases are disabled; exact retries, status reads and issuer reconciliation can continue, and sessions with unresolved obligations remain retained. Default storage is volatile. Optional encrypted checkpoints preserve all role secrets/books/order results on disk and recover server restarts, creating an additional password/OS-custody boundary. Browser reload/navigation still drops capabilities/IDs. Neither encrypted storage nor authenticated checkpoints provide device-loss backup or rollback detection. No ZK proofs or asset transfers are performed. [Checkout storage limits](CHECKOUT_DURABILITY_2026-10-10.md), [separate console journal limits](OPERATION_RECOVERY_2026-10-10.md).

Private witnesses are not necessarily hidden from the executing process, remote proof provider, logs or transport. Invoice text/results and note openings require authenticated private transport and retention controls. Never claim client-side proving without confirming the selected proof configuration.

Closing the full requirement needs a specified observer model and supported Compact design, tested against fields, complete transcripts, amounts, attribution, history, timing and proof-provider access. It must retain exact accounting, ownership and the twelve-circuit interface. The explorer omitting books does not remove public protocol disclosure.
