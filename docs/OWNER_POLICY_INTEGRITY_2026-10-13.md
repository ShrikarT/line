# Owner policy module integrity

The owner CLI previously checked its policy module against the current profile, while the encrypted signer store bound only `authorize.toString()`. That is insufficient to detect changes to helpers or constants outside the function. A profile updated to match changed module bytes could reopen an existing bound identity even when the policy now authorizes more.

The adversarial reproduction uses two actual imported modules with identical authorization function text. Only their outer amount constant changes from 20 to 100; a 30-unit request changes from denied to allowed. The encrypted store now additionally persists an optional exact `policyModuleSha256` alongside the function fingerprint and typed configuration. The CLI supplies its already verified full module hash. Changed or omitted pins reject when reopening a bound store, without rewriting its encrypted contents; unchanged pins preserve identity and exact approvals.

The CLI process test separately changes its outer amount limit and updates the profile hash after a successful approval/restart. The next process exits before service readiness. Existing tests still verify the original public identity and exact saved approval across an unchanged restart.

## Compatibility and limits

- Existing function-only library fixtures retain their existing behavior. They have no module-integrity guarantee.
- Existing bound CLI stores created before this change cannot silently acquire the new pin. Reopening through the new CLI rejects. There is no migration command; do not delete or recreate an identity to bypass this check. Preserve its encrypted store, approvals and public identity for a separately reviewed owner-controlled migration.
- `--identity` creates an unbound identity; its first policy binding remains the owner's explicit setup step. A bound store is checked even in identity mode.
- This is a top-level source pin, **not a transitive dependency attestation**. Imported code, runtime versions, external reads, mutable globals and in-memory behavior are not captured by this hash. A direct library caller supplies the fingerprint; the signer does not independently derive it. Protect source, dependencies, profile and runtime under owner administration.
- Hashing here fingerprints local software policy. Compact commitments/hashes, circuit names, contract source, ABI, generated artifacts and proof semantics are unchanged.
- Software module pins do not establish hostile-code isolation, hardware custody, independent institutions, rollback protection or independent review of the approval construction.

## Verification

Targeted signer/service controls: **26 passed**, including changed-helper behavior, changed/removed pins, unchanged reopen, legacy-store upgrade refusal and real CLI helper/profile changes. The full local regression passes **537 tests / 60 suites**. Canonical compilation passes with zero managed-binding drift; build/typecheck and fixture-key/credential scans pass. Implementation `eab4b94` passes [push CI](https://github.com/ShrikarT/line/actions/runs/38302218992) and [PR CI](https://github.com/ShrikarT/line/actions/runs/38302224790). Historical native reports retain their original helper fingerprints; this change generates no new proof or network evidence.
