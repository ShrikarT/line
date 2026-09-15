# Agent Handoff (Wave 2)

Read this before touching Line.

## Product Context

Line is **private revolving credit and settlement authorization for autonomous agents**.
It is not a wallet spend-cap and not an unbacked IOU. An issuer underwrites confidential credit and deposits liquidity into a reserve pool. An agent proves in zero-knowledge that an invoice fits remaining capacity and that reserve backing exists. A merchant receives an issuer-backed, non-replayable private draw note redeemable once against the reserve pool. An issuer-confirmed repayment restores capacity privately.

## Non-Negotiables

1. **Compact is the source of truth**: `contracts/line.compact` is the protocol. The TypeScript engine is a strict replica of Compact encodings via `@midnight-ntwrk/compact-runtime`, not a parallel SHA-256 scheme.
2. **Honest settlement scope**: Wave 2 implements the exact Compact settlement accounting model (reserve pools, private draw notes, redemption nullifiers). Do not claim live token payouts (Night/Dust) or a live Midnight Preprod deployment.
3. **Multi-merchant isolation**: Support multiple merchants via `registeredMerchants: Map<Bytes<32>, Boolean>`. Notes are bound to the specific merchant's public key; Merchant B cannot redeem Merchant A's notes.
4. **Reserve solvency**: Total reserve must always back all encumbered and redeemed claims: $\text{encumberedReserve} + \text{redeemedReserve} \le \text{totalReserve}$. Draws assert $\text{withdrawable} \ge A$.
5. **Anti-rug protection**: An issuer can only withdraw unencumbered reserve funds. Active draw notes are strictly protected against issuer withdrawal.
6. **One-time redemption**: Draw notes can be redeemed at most once using $N_{\text{redeem}} = \text{persistentHash}([\text{pad}(32, \text{"line:v2:redeem"}), sk_{\text{merchant}}, D, \text{domain}])$. Double redemption must fail.
7. **Instance domain separation**: The constructor takes `(issuerPk, initialMerchantPk, instanceNonce: Bytes<32>)` creating unique `contractDomain`.
8. **Private failure string**: Failed circuits write nothing to public storage. Any failed draw surfaces: `"Clearance could not be proven."`
9. **Private books**: Limits $L$, balances $B$, invoice amounts $A$, and merchant identities remain hidden. Only commitments ($I, C, Q, D$), reserve totals, and nullifiers are public.
10. **10 Circuits only**: `registerMerchant`, `fundReserve`, `withdrawUnencumberedReserve`, `openLine`, `postQuote`, `draw`, `redeemDraw`, `cancelOrExpireNote`, `acknowledgeRepayment`, `setStatus`.

## File Map

| Path | Purpose |
|---|---|
| `contracts/line.compact` | Protocol source of truth (Compact 0.26) |
| `contracts/v1/line.compact` | Preserved Wave 1 contract |
| `contracts/managed/line` | Generated Compact artifacts (`--skip-zk`) |
| `src/lib/line/encoding.ts` | compact-runtime encodings and commitments |
| `src/lib/line/protocol.ts` | Reference engine (replica for UI / MCP) |
| `src/lib/line/compact.test.ts` | Compact simulator tests (39 tests across 11 suites) |
| `src/lib/line/protocol.test.ts` | Reference engine unit tests (31 tests across 10 suites) |
| `src/lib/line/model.test.ts` | Deterministic state machine invariant model tester |
| `src/lib/line/demo.ts` | 19-step scripted demo flow and state snapshots |
| `mcp/line-mcp.mjs` | Local MCP server exposing 8 tools for autonomous agents |
| `docs/WAVE2_PLAN.md` | Architecture and technical specification |
| `docs/WAVE2_SECURITY_REVIEW.md` | Threat model, invariants, and test matrix |
| `docs/WAVE2_DEMO.md` | Narrative walkthrough of all 19 demo steps |
| `docs/WAVE2_DEPLOYMENT.md` | Local simulator vs testnet requirements and proving policy |

## Toolchain & Commands

Compact toolchain `0.34.0`, language `0.26.0`, runtime `0.19.0`, Node `>= 22`.

```bash
npm run compact:compile    # compile Compact contract
npm run compact:test       # run Compact simulator tests
npm test                   # run complete test suite (92 tests)
npm run typecheck          # TypeScript check
npm run build              # build frontend
npm run dev                # launch interactive desks on :5173
npm run mcp                # run local MCP server
```
