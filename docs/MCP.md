# Model Context Protocol (MCP) Integration Guide

## Overview

Line exposes a standard Model Context Protocol (MCP) interface over JSON-RPC (stdin/stdout).
This allows autonomous AI agents (running in Claude, Gemini, or custom orchestrators) to programmatically evaluate purchase quotes, verify credit availability, execute draws, and track settlement claims.

---

## Server Commands

| Command | Purpose |
|---|---|
| `npm run mcp` | Production MCP server connected to configured `MidnightNetworkRuntime` or active environment |
| `npm run mcp:dev` | Local development MCP server running against local state adapter |
| `npm run mcp:test` | Automated integration test suite for MCP tools |

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
Autonomous agent tool to evaluate an open quote, verify credit capacity, and submit a zero-knowledge draw.
- **Input:**
  - `quoteId` (string, required): The quote commitment $Q$ to draw against.
- **Output:** Draw note commitment $D$, rotated line commitment $C'$, and transaction confirmation.
- **Error Response:** If over-limit or invalid: `"Clearance could not be proven."`

### 5. `line.note.status`
Inspects public redemption and expiry status of an issued settlement note.
- **Input:**
  - `noteCommitment` (string, optional): The draw note commitment $D$.
- **Output:** Array of note statuses (`amount`, `redeemed`, `cancelled`, `expiry`, `lineGeneration`).

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
- **Output:** Rotated commitment $C'$ reflecting reduced outstanding balance.

### 8. `line.seed`
Developer tool to load a deterministic snapshot from the 19-step lifecycle demo.
- **Input:**
  - `step` (number, required): Lifecycle step index (0–18).
- **Output:** Updated local ledger state.
