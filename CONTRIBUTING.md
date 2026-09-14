# Contributing

Line is a Midnight Buildathon project. Compact is the source of truth.

1. Read `docs/HANDOFF.md` and `docs/ENCODING.md`.
2. Change `contracts/line.compact` first for protocol behavior.
3. Compile: `npm run compact:compile` (requires Compact 0.34.0).
4. Update `src/lib/line/encoding.ts` only if the Compact types/tags changed.
5. Keep Compact simulator tests and reference-engine tests in lockstep.
6. Do not add an on-chain `canPay` circuit or agent-initiated repay.
7. Do not claim settlement, production readiness, or unlinkability of timing.

```bash
npm install
bash scripts/install-compact.sh
npm run compact:compile
npm run compact:test
npm run test:line
npm run mcp:test
npm run typecheck
npm run build
```

License: Apache-2.0. All original Compact and TypeScript in this repository is covered.
