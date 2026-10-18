import { OrganizationAuth, OrganizationAuthError, organizationRecipient } from './organization-auth.mjs';
import { sanitizeServiceError } from '../src/lib/runtime/endpoints.ts';

async function readJson(req) {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new OrganizationAuthError('Use a JSON request.', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 32768) throw new OrganizationAuthError('Request is too large.', 413); chunks.push(Buffer.from(chunk)); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (value && !Array.isArray(value) && typeof value === 'object') return value; } catch {}
  throw new OrganizationAuthError('Supply a JSON object.', 400);
}
const requestId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

/** Production organization-only API. No historical operator or simulator routes.
 * service is one started, exclusive native supplier runtime; tests replace only
 * its network boundary and make no funded-transaction claim.
 */
export function organizationApi({ service, origin, auth = new OrganizationAuth(origin) }) {
  let job = null, activeId = null, activeRecipient = null, closed = false;
  const errors = new Map();
  const signInAdmission = new Map();
  const authorize = async (address, session) => {
    if (!await service.authorizeOrganization(address, session.recipient)) throw new OrganizationAuthError('Organization order not found.', 404);
  };
  const middleware = async (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith('/api/organization/')) return next();
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(body)); };
    if (closed) return send(503, { error: 'The supplier service is shutting down.' });
    try {
      // Never trust a caller-controlled forwarded Host as the sign-in domain.
      let source;
      try { source = new URL(req.headers.origin ?? req.headers.referer ?? '').origin; } catch {}
      if (source !== origin || req.headers['x-line-organization'] !== 'wallet') throw new OrganizationAuthError('Open the organization workspace on this site.', 403);
      if(path.startsWith('/api/organization/auth/')){
        const now=auth.now(),peer=req.socket.remoteAddress??'unknown';
        for(const [key,entry]of signInAdmission)if(entry.until<=now)signInAdmission.delete(key);
        let entry=signInAdmission.get(peer);
        if(!entry){if(signInAdmission.size>=1000)throw new OrganizationAuthError('Sign-in requests are busy. Retry in a minute.',429);entry={until:now+60000,count:0};signInAdmission.set(peer,entry);}
        if(++entry.count>120)throw new OrganizationAuthError('Sign-in requests are busy. Retry in a minute.',429);
      }
      if (req.method === 'GET' && path === '/api/organization/catalog') return send(200, { ...service.catalog(), walletAuthentication: 'required' });
      if (req.method === 'POST' && path === '/api/organization/auth/challenge'){
        const context=auth.requester(req.headers.cookie,req.socket.remoteAddress);
        return send(200,auth.challenge((await readJson(req)).address,context.key),{'Set-Cookie':context.cookie});
      }
      if (req.method === 'POST' && path === '/api/organization/auth/verify') {
        const session = auth.finish(await readJson(req));
        return send(200, { authenticated: true, expiresAt: session.expiresAt }, { 'Set-Cookie': auth.cookie(session.token, session.expiresAt) });
      }
      if (req.method === 'POST' && path === '/api/organization/auth/logout') return send(200, { authenticated: false }, { 'Set-Cookie': auth.revoke(req.headers.cookie) });
      const session = auth.require(req.headers.cookie);
      if(req.headers['x-line-wallet'] && organizationRecipient(req.headers['x-line-wallet'])!==session.recipient)throw new OrganizationAuthError('Sign in with the selected organization wallet.');
      const match = /^\/api\/organization\/orders\/([0-9a-f-]{36})(\/redeem)?$/.exec(path);
      if (req.method === 'GET' && match && !match[2]) {
        const order = service.order(match[1]);
        const retainedError = errors.get(match[1]);
        if (!order) return send(200, { order: null, busy: activeId === match[1] && activeRecipient === session.recipient, error: retainedError?.recipient === session.recipient ? retainedError.message : null });
        await authorize(order.contractAddress, session); auth.require(req.headers.cookie);
        return send(200, { order, busy: activeId === match[1], error: retainedError?.recipient === session.recipient ? retainedError.message : null });
      }
      if (req.method !== 'POST' || path !== '/api/organization/orders' && !match?.[2]) return send(404, { error: 'Unknown supplier action.' });
      if (job) return send(409, { error: 'The supplier wallet is completing another operation.' });
      const input = await readJson(req), id = match?.[1] ?? input.id;
      if (!requestId(id)) throw new OrganizationAuthError('A stable purchase request ID is required.', 400);
      const redeem = !!match?.[2], existing = service.order(id);
      let address;
      if (redeem) {
        if (typeof input.claim !== 'string' || input.claim.length > 16384 || !existing) throw new OrganizationAuthError('Organization order not found.', 404);
        address = existing.contractAddress;
      } else {
        if (typeof input.contractAddress !== 'string' || !/^[0-9a-f]{64}$/.test(input.contractAddress) || !['text-metrics', 'content-integrity'].includes(input.service) || typeof input.document !== 'string' || !input.document.trim() || input.document.length > 5000) throw new OrganizationAuthError('Supply an exact facility, service and document.', 400);
        address = input.contractAddress;
        if (existing && existing.contractAddress !== address) throw new OrganizationAuthError('The purchase request belongs to different terms.', 409);
      }
      await authorize(address, session); auth.require(req.headers.cookie);
      // Both body streaming and owner lookup yield. Admission is atomic here.
      if (closed) return send(503, { error: 'The supplier service is shutting down.' });
      if (job) return send(409, { error: 'The supplier wallet is completing another operation.' });
      errors.delete(id); activeId = id; activeRecipient = session.recipient;
      job = Promise.resolve().then(() => redeem ? service.redeem(id, input.claim) : service.quote(id, address, input.service, input.document)).catch(error => {
        if (errors.size >= 1000) errors.delete(errors.keys().next().value);
        errors.set(id, { recipient: session.recipient, message: sanitizeServiceError(error instanceof Error ? error.message : 'The supplier operation needs reconciliation.') });
      }).finally(() => { job = null; activeId = null; activeRecipient = null; });
      return send(202, { accepted: true, id });
    } catch (error) {
      const status = error instanceof OrganizationAuthError ? error.status : 503;
      return send(status, { ...(status === 401 ? { code: 'WALLET_AUTH_REQUIRED' } : {}), error: sanitizeServiceError(error instanceof Error ? error.message : 'The supplier service is unavailable.') });
    }
  };
  return { middleware, auth, async close() { closed = true; await job; await service.close(); auth.close(); } };
}
