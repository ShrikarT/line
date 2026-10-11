# Private merchant membership experiment — 11 October 2026

The signed private-finance candidate commits amounts and reserve books, but its `postQuote` and `draw` query transcripts still contain the selected merchant identifier. A public catalog can turn that identifier into a price inference. This experiment removes that particular lookup while retaining all twelve circuits, issuer registry authority, merchant-authenticated quotes and merchant-bound claims. It does not establish full-history privacy, independent institutional custody, network execution or payments.

## Construction and compatibility

`contracts/experimental/line-private-merchant.compact` uses two supported `MerkleTree<20, Bytes<32>>` ledgers. A public issuer-controlled registry assigns each merchant a fixed index. The registered tree retains permanent membership; the enabled tree has a leaf only while new offers are allowed. Registration updates both; disabling clears only the enabled leaf using `insertIndexDefault`. The registry, indices and membership changes remain public.

`postQuote` privately derives the authenticated merchant key, checks that its enabled path has that leaf, and verifies the **current** enabled root. `draw` privately proves the quote's merchant is in the current permanent registered tree. It still checks the exact buyer, generation, amount, expiry, fee policy and quote commitment. A disabled merchant cannot post a new quote, but its existing claims retain their rights. Old registered roots and another merchant's leaf cannot substitute for the selected path.

These APIs compile with pinned Compact **0.31.1 / runtime 0.16.0**. The source includes the cancellation approval fix and has its own instance-domain tag. Its ABI and trees differ from the deployed canonical contract; no migration is implicit. Source SHA-256: `1601682473abccaaa9eb3790434f1673ded41d34e22c057688bca687e04c4b6e`.

## Verification boundary

The fresh generated fixture passes **38 accepted calls and 48 rejection controls**, exercising both merchants and all twelve names. It checks that neither merchant identifier appears in accepted quote/draw inputs, outputs or operation transcripts. It checks stale enabled and registered roots, wrong leaves, an unregistered offer, unauthorized registration/disable, duplicate registration, revocation and redemption of an existing disabled-merchant claim. Private reserve/note/quote encodings and exact lifecycle accounting retain the signed-finance checks. [Source-bound generated evidence](private-signed-2026-10-11-evidence/merchant-feasibility.json).

Generated execution is not proof generation. No proving keys or native proof pass for this source are claimed here. The fixture uses six same-host signer children, synthetic approval policy and a trusted financial coordinator. It has no durable custody, network finality, authentic settlement or validated customer.

## Remaining privacy work

The public registry reveals the candidate merchant population. One eligible merchant, a unique price or deadline, public sender/fee-payer metadata, recognizable request timing or participant knowledge can still identify a purchase. Quote-to-draw and note lifecycle linkage also remain. Changing a lookup does not solve these inferences. A complete observer model and counterfactual histories must account for all allowed disclosures and side information; relaying, standardized windows, batching or cover traffic must be evaluated where needed.

The current-root enabled tree provides revocation, while permanent registration preserves existing claim eligibility. Registration invalidates old paths; clients need path rebasing and durable concurrency/recovery. The tree has finite capacity. These operational requirements remain acceptance work.

## Reproduction

```bash
npm run merchant:spike
git diff --exit-code contracts/line.compact contracts/managed/
```

The command compiles fresh into a new ignored directory and writes source-bound evidence there. `--compiled-dir` is diagnostic only and is explicitly marked cached. CI runs fresh generated execution. Neither mode submits a transaction, funds a wallet, changes canonical bindings or asserts a complete privacy pass.
