# Line UI redesign — 14 October 2026

The owner's subsequent visual feedback is addressed in the [product interface revision](UI_REVISION_2026-10-15.md), finalized on 16 October. This document records the earlier design and verification snapshot.

## Scope and design

The full web interface is updated in `feat/line-ui-redesign`, based on `6c8fc67`, in the isolated `line-audit-review` checkout. Final review continued on 15 October 2026. The original checkout's pending UI work is preserved. Website deployment is not part of this change.

The original logo files, warm cream, navy, coral and blush palette, and bundled Manrope font are retained. The redesign uses a consistent editorial grid, restrained borders, clearer type hierarchy, a desktop workspace sidebar, accessible mobile navigation, role-specific introductions, readable accounting panels and service results. It retains the existing transaction state machines and server behavior.

References supplied by the owner and visually inspected during design:

- [Stock & Foil](https://stock-and-foil.vercel.app/): aligned editorial columns, spacious typography, framed artwork and contrasting section bands.
- [Arkemis](https://arkemis.space/): product previews, composed cards and smooth interaction.
- [Mascofast](https://mascofast.com/): textured landscape atmosphere, translated into Line's existing colors.

No reference site's copy or artwork is reproduced. Relevant guidance: landing-page-design, shadcn, Anime.js, imagegen and React best practices. The primitives use Radix semantics for tabs, accordion and the mobile sheet. Motion respects reduced-motion preferences and uses IntersectionObserver with cleanup.

## Generated asset

`public/artwork/line-landscape.png` is an original background generated with the built-in image generation tool, then copied into the project. It is decorative, with empty alt text; all product content is real HTML. Original generation source: `01a1147f-6031-7873-86fe-f5b4aa3c979c/exec-59b0108f-94cb-4628-8e33-6b4599bd2c38.png`.

Prompt direction: premium editorial wide 3:1 abstract folded-paper terraces and branching paths; ivory `#faf2e7`, navy `#1e3a6e`, coral `#f47457`, small blush `#f8b0c6`; quiet ivory center for a product card; tactile halftone/risograph texture; no text, logos, UI, coins or glow. The Line logo itself was not regenerated or edited.

## Interface coverage

| Surface | Changes |
|---|---|
| Home | Editorial hero, textured product stage, interactive role preview, three-role explanation, statement band, explicit privacy boundary, dated network evidence, FAQ and final CTA |
| Shared shell | Persistent desktop navigation, mobile sheet, runtime control, role introductions, footer, focus states, route titles |
| Live Preprod | Progress strip, document field, merchant service cards, private credit meter, summarized results, readable confirmed-call list, retained reconciliation controls |
| Local checkout | Scenario cards, shared workflow and service components, private credit meter, summarized result regions; original authorization/decline/retry behavior retained |
| Issuer | Grouped reserve and lifecycle controls, coherent form and stats spacing, readable public observer panel |
| Agent | Private-book view, clear quote/note empty states and import actions, responsive public ledger panel |
| Merchant | Wrapping merchant selector, quote and claim sections, consistent inbox presentation |
| Explorer | Responsive reserve metrics, separated commitments and informative empty states; no private book added |
| Circuits | Search and role filters, twelve expandable references, empty-result recovery; stale descriptive copy corrected |
| Attack lab | Contrasting dark surface, grouped controls and explicit local-model scope |
| Roadmap | Six expandable gates, evidence summaries and honest status labels |
| Privacy | Working destination for privacy links, explicit public/private inventory and settlement/demo boundaries |
| Unknown routes | Branded not-found page with a route back home |

## Verification record

The automated review in `e2e/ui-review.spec.ts` captures all twelve routes at 1440px and 390px, checks horizontal bounds and runtime errors, and exercises keyboard tabs, the FAQ, mobile navigation, circuit filters and empty-result recovery. Additional scenarios expand all six roadmap gates and twelve circuit references, purchase both local services, expand their response, and populate the issuer and agent consoles with a quote and draw. `e2e/ui-overlays.spec.ts` checks mobile network setup, vault management and quote/note imports. Preprod responses are mocked for these UI tests; no funded transaction is submitted by this redesign verification.

Screenshots are stored under `artifacts/ui-redesign/`. Browser-extension control was unavailable during the resumed review, so the repository's automated Chromium tests supply the rendered artifacts for visual inspection.

The first pass found a hidden-result accessible label and contrast problems in the dark lab reserve panel, both corrected. Vault action contrast and mobile merchant selectors were also improved. The issuer button now says "Register vault merchant", accurately describing the existing action. Initial browser runs encountered cold-load timeouts; expanded-state test preparation was corrected to wait for hydration and register the merchant before posting its quote.

| Check | Result and scope |
|---|---|
| Core regression | 560 tests / 60 suites: 559 passed, zero failures, one intentional compiled-owner skip. Exact `npm test` inventory with `--test-concurrency=4`; 156.9 seconds |
| Production build | Final `npm run build` passed, including TypeScript checking. Vite bundling completed in 57.48 seconds |
| Browser regression | Full 28-case run passed; both subsequently added UI scenarios passed together. Eight relevant existing scenarios also passed during the intervening focused review. These are 30 unique passing scenarios across runs, not a single 30-case run |
| Responsive visual review | 35 PNGs: all twelve routes at desktop/mobile, expanded reference sections, populated consoles/results and mobile setup/import surfaces. Inspected for alignment, hierarchy, wrapping, clipping, contrast and empty/populated states |
| Compact artifact check | `npm run compact:check`: 16 files match pinned compiler 0.31.1; zero generated drift |
| Preserved invariants | `git diff --exit-code -- contracts/line.compact contracts/managed public/brand` passes. Canonical source, bindings and original logo files are unchanged |
| Production key and secret checks | Both scanners pass; key check covers 59 production-graph modules |
| Patch formatting | `git diff --check` passes |
| Current native backend | Read-only check: HTTP 200, phase ready, 22 receipts, not busy, no pending operation or error. No transaction submitted during redesign verification |

## Completion against the design request

| Requirement | Evidence |
|---|---|
| Update the entire UI | Shared shell and all eleven real routes plus the unknown-route fallback are included in the route matrix above; setup, vault and transfer forms retain the shared design |
| Keep the theme, logo and Line identity | Original brand files have zero diff; cream/navy/coral/blush tokens and bundled typeface remain, with improved muted-text contrast |
| Stock & Foil alignment and editorial direction | Shared max-width grid, split section headings, consistent columns, generous spacing, framed hero and contrasting statement band; desktop/mobile homepage captures |
| Arkemis product components and smooth interaction | Interactive role preview, shared service/result cards, credit meter, accessible tabs/accordions/mobile sheet and section reveals; interaction tests and populated captures |
| Mascofast background inspiration | Original textured landscape in the retained Line palette; separate decorative image with real HTML product content above it |
| Check every section after implementation | Route-wide screenshots, all twelve circuit/six roadmap expansions, populated role/checkout states, overlays, keyboard navigation and original behavioral regressions |

The final review confirms listener/observer cleanup, reduced-motion handling, semantic accordion/tab/sheet primitives, named controls and service-result regions, and preserved transaction handlers. It does not certify unrelated financial or protocol requirements. Independent custody, full-history privacy, token settlement and customer validation remain outside this UI change.

Existing SDK build warnings remain: browser externalization of `assert`, an undefined `isomorphic-ws` WebSocket export and a large JavaScript chunk (1,122.61 kB; 288.85 kB gzip). They are not reported as fixed by this redesign. Browser regression uses the development server; this change does not newly certify built-preview wallet/network operation or a public deployment.

## Review locally

Open **http://127.0.0.1:5174/** while the existing development server is running. The isolated checkout is `C:\Users\Shrikar\line-audit-review`; start it with `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort` if needed. `/preprod` uses the existing local native backend; `/checkout` is the fast generated-Compact demo. Public hosting remains deferred.
