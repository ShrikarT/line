// Explicit manual funded Preprod run. Never invoked by automated tests.
import { chromium } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
if (!process.argv.includes('--submit-preprod')) throw Error('Explicit --submit-preprod required.');
const base = 'http://127.0.0.1:5174', directory = resolve('artifacts/preprod-2026-10-16');
const marker = resolve(directory, 'token-request.json');
const resumeSetup = process.argv.includes('--resume-setup');
if (existsSync(marker) !== resumeSetup) throw Error('Use --resume-setup only for the retained setup attempt; never replace a purchase request.');
async function status() {
  const response = await fetch(`${base}/api/preprod/settlement/status`, { headers: { Origin: base, 'X-Line-Preprod': 'operator' }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw Error(`Status HTTP ${response.status}`);
  return response.json();
}
async function waitUntil(predicate) {
  let last = '';
  for (const deadline = Date.now() + 40 * 60000; Date.now() < deadline;) {
    const current = await status();
    const progress = JSON.stringify({ phase: current.phase, progress: current.progress, receipts: current.receipts.length, busy: current.busy, pending: current.pending, error: current.error });
    if (progress !== last) { console.log(progress); last = progress; }
    if (!current.busy && current.error) throw Error(current.error);
    if (!current.busy && !current.pending && predicate(current)) return current;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw Error('Observation deadline reached; preserve this request.');
}
let initial;
for (const deadline = Date.now() + 180000; Date.now() < deadline && !initial;) {
  try { initial = await status(); }
  catch { await new Promise(resolve => setTimeout(resolve, 5000)); }
}
if (!initial) throw Error('Read-only startup checks did not become available; no action submitted.');
if (initial.busy || initial.pending || initial.error || initial.phase !== (resumeSetup ? 'registering' : 'not-deployed') || initial.orders.length !== 0) throw Error('Expected an idle, new test-token facility.');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/test-payout`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const setup = page.waitForResponse(response => response.url().endsWith('/settlement/setup') && response.request().method() === 'POST');
  if (!resumeSetup) writeFileSync(marker, JSON.stringify({ startedAt: new Date().toISOString(), setup: true }, null, 2));
  await page.getByRole('button', { name: 'Set up test-token facility', exact: true }).click({ timeout: 60000 });
  if ((await setup).status() !== 202) throw Error('Setup rejected.');
  const ready = await waitUntil(state => state.phase === 'ready' && !!state.tokenObservation);
  writeFileSync(resolve(directory, 'token-setup.json'), JSON.stringify(ready, null, 2));
  await page.getByRole('textbox', { name: /Document to analyze/ }).fill('Line test-token payout verification. Two merchants deliver analysis and cost reporting after their distinct Midnight Preprod wallets receive the contract-authorized test assets.');
  const purchase = page.waitForResponse(response => response.url().endsWith('/settlement/purchase') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Run agent purchase', exact: true }).click({ timeout: 60000 });
  const accepted = await purchase;
  const requestId = accepted.request().postDataJSON().requestId;
  writeFileSync(marker, JSON.stringify({ startedAt: new Date().toISOString(), requestId, contractAddress: ready.contractAddress, baselineReceipts: ready.receipts.length }, null, 2));
  if (accepted.status() !== 202) throw Error('Purchase rejected.');
  const final = await waitUntil(state => state.orders.length === 2 && state.orders.every(order => order.status === 'delivered') && state.tokenObservation?.balances.A.units === '25' && state.tokenObservation?.balances.B.units === '20');
  if (final.receipts.length !== ready.receipts.length + 6) throw Error('Expected six purchase calls.');
  await page.reload();
  await page.getByText('25 test units received', { exact: true }).waitFor({ timeout: 60000 });
  await page.screenshot({ path: resolve(directory, 'token-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(directory, 'token-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (errors.length || overflow || (await status()).receipts.length !== final.receipts.length) throw Error('Browser/reload check failed.');
  writeFileSync(resolve(directory, 'token-payout-verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), requestId, ...final, browserErrors: errors, mobileOverflow: overflow, reloadRetainedReceipts: true, cashRepaymentVerified: false }, null, 2));
  console.log(JSON.stringify({ complete: true, receipts: final.receipts.length, merchantA: '25', merchantB: '20' }));
} finally { await browser.close(); }
