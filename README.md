# Line

**Private revolving credit for autonomous agents.**

An agent proves a purchase fits an issuer-backed line. The chain never sees score, limit, balance, or counterparty.

Wave 1 of the [Midnight Buildathon](https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG): a merchant receives an **issuer-backed, non-replayable draw authorization**. Simulated settlement is at the issuer desk. Asset movement is Wave 2.

## Honest privacy

Line hides amounts, limits, balances, and counterparties. It does **not** hide that a given line commitment changed at a time.

## Circuits

| Circuit | Caller | Effect |
|---|---|---|
| `openLine` | Issuer | `C0 = H(I, L, 0, e0, s)` |
| `postQuote` | Merchant | Opaque `Q` |
| `draw` | Agent | `B+A ≤ L`, rotate `C`, spend nullifier |
| `acknowledgeRepayment` | Issuer | Only way `B` decreases |
| `setStatus` | Issuer | `open / defaulted / closed` |

Agents cannot repay themselves. That would be free credit.

## Repo

```
contracts/line.compact     Circuit spec (Compact)
src/lib/line/              Executable reference + tests
src/routes/                Desks, attack lab, circuits, roadmap
mcp/line-mcp.mjs           Thin agent tool
docs/                      PLAN, ROADMAP, PROGRESS, HANDOFF, PITCH, AGENTS
```

## Tests

```bash
node --experimental-strip-types --test src/lib/line/protocol.test.ts src/lib/line/demo.test.ts
```

Forged issuer, fake repay, stale C, double-draw, quote auth, replay, expiry, closed, overflow.

## Demo

Use **Next demo step** (not a dump of the final ledger). Attack lab tries replay, fake repay, over-limit, stale C, wrong agent.

Read [docs/ROADMAP.md](docs/ROADMAP.md) for Wave 2 (escrow, notes, unlinkability) and Wave 3 (network).

## License

Apache-2.0. Tag GitHub topics `midnightntwrk` and `compact`.
