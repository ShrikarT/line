// Read-only finalized transaction verification. Does not load any wallet keys.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFinalizedReceiptReader } from './finalized-contract-receipt.mjs';
import { resolveMidnightEndpoints, sanitizeServiceError } from '../src/lib/runtime/endpoints.ts';
import { resolveContractRelease, validateContractArtifacts } from './contract-artifacts.mjs';

try {
  const [evidencePath, outputPath, ...extra] = process.argv.slice(2);
  assert(evidencePath && outputPath && !extra.length, 'Usage: verify-test-token-payout.mjs <public-browser-evidence.json> <report.json>');
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.profile, 'test-settlement');
  const release = validateContractArtifacts({ artifactDir: resolveContractRelease({ profile: 'test-settlement' }), profile: 'test-settlement' });
  const { ledger } = await import(pathToFileURL(join(release.artifactDir, 'contract/index.js')).href);
  const reader = createFinalizedReceiptReader({ endpoints: resolveMidnightEndpoints({ networkId: 'preprod', blockfrostProjectId: process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID }) });
  const directory = '.midnight-cache/test-settlement';
  const records = readdirSync(directory).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(directory, name), 'utf8'))).filter(row => row.schema === 'line-live-checkout-operation/v1' && row.disposition === 'confirmed-success').sort((a, b) => a.blockHeight - b.blockHeight);
  assert(records.length >= 21 && records.every(row => row.contractAddress === evidence.contractAddress), 'Incomplete or mixed deployment record.');
  const hex = bytes => Buffer.from(bytes).toString('hex');
  const receipts = [], payouts = [];
  let latest, fundedBalance;
  const balance = (state, color) => [...state.balance].filter(([type]) => type.tag === 'unshielded' && type.raw === color).reduce((sum, [, amount]) => sum + amount, 0n);
  for (const row of records) {
    latest = await reader.read({ kind: row.kind, name: row.name, txHash: row.txHash, blockHeight: row.blockHeight }, row.contractAddress);
    const publicLedger = ledger(latest.compactState.data);
    const color = hex(publicLedger.settlementTokenColor);
    if (row.id === 'setup-fund') { fundedBalance = balance(latest.state, color); assert.equal(fundedBalance, 200n); }
    if (row.kind === 'call' && row.name === 'redeemDraw') {
      const outputs = [...latest.raw.intents.values()].flatMap(intent => [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer].flatMap(offer => offer?.outputs ?? [])).filter(output => output.type === color);
      assert.equal(outputs.length, 1, 'Each redemption must pay exactly one test-token output.');
      const registered = [...publicLedger.merchantPayoutRecipients].map(([, recipient]) => hex(recipient.bytes));
      assert(registered.includes(outputs[0].owner), 'Payout recipient must be registered on-chain.');
      payouts.push({ id: row.id, txHash: row.txHash, blockHeight: row.blockHeight, recipient: outputs[0].owner, units: String(outputs[0].value), tokenColor: color, contractBalanceAfter: String(balance(latest.state, color)) });
    }
    receipts.push({ id: row.id, name: row.name, txHash: row.txHash, blockHeight: row.blockHeight, verified: true });
  }
  const names = release.compilerInfo.circuits.map(circuit => circuit.name).sort();
  assert.equal(names.length, 12);
  for (const name of names) assert(Buffer.from(latest.state.operation(name).verifierKey).equals(readFileSync(join(release.artifactDir, 'keys', `${name}.verifier`))), `Verifier key mismatch: ${name}`);
  const observation = evidence.tokenObservation;
  assert(observation && observation.balances.A.addressHex !== observation.balances.B.addressHex);
  for (const [merchant, index, amount] of [['A', 0, '25'], ['B', 1, '20']]) {
    const payout = payouts.find(row => row.id === `${evidence.requestId}-${index}-redeem`);
    assert(payout, `Missing merchant ${merchant} redemption.`);
    assert.equal(payout.units, amount);
    assert.equal(payout.recipient, observation.balances[merchant].addressHex);
    assert.equal(payout.tokenColor, observation.color);
    assert(BigInt(observation.balances[merchant].units) >= BigInt(amount));
  }
  const totalPaid = payouts.reduce((sum, payout) => sum + BigInt(payout.units), 0n);
  const remaining = balance(latest.state, observation.color);
  assert.equal(fundedBalance - totalPaid, remaining, 'Contract asset balance must reconcile to finalized merchant payouts.');
  const report = { checkedAt: new Date().toISOString(), network: 'preprod', contractAddress: evidence.contractAddress, sourceSha256: release.inputs.source.sha256, confirmedTransactions: receipts.length, verifierKeysMatched: names, fundedTestUnits: String(fundedBalance), paidTestUnits: String(totalPaid), remainingContractTestUnits: String(remaining), payouts, receipts, finalizedHead: latest.finalizedHead, tokenPayoutEstablished: true, cashRepaymentVerified: false, trust: 'Configured TLS indexer and RPC; finalized block, raw transaction, registered recipient and asset-balance checks. Not a light-client proof.' };
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ verified: true, confirmedTransactions: receipts.length, paidTestUnits: String(totalPaid), remainingContractTestUnits: String(remaining) }));
} catch (error) { console.error(sanitizeServiceError(error.message)); process.exitCode = 1; }
