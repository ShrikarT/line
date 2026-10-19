# Organization product verification

Use [submission-verification.json](submission-verification.json) for the current
test and submission scope, and [public-host-verification.json](public-host-verification.json)
for the deployed revision and public network-read checks. The
[public workspace](https://line-midnight.onrender.com/app) uses Render's free
wallet-only mode; it provides no automated hosted API supplier.

The local core suite has 644 cases: 643 passed and one intentional skip. Fourteen
focused browser cases passed, including ten organization cases. Build/typecheck
and the 37 public proving-file checks passed. The full remote CI run passed all
four jobs, including all 49 browser cases. Its Linux core run passed 642 cases
with two Windows-only skips; the separate Windows ACL job passed. These browser
tests are not evidence of a real wallet transaction.

Actual Lace connection, a Preprod receiving address and organization vault
opening were observed. Preparation reached wallet approval, but fresh funded
organization acceptance is unverified. Public reader checks sign in with an
ephemeral verification key and read historical Preprod state; they submit no
transactions. One 40-second subscription observation timed out; two subsequent
focused observations passed. Stable provider latency is not established.

Older increment reports remain for provenance: [API](production-api-verification.json),
[supplier runtime](standalone-supplier-verification.json),
[hosting preparation](hosting-preparation-verification.json),
[recovery](recovery-verification.json) and [initial scope](verification.json).
Their test counts and outstanding-hosting statements describe those checkpoints.
The screenshots and synthetic browser fault fixtures verify UI and persistence,
not finalized customer transactions.

Install the exact published public proving material with
`npm run organization:install-release`, then run `npm run organization:validate`
and `npm run build:deploy`. Generation with `npm run organization:release` is a
separate operation; preserve the existing keys for any deployed facility.
