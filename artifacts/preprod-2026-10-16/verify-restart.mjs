// Read-only comparison around an operator-managed backend restart. No POSTs.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const [stage] = process.argv.slice(2);
assert(['--before', '--after'].includes(stage));
const directory = 'artifacts/preprod-2026-10-16', base = 'http://127.0.0.1:5174';
async function snapshot(profile) {
  const response = await fetch(`${base}/api/preprod/${profile === 'settlement' ? 'settlement/' : ''}status`, { headers: { Origin: base, 'X-Line-Preprod': 'operator' }, signal: AbortSignal.timeout(45000) });
  assert(response.ok); const state = await response.json();
  assert.equal(state.busy, false); assert.equal(state.pending, null); assert(!state.error); assert.equal(state.phase, 'ready');
  return { contractAddress: state.contractAddress, receipts: state.receipts.length, privateBook: state.privateBook, orders: state.orders.map(({ id, service, status }) => ({ id, service, status })), tokenObservation: state.tokenObservation ?? null };
}
const current = { canonical: await snapshot('canonical'), settlement: await snapshot('settlement') };
if (stage === '--before') writeFileSync(`${directory}/restart-before.json`, JSON.stringify(current, null, 2));
else {
  assert.deepEqual(current, JSON.parse(readFileSync(`${directory}/restart-before.json`, 'utf8')));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], mutations = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST') mutations.push(new URL(request.url()).pathname); });
    await page.goto(`${base}/test-payout`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByText('25 test units received', { exact: true }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: 'Both services delivered', exact: true }).waitFor({ timeout: 60000 });
    await page.screenshot({ path: `${directory}/token-restarted-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${directory}/token-restarted-mobile.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(mutations, []); assert.deepEqual(errors, []);
    writeFileSync(`${directory}/restart-verification.json`, JSON.stringify({ checkedAt: new Date().toISOString(), ...current, retainedAcrossBackendRestart: true, browserErrors: errors, browserPosts: mutations, mobileOverflow: false }, null, 2));
  } finally { await browser.close(); }
}
console.log(JSON.stringify({ stage, canonicalReceipts: current.canonical.receipts, testTokenReceipts: current.settlement.receipts, merchantA: current.settlement.tokenObservation.balances.A.units, merchantB: current.settlement.tokenObservation.balances.B.units }));
