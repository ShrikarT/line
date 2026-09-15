# Wave 2 Progress Tracking

- **Branch:** `feat/wave-2-private-settlement`
- **Starting Point:** PR #2 merged at `ed45ca4`, tagged `wave1-final`.
- **Wave 1 Preserved At:** `contracts/v1/line.compact`
- **Wave 2 Contract:** `contracts/line.compact` and `contracts/v2/line.compact`

## Wave 2 Checklist

- [x] Initial repository inspection & PR #1, PR #2 merge verification
- [x] Created & pushed `wave1-final` tag (`ed45ca4`)
- [x] Preserved Wave 1 contract at `contracts/v1/line.compact`
- [x] Created `docs/WAVE2_PLAN.md` with complete Wave 2 architecture
- [x] Contract-instance domain separation with `instanceNonce`
- [x] Compact contract: merchant registry & reserve accounting
- [x] Compact contract: merchant-bound draw notes (`DrawNotePreimage`, `D`)
- [x] Compact contract: one-time note redemption (`redeemDraw`, `N_redeem`)
- [x] Compact contract: safe unencumbered reserve withdrawal & note cancellation
- [x] Recompile Compact contract with toolchain 0.34.0 & verify ZKIR
- [x] TypeScript replica & encodings update (`encoding.ts`, `types.ts`, `protocol.ts`)
- [x] Compact simulator tests (`compact.test.ts` with 39 tests across 11 suites)
- [x] Cross-language encoding vectors (`encoding.test.ts`)
- [x] Reference engine tests (`protocol.test.ts` with 31 tests)
- [x] Deterministic property / model tests (`src/lib/line/model.test.ts`)
- [x] 19-step scripted demo (`demo.ts` & `demo.test.ts`)
- [x] Multi-merchant UI desk & updated Explorer & Attack Lab
- [x] Wave 2 MCP server tools & tests (`mcp/line-mcp.mjs`, `mcp/line-mcp.test.mjs`)
- [x] Security review (`docs/WAVE2_SECURITY_REVIEW.md`)
- [x] Documentation updates (`README.md`, `docs/WAVE2_DEMO.md`, `docs/WAVE2_DEPLOYMENT.md`, `HANDOFF.md`, etc.)
- [x] CI workflow update (`ci.yml` supporting `feat/**` and drift check)
- [ ] Push branch & open Pull Request for Wave 2
