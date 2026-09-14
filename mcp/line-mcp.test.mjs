import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("MCP interface", () => {
  let handleMessage;
  let dir;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "line-mcp-"));
    process.env.LINE_MCP_STATE = join(dir, "state.json");
    ({ handleMessage } = await import("./line-mcp.mjs"));
  });

  it("lists tools", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = res.result.tools.map((t) => t.name);
    assert.ok(names.includes("line.status"));
    assert.ok(names.includes("line.draw"));
    assert.ok(names.includes("line.seed"));
  });

  it("status on empty ledger is public-only", async () => {
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "line.status", arguments: {} },
    });
    const body = JSON.parse(res.result.content[0].text);
    assert.equal(body.status, "none");
    assert.equal(JSON.stringify(body).includes("150"), false);
  });

  it("seed + replay draw returns generic failure", async () => {
    await handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "line.seed", arguments: { step: 4 } },
    });
    const status = await handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "line.status", arguments: {} },
    });
    const pub = JSON.parse(status.result.content[0].text);
    assert.equal(pub.status, "open");
    assert.ok(pub.lineCommitment);
    assert.equal(Object.prototype.hasOwnProperty.call(pub, "limit"), false);

    const usedQ = pub.quotes.find((q) => q.used)?.commitment;
    assert.ok(usedQ);
    const draw = await handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "line.draw", arguments: { quoteId: usedQ } },
    });
    const body = JSON.parse(draw.result.content[0].text);
    assert.equal(body.ok, false);
    assert.equal(body.message, "Clearance could not be proven.");
  });
});
