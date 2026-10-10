# Line Wave 2 demonstration

Updated: 9 October 2026. This guide separates the executable local checkout from contract/reference-model tests and the required production acceptance. It does not certify a live deployment or token payout. Product requirements remain in [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md).

## Start the executable procurement evaluation

```bash
npm run dev
```

Open `http://localhost:5173/checkout`. Alternatively use `npm run build` followed by `npm run preview` and open the preview server's `/checkout` route. A static host of `dist/` alone has no checkout API: the development/preview middleware provides the local evaluation endpoints.

The evaluation executes the compiler-generated Compact contract in a local simulator, with random independent issuer/agent/Merchant A/Merchant B secrets inside one server process. A deterministic policy agent buys a document analysis from A and processing estimate from B through HTTP. This is a useful integration of contract execution and service results; it does not generate/submit ZK proofs, confirm a public-network transaction or transfer tokens.

Issuer and agent API bearer capabilities are separate. The operator's evaluation browser receives both to drive the demonstration. All keys/books remain in the same process; this is not independent production custody or a sandbox for an untrusted agent. New purchases close 30 minutes after session creation; expired sessions with unresolved obligations retain local state and consume capacity, and there is no operator recovery UI if the browser loses its capability/IDs. Storage is volatile unless both encrypted checkpoint variables are configured; configured sessions recover server restart. Portable backup, rollback detection and external merchant/payment recovery remain required. [Configuration and limits](CHECKOUT_DURABILITY_2026-10-10.md).

## Browser demonstration script

1. Keep the default **40-unit limit** and **200-unit accounting reserve**. Choose **Open evaluation line**. This runs `fundReserve` and `openLine`; no deposit or cash movement occurs. The issuer panel shows the authorized private book.
2. Supply a document and choose **Run agent purchase plan**. A quotes **25 evaluation units**, the generated draw/redemption succeeds, and the text-analysis result appears. B quotes **20 units**; with debt 25 and limit 40, its draw fails with **"Clearance could not be proven."**
3. Review actual quote/note references and receipt stages. Delivered A reports `service-delivered`; declined B has no claim note. Payout is **not connected**. The local ledger shows redeemed claim accounting, not bank or token payment.
4. In the issuer panel, acknowledge **25 units** using **Issuer: acknowledge evaluation repayment**. This is simulated repayment reconciliation, not an actual payment or receipt from a rail. Capacity resets; reserve accounting does not replenish.
5. Keep the document unchanged and choose **Retry declined purchase**. The planner preserves A's delivered order ID, so A's stored result returns without another draw, redemption or delivery. B receives a fresh logical attempt ID and succeeds for 20 units after the acknowledgment. Both results now complete the same task; private debt is 20, accounting redeemed reserve is 45, and delivered-service count is 2.
6. Review both deterministic local results. The second result's token estimate is an explicitly disclosed heuristic, not a vendor bill or accurate tokenizer output. To demonstrate both purchases without a repayment step, start a new evaluation with a limit of at least 45 units and sufficient reserve.
7. Review the public-ledger panel. It omits plaintext private books but exposes amounts/reserve history that can reveal debt. Do not describe the complete history as anonymous or zero-leakage.

A new task generates fresh purchase IDs. An uncertain HTTP response retains the same plan IDs while the page remains open; the server stage journal resumes completed stages without another debit. Reusing an ID for changed terms rejects. A confirmed decline remains the same result for that ID after repayment. Retrying the unchanged task preserves delivered IDs and creates a fresh attempt only for declined services. A completed task's new plan creates new purchases. Configured encrypted checkpoints preserve this server state through restart; the volatile default does not. Browser reload loses its handles in either mode.

## API behavior and role checks

The evaluation API lives under `/api/checkout`:

| Operation | Capability and effect |
|---|---|
| `GET /catalog` | Local service catalog, price and description |
| `POST /sessions` | Operator creates local session; receives issuer and agent tokens |
| `POST /sessions/:id/issuer/configure` | Issuer token; sets initial limit/reserve once |
| `POST /sessions/:id/issuer/acknowledge` | Issuer token; evaluates repayment with stable reference |
| `POST /sessions/:id/agent/purchase` | Agent token; catalog service, document and stable `requestId` |
| `GET /sessions/:id/issuer` | Issuer token; authorized private book and public accounting |
| `GET /sessions/:id/agent` or `/public` | Agent token; public evaluation state without private books |

Never paste bearer tokens into a deck, URL, public logs or screenshot. Public-view here describes payload content; the evaluation endpoint still requires a session capability. Verify wrong-role requests return authorization failure and do not mutate the ledger. Generated Compact rejects exact stable payment-reference reuse within its issuer/domain across later book transitions. This proves reference replay prevention only; it does not verify cash or prevent reuse across unrelated facilities/identities.

## Contract and legacy fixture evidence

`src/lib/line/compact.test.ts` exercises generated circuits. `src/dev/demo.ts` and `src/lib/line/demo.test.ts` exercise a scripted TypeScript reference-model lifecycle with known fixture keys and 500/150/40/120 test-unit amounts. `/lab` is an attack/simulator view. These are development artifacts; fixture snapshots are not live ZK proofs, bank transfers or real merchant integrations.

```bash
npm run compact:test
npm test
npm run test:e2e
```

Only report actual command results from the current release. Tests must check real API capability separation, replay/duplicate delivery, concurrent purchases, changed request terms, insufficient capacity, and restart/timeout behavior. Scripted state transitions alone do not verify independent custody, durable payout or full privacy. [The audit](FULL_AUDIT_2026-10-07.md) identifies gaps and reproductions.

## Evidence still required for complete product readiness

Retain the full requirements: independently operated merchants, separate role custody, supported network execution with finalized receipts, actual funded settlement, full-history privacy, post-redemption dispute handling, verified cash refunds, global/partial payment allocation, safe live finality, durable private state and crash recovery, fleet policy/exposure, credit/default economics and actual buyer/merchant validation. [The roadmap](ROADMAP.md) orders this work; a demonstration does not waive it.

For a network/payout pitch, attach exact source/version manifest, deployment address, finalized successful transaction IDs, independently decoded state and separate asset-payment receipts. Use [PITCH.md](PITCH.md)'s evidence checklist and an accurate prior-wave delta. Do not submit a snapshot or local counter transition as that evidence.
