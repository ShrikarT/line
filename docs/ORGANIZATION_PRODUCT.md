# Organization-funded Line product

The owner selected this operating model on 17 October 2026: **each organization funds and controls its own agents' spending**. This is the initial user product. A separate outside credit provider is not assumed, and an organization's own deposit must not be described as externally supplied credit.

The existing operator facilities are retained as historical network evidence. They do not become user facilities by connecting a wallet, and their role keys are never copied into user accounts. The primary product must not silently select a simulator, mint a reserve or acknowledge a payment that did not occur.

## Required user flow

1. Connect a user's actual Midnight Preprod wallet. Bind encrypted account records to that wallet's public identity and selected network; revoke the open account when the connection changes.
2. Create or recover the organization's own facility. Its issuer and delegated-agent records stay in the organization's encrypted custody. Merchant registration contains the supplier's public role key and receiving address, never its private key.
3. Deposit existing assets from the organization wallet into the facility. A successful circuit must require the same asset amount as a ledger input; a counter update or a minted test reserve is insufficient.
4. Set an agent allowance and purchase an authenticated merchant quote. The organization signs its own outgoing transaction through its wallet. The merchant proves redemption of its own claim and receives the selected settlement asset exactly once.
5. Confirm the exact finalized transaction before publishing an updated private book, releasing a service result or displaying payment success. An uncertain submission is retained and reconciled, not replaced with a new request.
6. Replenish capacity through an actual incoming deposit. Expired unredeemed claims release credit; excess deposits are returned with an actual payout. Withdrawals cannot consume encumbered funds.

## Compact implementation

`contracts/organization/line.compact` is the source for the organization profile, with managed bindings at `contracts/managed/organization/`. It retains all twelve circuit names. The previously deployed canonical and test-token profiles remain separate and unchanged.

- The constructor fixes the existing asset color and organization/merchant payout recipients.
- `fundReserve` uses `receiveUnshielded`; this source has no mint primitive.
- `redeemDraw`, withdrawals and fee withdrawals emit actual selected-asset payouts.
- `acknowledgeRepayment` requires an actual equal deposit in its transaction before restoring the committed allowance and increasing reserve inflow.
- The refund branch of `cancelOrExpireNote` sends the proven excess to the organization, removes that amount from reserve accounting and releases the retained original budget. It does not accept an off-chain refund report.

The organization owns and controls its delegated agent. This profile does not establish the separate-issuer/borrower custody goal of the broader external-credit architecture. The selected transparent asset reveals deposit, payout and refund amounts and recipients; commitments alone do not establish full-history privacy. No deployment or actual user deposit is claimed until its network receipt is confirmed.

Nine generated-Compact checks currently pass: selected-asset deposit with no mint; both merchant payouts; authorization/replay/recipient replacement; asset shortage/locked withdrawals; earned-fee payout; real-deposit replenishment and reference replay; and actual excess-refund conservation. These are execution/effect tests with synthetic ledger balances, not funded network evidence. The browser account, actual SDK deployment preparation and merchant service integration are implemented. Metadata-only connector tests establish wallet-scoped encrypted isolation and rejection before submission; the owner confirms actual Lace connection and vault opening. A funded organization deployment and end-to-end purchase still require network acceptance. See [the current readiness audit](ORGANIZATION_READINESS_2026-10-18.md) for limits and next steps.
