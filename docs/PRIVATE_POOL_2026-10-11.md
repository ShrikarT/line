# Private-book pool experiment — 11 October 2026

**Result: generated execution passes; eight real contract calls across five circuit names verify; full-history privacy fails and the real pool lifecycle remains incomplete.** This is an isolated architecture experiment. The canonical `contracts/line.compact`, its managed bindings, checkout and deployed state have not migrated.

## What the compiled candidate establishes

[`contracts/experimental/line-pool.compact`](../contracts/experimental/line-pool.compact) compiles with Compact 0.31.1, language 0.23.0 and runtime 0.16.0. It retains exactly the twelve exported circuit names; `openLine` has an experimental two-phase ABI. Source SHA-256: `cea2dcddbc49ea0c09301020891d298179517ba99ad8b516fa441a5d423f99b8`. This hash identifies source bytes; protocol commitments use Compact `persistentCommit`/`persistentHash`.

The public pool stores salted book commitments, a common historic Merkle root and spent-book nullifiers. The private book includes domain, identity, limit, debt, epoch, generation, expiry, pricing and status. An agent prepares consent over the exact new book, predecessor and terms; the issuer accepts it without the agent signing key. Quotes bind the buyer as well as merchant, generation, price and fees. Every book update proves membership and consumes its old nullifier; another borrower cannot put that quote into its own book.

The latest [generated-execution evidence](pool-2026-10-11-evidence/generated.json) records **39 accepted operations across all twelve circuits and 44 rejected controls**, using six processes with locally generated signing keys: issuer, two agents, Merchant A, Merchant B and attacker. The coordinator receives no signing secret through IPC, but handles private book openings and salts. Same-host administration remains trusted; independent institutional custody and durable actor-owned storage are not established.

The two synthetic enrollments are not evidence of two independently accountable borrower organizations or an enterprise fleet's shared borrower exposure. Those legal and aggregate-delegation requirements remain open.

Public scalar words are normalized through the pinned `Bytes<32>` decoder before structural absence checks, so trimmed trailing zeros cannot hide a disclosed identity/leaf/salt from the test. A fresh pinned compile and generated run passed all 39 operations and 44 controls after this change. These checks remain falsification tools, not a privacy proof.

Checks include altered consent/identity/fees/terms; wrong signing roles; forged limit/path; competing quotes spending the same old book; quote theft and replay; over-limit draw; wrong merchant and repeated redemption; stable repayment-reference replay; default/resume; zero-debt closure; reopening; exact expiry cutoff; debt/cash compensation; old-generation compensation preserving new debt; refund reports; merchant disable with outstanding-claim redemption; reserve overflow and locked-backing withdrawal. Final synthetic accounting is `T=187`, `R=45`, `X=15`, with `E=P=F=U=0`. These are counters, not deposits or paid claims.

## Privacy findings that the experiment does not fix

1. **Known-zero singleton debt is still reconstructed.** In a separate generated world containing only one borrower, public principal 15 plus public fee 1 reveals debt 16. Global pool membership and blinding do not hide that arithmetic.
2. **Historic-root choice can reduce the anonymity population.** After two borrower enrollments, the first borrower can choose the publicly recognizable earlier root containing just one borrower. That draw is accepted. A current-population claim would therefore be misleading. Current-root serialization or another reviewed construction is needed, with concurrency/recovery tests.
3. **Selected input identity, old leaf and salt are not redisclosed in the inspected draw query/input/output.** This narrower structural result is not privacy certification. All inserted commitments are still public pool leaves; a proven transaction may legitimately contain pool-state commitments.
4. **Pricing, facility/note deadlines, lifecycle/compensation bounds, merchant disclosure, sender/payer/prover and timing metadata remain relevant.** More agents under one organization do not create independent borrowers. No arbitrary population threshold makes the target pass.

The owner has now authorized redesign of public note amounts and reserve deltas. The [next-version design](PRIVACY_REDESIGN_2026-10-11.md) changes that former constraint while preserving exact accounting and all twelve roles. It is a design, not a compiled implementation or proof. Historic public debt remains exposed and cannot be erased by migration.

## Real proofs: partial evidence and observed failures

Full proving and verifying artifacts were generated for every experimental circuit. Artifact generation alone is not successful proof execution. The separate proof harness uses fresh role-local keys, supported HTTP proving and the proof-enabled native Rust ledger 8.1.3 verifier, explicitly in real proof mode. Synthetic deployment disables fee balancing and uses no wallet, network submission or asset rail.

- A first run using a common trusted loopback prover verified synthetic deployment, merchant registration, funding, both borrowers' agent preparation and issuer acceptance, and the first merchant quote. Its first draw request aborted at the 300-second HTTP deadline. **No pool draw was verified in that run.** The common prover received different roles' private inputs, so it did not establish independent proving custody.
- A second run used separately addressed role provers with two configured Rayon threads each. Its saved [partial checkpoint](pool-2026-10-11-evidence/partial-isolated-proof.json) records synthetic deployment, registration, funding and one agent-prepared opening verified by native Rust. The issuer acceptance request then aborted at the 600-second HTTP deadline. Idle agent-prover cache used approximately 1.56 GiB while the active issuer prover used approximately 831 MiB, on an 8 GiB host with other ongoing work. These observations explain a resource concern; they are not an isolated latency benchmark or proof of the sole failure cause.
- A subsequent sequential, ephemeral-role run verified **eight contract calls across five circuit names**: registration, funding, both agent preparations and issuer acceptances, Merchant A's quote and Agent A's draw. Synthetic deployment is a ninth trace, separately counted. Rust rejected a decodable corruption of that draw proof; two wrong-role opening controls and an issuer draw also rejected before proving. The [saved checkpoint](pool-2026-10-11-evidence/partial-ephemeral-proof.json) remains `complete:false`. The run ended on a Docker stop subprocess timeout after the first draw; final cleanup removed the experiment's provers. Merchant B's quote/draw, repayment and closure were not proved in this run. This improves proven custody/membership coverage but is not a passed core lifecycle or reliable performance benchmark.
- A generated-compilation attempt also encountered a WSL VM startup timeout under resource pressure; a later run passed. The local harness now supports sequential, ephemeral role provers to discard completed roles' caches, and writes a checkpoint after every verified application. Failed attempts remain findings, not passes.

A subsequent attempt stopped before proving when its fresh WSL compilation returned status `4294967295`. The harness now offers an explicit `--compiled-check PATH` option: it verifies a previously successful generated-execution snapshot's source hash, compiler/runtime, executable and metadata fingerprints, then compares those artifacts byte-for-byte with the full compiled release. It does not silently skip provenance or substitute a mock contract. Default execution still freshly compiles. This avoids repeating WSL startup during a proof run when the exact source has already compiled and been tested; the report records which check was used.

The intended real pool core check covers seven circuit names, not all twelve; only five completed in the latest run. It must verify both draw proofs and reject their decodable corruptions, then finish repayment and closure before reporting core success. `disableMerchant`, both withdrawal circuits, `redeemDraw` and `cancelOrExpireNote` need additional real pool proof coverage. The separate [canonical proof experiment](LOCAL_PROOF_VERIFICATION_2026-10-11.md) covers all twelve canonical circuits; its results must not be transferred to this different source or these verifier keys.

## Reproduction

```sh
npm run pool:spike
npm run pool:spike -- --full-compile
npm run proof:native:build
# Use the managed directory from that full compile's evidence output:
npm run proof:pool -- .compact-keys/pool-spike-REPLACE/managed --isolated-provers --ephemeral-provers
# Optional: reuse the source-bound managed output of a successful pool:spike
# instead of starting another fresh compiler process:
# append --compiled-check .compact-keys/pool-spike-CHECKED/managed
# Clean up only the experiment's labeled role provers after requests have ended:
node scripts/private-pool-provers.mjs stop
```

Role endpoints are loopback ports 6301–6305, image `midnightntwrk/proof-server:8.1.3`. The helper checks ownership labels, image and bindings before managing a container. It does not manage the user's existing service on port 6300. Same-host administration is trusted and each prover receives its role's private preimages. Artifacts, private state and proving scratch stay in ignored `.compact-keys/`; published evidence contains no signing keys or private transcripts.

## Gates still open

No canonical custody integration, private fleet runtime, legal borrower, approved creditor/capital source, fee-funded network finality, authentic service-to-payout settlement, full-history privacy or customer demand is established. The accepted initial customer hypothesis is enterprise teams buying APIs/compute through agents; there are no contacts, interviews or pilots. Preserve all eighteen product requirements. The next technical decision is who can privately prove the reserve opening without sharing borrower/role secrets or revealing pool balances to unauthorized parties; the next commercial action is consented discovery with a real budget owner and supplier.
