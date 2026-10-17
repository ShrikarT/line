// One-time, contract-specific recovery. Never submits a network transaction.
// Stop the local signer server before running this command.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import * as L from '@midnight-ntwrk/ledger-v8';
import { PreprodLive } from '../server/preprod-live.mjs';
import { TestSettlementLive } from '../server/test-settlement-live.mjs';
import { merchantPublicKey } from '../src/lib/line/encoding.ts';
import { sanitizeServiceError } from '../src/lib/runtime/endpoints.ts';
if (process.argv[2] !== '--retire-expired-registration') throw Error('Explicit --retire-expired-registration required; stop the local app first.');
try {
  await fetch('http://127.0.0.1:5174', { signal: AbortSignal.timeout(2000) });
  throw Error('Local app is running. Stop its signer before this recovery.');
} catch (error) { if (error.message?.startsWith('Local app')) throw error; }
let parent;
try {
  assert(process.env.MIDNIGHT_DEPLOYER_MNEMONIC && process.env.MIDNIGHT_STORAGE_PASSWORD, 'Configure the local Preprod signer first.');
  parent = new PreprodLive();
  // Initialization normally recovers the canonical facility. This maintenance
  // helper must never submit or recover an unrelated canonical transaction.
  parent.recoverPending = async () => { assert(!parent.state.pending, 'Canonical facility has a pending operation; reconcile it in the app first.'); };
  await parent.initialize(process.env);
  const live = await TestSettlementLive.fromCanonical(parent), pending = live.state.pending;
  assert.equal(pending?.id, 'setup-merchant-b');
  assert.equal(pending.name, 'registerMerchant');
  assert.equal(pending.record?.disposition, 'submission-attempted');
  const root = resolve(live.directory), binary = join(root, `${pending.id}.bin`), journal = join(root, `${pending.id}.json`);
  const tx = L.Transaction.deserialize('signature', 'proof', 'binding', readFileSync(binary));
  assert.equal(tx.transactionHash(), pending.record.txHash);
  const finalHash = await parent.api.rpc.chain.getFinalizedHead();
  const finalTime = Number((await parent.api.query.timestamp.now.at(finalHash)).toString());
  const expiry = Math.max(...[...tx.intents.values()].map(intent => intent.ttl.getTime()));
  assert(Number.isFinite(expiry) && finalTime > expiry + 60000, 'Finalized chain time has not passed every transaction expiry.');
  const response = await fetch(parent.endpoints.indexerUri, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'query($offset: TransactionOffset!) { transactions(offset: $offset) { hash } }', variables: { offset: { identifier: pending.record.txId } } }), signal: AbortSignal.timeout(30000) });
  assert(response.ok); const indexed = await response.json(); assert(!indexed.errors && Array.isArray(indexed.data?.transactions));
  assert.equal(indexed.data.transactions.length, 0, 'A transaction exists; reconcile it instead.');
  const state = live.decodeLedger((await parent.publicProvider.queryContractState(live.state.contractAddress)).data);
  assert.equal(state.registeredMerchants.member(merchantPublicKey(live.keys.merchantB)), false, 'Merchant already registered; reconcile instead.');
  assert.equal(state.totalReserve, 200n);
  const archive = join(root, 'expired', pending.record.txHash);
  assert(archive.startsWith(root + sep) && binary.startsWith(root + sep) && journal.startsWith(root + sep));
  mkdirSync(archive, { recursive: true });
  const report = { checkedAt: new Date().toISOString(), contractAddress: live.state.contractAddress, txHash: pending.record.txHash, txId: pending.record.txId, finalizedHash: finalHash.toHex(), finalizedTime: new Date(finalTime).toISOString(), expiresAt: new Date(expiry).toISOString(), indexedMatches: 0, merchantRegistered: false, action: 'Retired expired registration; retained bytes and journal; no submission or accounting change', trust: 'Configured TLS node and indexer' };
  writeFileSync(join(archive, 'recovery.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  renameSync(binary, join(archive, 'transaction.bin'));
  renameSync(journal, join(archive, 'operation.json'));
  live.state.pending = null; await live.save();
  writeFileSync(`artifacts/preprod-2026-10-16/token-expiry-recovery-${report.txHash.slice(0,12)}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) { console.error(sanitizeServiceError(error.message)); process.exitCode = 1; }
finally { await parent?.close(); }
