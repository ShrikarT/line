import type { IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { sanitizeServiceError } from "../src/lib/runtime/endpoints.ts";
import type { PreprodSummary } from "../src/lib/preprod.ts";

interface NativeRuntime {
  busy?: boolean; summary(): PreprodSummary; setup(): Promise<PreprodSummary>;
  purchase(id: string, document: string): Promise<PreprodSummary>; acknowledge(id: string): Promise<PreprodSummary>; close(): Promise<void>;
}
interface Options { env: Record<string, string | undefined>; create?: () => Promise<NativeRuntime> }
export function preprodMiddleware({ env, create }: Options) {
  let runtime: Promise<NativeRuntime> | undefined; let job: Promise<void> | null = null; let error: string | null = null;
  const initialize = () => runtime ??= create ? create() : import(pathToFileURL(`${process.cwd()}/server/preprod-live.mjs`).href)
    .then(module => module.PreprodLive.create(env) as Promise<NativeRuntime>);
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? "").split("?")[0]; if (!path.startsWith("/api/preprod/")) return next();
    const send = (status: number, value: object) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(JSON.stringify(value)); };
    const peer = req.socket.remoteAddress; let origin: URL;
    try { origin = new URL(req.headers.origin ?? req.headers.referer ?? ""); } catch { return send(403, { error: "Open the local operator console." }); }
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer ?? "") || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
      origin.protocol !== "http:" || origin.host !== req.headers.host || req.headers["x-line-preprod"] !== "operator") return send(403, { error: "Open the local operator console." });
    if (env.LINE_LIVE_PREPROD !== "1") return send(503, { error: "Live Preprod checkout is not enabled on this server." });
    try {
      if (req.method === "GET" && path === "/api/preprod/status") { const current = await initialize(); return send(200, { ...current.summary(), busy: !!job, error }); }
      if (req.method !== "POST" || !["/api/preprod/purchase", "/api/preprod/acknowledge"].includes(path)) return send(404, { error: "Unknown Preprod action." });
      if (job) return send(409, { error: "A Preprod operation is already running." });
      let bytes = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) return send(413, { error: "Request is too large." }); chunks.push(Buffer.from(chunk)); }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { requestId?: unknown; document?: unknown };
      if (typeof input.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(input.requestId)) return send(400, { error: "A stable request ID is required." });
      if (path.endsWith("purchase") && (typeof input.document !== "string" || !input.document.trim() || input.document.length > 5000)) return send(400, { error: "Enter a document of up to 5000 characters." });
      error = null;
      const requestId = input.requestId, document = input.document as string;
      job = Promise.resolve().then(initialize).then(async current => {
        if (path.endsWith("purchase")) await current.purchase(requestId, document); else await current.acknowledge(requestId);
      }).catch(failure => { error = sanitizeServiceError(failure instanceof Error ? failure.message : "Preprod operation requires reconciliation."); }).finally(() => { job = null; });
      return send(202, { accepted: true, requestId });
    } catch (failure) { return send(503, { error: sanitizeServiceError(failure instanceof Error ? failure.message : "Preprod is unavailable.") }); }
  };
  return { middleware, async close() { await job; if (runtime) await runtime.then(current => current.close()).catch(() => {}); } };
}
