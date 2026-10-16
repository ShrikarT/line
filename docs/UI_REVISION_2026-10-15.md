# Line product interface revision — 15 October 2026

This revision follows the owner's feedback that the first redesign still felt basic. Its fixed baseline is `2317068` on `feat/line-ui-redesign`. The original Line logo and cream, navy, coral and blush colors remain authoritative.

## Reference and design decisions

The live [Arkemis site](https://arkemis.space/) was rendered in Chromium and inspected at the hero, interactive product demo and feature sections. The useful details are its oversized type, distinct hero object, layered product surfaces, working demonstration and feature illustrations. Line translates these into a credit card and merchant receipt, a three-role purchase playground, and policy/proof/claim illustrations. No Arkemis code, brand graphics, copy or screenshots are shipped as Line product assets. The original Stock & Foil grid/alignment direction remains in the shared container and section columns.

The first version's landscape-backed generic preview and large icon tiles are replaced. The new hero illustration is responsive HTML/CSS with the unchanged logo. Its test units and illustrative status are explicit. Cream remains the page canvas; navy is reserved for the credit object, product playground, private book and application navigation. Coral and blush identify claims and policy accents.

## Actual skill and component application

- **shadcn:** searched the configured component registry, installed Command, Dialog, Tooltip and Button using the CLI, and composed a keyboard workspace search. Existing Radix Tabs, Accordion and Sheet remain the accessible interaction foundations. Local `cn` imports and Line theme tokens are used. The command dialog's title/description live inside its content so they are absent when closed.
- **Anime.js:** the purchase preview uses a timed quote → proof → redemption sequence, replay, staggered role transitions and effect cleanup. Existing section reveals remain. Reduced-motion mode omits movement and shortens the preview sequence.
- **Landing-page design:** product-first hierarchy, one clear live-checkout CTA, responsive section rhythm, real dated evidence and explicit demo boundaries. Product drawings illustrate behavior instead of substituting icons for content.
- **React best practices:** separated illustration/preview components, local presentation state, stable keys, effect cleanup, semantic controls, and no change to signing, wallet or transaction handlers. The homepage preview is verified to make no POST request.

## Coverage

| Surface | Revision |
|---|---|
| Hero | Centered display typography, layered credit card/receipt, restrained orbit/dot texture, entry motion, visible live-checkout action |
| Product walkthrough | Interactive issuer/agent/merchant tabs; purchase progression, remaining allowance, replay and clear illustrative scope |
| Features | Distinct policy, proof and merchant-claim illustrations; shared card proportions and aligned copy |
| Privacy | Private-book illustration paired with public observation timeline; inference limitation remains visible |
| Evidence, FAQ and footer | Transaction counter and event rows, numbered accordion, larger final CTA and quieter footer |
| App navigation | Compact navy sidebar, current-route state, mobile sheet, searchable Command dialog and Ctrl/Command K shortcut |
| Checkout and Preprod | Navy private book, aligned service amounts, revised progress segments, cleaner evidence and result surfaces |
| Issuer, agent and merchant | Operational headings, refined shared panels and vault treatment; existing controls and permissions retained |
| Circuits and roadmap | Contained reference rows, active filters, evidence overview and distinct expandable roadmap gates |
| Explorer, lab, privacy and 404 | Shared revised shell and panels; dark-lab contrast and mobile bounds checked |

## Verification

Final verification continued on 16 October. The 40 captures under `artifacts/ui-revision/rendered/` cover all twelve routes at 1440px and 390px, expanded circuit/roadmap sections, populated checkout/role states, vault/import forms, the preview and command palette. Each route was visually inspected at both sizes. Reference captures stay local and are not product assets.

The first full browser run passed 31 of 32 cases. The remaining failure was an ambiguous legacy selector matching both the new explorer heading and the existing `Public ledger` panel label. It now targets the exact panel label. Visual review also corrected a doubled vault border, uneven service-price baselines, dark-lab border contrast and shell-inserted Unicode replacement characters.

The final focused run passed 15 of 16 cases, including the corrected navigation case. Its one failure was Chromium `ERR_NO_BUFFER_SPACE` before the circuit page loaded; an isolated rerun of that case passed. All 32 unique browser cases therefore have passing evidence across these runs; this is not a claim of a single clean 32-case run. The new preview test confirms replay, every participant tab, mobile bounds and zero POST requests. The command-palette test covers search, empty results, keyboard selection, navigation and Escape dismissal.

An additional full-speed replay check caught premature timeline completion while its zero-duration callbacks were being assembled. The preview now constructs the timeline with autoplay disabled and starts it only after adding all three stages. Both new browser cases pass after this correction (14.5 seconds), with the purchase case exercising reduced-motion playback and normal-speed replay.

## Completion matrix

| Requested outcome | Current evidence |
|---|---|
| Entire interface, not only the homepage | All twelve routes, shared shell, populated checkout/consoles and mobile setup/import surfaces are rendered and checked |
| Preserve theme and logo | Original brand files and palette are retained; canonical logo files have zero diff |
| Stock & Foil alignment | Shared content bounds, consistent section columns, oversized typography, clear spacing and aligned service prices |
| Arkemis product components and movement | Layered credit sculpture, functional purchase preview, distinct product illustrations, animated role changes and keyboard workspace search |
| Mascofast-inspired atmosphere | Subtle dot/orbit textures and original brand-colored background bands; the earlier landscape asset remains available, while the hero now prioritizes the product object |
| Apply relevant design/component skills | CLI-installed shadcn primitives, Anime.js timelines, landing-page hierarchy and React lifecycle review are documented above |
| Check every section | Desktop/phone route matrix, all circuit/roadmap expansions, populated results, preview states, FAQ, navigation and import/setup forms |

`npm run build` passes, including TypeScript checking. Existing SDK `assert` externalization, `isomorphic-ws` export and large-chunk warnings remain, along with plugin timing information. This is not a new certification of built-preview wallet/network operation. Both scanners pass (65 production modules in the fixture-key scan). The pinned Compact artifact check reports zero drift across 16 files. Patch formatting and unchanged canonical source, managed output, original brand, server and script checks pass.

The read-only native status check initially timed out at 15 seconds. A later bounded check succeeded: phase ready, 22 receipts, no busy/pending operation and no error. No new transaction was submitted.

The complete `npm test` inventory, run with `--test-concurrency=4`, passes: **560 tests / 60 suites, 559 passed, zero failed, one intentional compiled-owner skip**, in 144.9 seconds.

The implementation retains exactly the existing canonical contract and managed output. These UI checks use mocked Preprod responses and generated local Compact operations; they submit no new funded transaction and establish no additional token-settlement or historical-privacy capability.

## Local review

Open **http://127.0.0.1:5174/**. The working checkout is `C:\Users\Shrikar\line-audit-review`, branch `feat/line-ui-redesign`. The original `line` checkout's pending user changes are preserved. Public deployment remains deferred.
