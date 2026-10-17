# Run the Line purchasing demo

Current local app: **http://127.0.0.1:5174/**.

## Start here: wallet and workspace

Open **http://127.0.0.1:5174/app**. The header now exposes **Connect wallet** on desktop and mobile, including the live checkout pages. Choose a detected Midnight Connector v4 wallet, use Preprod, and approve the connection in the extension. Line displays the public receiving address and provides copy/disconnect controls. After a full reload, reconnect explicitly; wallet handles and addresses are not persisted by the new account UI. No mnemonic or wallet password is requested.

The workspace links directly to `/test-payout`, describes the complete purchase test, and links to all three role consoles. Existing facility owners can open `/connect` for advanced service configuration and contract joining. The original runtime switch remains available on larger screens.

**Connection is not facility ownership or authentication to the local operator.** The demo's issuer, agent, fee and merchant keys remain under the configured local operator. A connected browser wallet does not sign `/preprod` or `/test-payout` purchases, receive their merchant payouts, or automatically get a credit line. Independent borrower onboarding, role provisioning and a wallet-signed credit application are still outstanding product work. The role consoles use their configured simulator/network runtime and require matching private vault records for network operations.

## Live Midnight Preprod

The homepage's **Open workspace** and header **Open app** actions open `/app`. Choose **Live Preprod** in the navigation for `/preprod`. It uses the existing funded test wallet and deployed canonical contract through the local operator backend.

Before a live demonstration, start Docker Desktop and the existing proof server:

```powershell
docker start line-preprod-proof-8-1-3
```

After starting the app on port 5174, run:

```powershell
node scripts/check-preprod-readiness.mjs
```

This checks both the proof server and local operator API without submitting a transaction or displaying credentials. An existing contract can report phase `ready` even when Docker is stopped; check `proofServerReady` too. A busy or pending operation must finish or be reconciled before starting another purchase. Do not run a second signer CLI alongside the app.

In `/preprod`, choose **Start another purchase** when available, edit the document and run the purchase. Two merchant services require six fee-funded calls. Keep the same request ID if interrupted. **Acknowledge reported test repayment** is explicitly a demo issuer report, not proof of a real payment. The existing contract records credit and claims; it does not pay merchant tokens.

## Midnight test-token checkout

Open **http://127.0.0.1:5174/test-payout** for the separate test-asset version. It uses the same local fee wallet and a separate contract, encrypted controller, merchant wallets and browser request IDs. Confirmed wallet balances and the test-token identity appear above checkout; the standard `/preprod` facility remains the accounting version. [Current network evidence and limits](TEST_TOKEN_PAYOUT_2026-10-16.md).

Setup mints 200 valueless test units into contract custody. Each completed purchase pays 25 units to Merchant A and 20 to Merchant B, at their fixed registered addresses. These are transparent test tokens; their amounts and recipients are public. They have no monetary value or cash-redemption promise.

Keep the same purchase ID after interruption. A pending transaction must be reconciled before another operation; reloading does not create a purchase. Once both services are delivered, the issuer can use the clearly labelled **Acknowledge reported test repayment** demonstration action before **Start another purchase** becomes available. That action proves an issuer report and does not establish a real incoming repayment. Further purchases remain bounded by the contract's actual remaining test assets.

The local backend serializes both facilities through one fee-wallet job. It uses a positive DUST fee allowance and rejects empty fee sections before submission. Do not run a second signer process alongside the app.

## Fast local evaluation

From the audit checkout (`C:/Users/Shrikar/line-audit-review`), start it with:

```powershell
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

1. Select **Try API checkout**.
2. Keep **Complete both purchases** selected, then open the evaluation line.
3. Run the agent purchase plan. Both merchants deliver; the issuer's private view shows debt **45** and remaining capacity **15**.
4. In a fresh demo, choose **Decline and recovery**. Merchant A delivers, Merchant B declines with `Clearance could not be proven.` Acknowledge 25 units as the issuer, then retry the declined purchase. The earlier delivered service is retained.

The service results, generated Compact transitions and demo ledger projection are on the checkout page. The separate protocol consoles inspect their own configured runtime. Keep the checkout page open to retain its capabilities and exact retry IDs.

This is a local demonstration using demo units and deterministic services. It submits no proof or network transaction and transfers no assets. `npm run preview` also serves the checkout API after a build; static-file-only hosting does not.
