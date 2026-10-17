// Explicitly authorized live Preprod purchase. Never part of npm test.
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (!process.argv.includes('--submit-preprod')) throw Error('Explicit --submit-preprod is required.');
const directory = resolve('artifacts/preprod-2026-10-16');
const marker = resolve(directory, 'purchase-request.json');
mkdirSync(directory, { recursive: true });
if (existsSync(marker)) throw Error('A request already exists. Reconcile that exact request; do not start another.');
const base = 'http://127.0.0.1:5174';
const headers = { Origin: base, 'X-Line-Preprod': 'operator' };
async function status() {
  const response = await fetch(`${base}/api/preprod/status`, { headers, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw Error(`Status HTTP ${response.status}`);
  return response.json();
}
const before = await status();
if (before.phase !== 'ready' || before.busy || before.pending || before.error || before.privateBook.remaining < 45 || before.privateBook.outstanding !== 0) throw Error('Facility is not ready for a fresh two-merchant purchase.');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/preprod`);
  await page.getByRole('button', { name: 'Start another purchase', exact: true }).click({ timeout: 60000 });
  await page.getByRole('textbox', { name: /Document to analyze/ }).fill('Fresh Line verification on 16 October 2026. An issuer authorizes an agent to buy document analysis and a cost report from two separate merchants. Each service is delivered only after its Midnight Preprod claim confirms.');
  const requestId = await page.evaluate(() => sessionStorage.getItem('line.preprod.purchase'));
  if (!requestId) throw Error('Browser did not retain a stable request ID.');
  writeFileSync(marker, JSON.stringify({ requestId, startedAt: new Date().toISOString(), baselineReceipts: before.receipts.length, contractAddress: before.contractAddress }, null, 2));
  await page.screenshot({ path: resolve(directory, 'before-purchase.png'), fullPage: true });
  const accepted = page.waitForResponse(response => response.url().endsWith('/api/preprod/purchase') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Run or resume purchases', exact: true }).click();
  const response = await accepted;
  if (response.status() !== 202) throw Error(`Purchase was not accepted: HTTP ${response.status()}`);
  console.log(JSON.stringify({ accepted: true, requestId, baselineReceipts: before.receipts.length }));
  const deadline = Date.now() + 30 * 60 * 1000;
  let last = '';
  while (Date.now() < deadline) {
    const current = await status();
    const orders = current.orders.filter(order => order.id.startsWith(`${requestId}-`));
    const progress = { progress: current.progress, busy: current.busy, pending: current.pending, receipts: current.receipts.length, orders: orders.map(({ service, status }) => ({ service, status })), error: current.error };
    const encoded = JSON.stringify(progress);
    if (encoded !== last) { console.log(encoded); last = encoded; }
    if (current.error && !current.busy) throw Error(`Purchase stopped: ${current.error}`);
    if (!current.busy && !current.pending && orders.length === 2 && orders.every(order => order.status === 'delivered')) {
      const receipts = current.receipts.filter(receipt => receipt.id.startsWith(requestId));
      if (receipts.length !== 6 || current.receipts.length !== before.receipts.length + 6) throw Error('Expected exactly six fresh confirmed calls.');
      await page.reload();
      await page.getByRole('button', { name: 'Both services delivered', exact: true }).waitFor({ timeout: 60000 });
      await page.screenshot({ path: resolve(directory, 'delivered-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: resolve(directory, 'delivered-mobile.png'), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      const afterReload = await status();
      if (afterReload.receipts.length !== current.receipts.length || overflow || errors.length) throw Error('Reload, layout or browser errors require review.');
      const report = { checkedAt: new Date().toISOString(), network: 'preprod', contractAddress: current.contractAddress, requestId, beforeReceipts: before.receipts.length, afterReceipts: current.receipts.length, receipts, deliveredServices: orders.map(({ service, status }) => ({ service, status })), browserErrors: errors, mobileOverflow: overflow, reloadRetainedReceipts: true, tokenPayoutEstablished: false, cashRepaymentVerified: false };
      writeFileSync(resolve(directory, 'fresh-purchase-verification.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ complete: true, confirmedCalls: receipts.length, totalReceipts: current.receipts.length }));
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!existsSync(resolve(directory, 'fresh-purchase-verification.json'))) throw Error('Observation deadline reached; retain and reconcile the existing request.');
} finally { await browser.close(); }
