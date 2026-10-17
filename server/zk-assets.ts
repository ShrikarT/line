import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveContractRelease, validateContractArtifacts } from "../scripts/contract-artifacts.mjs";

/** The deployed static build and local server expose the same public manifest. */
export function publicOrganizationManifest(release: ReturnType<typeof validateContractArtifacts>) {
  return { profile: "organization", inputs: release.inputs, files: release.files };
}

/** Dev/preview only. Serve proving material, never private state or deployer credentials. */
export function zkAssetMiddleware() {
  let release: ReturnType<typeof validateContractArtifacts> | null = null;
  let organization: ReturnType<typeof validateContractArtifacts> | null = null;
  try { release = validateContractArtifacts({ artifactDir: resolveContractRelease() }); }
  catch { /* Checkout remains available without a configured network release. */ }
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? "").split("?")[0];
    const organizationRequest = url.startsWith("/organization-zk/");
    if (!organizationRequest && !url.startsWith("/line-zk/")) return next();
    const fail = (status: number, message: string) => {
      res.writeHead(status, { "Content-Type": "text/plain", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(message);
    };
    if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "Use GET or HEAD.");
    if (organizationRequest && !organization) {
      try { organization = validateContractArtifacts({ artifactDir: resolveContractRelease({ profile: "organization" }), profile: "organization" }); }
      catch { return fail(503, "The organization-funded contract release is unavailable or does not match its source."); }
    }
    const selected = organizationRequest ? organization : release;
    if (!selected) return fail(503, "A validated full Line release is required. Run compact:compile:release and restart the server.");
    const path = url.slice((organizationRequest ? "/organization-zk/" : "/line-zk/").length);
    if (path !== "release.json" && !/^(?:keys\/[a-zA-Z]+\.(?:prover|verifier)|zkir\/[a-zA-Z]+\.bzkir)$/.test(path)) return fail(404, "Proving asset not found.");
    try {
      const source = readFileSync(join(process.cwd(), selected.inputs.source.path));
      if (createHash("sha256").update(source).digest("hex") !== selected.inputs.source.sha256) return fail(503, "The source changed. Generate a fresh release and restart the server.");
      if (path === "release.json") {
        if (!organizationRequest) return fail(404, "Proving asset not found.");
        const bytes = JSON.stringify(publicOrganizationManifest(selected));
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        return res.end(req.method === "HEAD" ? undefined : bytes);
      }
      const expected = selected.files[path];
      if (!expected) return fail(404, "Proving asset not found.");
      const bytes = readFileSync(join(selected.artifactDir, path));
      if (bytes.length !== expected.size || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) return fail(503, "Release asset integrity check failed.");
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length,
        "Cache-Control": "no-cache", "ETag": `"${expected.sha256}"`, "X-Content-Type-Options": "nosniff" });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch { fail(503, "Proving asset is unavailable."); }
  };
}
