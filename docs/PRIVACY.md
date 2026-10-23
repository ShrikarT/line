# Privacy

Line hides plaintext spending-book openings from the public application. It does
**not** currently provide complete historical balance or purchase privacy.

## Private inputs and public observations

| Private to the executing account | Public or inferable |
| --- | --- |
| Limit, outstanding balance, epoch and blinding salts | Commitments and state-transition history |
| Role signing secrets and claim openings | Registered merchant pseudonyms and contract identity |
| Encrypted organization records and pending candidates | Purchase amounts, fees, expiry and reserve changes |
| Backup plaintext | Transparent deposit/payout amounts and receiving addresses |

The book commitment binds the contract domain, agent identity, limit, balance and
epoch with `persistentCommit`. Quotes, claims and nullifiers use domain-separated
`persistentHash` encodings. Neither primitive is replaced by a general-purpose
hash in the protocol.

An observer who knows the book starts at zero can reconstruct debt from public
draw amounts and fees. Later repayments can add uncertainty, but do not establish
full-history confidentiality. Reusing an agent identity also creates linkability.
The leakage tests check counterexamples; they are not a privacy proof.

## Authorization and custody

The issuer authorizes governance, allowances, reserve changes and repayment
acknowledgement. Merchants authorize quotes and redemption; the agent authorizes
draws. Contract domains and nullifiers prevent cross-instance replay and repeated
redemption. Rejected draws show **"Clearance could not be proven."**

The organization owns its delegated agent. The current opening flow needs an
agent-secret witness under issuer authorization; it does not establish independent
outside borrower/issuer custody.

Browser accounts encrypt private records with AES-GCM and password-derived keys.
They are scoped to the connected Preprod wallet. Pending candidates remain
encrypted until finalized receipts authorize publication. An uncertain transaction
is reconciled by its original identity before another mutation is admitted.
The organization vault stays unlocked for up to twelve hours in the current tab,
including normal refreshes. Its passphrase stays in a same-origin SharedWorker's
memory, with only a random resume ticket and public wallet selection in
sessionStorage. Restoration verifies the live Preprod network and both wallet
identities before loading encrypted records; it does not renew the expiry.
Duplicated tabs cannot claim the original tab's browser lock. Manual locking,
disconnect and account changes revoke restoration. Browser restart, unavailable
worker support or loss of that memory require another password entry. Neither
the password nor private keys are written to localStorage, sessionStorage or
IndexedDB by the session holder. Same-origin script compromise remains a threat
while an organization is unlocked, including during its refresh grace period.
Encrypted backup export requires the unlocked organization session and account
lock, while remaining available during a wallet API outage. It does not reveal
the backup plaintext or authorize a transaction. Restore and financial operations
still require fresh wallet identity verification.
Verified wallet service settings remain in session memory and are excluded from
backups. Transaction boundaries check the live connection, Preprod network and
both wallet identities; a failed live check cannot use cached settings to proceed.
Server access uses a separate thirty-minute HttpOnly sign-in cookie. Refresh can
reuse an unexpired cookie only after the server matches it to the selected
receiving wallet; the check does not extend its deadline or send the vault
password to the server.
Keep a recoverable encrypted backup: browser-local storage is not institutional
custody or a guarantee against device compromise.

The narrowly scoped expired-opening, merchant-disable, claim-compensation and merchant-quote recoveries retain the
original signed bytes, private candidate, predecessor and provider evidence in encrypted recovery history
and backups. Only public facility/block state is requested from the server; the
private candidate and original signed bytes are checked locally. Archiving does
not create a finalized failure receipt, prove absence of network fees or provide
an independent chain proof. See [architecture](ARCHITECTURE.md) for its assumptions.

## Network and settlement boundaries

The public wallet-only server holds the provider credential and exposes bounded,
authenticated HTTP/WebSocket ledger reads. Wallets retain transaction signing and
proving. This mode has no hosted supplier signing wallet or automated API supplier.

The canonical profile's reserve is accounting, not token custody. Its repayment
acknowledgement is an issuer assertion, not independently verified money receipt.
Separate test-settlement receipts establish only the reported valueless test-token
payouts. A historical receipt does not certify a new organization facility.

Native transparent-asset transfers reveal amounts and recipients. A stronger
settlement design must address those disclosures, genuine backing/redemption,
timing and complete observer history before claiming private balances.

No external security certification or production credit/custody acceptance is
claimed. Current acceptance and remaining work are in [progress](PROGRESS.md).

Optional submission diagnostics export the original public signed transaction,
its identifiers/hash, action metadata and signed intent deadlines. The explicit
field list excludes vault passwords, role secrets, private candidates and
provider URLs. This is an unencrypted diagnostic file, separate from encrypted
vault backup; exporting it neither submits the transaction nor proves its outcome.
