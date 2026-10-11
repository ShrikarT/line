import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CATALOG, CheckoutError, CheckoutEvaluation } from "./checkout-engine.ts";
import { checkoutStorageFromEnvironment, type CheckoutCheckpointStore } from "./checkout-storage.ts";

/** Development/preview middleware. No CORS; role capabilities never appear in URLs. */
export function checkoutMiddleware(options: { storage?: CheckoutCheckpointStore } = {}) {
  const sessions = new Map<string, CheckoutEvaluation>();
  let storage = options.storage;
  let closed = false;
  let creationFailed = false;
  const durableConfigured = !!storage || !!process.env.LINE_CHECKOUT_STORAGE_DIR || !!process.env.LINE_CHECKOUT_STORAGE_PASSWORD;
  const ready = durableConfigured ? (async () => {
    storage ??= await checkoutStorageFromEnvironment();
    try {
      for (const snapshot of await storage!.loadAll()) {
        const session = CheckoutEvaluation.recover(snapshot, storage!);
        if (sessions.has(session.id)) throw new Error("Duplicate checkout checkpoint.");
        sessions.set(session.id, session);
      }
    } catch (error) { await storage!.close(); throw error; }
  })() : Promise.resolve();
  // Keep startup errors observable through ready() and HTTP, without unhandled rejection.
  void ready.catch(() => {});
  const active = new Set<Promise<void>>();
  let pendingCreations = 0;
  const ttl = 30 * 60 * 1000;
  function send(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(JSON.stringify(value));
  }
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (!req.headers["content-type"]?.startsWith("application/json")) throw new CheckoutError(415, "Use application/json.");
    let size = 0;
    const parts: Buffer[] = [];
    for await (const chunk of req) {
      const part = Buffer.from(chunk);
      size += part.length;
      if (size > 40_000) throw new CheckoutError(413, "Request is too large.");
      parts.push(part);
    }
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, unknown>;
    } catch { throw new CheckoutError(400, "Invalid JSON object."); }
  }
  function authorize(req: IncomingMessage, expected: string) {
    const supplied = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new CheckoutError(403, "This role is not authorized for that operation.");
  }
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? "").split("?")[0];
    if (!path.startsWith("/api/checkout")) { next(); return; }
    try {
      if (closed) throw new CheckoutError(503, "Checkout server is shutting down.");
      if (durableConfigured) await ready;
      // Prevent cross-origin drive-by session creation and bearer use.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) throw new CheckoutError(403, "Use this application's origin.");
      for (const [id, session] of sessions) if (Date.now() - session.createdAt > ttl) {
        await session.whenIdle();
        // Debt, unredeemed authorizations and refund budgets (including issuer
        // reports with locked backing) retain their original reconciliation evidence.
        if (session.hasOutstandingObligations()) continue;
        sessions.delete(id);
        await storage?.remove(id);
      }
      if (path === "/api/checkout/catalog" && req.method === "GET") { send(res, 200, { services: CATALOG, durability: storage?.mode ?? "volatile" }); return; }
      if (path === "/api/checkout/sessions" && req.method === "POST") {
        if (creationFailed) throw new CheckoutError(503, "Checkout creation requires server restart and recovery.");
        if (sessions.size + pendingCreations >= 20) throw new CheckoutError(429, "Evaluation server is at capacity. Try again after sessions expire.");
        // Reserve capacity before asynchronous construction to avoid creation races.
        pendingCreations += 1;
        let session: CheckoutEvaluation;
        try { session = await CheckoutEvaluation.create(storage); }
        catch (error) { if (storage && error instanceof CheckoutError && error.status === 503) creationFailed = true; throw error; }
        finally { pendingCreations -= 1; }
        sessions.set(session.id, session);
        send(res, 201, { id: session.id, issuerToken: session.issuerToken, agentToken: session.agentToken, expiresAt: session.createdAt + ttl, durability: storage?.mode ?? "volatile" });
        return;
      }
      const match = /^\/api\/checkout\/sessions\/([a-zA-Z0-9-]+)\/(issuer|agent|public)(?:\/([a-z-]+))?$/.exec(path);
      if (!match) throw new CheckoutError(404, "Checkout endpoint not found.");
      const session = sessions.get(match[1]);
      if (!session) throw new CheckoutError(410, "Evaluation session expired. Start a new session; no real funds were used.");
      const role = match[2]; const action = match[3];
      authorize(req, role === "issuer" ? session.issuerToken : session.agentToken);
      if (req.method === "GET" && !action) { await session.whenIdle(); send(res, 200, role === "issuer" ? session.issuerView() : session.publicView()); return; }
      if (req.method !== "POST") throw new CheckoutError(405, "Method not allowed.");
      const input = await body(req);
      if (role === "issuer" && action === "configure") send(res, 200, await session.configure(input.limit, input.reserve));
      else if (role === "issuer" && action === "acknowledge") send(res, 200, await session.acknowledge(input.amount, input.reference));
      else if (role === "issuer" && action === "report-refund") send(res, 200, await session.reportRefund(input.orderId, input.reference));
      else if (role === "agent" && action === "purchase") send(res, 200, await session.purchase(input.service, input.document, input.requestId));
      else throw new CheckoutError(404, "That operation is not exposed to this role.");
    } catch (error) { send(res, error instanceof CheckoutError ? error.status : 500, { error: error instanceof CheckoutError ? error.message : "Evaluation could not finish. Retry the same request to resume this session." }); }
  };
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const result = handle(req, res, next);
    active.add(result);
    void result.finally(() => active.delete(result));
    return result;
  };
  middleware.ready = () => ready;
  middleware.close = async () => {
    closed = true;
    await Promise.allSettled([...active]);
    await ready;
    await storage?.close();
  };
  return middleware;
}
