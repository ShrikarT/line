import type { IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { sanitizeServiceError } from "../src/lib/runtime/endpoints.ts";
import type { PreprodSummary } from "../src/lib/preprod.ts";

interface NativeRuntime {
  busy?: boolean; summary(): PreprodSummary; setup(): Promise<PreprodSummary>;
  purchase(id: string, document: string): Promise<PreprodSummary>; acknowledge(id: string): Promise<PreprodSummary>; close(): Promise<void>;
  recoverPending?(): Promise<unknown>;
}
interface Options { env: Record<string, string | undefined>; create?: () => Promise<NativeRuntime>; createSettlement?: (parent: NativeRuntime) => Promise<NativeRuntime> }
export function preprodMiddleware({ env, create, createSettlement }: Options) {
  let runtime: Promise<NativeRuntime> | undefined, settlement: Promise<NativeRuntime> | undefined;
  let job: Promise<void> | null = null, jobProfile: string | null = null;
  const errors: Record<string, string | null> = { canonical: null, settlement: null };
  const initialize = () => runtime ??= (create ? create() : import(pathToFileURL(`${process.cwd()}/server/preprod-live.mjs`).href)
    .then(module => module.PreprodLive.create(env) as Promise<NativeRuntime>)).catch(failure => { runtime = undefined; throw failure; });
  const initializeSettlement = () => settlement ??= initialize().then(parent => createSettlement ? createSettlement(parent) : import(pathToFileURL(`${process.cwd()}/server/test-settlement-live.mjs`).href).then(module => module.TestSettlementLive.fromCanonical(parent) as Promise<NativeRuntime>)).catch(failure => { settlement = undefined; throw failure; });
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const requestedPath = (req.url ?? "").split("?")[0]; if (!requestedPath.startsWith("/api/preprod/")) return next();
    const isSettlement = requestedPath.startsWith("/api/preprod/settlement/");
    const profile = isSettlement ? "settlement" : "canonical";
    const path = isSettlement ? requestedPath.replace("/settlement/", "/") : requestedPath;
    const selectedRuntime = isSettlement ? initializeSettlement : initialize;
    const send = (status: number, value: object) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(JSON.stringify(value)); };
    const peer = req.socket.remoteAddress; let origin: URL;
    try { origin = new URL(req.headers.origin ?? req.headers.referer ?? ""); } catch { return send(403, { error: "Open the local operator console." }); }
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer ?? "") || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
      origin.protocol !== "http:" || origin.host !== req.headers.host || req.headers["x-line-preprod"] !== "operator") return send(403, { error: "Open the local operator console." });
    if (env.LINE_LIVE_PREPROD !== "1") return send(503, { error: "Live Preprod checkout is not enabled on this server." });
    try {
      if (req.method === "GET" && path === "/api/preprod/status") {
        if (isSettlement && !settlement && job) return send(409, { error: "Wait for the active Preprod operation before opening test-token settlement." });
        const current = await selectedRuntime();
        return send(200, { ...current.summary(), ...(job && jobProfile !== profile ? { progress: "Another Preprod contract operation is running" } : {}), busy: !!job, error: errors[profile] });
      }
      const actions = ["/api/preprod/purchase", "/api/preprod/acknowledge", "/api/preprod/reconcile", ...(isSettlement ? ["/api/preprod/setup"] : [])];
      if (req.method !== "POST" || !actions.includes(path)) return send(404, { error: "Unknown Preprod action." });
      if (job) return send(409, { error: "A Preprod operation is already running." });
      let bytes = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) return send(413, { error: "Request is too large." }); chunks.push(Buffer.from(chunk)); }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { requestId?: unknown; document?: unknown };
      if (typeof input.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(input.requestId)) return send(400, { error: "A stable request ID is required." });
      if (path.endsWith("purchase") && (typeof input.document !== "string" || !input.document.trim() || input.document.length > 5000)) return send(400, { error: "Enter a document of up to 5000 characters." });
      // Reading a streamed body yields; admission and assignment must be atomic.
      if (job) return send(409, { error: "A Preprod operation is already running." });
      errors[profile] = null; jobProfile = profile;
      const requestId = input.requestId, document = input.document as string;
      job = Promise.resolve().then(selectedRuntime).then(async current => {
        if (path.endsWith("purchase")) await current.purchase(requestId, document);
        else if (path.endsWith("setup")) await current.setup();
        else if (path.endsWith("reconcile")) { if (!current.recoverPending) throw Error("Restart the local Preprod backend to reconcile."); await current.recoverPending(); }
        else await current.acknowledge(requestId);
      }).catch(failure => { errors[profile] = sanitizeServiceError(failure instanceof Error ? failure.message : "Preprod operation requires reconciliation."); }).finally(() => { job = null; jobProfile = null; });
      return send(202, { accepted: true, requestId });
    } catch (failure) { return send(503, { error: sanitizeServiceError(failure instanceof Error ? failure.message : "Preprod is unavailable.") }); }
  };
  return { middleware, async close() { await job; if (settlement) await settlement.then(current => current.close()).catch(() => {}); if (runtime) await runtime.then(current => current.close()).catch(() => {}); } };
}
