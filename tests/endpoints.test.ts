import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveMidnightEndpoints, assertEndpointCredentials, redactEndpoint, sanitizeServiceError } from "../src/lib/runtime/endpoints.ts";
describe("Midnight service configuration", () => {
  it("uses current Preprod services and requires credentials before I/O", () => {
    const config = resolveMidnightEndpoints();
    assert.equal(config.networkId, "preprod");
    assert.equal(config.indexerUri, "https://midnight-preprod.blockfrost.io/api/v0");
    assert.throws(() => assertEndpointCredentials(config), /project token/);
    const authenticated = resolveMidnightEndpoints({ networkId: "midnight-preprod", blockfrostProjectId: "test token&value" });
    assertEndpointCredentials(authenticated);
    for (const value of [authenticated.indexerUri, authenticated.indexerWsUri, authenticated.nodeUri]) assert.equal(new URL(value).searchParams.get("project_id"), "test token&value");
  });
  it("preserves explicit services and selects Preview only when requested", () => {
    const custom = resolveMidnightEndpoints({ indexerUri: "http://localhost:8080/graphql", indexerWsUri: "ws://localhost:8080/graphql/ws", nodeUri: "http://localhost:9944" });
    assertEndpointCredentials(custom);
    assert.equal(custom.networkId, "preprod");
    const preview = resolveMidnightEndpoints({ networkId: "preview" });
    assertEndpointCredentials(preview);
    assert.equal(preview.nodeUri, "https://rpc.preview.midnight.network/");
  });
  it("rejects retired, wrong-network, and malformed service configurations", () => {
    assert.throws(() => resolveMidnightEndpoints({ networkId: "midnight-testnet" }), /supported/);
    assert.throws(() => resolveMidnightEndpoints({ nodeUri: "https://rpc.preprod.midnight.network" }), /retired/);
    assert.throws(() => resolveMidnightEndpoints({ indexerWsUri: "https://example.test/ws" }), /Invalid/);
    assert.throws(() => resolveMidnightEndpoints({ nodeUri: "https://user:secret@example.test" }), /Invalid/);
    const wrong = resolveMidnightEndpoints({ nodeUri: "https://rpc.midnight-mainnet.blockfrost.io?project_id=secret", blockfrostProjectId: "secret" });
    assert.throws(() => assertEndpointCredentials(wrong), /does not match/);
  });
  it("redacts all URL credentials in logs and service errors", () => {
    const value = "https://user:secret@midnight-preprod.blockfrost.io/api/v0?project_id=confidential&other=hidden#private";
    const redacted = redactEndpoint(value);
    for (const secret of ["secret", "confidential", "hidden", "private", "user"]) assert.ok(!redacted.includes(secret));
    const error = sanitizeServiceError(`Request failed: ${value}; project_id=confidential`);
    assert.ok(!error.includes("confidential"));
  });
});
