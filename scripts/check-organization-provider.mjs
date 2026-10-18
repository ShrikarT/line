/** Read-only Preprod transport acceptance. Starts no native wallet and submits
 * no transaction. The isolated HTTP runtime supplies only network transport;
 * its injected catalog boundary is not acceptance of a funded supplier runtime.
 */
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import * as L from '@midnight-ntwrk/ledger-v8';
import { bech32m } from '@scure/base';
import { resolveMidnightEndpoints, assertEndpointCredentials } from '../src/lib/runtime/endpoints.ts';
import { startOrganizationServer } from '../server/organization-server.mjs';

const endpoints = resolveMidnightEndpoints({ networkId: 'preprod', blockfrostProjectId: process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID });
assertEndpointCredentials(endpoints);
const directory = mkdtempSync(join(tmpdir(), 'line-provider-read-'));
const modulesOrigin = process.env.LINE_BROWSER_MODULE_ORIGIN ?? 'http://127.0.0.1:5174';
writeFileSync(join(directory, 'index.html'), `<!doctype html><base href="${modulesOrigin}/"><title>Isolated read-only provider verification</title>`);
const probe = createServer(); await new Promise(yes => probe.listen(0, '127.0.0.1', yes));
const port = probe.address().port; await new Promise(yes => probe.close(yes));
const origin = `http://127.0.0.1:${port}`;
const key = L.sampleSigningKey(), verifyingKey = L.signatureVerifyingKey(key);
const receivingAddress = bech32m.encodeFromBytes('mn_addr_preprod', Buffer.from(L.addressFromKey(verifyingKey), 'hex'));
const app = await startOrganizationServer({ env: { LINE_PUBLIC_ORIGIN: origin }, port, host: '127.0.0.1', publicDirectory: directory, createService: async () => ({ endpoints, catalog: () => ({ services: [] }), close: async () => {} }) });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let signatures = 0; const requests = [];
  page.on('request', request => requests.push(request.url()));
  page.on('websocket', socket => requests.push(socket.url()));
  await page.exposeFunction('providerReadProgress', stage => console.log(JSON.stringify({ stage })));
  await page.exposeFunction('signProviderControl', message => {
    if (!message.startsWith('Sign in to Line\n') && !message.startsWith('Line organization sign-in\n')) throw Error('Unexpected control challenge');
    signatures++;
    return { verifyingKey, signature: L.signData(key, Buffer.from(`midnight_signed_message:${Buffer.byteLength(message)}:${message}`)) };
  });
  await page.goto(origin);
  const result = await page.evaluate(async ({ receivingAddress, modulesOrigin }) => {
    const [{ OrganizationSupplierClient }, { organizationReadEndpoints }, { indexerPublicDataProvider }, { authenticatedOrganizationReads }] = await Promise.all([
      import(modulesOrigin + '/src/lib/organization/supplier-client.ts'),
      import(modulesOrigin + '/src/lib/organization/read-endpoints.ts'),
      import(modulesOrigin + '/e2e/organization-provider.ts'),
      import(modulesOrigin + '/src/lib/organization/authenticated-reads.ts'),
    ]);
    const account = { receivingAddress, assertSession() {}, async assertWallet() {}, wallet: { async signData(message) { return window.signProviderControl(message); } } };
    const supplier = new OrganizationSupplierClient(account, location.origin);
    const endpoints = await organizationReadEndpoints({ networkId: 'preprod', indexerUri: 'https://midnight-preprod.blockfrost.io/api/v0', indexerWsUri: 'wss://midnight-preprod.blockfrost.io/api/v0/ws', substrateNodeUri: 'https://rpc.midnight-preprod.blockfrost.io' }, supplier, location.origin);
    await window.providerReadProgress('Authenticated same-origin reader selected');
    const provider = authenticatedOrganizationReads(indexerPublicDataProvider(endpoints.indexerUri, endpoints.indexerWsUri, WebSocket), endpoints.authorize);
    const historicalAddress = '8990864c6f80c517c7458fa9b2526d3500f3a9814399fc836097ee409da9bed0';
    const state = await Promise.race([provider.queryContractState(historicalAddress), new Promise((_, no) => setTimeout(() => no(Error('HTTP observation deadline')), 35000))]);
    if (!state) throw Error('Historical contract was not returned');
    await window.providerReadProgress('Actual SDK decoded historical Preprod state over HTTP');
    await fetch(new URL('/api/organization/auth/logout', location.origin), { method: 'POST', headers: { 'X-Line-Organization': 'wallet' } });
    const renewedState = await provider.queryContractState(historicalAddress);
    if (!renewedState) throw Error('The existing SDK reader did not recover after revocation');
    await window.providerReadProgress('Existing SDK reader reauthenticated after sign-out');
    const block = await (await fetch(endpoints.indexerUri, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query { block { height } }' }) })).json();
    const height = block.data?.block?.height;
    if (!Number.isSafeInteger(height) || height <= 0) throw Error('No current Preprod height');
    const observed = await new Promise((yes, no) => {
      let subscription;
      const timer = setTimeout(() => { subscription?.unsubscribe(); no(Error('Subscription observation deadline')); }, 35000);
      subscription = provider.contractStateObservable(historicalAddress, { type: 'all' }).subscribe({ next(value) { clearTimeout(timer); subscription?.unsubscribe(); yes(value.operations().length); }, error() { clearTimeout(timer); no(Error('Actual SDK subscription failed')); } });
    });
    return { httpContractOperations: state.operations().length, renewedContractOperations: renewedState.operations().length, subscriptionContractOperations: observed, observedBlockHeight: height, httpReaderSameOrigin: new URL(endpoints.indexerUri).origin === location.origin, websocketReaderSameHost: new URL(endpoints.indexerWsUri).host === location.host };
  }, { receivingAddress, modulesOrigin });
  if (requests.some(value => value.includes('project_id=') || value.includes(process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID))) throw Error('A browser URL exposed a provider credential');
  const evidence = { schema: 'line-organization-provider-read/v1', observedAt: new Date().toISOString(), network: 'preprod', ...result, walletSignInSignatures: signatures, browserProviderCredentialUrls: 0, nativeWalletStarted: false, submittedTransactions: 0, historicalContractOnly: true, supplierRuntimeBoundary: 'isolated catalog only; no funded supplier acceptance', actualLace: false };
  writeFileSync('artifacts/organization-product/provider-routing-preprod-read.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close(); await app.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'line-provider-read-')) throw Error('Unexpected verification directory');
  rmSync(directory, { recursive: true, force: true });
}
