import type { IncomingMessage, ServerResponse } from "node:http";

/** Local dev/preview convenience. Tokens remain session-only browser inputs. */
export function networkSessionMiddleware(projectToken?: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if ((req.url ?? "").split("?")[0] !== "/api/line/network-session") return next();
    const send = (status: number, value: object) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(JSON.stringify(value));
    };
    const peer = req.socket.remoteAddress;
    const loopback = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
    let origin: URL;
    try { origin = new URL(req.headers.origin ?? ""); } catch { return send(403, { error: "Local browser session required." }); }
    if (!loopback || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
        origin.protocol !== "http:" || origin.host !== req.headers.host ||
        req.headers["x-line-session"] !== "network-setup") return send(403, { error: "Local browser session required." });
    if (req.method !== "POST") return send(405, { error: "Use POST." });
    if (!projectToken?.trim()) return send(404, { error: "Enter a Preprod token in network setup." });
    send(200, { networkId: "preprod", blockfrostProjectId: projectToken.trim() });
  };
}
