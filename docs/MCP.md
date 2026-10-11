# Model Context Protocol (MCP) Integration Guide

## Overview

Line exposes a standard Model Context Protocol (MCP) interface over JSON-RPC (stdin/stdout).
This allows autonomous AI agents (running in Claude, Gemini, or custom orchestrators) to programmatically evaluate purchase quotes, verify credit availability, execute local model draws, and track settlement claims. The current MCP server does not produce or submit Midnight proofs.

---

## Server Commands

| Command | Purpose |
|---|---|
| `npm run mcp` | Local JSON-RPC simulator; does not connect to a Midnight deployment |
| `npm run mcp:dev` | Same local simulator entry point |
| `npm run mcp:test` | Automated integration test suite for MCP tools |

The current server includes development fixture seeding and issuer privileges and may store plaintext private development state. It is not an independently scoped production agent payment tool. New state files require `deadlineUnits: "unix-seconds"`; old/unlabelled action-count state rejects. `line.seed` explicitly replaces a development snapshot with a fresh matching one. It is not a migration of a live credit book. Deadlines use local Unix time; `actionClock` is ordering only. [Expiry evidence](EXPIRY_2026-10-10.md).

---

## Available MCP Tools

### 1. `line.status`
Returns the public ledger snapshot. Never returns private credit books ($L, B$).
- **Input:** `{}`
- **Output:** `contractDomain`, `status`, `actionClock`, `lineGeneration`, `lineCommitment`, `totalReserve`, `encumberedReserve`, `redeemedReserve`, `withdrawableReserve`.

### 2. `line.reserve.status`
Returns real-time reserve accounting breakdown.
- **Input:** `{}`
- **Output:** `totalReserve`, `encumberedReserve`, `redeemedReserve`, `withdrawableReserve`, `contractDomain`.

### 3. `line.quote`
Merchant tool to post a private quote commitment for an invoice.
- **Input:**
  - `amount` (number, required): Invoice amount in credit units.
  - `invoiceId` (string, required): Merchant invoice identifier.
  - `merchantSecret` (string, optional): Merchant private key (defaults to active session).
- **Output:** Opaque quote hash $Q$ and quote metadata.

### 4. `line.draw`
Autonomous agent tool to evaluate an open quote, verify credit capacity, and execute a local reference-model draw.
- **Input:**
  - `quoteId` (string, required): The quote commitment $Q$ to draw against.
  - `fee` (number, optional): If supplied, must equal the exact issuer-approved fee. Omission computes `feeFlat + ceil(amount * feeBps / 10000)`.
- **Output:** Draw note commitment $D$, rotated line commitment $C'$, and transaction confirmation.
- **Error Response:** If over-limit or invalid: `"Clearance could not be proven."`

### 5. `line.note.status`
Inspects public redemption and expiry status of an issued settlement note.
- **Input:**
  - `noteCommitment` (string, optional): The draw note commitment $D$.
- **Output:** Array of public note statuses including principal, original fee, deadline/generation, redemption/expiry, compensation flags, refund commitment and note-bound refund payment nullifier. Private cash remainder and note openings are omitted.

### 6. `line.redeem`
Merchant tool to prove note ownership in zero-knowledge and redeem against issuer reserve.
- **Input:**
  - `noteCommitment` (string, required): Draw note commitment $D$.
  - `merchantSecret` (string, optional): Merchant private key.
- **Output:** Confirmation of redemption and updated reserve balances.

### 7. `line.repay`
Issuer tool to acknowledge off-chain repayment and restore revolving capacity.
- **Input:**
  - `amount` (number, required): Repayment amount in credit units.
  - `paymentRef` (string, optional): Exact simulated event reference. Omission uses the one-use development reference `mcp-repay`.
- **Output:** Rotated commitment $C'$ reflecting reduced outstanding balance.

### 8. `line.seed`
Developer tool to load a deterministic snapshot from the 19-step lifecycle demo.
- **Input:**
  - `step` (number, required): Lifecycle step index (0–18).
  - `feeFlat`, `feeBps` (integers, optional, default 0): Issuer pricing for this development fixture, with basis points from 0 to 10000. This privileged fixture tool is not production borrower authority.
- **Output:** Updated local ledger state.

New state files also require `feePolicy: "flat-plus-ceil-bps-v1"` and valid public `feeFlat`/`feeBps`. Missing legacy pricing rejects until an explicit development `line.seed` reset; the server cannot relabel old commitments as new policy-bound quotes. Public status includes the pricing policy. Fees are accounting charges, not collected revenue or token payouts.


### 9. `line.expireNote`
Permissionless local expiry of an unredeemed claim into a **full-cost locked compensation budget**, with no private debt change. Input: `{noteCommitment}`. This is action 0 of the existing cancelOrExpireNote circuit, modeled locally.

### 10. `line.withdrawFees`
Issuer development authority withdraws fees earned at merchant claim redemption; pending fees/refund budgets remain locked. No token movement occurs.

### 11. `line.disableMerchant`
Issuer development authority blocks new merchant quoting while preserving existing claim rights. Input identifies the merchant public key.

### 12. `line.compensate`
Issuer development authority allocates expired unredeemed cost once against authentic current debt, or commits the full owed cash for an older generation. Input: `{noteCommitment}`. The development file retains the private refund opening; public results show only commitment/lifecycle fields. No actual cash refund occurs.

### 13. `line.refund.acknowledge`
Input: `{noteCommitment, paymentRef}`. Issuer development authority proves the exact positive private cash remainder and records its report. The stable payment reference cannot be reused as repayment or for another refund. The note records its exact payment nullifier for attribution; a globally spent reference alone does not identify a note's refund. Original full-cost backing moves into reportedRefundReserve and stays locked.

Current development state requires `compensationPolicy: "private-refund-full-cost-lock-v1"`, all six reserve counters, private refund storage, and valid note-bound receipt metadata. Incompatible state rejects until explicit `line.seed` reset; this is not migration of live commitments. MCP still exposes issuer fixture tools and plaintext development state, so it is not the production agent tool surface. [Compensation evidence and remaining scope](COMPENSATION_2026-10-10.md).
