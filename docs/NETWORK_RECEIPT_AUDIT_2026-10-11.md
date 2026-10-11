# Reported Preprod deployment — independent audit status

Deployment commit `babc507`, merged into `main` by PR #11, adds `deployment-evidence.json` and `scripts/deploy-preprod-incremental.mjs`. The audit integration now includes that update. The receipt file reports a deployment, eleven subsequent verifier registrations and eight circuit calls at contract `b2254962147c9cc2e5b9fbcf39f8a4e0d1f149b7801a651df2e41dda1e4410d9`.

**Independent network verification is pending.** The read-only verifier cannot currently query Blockfrost because its environment has no Preprod project token. Its first run returned `PREPROD_READ_ONLY_TOKEN_MISSING`, recorded an incomplete result and made no network request. The reported transactions are new evidence; neither their existence in JSON nor this audit establishes finality.

## Exact reported coverage

The eight execution names are `fundReserve`, `registerMerchant`, `openLine`, `postQuote`, `draw`, `redeemDraw`, `acknowledgeRepayment`, and `withdrawFees`. The other four names are registered but not executed by this flow: `disableMerchant`, `withdrawUnencumberedReserve`, `cancelOrExpireNote`, and `setStatus`. Earlier text saying all twelve were executed has been corrected in the integration branch.

The calls use the canonical public-disclosure contract. Neither the private-book pool nor either signed candidate is deployed by these receipts. The script derives issuer/agent/merchant capabilities from the same mnemonic in one process. Its funding/redemption/repayment/fee counters do not establish deposits, service, payouts or refunds.

## Recovery findings in the newly added script

| Priority | Source finding | Required repair |
|---|---|---|
| High | `watchForDeployTxData` substitutes saved metadata and a success status, without re-querying the actual deploy transaction. `queryContractState` establishes a visible state, not the saved deployment's exact finality. | Re-query the real receipt; verify address, status, canonical finalized block, raw transaction, state and verifier keys. Do not synthesize confirmation from local metadata. |
| High | `executeStep` skips a saved step merely because it has a transaction hash. The receipt does not preserve its exact submitted action/identifier or a durable private candidate. | Persist immutable operation identity and the private candidate before dispatch; independently re-query saved receipts before advancing. |
| High | Every launch regenerates line/quote/note salts, nonces and deadlines. Restarting after a confirmed opening/draw skips that step but later uses different openings/claims. These cannot open the existing commitments. | Restore the exact encrypted private state and original action terms. Exercise restart after each stage, including uncertainty and mirror-write failure. A hash-only journal cannot recover private books. |
| High | Exceptions are retried without resolving whether the prior submission finalized. An interrupted funding/registration/purchase can be repeated or become unrecoverable. | Preserve submission IDs and reconcile uncertain outcomes before rebuilding or retrying. Reuse the audited runtime journal semantics rather than assuming a thrown call did not submit. |
| Open gate | All roles share one mnemonic/process; asset amounts are accounting assertions. | Independent accountable custody and authentic settlement remain separate requirements. No source change can turn a reserve counter into a receipt for money. |

These are source findings, not claims that the reported successful run duplicated funds or failed. The audit has not replayed this funded script, accessed wallet seeds, changed its cache or restarted the user's proof server.

## Read-only verification command

```bash
npm run network:receipts
npm run network:receipts:test
```

Configure `MIDNIGHT_BLOCKFROST_PROJECT_ID` in the local execution environment, using a Midnight **Preprod** project token. Do not paste tokens into chat or commit them. Midnight's [official endpoint documentation](https://docs.midnight.network/relnotes/network), checked 11 October, requires a network-specific token for Preprod indexer/RPC requests.

The verifier loads no wallet, seed, signing, proving or submission API. It queries each reported transaction by hash using the installed indexer schema; checks the exact successful contract action; matches its block with the RPC canonical block and finalized head; decodes raw transaction/state bytes; checks raw transaction hash/identifiers; and matches the operation keys against source-bound public verifier fixtures. The fixtures are comparison data, not deployable releases. Partial/failure evidence is preserved in a new ignored output directory; provider error messages and credential URLs are excluded.

Eleven local metadata tests pass, including partial success, failed segments, incorrect hash/height/address/entry point, registration mislabeled as execution, nonfinalized blocks and RPC/indexer disagreement. They do not verify any live receipt or exercise actual raw network decoding. Live schema/encoding/key checks still need the authenticated run and adaptation to observed data if necessary.

The trust boundary is fresh Blockfrost indexer/RPC views over TLS. This is not an independently operated full node, local cryptographic re-verification of network proofs, or confirmation of an asset transfer. Finalized canonical calls will improve the network gate; they will not prove private-candidate deployment, privacy, independent custody, authentic settlement or demand.
