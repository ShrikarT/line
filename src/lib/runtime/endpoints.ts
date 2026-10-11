/** Public service configuration. Credentials remain in memory; never persist or log full URLs. */
export type MidnightNetwork = "preprod" | "preview" | "mainnet";
export interface EndpointOptions {
  networkId?: string;
  indexerUri?: string;
  indexerWsUri?: string;
  nodeUri?: string;
  proofServerUri?: string;
  blockfrostProjectId?: string;
}
export interface MidnightEndpoints {
  networkId: MidnightNetwork;
  indexerUri: string;
  indexerWsUri: string;
  nodeUri: string;
  proofServerUri: string;
}
export function normalizeNetworkId(value = "preprod"): MidnightNetwork {
  const id = value.replace(/^midnight-/, "");
  if (id === "preprod" || id === "preview" || id === "mainnet") return id;
  throw new Error("Select a supported Midnight network: preprod, preview or mainnet.");
}
function endpoint(value: string, websocket: boolean, token?: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Network service configuration requires an absolute URL."); }
  const protocols = websocket ? ["wss:", "ws:"] : ["https:", "http:"];
  if (!protocols.includes(url.protocol) || url.username || url.password) throw new Error("Invalid network service URL.");
  if (/^(?:rpc|indexer)\.(?:preprod|mainnet|testnet-02)\.midnight\.network$/.test(url.hostname)) {
    throw new Error("This Midnight endpoint has been retired. Configure the current provider for the selected network.");
  }
  if (url.hostname.endsWith(".blockfrost.io") && token) url.searchParams.set("project_id", token);
  return url.href;
}
export function resolveMidnightEndpoints(options: EndpointOptions = {}): MidnightEndpoints {
  const networkId = normalizeNetworkId(options.networkId);
  const blockfrost = networkId !== "preview";
  const indexer = blockfrost ? `https://midnight-${networkId}.blockfrost.io/api/v0` : "https://indexer.preview.midnight.network/api/v4/graphql";
  const ws = blockfrost ? `wss://midnight-${networkId}.blockfrost.io/api/v0/ws` : "wss://indexer.preview.midnight.network/api/v4/graphql/ws";
  const node = blockfrost ? `https://rpc.midnight-${networkId}.blockfrost.io` : "https://rpc.preview.midnight.network";
  const token = options.blockfrostProjectId?.trim();
  return {
    networkId,
    indexerUri: endpoint(options.indexerUri ?? indexer, false, token),
    indexerWsUri: endpoint(options.indexerWsUri ?? ws, true, token),
    nodeUri: endpoint(options.nodeUri ?? node, false, token),
    proofServerUri: endpoint(options.proofServerUri ?? "http://127.0.0.1:6300", false),
  };
}
/** Call before network I/O, allowing unconfigured setup screens to render first. */
export function assertEndpointCredentials(endpoints: MidnightEndpoints): void {
  for (const value of [endpoints.indexerUri, endpoints.indexerWsUri, endpoints.nodeUri]) {
    const url = new URL(value);
    if (url.hostname.endsWith(".blockfrost.io")) {
      if (!url.hostname.includes(`midnight-${endpoints.networkId}.`)) throw new Error("Provider endpoint does not match the selected Midnight network.");
      if (!url.searchParams.get("project_id")?.trim()) throw new Error(`Configure a Blockfrost Midnight ${endpoints.networkId} project token before connecting.`);
    }
  }
}
export function redactEndpoint(value: string): string {
  try {
    const url = new URL(value);
    url.username = ""; url.password = "";
    for (const name of [...url.searchParams.keys()]) url.searchParams.set(name, "[redacted]");
    url.hash = "";
    return url.href;
  } catch { return "[invalid service URL]"; }
}
export function sanitizeServiceError(message: string): string {
  return message.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/g, value => redactEndpoint(value))
    .replace(/(project_id\s*[=:]\s*)[^\s&"'<>]+/gi, "$1[redacted]");
}
