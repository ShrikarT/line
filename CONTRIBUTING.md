# Contributing to Line

Line provides private credit and checkout infrastructure for autonomous agents. Compact is the source of truth.

## Development Workflow

1. Read `docs/PRODUCT_ARCHITECTURE.md`, `docs/PROTOCOL.md`, and `docs/PRIVACY.md`.
2. Modify `contracts/line.compact` first for protocol changes.
3. Compile contract bindings: `npm run compact:compile`.
4. Verify zero drift: `git diff --exit-code contracts/managed/`.
5. Update `src/lib/line/encoding.ts` and runtime adapters.
6. Ensure all test suites pass: `npm test`.

```bash
npm ci
npm run compact:compile
npm run compact:test
npm test
npm run typecheck
npm run build
```

## Protocol Principles

- Compact circuits in `contracts/line.compact` are the canonical source of truth.
- Credit limits ($L$) and balances ($B$) remain confidential in agent witnesses.
- Never claim live token movement or external settlement unless backed by on-chain transactions.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
