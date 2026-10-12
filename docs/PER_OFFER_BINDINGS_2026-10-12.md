# Per-offer binding recovery — 12 October 2026

The integrated private coordinator previously reused its initialization binding and salt for every supplier quote. Suppliers that shared their off-chain request values could compare that opaque binding directly across purchases. This is an off-chain correlation channel, not a new plaintext public-ledger balance disclosure. Different quote nonces did not erase equality of the supplier-facing binding.

The coordinator now creates a fresh random salt and actual Compact `persistentCommit` binding for each new offer. The binding still commits to `{domain, identity, generation}` using the existing private-offer encoding. It is saved in the write-ahead authorization packet before supplier approval and then in that offer's encrypted financial record. Exact retries restore the saved packet; they do not mint a replacement binding. Draw uses the selected offer's salt, rather than the initialization salt, so Compact proves the offer belongs to the authentic private book generation.

Already-saved legacy offers retain their original salt fallback. This avoids changing a pending claim's opening; it does not erase historical equality or certify migration of owner policies. The initialization binding remains a legacy field and is not reused by new offers.

## Owner policy is an explicit choice

The existing fixed-binding supplier example is unchanged. A separate `scripts/approval-owner-per-offer-policy.mjs` requires the owner-selected mode `facilityBindingMode: 'per-offer'`. It accepts nonzero opaque handles within the configured price and time limits from the supplier's authenticated financial caller. The pinned mTLS caller, contract domain, role and approval ABI remain enforced by the owner service/signer. The policy does not apply the fixed policy's stable buyer-binding allowlist. An owner must accept that scope; it is not interchangeable with a fixed customer restriction.

Only the synthetic coordinator fixture selects this new policy for Merchant A and Merchant B. Issuer and agent policies remain unchanged. Existing independently provisioned stores/configurations are not migrated or silently broadened. An unchanged fixed-binding owner may reject a newly randomized offer, and that denial must retain the saved intent rather than fall back to linkable reuse. Supplier requests still exclude borrower identity, generation, fee policy, book and binding salt.

## Evidence and remaining work

Three added controls verify independent bindings for the same facility, domain/identity/generation binding, explicit policy selection, preserved fixed-policy restrictions, and rejection of invalid handles, prices, deadlines and unsupported actions. They compare actual Compact commitments; finite unequal samples do not prove hiding distributions or computational indistinguishability.

The Compact source, twelve circuit names and managed canonical bindings are unchanged. Canonical compilation/zero drift, build/typecheck and key/credential scans pass. The full local regression passes **532 tests / 60 suites**. Fresh compiled coordinator recovery passes ten calls, eight exits, six controls and 46 workers with 23 helper fingerprints. Native proving is a separate pending scope. Historical proof reports retain their exact helper fingerprints and are not relabeled as this runtime change. Work started on 12 October and local regression completed on 13 October IST.

Public action names, quote/note linkage, deadlines, caller/DUST metadata, service traffic and outside knowledge remain channels. A supplier may already know its buyer; new opaque handles do not conceal independently known identity or arithmetic. Financial coordinator trust, independently administered custody, fee-funded network execution, authentic settlement and full-history privacy remain separate gates. This change removes repeated protocol-supplied binding equality from new offers; it does not claim anonymity or a passed privacy release gate.
