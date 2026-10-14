# Midnight Preprod connection

**14 October update:** the owner-supplied signer/token now establish an actual two-merchant Preprod checkout, repayment and backend restart on a fresh canonical instance: 22 independently verified finalized transactions. Prior credential/deployment blockers below are historical. [Current evidence, fixes, scope and remaining decisions](LIVE_PREPROD_CHECKOUT_2026-10-14.md). Website deployment and wider investigation remain deferred.

The app is running from `C:\Users\Shrikar\line-audit-review` at http://127.0.0.1:5174/. No website deployment is required for this work.

## Prepared locally

- The existing canonical release was copied from the original checkout and validated against the current source, bindings and manifest. No keys were regenerated. All 36 HTTP proving assets match their release hashes; all 12 verifier keys match the public fixture.
- Proof-server `midnightntwrk/proof-server:8.1.3` is running in container `line-preprod-proof-8-1-3`, bound to `127.0.0.1:6300`. `/health` returns 200.
- The reported contract address is configured locally: `b2254962147c9cc2e5b9fbcf39f8a4e0d1f149b7801a651df2e41dda1e4410d9`.
- Joining a network contract now refreshes the console's public ledger and runtime status.

The owner supplied the Preprod token, and all 20 recorded receipts have now been freshly verified against finalized RPC blocks and raw transaction/action bytes. All 12 deployed verifier keys match the canonical release. Eight recorded circuit names executed successfully; the other four are registered but have no execution receipts in this record. [Verified receipts](preprod-2026-10-14-evidence/receipt-verification.json). No redeployment is required for key compatibility, and none has occurred.

An actual browser joined this contract and loaded live public state (OPEN, total reserve 998, withdrawable 898). This check used a read-only connector stub and real Blockfrost queries; it did not connect an actual Lace wallet, submit a new transaction, or transfer assets. [Exact browser-check scope](preprod-2026-10-14-evidence/browser-readiness.json).

Validation: build/typecheck, all six relevant browser checks and the updated full core suite pass (549 tests; 548 pass, zero failures, one intentional compiled-owner skip). All 38 receipt tests pass separately. Managed bindings have no drift. Browser checks pass when run after the core suite; overlapping runs hit timing failures.

## Finish the network connection

1. The supplied token is configured as `MIDNIGHT_BLOCKFROST_PROJECT_ID` in ignored `.env.local`. CLI commands load this file; it is not a Vite public environment variable. A loopback-only, same-origin dev/preview endpoint fills the setup screen's memory-only token field. The production browser bundle contains no configured token.
2. `npm run network:receipts` can rerun the completed receipt verification. The reader now supports the official indexer's explicit null segment outcomes under aggregate SUCCESS and converts serialized ledger state to the Compact runtime before decoding generated bindings. Contradictory failed segments, partial success and missing fields remain rejected. All 38 receipt regression checks pass.
3. Open `/issuer` in the browser containing Midnight Lace. Click the runtime badge to choose network mode, select Preprod, retain proof URL `http://127.0.0.1:6300` and proving root `/line-zk`, then connect Lace and join the configured contract. The token is prefilled locally.
4. Unlock/import the existing role vault and private book openings for this contract. Newly generated role keys cannot authorize an existing deployment. Preserve existing salts, generations and pending operations. The issuer, agent and two merchant consoles provide the network circuit flow.
5. Confirm each submitted action through its transaction receipt and block height. Resolve an uncertain submission before retrying.

The `/checkout` API purchasing demo remains local generated-Compact execution; switching the protocol consoles to Preprod does not turn that server demo into network checkout or token settlement.

If the recorded contract's keys differ from the current validated release, a fresh deployment is authorized by the owner. Deployment still requires a funded DUST wallet, locally configured `MIDNIGHT_DEPLOYER_MNEMONIC` and `MIDNIGHT_STORAGE_PASSWORD`, plus the intended issuer/merchant public keys. Neither wallet credentials nor the existing private openings have been supplied to this checkout. Do not rerun the incremental script to regenerate missing openings or retry uncertain calls.

Current service URLs and the required Preprod token are documented in [Midnight's network reference](https://docs.midnight.network/relnotes/network).
