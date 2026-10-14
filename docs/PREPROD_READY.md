# Midnight Preprod connection

The app is running from `C:\Users\Shrikar\line-audit-review` at http://127.0.0.1:5174/. No website deployment is required for this work.

## Prepared locally

- The existing canonical release was copied from the original checkout and validated against the current source, bindings and manifest. No keys were regenerated. All 36 HTTP proving assets match their release hashes; all 12 verifier keys match the public fixture.
- Proof-server `midnightntwrk/proof-server:8.1.3` is running in container `line-preprod-proof-8-1-3`, bound to `127.0.0.1:6300`. `/health` returns 200.
- The reported contract address is configured locally: `b2254962147c9cc2e5b9fbcf39f8a4e0d1f149b7801a651df2e41dda1e4410d9`.
- Joining a network contract now refreshes the console's public ledger and runtime status.

These checks establish local readiness, not network execution. Recorded receipts still need fresh verification. No redeployment has occurred.

Validation: build/typecheck, five relevant browser checks, all 40 focused store/SDK/wallet tests, and the full core suite pass (548 tests; 547 pass, zero failures, one intentional compiled-owner skip). Managed bindings have no drift.

## Finish the network connection

1. Put `MIDNIGHT_BLOCKFROST_PROJECT_ID=<your Midnight Preprod token>` in the ignored `.env.local` in the audit checkout. CLI commands now load this file automatically; it is not exposed as a Vite environment variable.
2. Run `npm run network:receipts`. This rechecks the 20 recorded receipts, their finalized blocks, contract actions and exact verifier keys. A failure must be resolved before treating the recorded deployment as compatible.
3. Open `/issuer` in the browser containing Midnight Lace. Choose network mode, select Preprod, enter the same token in the session-only field, retain proof URL `http://127.0.0.1:6300` and proving root `/line-zk`, then connect Lace and join the configured contract.
4. Unlock/import the existing role vault and private book openings for this contract. Newly generated role keys cannot authorize an existing deployment. Preserve existing salts, generations and pending operations. The issuer, agent and two merchant consoles provide the network circuit flow.
5. Confirm each submitted action through its transaction receipt and block height. Resolve an uncertain submission before retrying.

The `/checkout` API purchasing demo remains local generated-Compact execution; switching the protocol consoles to Preprod does not turn that server demo into network checkout or token settlement.

If the recorded contract's keys differ from the current validated release, a fresh deployment is authorized by the owner. Deployment still requires a funded DUST wallet, locally configured `MIDNIGHT_DEPLOYER_MNEMONIC` and `MIDNIGHT_STORAGE_PASSWORD`, plus the intended issuer/merchant public keys. Neither wallet credentials nor the existing private openings have been supplied to this checkout. Do not rerun the incremental script to regenerate missing openings or retry uncertain calls.

Current service URLs and the required Preprod token are documented in [Midnight's network reference](https://docs.midnight.network/relnotes/network).
