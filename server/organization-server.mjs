import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { organizationApi } from './organization-api.mjs';
import { OrganizationAuth } from './organization-auth.mjs';
import { organizationNetwork } from './organization-network.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
async function servePublic(req, res, root) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path.includes('\0') || path.includes('\\') || path.length > 2048) throw Error('Invalid public path');
    if (path === '/' || !extname(path)) path = '/index.html';
    const file = await realpath(resolve(root, '.' + path));
    if (!file.startsWith(root + sep)) throw Error('Outside public directory');
    const details = await stat(file); if (!details.isFile()) throw Error('Not a file');
    const cache = extname(file) === '.html' ? 'no-store' : /^\/assets\/[^/]+-[\w-]{8,}\.(?:js|css|wasm|woff2|svg|png|webp|jpg)$/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': details.size, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res);
  } catch { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end('Not found'); }
}

/** One persistent process serves the built app and owns one supplier wallet.
 * A runtime factory is injectable solely for transport/lifecycle tests.
 */
export async function startOrganizationServer({ env = process.env, createService, port = Number(env.PORT ?? 3000), host = '0.0.0.0', publicDirectory = resolve('dist') } = {}) {
  const mode = env.LINE_ORGANIZATION_MODE ?? 'supplier';
  if (!['supplier', 'wallet-only'].includes(mode)) throw Error('Configure supplier or wallet-only organization mode.');
  const origin = env.LINE_PUBLIC_ORIGIN;
  const auth = new OrganizationAuth(origin); // Reject invalid public configuration before listening.
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Configure a valid service port.');
  const root = await realpath(publicDirectory);
  if (!(await stat(resolve(root, 'index.html'))).isFile()) throw Error('Build the public app before starting its server.');
  let api, network, startupFailure = false, closing = false, closeTask, httpStopTask;
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/healthz' || path === '/readyz') {
      const ready = !!api && !closing;
      res.writeHead(path === '/healthz' ? 200 : ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ready, ...(mode === 'wallet-only' ? { mode } : {}), ...(startupFailure ? { error: 'Supplier initialization failed.' } : {}) }));
    }
    if (path.startsWith('/api/')) {
      if (!api) { res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ error: 'The supplier wallet is starting. Retry shortly.' })); }
      const fallback = () => api.middleware(req, res, () => { res.writeHead(404); res.end(); });
      void (network ? network.middleware(req, res, fallback) : fallback()).catch(() => { if (!res.headersSent) res.writeHead(503); res.end(); });
      return;
    }
    void servePublic(req, res, root);
  });
  server.maxHeadersCount = 40; server.headersTimeout = 15000; server.requestTimeout = 30000; server.keepAliveTimeout = 5000;
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, host, () => { server.off('error', no); yes(); }); });
  const app = { server, async close() {
    if (closeTask) return closeTask;
    closing = true;
    closeTask = (async () => {
      httpStopTask??=new Promise((yes,no)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?no(error):yes()));
      try{await network?.close();await api?.close();auth.close();}finally{await httpStopTask;}
    })().catch(error=>{closeTask=undefined;throw error;});
    return closeTask;
  } };
  try {
    const service = await (createService ? createService() : mode === 'wallet-only'
      ? import('./organization-wallet-only.mjs').then(module => module.createWalletOnlyOrganizationService(env))
      : import('./organization-wallet.mjs').then(module => module.createStandaloneOrganizationMerchants(env)));
    api = organizationApi({ service, origin, auth });
    network = organizationNetwork({ server, auth, origin, endpoints: service.endpoints });
    return app;
  } catch (error) { startupFailure = true; await app.close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const app = await startOrganizationServer();
    const stop = () => { void app.close().then(() => { process.off('SIGTERM',stop);process.off('SIGINT',stop);process.exitCode = 0; }).catch(() => { console.error('Supplier shutdown is incomplete. Inspect its retained process ownership.'); process.exitCode = 1; }); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    console.log('Line organization service is ready.');
  } catch { console.error('Line organization service failed to start. Inspect private runtime configuration and retained storage.'); process.exitCode = 1; }
}
