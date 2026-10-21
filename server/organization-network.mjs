import { WebSocket, WebSocketServer } from 'ws';
import { parse, getOperationAST, visit } from 'graphql';
import { OrganizationAuthError } from './organization-auth.mjs';
import { expiredOpeningReader } from './organization-expiry.mjs';

const BASE = '/api/organization/network';
const MAX_REQUEST = 65536;
const MAX_RESPONSE = 16 * 1024 * 1024;
const ROOTS = { query: new Set(['block', 'transactions', 'contractAction']), subscription: new Set(['blocks', 'contractActions']) };

function readOperation(input, allowed) {
  if (!input || typeof input.query !== 'string' || input.query.length > 24000 || input.variables !== undefined && (!input.variables || typeof input.variables !== 'object' || Array.isArray(input.variables))) throw new OrganizationAuthError('Supply a bounded indexer query.', 400);
  let document, operation;
  try { document = parse(input.query, { maxTokens: 4000 }); operation = getOperationAST(document, input.operationName); } catch {}
  if (!operation || !allowed.includes(operation.operation) || document.definitions.length !== 1) throw new OrganizationAuthError('Only one read-only indexer operation is supported.', 400);
  let fields = 0, depth = 0, maxDepth = 0;
  visit(document, { SelectionSet: { enter() { maxDepth = Math.max(maxDepth, ++depth); }, leave() { depth--; } }, Field() { fields++; }, FragmentSpread() { throw new OrganizationAuthError('Named query fragments are unsupported.', 400); } });
  // The SDK uses direct root selections. Reject root fragments and introspection
  // rather than accepting a second, unbounded query language at this boundary.
  if (fields > 120 || maxDepth > 16 || operation.selectionSet.selections.length > 8 || operation.selectionSet.selections.some(node => node.kind !== 'Field' || !ROOTS[operation.operation].has(node.name.value))) throw new OrganizationAuthError('Unsupported indexer read.', 400);
  return { query: input.query, ...(input.variables ? { variables: input.variables } : {}), ...(typeof input.operationName === 'string' ? { operationName: input.operationName } : {}) };
}

async function readBounded(stream, limit) {
  let length = 0; const chunks = [];
  for await (const chunk of stream) { length += chunk.length; if (length > limit) throw new OrganizationAuthError('Indexer payload is too large.', 413); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks).toString('utf8');
}

/** Same-origin public-ledger reads. Provider credentials exist only in the two
 * fixed server URLs, never in metadata, client frames or forwarded headers.
 */
export function organizationNetwork({ server, auth, origin, endpoints }) {
  const readExpiredOpening = expiredOpeningReader({ endpoints });
  const queryUrl = new URL(endpoints.indexerUri), wsUrl = new URL(endpoints.indexerWsUri);
  for (const [url, schemes] of [[queryUrl, ['https:', 'http:']], [wsUrl, ['wss:', 'ws:']]]) {
    if (!schemes.includes(url.protocol) || url.username || url.password || url.hash) throw Error('Invalid supplier indexer configuration.');
  }
  const sensitive = [...queryUrl.searchParams.values(), ...wsUrl.searchParams.values()].filter(value => value.length > 8);
  const clean = value => {
    let encoded = JSON.stringify(value);
    for (const secret of sensitive) encoded = encoded.split(JSON.stringify(secret).slice(1, -1)).join('[redacted]');
    return JSON.parse(encoded);
  };
  const publicOrigin = new URL(origin), wsOrigin = new URL(origin); wsOrigin.protocol = publicOrigin.protocol === 'https:' ? 'wss:' : 'ws:';
  const metadata = { networkId: 'preprod', indexerUri: new URL(BASE + '/indexer', origin).href, indexerWsUri: new URL(BASE + '/indexer/ws', wsOrigin).href };
  const connections = new Set(), budgets = new Map(), requests = new Set();
  const removeInvalidationListener = auth.onSessionInvalidated(session => { for (const entry of [...connections]) if (entry.session === session) entry.finish(); });
  let closed = false;
  function authorized(req, websocket = false) {
    if (closed) throw new OrganizationAuthError('The network service is stopping.', 503);
    let source; try { source = new URL(req.headers.origin ?? (!websocket ? req.headers.referer : undefined) ?? '').origin; } catch {}
    if (source !== origin) throw new OrganizationAuthError('Open the organization workspace on this site.', 403);
    return auth.require(req.headers.cookie);
  }
  function admit(session) {
    const now = auth.now();
    for (const [key, value] of budgets) if (value.until <= now) budgets.delete(key);
    let budget = budgets.get(session.recipient);
    if (!budget) { if (budgets.size >= 1000) throw new OrganizationAuthError('Indexer reads are busy.', 429); budget = { until: now + 60000, count: 0 }; budgets.set(session.recipient, budget); }
    if (++budget.count > 120) throw new OrganizationAuthError('Indexer reads are busy. Retry in a minute.', 429);
  }
  const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
  const middleware = async (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== BASE && !path.startsWith(BASE + '/')) return next();
    let controller;
    try {
      const session = authorized(req); admit(session);
      if (req.url !== path) throw new OrganizationAuthError('Indexer URL parameters are not supported.', 400);
      if (path === BASE && req.method === 'GET') return send(res, 200, metadata);
      if (path === BASE + '/expired-opening' && req.method === 'GET') {
        if (requests.size >= 8) throw new OrganizationAuthError('Recovery reads are busy.', 429);
        controller = new AbortController(); requests.add(controller);
        const abort = () => controller.abort(); res.once('close', abort);
        try {
          const evidence = await readExpiredOpening(controller.signal);
          auth.require(req.headers.cookie);
          if (!res.destroyed) return send(res, 200, evidence);
          return;
        } finally { res.off('close', abort); }
      }
      if (path !== BASE + '/indexer' || req.method !== 'POST') throw new OrganizationAuthError('Unknown indexer read.', 404);
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new OrganizationAuthError('Use a JSON indexer query.', 415);
      let input; try { input = JSON.parse(await readBounded(req, MAX_REQUEST)); } catch (error) { if (error instanceof OrganizationAuthError) throw error; throw new OrganizationAuthError('Invalid indexer query.', 400); }
      const operation = readOperation(input, ['query']);
      if (requests.size >= 8) throw new OrganizationAuthError('Indexer reads are busy.', 429);
      controller = new AbortController(); requests.add(controller);
      const abort = () => controller.abort(); res.once('close', abort);
      try {
        const response = await fetch(queryUrl, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) });
        if (!response.ok || !response.body) throw Error('Unavailable');
        const value = JSON.parse(await readBounded(response.body, MAX_RESPONSE));
        if (res.destroyed) return;
        // Never relay provider diagnostics, URLs, headers or extensions.
        return send(res, 200, { ...(value.data !== undefined ? { data: clean(value.data) } : {}), ...(value.errors ? { errors: [{ message: 'The Preprod indexer could not complete this read.' }] } : {}) });
      } finally { res.off('close', abort); }
    } catch (error) {
      if (!res.destroyed) send(res, error instanceof OrganizationAuthError ? error.status : 503, { ...(error instanceof OrganizationAuthError && error.status === 401 ? { code: 'WALLET_AUTH_REQUIRED' } : {}), error: error instanceof OrganizationAuthError ? error.message : 'The Preprod indexer is unavailable. Retry the original operation.' });
    } finally { if (controller) requests.delete(controller); }
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_REQUEST, perMessageDeflate: false, handleProtocols: protocols => protocols.has('graphql-transport-ws') ? 'graphql-transport-ws' : false });
  function upgrade(req, socket, head) {
    let session;
    try {
      if (req.url !== BASE + '/indexer/ws') throw new OrganizationAuthError('Unknown indexer subscription.', 404);
      session = authorized(req, true); admit(session);
      const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim());
      if (!protocols.includes('graphql-transport-ws')) throw new OrganizationAuthError('Use the indexer subscription protocol.', 400);
      if (connections.size >= 100 || [...connections].filter(entry => entry.recipient === session.recipient).length >= 3) throw new OrganizationAuthError('Too many indexer connections.', 429);
    } catch (error) { socket.end(`HTTP/1.1 ${error instanceof OrganizationAuthError ? error.status : 503} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return; }
    wss.handleUpgrade(req, socket, head, downstream => {
      const entry = { recipient: session.recipient, session, downstream, upstream: null, finish: null };
      connections.add(entry);
      const subscriptions = new Set(); let initialized = false, ready = false, queued = [], finished = false;
      const finish = () => { if (finished) return; finished = true; clearTimeout(expiry); connections.delete(entry); downstream.terminate(); entry.upstream?.terminate(); };
      entry.finish = finish;
      const expiry = setTimeout(finish, Math.max(0, session.expiresAt - auth.now())); expiry.unref();
      const current = () => { try { authorized(req, true); return true; } catch { finish(); return false; } };
      const forward = message => {
        if (!ready) { if (queued.length >= 10) throw Error('Subscription initialization is pending'); queued.push(message); return; }
        if (entry.upstream.bufferedAmount > 1024 * 1024) throw Error('Slow upstream');
        entry.upstream.send(JSON.stringify(message));
      };
      downstream.on('error', finish); downstream.on('close', finish);
      downstream.on('message', (raw, binary) => {
        if (!current()) return;
        try {
          if (binary) throw Error('Binary subscription frame');
          const message = JSON.parse(raw.toString()); admit(session);
          if (message.type === 'connection_init' && !initialized) { initialized = true; forward({ type: 'connection_init' }); }
          else if (message.type === 'subscribe' && initialized && typeof message.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(message.id) && !subscriptions.has(message.id) && subscriptions.size < 8) {
            const payload = readOperation(message.payload, ['query', 'subscription']); subscriptions.add(message.id); forward({ id: message.id, type: 'subscribe', payload });
          } else if (message.type === 'complete' && subscriptions.delete(message.id)) forward({ type: 'complete', id: message.id });
          else if (message.type === 'ping' || message.type === 'pong') forward({ type: message.type });
          else throw Error('Unsupported subscription frame');
        } catch { finish(); }
      });
      const upstream = entry.upstream = new WebSocket(wsUrl, 'graphql-transport-ws', { handshakeTimeout: 10000, maxPayload: MAX_RESPONSE, perMessageDeflate: false, followRedirects: false });
      upstream.on('open', () => { if (!current()) return; try { ready = true; for (const message of queued) forward(message); queued = []; } catch { finish(); } });
      upstream.on('error', finish); upstream.on('close', finish);
      upstream.on('message', (raw, binary) => {
        if (!current()) return;
        try {
          if (binary || downstream.bufferedAmount > 1024 * 1024) throw Error('Invalid upstream frame');
          const message = JSON.parse(raw.toString());
          if (message.type === 'connection_ack') downstream.send(JSON.stringify({ type: 'connection_ack' }));
          else if (message.type === 'ping' || message.type === 'pong') downstream.send(JSON.stringify({ type: message.type }));
          else if (message.type === 'next' && subscriptions.has(message.id)) downstream.send(JSON.stringify({ id: message.id, type: 'next', payload: { ...(message.payload?.data !== undefined ? { data: clean(message.payload.data) } : {}), ...(message.payload?.errors ? { errors: [{ message: 'The Preprod indexer could not complete this read.' }] } : {}) } }));
          else if ((message.type === 'error' || message.type === 'complete') && subscriptions.delete(message.id)) downstream.send(JSON.stringify(message.type === 'complete' ? { type: 'complete', id: message.id } : { type: 'error', id: message.id, payload: [{ message: 'The Preprod indexer could not complete this read.' }] }));
          else throw Error('Unsupported upstream frame');
        } catch { finish(); }
      });
    });
  }
  server.on('upgrade', upgrade);
  return { middleware, async close() { closed = true; removeInvalidationListener(); server.off('upgrade', upgrade); for (const request of requests) request.abort(); for (const entry of [...connections]) entry.finish(); await new Promise(yes => wss.close(yes)); budgets.clear(); } };
}
