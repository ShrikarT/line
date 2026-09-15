# Line

**Private revolving credit authorization for autonomous agents.**

An issuer opens a confidential credit line. An agent proves that an invoice fits remaining capacity. A merchant receives an issuer-backed, non-replayable draw authorization. An issuer-confirmed repayment restores capacity.

Wave 1 of the [Midnight Buildathon](https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG).

## Honest Wave 1 limitation

A successful draw is an **authorization**, not a token payout. The merchant is not automatically paid on-chain. Simulated settlement is an issuer acknowledgement. Asset movement is Wave 2.

This is **not production-ready**. It is **not** deployed to Midnight Preprod. Runtime is **local/simulator**.

## What is real vs simulated

| Layer | Status |
|---|---|
| Compact contract `contracts/line.compact` | Real Compact 0.26 source. Compiles with toolchain **0.34.0**. |
| Generated bindings `contracts/managed/line` | Compiler output (`--skip-zk`). No proving keys. |
| Compact simulator tests | Execute the generated `Contract` via `@midnight-ntwrk/compact-runtime` **0.19.0**. |
| TypeScript reference engine | Replica of Compact encodings (same `persistentHash` / `persistentCommit`). Drives the UI and MCP. |
| UI | Local simulator desks. Not a Midnight node. |
| MCP | Functional local JSON-RPC tools against the same engine. Not network discovery. |
| On-chain settlement | **Not implemented.** |

## Privacy map

**Private**

- Exact limit `L`, outstanding `B`, quote amount `A`
- Agent secret, salts, quote preimage, repayment receipt details
- Merchant identity as a name (only a sealed public key is on the instance)

**Public**

- Identity commitment `I`, line commitment `C`, status, quote commitments `Q`
- Quote used/expiry metadata, nullifiers, `actionClock` state-transition counter, `lineGeneration`
- Sealed issuer public key (`line:issuer:pk`), merchant public key (`line:merchant:pk`), contract domain

Line does **not** hide that a public state transition happened, or when.

Failed draws always surface: **Clearance could not be proven.** They do not leak whether the cause was balance, limit, default, identity, or anything else.

## Trust assumptions

- The Compact compiler and `compact-runtime` implement `persistentHash` / `persistentCommit` as documented.
- Issuer and merchant authorization is **DApp-scoped hash-based** with domain separation (`issuerPk = persistentHash([pad(32,"line:issuer:pk"), sk])`, `merchantPk = persistentHash([pad(32,"line:merchant:pk"), sk])`), preventing cross-role key reuse.
- The constructor accepts public keys `(issuerPk, merchantPk)` directly so deployers do not need private signing secrets.
- Wave 1 has one issuer, one merchant, one live line per contract instance.
- Demo secrets are deterministic and **not** production keys.
- Timing and existence of public transitions leak. This is not full unlinkability.

## Threat model (Wave 1)

In scope: forged issuer/merchant, cross-role key substitution, agent self-repay, stale `C`, cross-generation quote replay, quote expiry, over-limit, wrong agent, tampered quote preimage, receipt reuse, closed/defaulted draws, overflow/zero amounts.

Out of scope: metadata analysis of `C → C′` timing, trusted setup / proving-key compromise, economic slashing, cross-contract composition, network-level deanonymization.

## State commitment

```
C = persistentCommit<LinePreimage>({ identity: I, limit: L, outstanding: B, epoch }, salt)
```

This is Compact's documented commitment primitive. The salt is the opening. Equivalent role to `H(domainState, I, L, B, epoch, salt)` with the type providing domain separation.

Every balance-changing circuit proves knowledge of a preimage that opens the current public `C`, then writes `C′` with a fresh salt and `epoch + 1`. Only `acknowledgeRepayment` (issuer) may decrease `B`.

## Quote commitment and generation isolation

```
Q = persistentHash([
  pad(32, "line:quote"),
  merchantPk, invoiceId, encodeU64(A), encodeU64(expiry), nonce, encodeU64(generation), contractDomain
])
```

- `encodeU64` is Compact's `n as Bytes<32>` (little-endian, 32-byte buffer).
- `quoteCommit` is an 8-element vector binding `generation`.
- `postQuote` requires `status == Status.OPEN`.
- `draw` verifies `meta.lineGeneration == lineGeneration`, preventing quotes from an earlier line generation from being drawn against a reopened line.
- Expiry is measured against `actionClock: Counter`, which counts contract state transitions. It does not measure wall-clock or block timestamp.

## Nullifiers

```
N_draw  = persistentHash([pad(32,"line:draw"), agentSecret, Q, contractDomain])
N_repay = persistentHash([pad(32,"line:repay"), receiptNonce, I, currentC, encodeU64(R), paymentRef, contractDomain])
```

## Status transitions and generations

| From | `setStatus` to OPEN | DEFAULTED | CLOSED | `openLine` |
|---|---|---|---|---|
| NONE | no | no | no | yes (generation 1, epoch 0) |
| OPEN | yes (idempotent) | yes | yes | no |
| DEFAULTED | yes | yes | yes | no |
| CLOSED | no | no | no | yes (generation `gen + 1`, epoch 0) |

`CLOSED` is terminal for `setStatus`. Reopening is a **new line generation** via `openLine` (fresh `C0`, epoch 0, `lineGeneration + 1`), not a resurrection of the old commitment. Quotes from previous generations cannot be drawn against the reopened line. DEFAULTED may return to OPEN without rotating `C` or advancing generation; draws stay blocked until returned to OPEN.

## Circuits

| Circuit | Caller | Effect |
|---|---|---|
| `openLine` | Issuer | `C0` with `B = 0`, status OPEN |
| `postQuote` | Merchant | Opaque `Q` |
| `draw` | Agent | Prove `B+A ≤ L`, rotate `C`, spend `N_draw` |
| `acknowledgeRepayment` | Issuer | Only way `B` decreases |
| `setStatus` | Issuer | OPEN / DEFAULTED / CLOSED |

Five circuits. No on-chain `canPay`. No agent-initiated repay.

## Repository structure

```
contracts/line.compact          Compact source of truth
contracts/managed/line/         Compiler output (skip-zk, no proving keys)
src/lib/line/encoding.ts        compact-runtime persistentHash / persistentCommit
src/lib/line/protocol.ts        TypeScript reference engine (replica, not the protocol)
src/lib/line/compact.test.ts    Compact simulator tests
src/lib/line/protocol.test.ts   Reference-engine tests
src/pages/                      Issuer / merchant / agent / explorer / lab
src/App.tsx                     Standalone SPA router
mcp/line-mcp.mjs                Local MCP tools (status, draw, seed)
docs/                           Plan, pitch, encoding, roadmap, handoff
```

## Versions

| Tool | Version |
|---|---|
| Compact toolchain | 0.34.0 |
| Compact language | 0.26.0 |
| `@midnight-ntwrk/compact-runtime` | 0.19.0 |
| Ledger (compiler) | 9.1.0.0-rc.3 |
| Node | 22 |

## Install

```bash
npm install
bash scripts/install-compact.sh    # compact toolchain 0.34.0 on PATH
```

## Commands

```bash
npm run compact:compile    # compact compile --skip-zk contracts/line.compact contracts/managed/line
npm run compact:test       # generated Contract via compact-runtime
npm test                   # reference engine + Compact simulator + MCP
npm run test:line          # Line tests only
npm run typecheck
npm run build
npm run dev                # desks on :5173 (local simulator)
npm run mcp                # MCP stdio server
```

## Demo (11 snapshots, each circuit actually runs)

Private `L = 150`. Use **Next demo step**.

0. Genesis
1. Issuer `openLine`
2. Explorer shows `I` / `C` / status — not 150
3. Merchant posts opaque 40
4. Agent draws 40; `C` rotates
5. Replay of the same invoice **runs and fails**
6. Quote 120; draw **runs and fails** (`40 + 120 > 150`)
7. Issuer `acknowledgeRepayment(40)`; `C` rotates
8. Fresh 120 succeeds
9. Issuer `setStatus(DEFAULTED)`
10. Further draw **runs and fails**

## MCP

Functional local tools against `.line-mcp-state.json`:

- `line.status` — public snapshot only
- `line.draw` — same engine as the desks; generic failure string
- `line.seed` — load a demo snapshot

Not a Midnight network transport.

## Deployment

**Local/simulator deployment.** The Compact contract is not deployed to Midnight Preprod. No contract address, no transaction hash.

Frontend: `npm run build` then `npm run preview`. `vercel.json` rewrites SPA routes. This is the web desks, not the contract.

## License

Apache License 2.0. See [LICENSE](LICENSE).

GitHub topics: `midnightntwrk`, `compact`, `privacy`, `typescript`, `zero-knowledge`.
