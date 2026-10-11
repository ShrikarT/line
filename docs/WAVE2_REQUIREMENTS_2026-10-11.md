# Wave 2 requirements and submission readiness — 11 October 2026

This is a source review, not organizer confirmation, an eligibility determination or a predicted score. The technical audit remains [AUDIT_UPDATE_2026-10-11.md](AUDIT_UPDATE_2026-10-11.md). Observed public metadata is fingerprinted in [wave2-public-metadata.json](private-signed-2026-10-11-evidence/wave2-public-metadata.json); full third-party documents are not republished.

## Deadline conflict requires written clarification

| Official source | Wave 2 build cutoff shown | Observation |
|---|---|---|
| [Live AKINDO public event API](https://api.akindo.io/public/wave-hacks/jaMZjqPOBsLXvjdG), also confirmed by its public waves endpoint | 19 October 2026, 15:00:34 UTC; 20:30:34 IST | Active wave `nPmLlGnMksMAqZBN`, started 29 September; judgment cutoff 26 October at the same UTC time; completion is null |
| [Midnight overview](https://midnight.network/hackathon/buildathon) and event description schedule | 17 October 2026 | Static schedule differs from the active wave timestamps |
| [Linked official rules PDF](https://drive.google.com/file/d/1YKXtsw5nghcEBEW0BFrLn-U34AfH_MF4/view?usp=sharing), pages 1–3 | 3 October 2026 | PDF table instead starts Wave 2 on 13 September and judges through 13 October |

The PDF points entrants to this exact AKINDO event and sets the submission deadline by the applicable build period. It also contains an earlier schedule and internally inconsistent contest-period dates. Page 8 reserves specified modification powers and says rule amendments require an authorized written document. No authorized schedule amendment was obtained in this review. This does **not** establish that Wave 2 has closed, that the live API overrides the PDF, or that the entrant can safely wait until October 19. Ask the organizer to confirm the applicable cutoff/timezone and provide the controlling amendment. Prepare the submission immediately; use October 17 as a conservative engineering freeze target relative to the two future public dates, without claiming that it resolves the already-past PDF cutoff.

## Judging weights and conflicting linked document

The current event API, event description and official PDF pages 3–4 agree:

| Area | Weight | Best evidence Line can add |
|---|---:|---|
| Engineering | 40% | Clean Compact compilation, exact source/key provenance, reproducible native verification, clear architecture and scoped privacy claims |
| QA and reliability | 15% | Negative authorization/replay/expiry controls, restart-safe checkout demonstration, published failures and limits |
| Product and vision | 15% | One concrete enterprise agent task, accountable borrower and supplier roles, a realistic next milestone |
| UX and design | 15% | Show the agent request, two merchant deliveries, generic decline, repayment and safe retry; identify simulator versus network paths |
| Communication | 10% | A concise deck and narrated video showing the problem, behavior, Midnight contribution and Wave 2 delta |
| Business | 5% | Evidence from prospective buyers and suppliers; presently a customer hypothesis, not traction |

The event also links a [judging document](https://docs.google.com/document/d/1-dDTqWa2CcfnSEvgXq83La2M8zAxi4jtVtKpMJRm3Oo/edit?usp=sharing) allocating 20 points each to product leadership and backend, and 15 each to UX, QA, communication and business. Its version/date and normalization of the individual subcriteria were not established. Do not silently substitute those weights or fabricate a total score. Request clarification; meanwhile address all six areas. The PDF describes proportional grants by judged points, so a strong balanced submission matters more than an unsupported claim of guaranteed first place.

## Required artifacts and current evidence

| Requirement from event/rules | Current review status | Action |
|---|---|---|
| At least one compiling Compact contract | Canonical source and experiments compile with the pinned toolchain; compilation is an explicit technical eligibility gate | Freeze a source revision and make clean reproduction straightforward |
| Public source, Apache 2.0 for submitted Midnight work | Public GitHub repository and recognized Apache 2.0 license verified | Confirm the exact submitted dependency/code scope and retain attribution |
| Midnight GitHub label/topic | `midnightntwrk` topic verified | Preserve it on the submitted repository |
| Repository, slide deck and video demo/pitch by cutoff | Repository exists; no final deck/video identified in this checkout, and external artifacts were not verified | Prepare and link all three in the entry |
| Individual registration for each identified team member; at most five members | Not verified | Entrant checks registration and team details personally |
| Original work within the permitted contest period | Visible earliest main commit is dated 14 September; commit dates do not prove when work began | Entrant verifies provenance and resolves the PDF/event wording on pre-existing work |
| Submitted version fixed at cutoff | No submitted revision verified | Pin commit, release fingerprints, demo URL/video and reproduction instructions |
| Personal entry by entrant/team | No submission performed | Entrant submits manually; automated entry is prohibited by the rules |
| Requested live presentation/interview | No request verified | Be prepared to reproduce the demonstration and explain its limits |

The PDF has both strict restrictions on work predating August 5 and provisions mentioning pre-existing code or functional extensions. The event summary permits material new Midnight work. These differences are not a basis to certify eligibility from Git history alone. No participant age, residency, sanctions status or registration is inferred.

## Submission priorities

1. Resolve the deadline and controlling rules with the organizer. Finish the deck/video and exact revision package now; do not wait for speculative production completeness.
2. Demonstrate one bounded task: an enterprise agent buys APIs/compute from two independent suppliers against organization-approved credit. Explain why private credit is needed beyond a prepaid policy wallet; customer validation may overturn this hypothesis.
3. Separate the execution paths: generated local checkout, owner-reported canonical Preprod receipts, canonical native proofs, complete base/merchant/enrollment native reports, the six-call durable-agent native subset, and the newer private-offer source with 65 native-verified calls and eight corrupted-proof rejections. None establishes live payouts or full-history privacy; each report pins a different scope and exact source/harness.
4. Show the known privacy failure and the concrete redesign. Cryptographic validity is proven for specific sources; observer indistinguishability, sender/timing/amount side channels, durable independent custody and uniform scheduling are still open.
5. Add buyer/supplier interviews and one measurable next acceptance criterion. No customers, pilots or supplier commitments have been established, and no outreach is authorized in this work.

The internal Wave 2 privacy-demo gate remains unmet. That gate is a project acceptance condition, distinct from the event's minimum compiling-contract requirement. Existing proof counts and passing tests are engineering evidence, not a guarantee of judging success.
