import type { Configuration } from "@midnight-ntwrk/dapp-connector-api";
import { assertEndpointCredentials, resolveMidnightEndpoints } from "../runtime/endpoints.ts";
import type { OrganizationSupplierClient } from "./supplier-client.ts";

const READS = ["indexerUri", "indexerWsUri"] as const;
const requiresToken = (value: string) => { const url = new URL(value); return url.hostname.endsWith(".blockfrost.io") && !url.searchParams.get("project_id")?.trim(); };

/** Known retired Preprod readers cannot serve ledger observations. Select the
 * current default instead; missing credentials then require authenticated Line reads.
 * Invalid URLs and credentials still reach the strict endpoint validator below.
 */
function currentReader(value: string, websocket: boolean): string | undefined {
  try {
    const url = new URL(value);
    const protocols = websocket ? ["wss:", "ws:"] : ["https:", "http:"];
    if (protocols.includes(url.protocol) && !url.username && !url.password &&
      /^(?:indexer|rpc)\.preprod\.midnight\.network$/.test(url.hostname)) return undefined;
  } catch { /* The shared validator reports malformed configuration. */ }
  return value;
}

/** Prefer usable wallet readers. Missing credentials and known retired Preprod
 * readers use Line's authenticated same-origin readers. Submission/proving stay in the wallet.
 */
export async function organizationReadEndpoints(configuration: Configuration, supplier: Pick<OrganizationSupplierClient, "request">, origin: string, transport: typeof fetch = fetch): Promise<{ indexerUri: string; indexerWsUri: string; authorize?: () => Promise<void> }> {
  if (configuration.networkId !== "preprod") throw new Error("Organization reads require a Midnight Preprod wallet network.");
  // This adapter only selects read services. The wallet owns submission and its
  // node configuration must not prevent an otherwise valid read connection.
  const endpoints = resolveMidnightEndpoints({ networkId: "preprod", indexerUri: currentReader(configuration.indexerUri, false), indexerWsUri: currentReader(configuration.indexerWsUri, true) });
  if (READS.some(key => requiresToken(endpoints[key])) && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)) {
    // The historical local operator helper is never requested by a public site.
    const response = await transport.call(globalThis, new URL("/api/line/network-session", origin), { method: "POST", headers: { "X-Line-Session": "network-setup" }, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (response?.ok) {
      const value = await response.json();
      if (value.networkId === "preprod" && typeof value.blockfrostProjectId === "string" && value.blockfrostProjectId.trim()) for (const key of READS) {
        if (requiresToken(endpoints[key])) { const url = new URL(endpoints[key]); url.searchParams.set("project_id", value.blockfrostProjectId); endpoints[key] = url.href; }
      }
    }
  }
  assertEndpointCredentials(endpoints, READS.filter(key => !requiresToken(endpoints[key])));
  if (READS.some(key => requiresToken(endpoints[key]))) {
    const value = await supplier.request("network") as Record<string, unknown>;
    const expectedHttp = new URL("/api/organization/network/indexer", origin).href;
    const expectedWs = new URL(expectedHttp); expectedWs.protocol = expectedWs.protocol === "https:" ? "wss:" : "ws:"; expectedWs.pathname += "/ws";
    if (value?.networkId !== "preprod" || value.indexerUri !== expectedHttp || value.indexerWsUri !== expectedWs.href) throw new Error("Line returned an invalid Preprod read connection. No transaction was submitted.");
    return { indexerUri: requiresToken(endpoints.indexerUri) ? expectedHttp : endpoints.indexerUri, indexerWsUri: requiresToken(endpoints.indexerWsUri) ? expectedWs.href : endpoints.indexerWsUri, authorize: async () => { await supplier.request("network"); } };
  }
  assertEndpointCredentials(endpoints, READS);
  return { indexerUri: endpoints.indexerUri, indexerWsUri: endpoints.indexerWsUri };
}
