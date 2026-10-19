/** Read-only check of the retained recording transaction. No wallet or resend. */
import { readFileSync, writeFileSync } from 'node:fs';
import * as L from '@midnight-ntwrk/ledger-v8';
import { resolveMidnightEndpoints } from '../src/lib/runtime/endpoints.ts';
import { createFinalizedReceiptReader } from './finalized-contract-receipt.mjs';
const operation = 'f79840f6-79f7-43c6-b552-700bdc81d727-1-draw';
const record = JSON.parse(readFileSync(`.midnight-cache/test-settlement/${operation}.json`, 'utf8'));
const tx = L.Transaction.deserialize('signature', 'proof', 'binding', readFileSync(`.midnight-cache/test-settlement/${operation}.bin`));
if (tx.transactionHash() !== record.txHash || tx.identifiers().at(-1) !== record.txId) throw Error('Saved transaction changed.');
const endpoints = resolveMidnightEndpoints({ networkId: 'preprod', blockfrostProjectId: process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID });
const response = await fetch(endpoints.indexerUri, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'query($offset: TransactionOffset!){transactions(offset:$offset){hash block{height timestamp} ... on RegularTransaction{transactionResult{status}}}}', variables: { offset: { identifier: record.txId } } }), signal: AbortSignal.timeout(30000) });
if (!response.ok) throw Error('Indexer unavailable.');
const result = await response.json();
if (result.errors || !Array.isArray(result.data?.transactions)) throw Error('Indexer response invalid.');
const a = await createFinalizedReceiptReader({ endpoints }).read({ kind: 'call', name: 'redeemDraw', identifier: '00f983f465d89759ddf482a81d70aa15da27f7046bc6d2e0055d340141db65fe92' }, record.contractAddress);
const report = { checkedAt: new Date().toISOString(), contractAddress: record.contractAddress, operation, txId: record.txId, txHash: record.txHash, submissionError: record.submissionError, expiresAt: [...tx.intents.values()].map(intent => intent.ttl.toISOString()), indexedMatches: result.data.transactions.length, matches: result.data.transactions, newMerchantARedemption: { txHash: a.transaction.hash, block: a.transaction.block, status: a.transaction.transactionResult.status, finalizedHead: a.finalizedHead, rawTransactionChecked: true }, action: 'Retained pending original transaction. No resend, no replacement, no private accounting mutation.', limitation: 'New recording is partial; the earlier independently verified two-merchant payout remains the accepted checkpoint.', reference: 'https://docs.midnight.network/guides/manage-dust#dust-troubleshooting' };
writeFileSync('artifacts/wave2/line-review-video/assets/capture/pending-check.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
