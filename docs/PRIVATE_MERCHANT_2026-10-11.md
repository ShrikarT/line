# Private merchant membership experiment — 11 October 2026

The signed private-finance candidate commits amounts and reserve books, but its `postQuote` and `draw` query transcripts still contain the selected merchant identifier. A public catalog can turn that identifier into a price inference. This experiment removes that particular lookup while retaining all twelve circuits, issuer registry authority, merchant-authenticated quotes and merchant-bound claims. It does not establish full-history privacy, independent institutional custody, network execution or payments.

## Construction and compatibility

`contracts/experimental/line-private-merchant.compact` uses two supported `MerkleTree<20, Bytes<32>>` ledgers. A public issuer-controlled registry assigns each merchant a fixed index. The registered tree retains permanent membership; the enabled tree has a leaf only while new offers are allowed. Registration updates both; disabling clears only the enabled leaf using `insertIndexDefault`. The registry, indices and membership changes remain public.

`postQuote` privately derives the authenticated merchant key, checks that its enabled path has that leaf, and verifies the **current** enabled root. `draw` privately proves the quote's merchant is in the current permanent registered tree. It still checks the exact buyer, generation, amount, expiry, fee policy and quote commitment. A disabled merchant cannot post a new quote, but its existing claims retain their rights. Old registered roots and another merchant's leaf cannot substitute for the selected path.

Draws also avoid repeating the selected facility expiry in a kernel query. Instead the private circuit proves `noteExpiry <= book.expiry`; the public quote/note deadline still enforces `now < noteExpiry`. Together these imply the facility is unexpired. This restricts newly drawn claims to the facility's term, unlike the prior candidate that allowed a longer claim deadline. The public note deadline remains observable and establishes a lower bound on the facility term; it can equal that term. Opening still publishes a facility expiry, so no overall deadline-anonymity claim follows. Existing notes keep their redemption rights.

These APIs compile with pinned Compact **0.31.1 / runtime 0.16.0**. The source includes the cancellation approval change and has its own instance-domain tag. Its ABI and trees differ from the deployed canonical contract; no migration is implicit. Current source SHA-256: `afb75b1bf6156500e63e75fb2d7a69bc002bf84daf15736c4aa2fbd99cb9a4b7`. [Pre-deadline-change evidence](private-signed-2026-10-11-evidence/pre-deadline-merchant-feasibility.json) belongs to `16016824`; [pre-acknowledgment-change evidence](private-signed-2026-10-11-evidence/pre-cover-merchant-feasibility.json) belongs to `72956ce1`. Both are retained separately. The [pre-uniform cancellation snapshot](private-signed-2026-10-11-evidence/pre-uniform-merchant-feasibility.json) belongs to `ccb44b47`. Current cancellation prepares typed witnesses/commitments uniformly and requires the exact repayment commitment even for a zero-obligation acknowledgment.

## Refund lifecycle disclosure

The predecessor allowed refund reporting only when cash was owed. Its public mode-2 action therefore revealed a condition on debt-first allocation even though the amounts and metadata were committed. For a known same-generation note, cash compensation implies allocation cleared the current debt. This is a concrete lifecycle disclosure under that side information, not a claim that every observer can attribute every note.

This candidate permits an issuer-authenticated **zero-obligation acknowledgment** after a no-cash allocation. It must report amount zero, preserves every financial hold, rotates the private state commitment, records a unique reference and rejects replay. Real cash obligations still require their exact committed positive amount and move the full original hold from `U` to `X`. A zero-obligation acknowledgment is bookkeeping, not a receipt for money. Canonical accounting and deployed code are unchanged.

The generated control forks one reachable state into two histories: repayment 100 leaves debt 448 after allocation and no cash obligation; repayment 600 leaves debt zero and cash compensation 52. Both execute repayment, expiry, allocation and acknowledgment. Their acknowledgment inputs and outputs are exactly equal, and the cash amount word is absent from those public views. Commitments/transcripts, proofs, network metadata and complete history distributions are **not** established equivalent. This tests a specific disclosure path, not full observer privacy.

Clients must actually schedule acknowledgments consistently for both cases; the current runtime does not implement that scheduling policy. Asset-rail events could distinguish the cases too. No full-history pass follows from merely permitting the zero-obligation action.

## Verification boundary

The fresh generated fixture passes **39 accepted calls and 55 rejection controls**, exercising both merchants and all twelve names. It checks that neither merchant identifier appears in accepted quote/draw/redemption inputs, outputs or operation transcripts, and that a distinct private facility expiry is not repeated in a draw. It checks stale enabled and registered roots, wrong leaves, an unregistered offer, unauthorized registration/disable, duplicate registration, revocation, redemption of an existing disabled-merchant claim, and a quote whose claim would outlive its facility. An isolated last-second draw accepts; the exact note-deadline cutoff rejects. Zero-obligation acknowledgment authority, amount zero, unchanged financial holds and replay are checked; cash cases reject zero and incorrect amounts. Private reserve/note/quote encodings and exact lifecycle accounting retain the signed-finance checks. [Source-bound generated evidence](private-signed-2026-10-11-evidence/merchant-feasibility.json).

Generated execution is not proof generation. All twelve fresh proving/verifier key pairs and binary IRs are complete for source `afb75b1`; [the source-bound manifest](private-signed-2026-10-11-evidence/merchant-key-generation.json) fingerprints every artifact and records no key cache. The first real run verified twelve contract calls (eleven normal and one isolated last-second draw), plus synthetic deployment, and rejected two corrupted draws before a later draw exceeded the configured 600-second proof request deadline. [Sanitized partial evidence](private-signed-2026-10-11-evidence/merchant-partial-proof.json) retains this incomplete result; no OOM or contract failure is established. A retry recycles the owned prover after every accepted call and remains incomplete. The isolated last-second draw, no-cash compensation/acknowledgment and alternate repayment history do not advance the normal lifecycle. The fixture uses six same-host signer children, synthetic approval policy and a trusted financial coordinator. It has no durable custody, network finality, authentic settlement or validated customer. The base signed-finance source now passes 38 real contract proofs across all twelve names, including all five normal cancellation transitions, with five corrupted-draw rejections after uniform preparation. Those proofs do not cover this separate merchant source. Full native coverage of this derivative, including cancellation and the alternate repayment history, remains pending.

The merchant proof driver now receives all accepted branches through the fixture hook before private checkpoints are published. An isolated proof must start from a previously native-verified public ledger snapshot; its result is verified separately and does not advance the normal lifecycle. A complete run requires 39 lifecycle calls, seven isolated branch calls and six rejected corrupted draw proofs. This is an implemented verification path, not a passing result. All twelve merchant textual IRs differ from the base candidate, so this source requires twelve fresh key pairs rather than that candidate's exact-IR cache.

## Remaining privacy work

The [observer model and acceptance cases](PRIVACY_OBSERVER_MODEL_2026-10-11.md) distinguish public readers, each merchant, borrowers, the trusted coordinator, relayers and settlement operators. It defines which facts must remain fixed across a valid comparison and the arithmetic limits of confidentiality when all debits and a zero baseline are already known.

The public registry reveals the candidate merchant population. One eligible merchant, a unique price or deadline, public sender/fee-payer metadata, recognizable request timing or participant knowledge can still identify a purchase. Quote-to-draw and note lifecycle linkage also remain. Changing a lookup does not solve these inferences. A complete observer model and counterfactual histories must account for all allowed disclosures and side information; relaying, standardized windows, batching or cover traffic must be evaluated where needed.

The current-root enabled tree provides revocation, while permanent registration preserves existing claim eligibility. Registration invalidates old paths; clients need path rebasing and durable concurrency/recovery. The tree has finite capacity. These operational requirements remain acceptance work.

## Reproduction

```bash
npm run merchant:spike
git diff --exit-code contracts/line.compact contracts/managed/
```

The command compiles fresh into a new ignored directory and writes source-bound evidence there. `--compiled-dir` is diagnostic only and is explicitly marked cached. CI runs fresh generated execution. Neither mode submits a transaction, funds a wallet, changes canonical bindings or asserts a complete privacy pass.

After building the native verifier, compiling this source with full key generation into a separate directory, and running a fresh merchant fixture, the planned native verification command is:

```bash
npm run proof:merchant -- <full-merchant-managed-dir> --compiled-check <fresh-merchant-fixture-managed-dir> --recycle-prover --recycle-each-call
```

It exclusively owns its labeled loopback prover and refuses an existing server. It fingerprints source, generated executable, all proving artifacts and harness scripts. Real proofs still use synthetic ledger/time with fee balancing disabled; they establish no network submission, asset settlement or complete privacy guarantee.
