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
src/routes/                Issuer / merchant / agent / explorer desks
mcp/line-mcp.mjs           Thin agent tool
docs/                      PLAN, PROGRESS, HANDOFF, PITCH, AGENTS
```

## Tests

```bash
npx --yes node --experimental-strip-types --test src/lib/line/protocol.test.ts
```

The suite covers forged issuer, fake repay, stale `C`, double-draw inclusion, quote auth, replay, and defaulted status.

## Demo

Open the app, click **Run scripted demo**:

1. Open line (150 private)
2. Quote 40
3. Draw 40
4. Replay fails
5. Draw 120 fails (generic copy)
6. Issuer acknowledges 40
7. Draw 120 succeeds
8. Status → defaulted

## License

Apache-2.0. Tag GitHub topics `midnightntwrk` and `compact`.
