import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { networkSessionMiddleware } from "./network-session.ts";

test("local configuration supports only an explicit same-origin browser session and never caches the token", async () => {
  const middleware = networkSessionMiddleware("session-fixture-token");
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const rejectedHeaders: Record<string, string>[] = [{}, { Origin: "https://external.example", "X-Line-Session": "network-setup" }, { Origin: origin }];
    for (const headers of rejectedHeaders) {
      const response = await fetch(`${origin}/api/line/network-session`, { method: "POST", headers });
      assert.equal(response.status, 403);
      assert(!(await response.text()).includes("session-fixture-token"));
    }
    const headers = { Origin: origin, "X-Line-Session": "network-setup" };
    const wrongMethod = await fetch(`${origin}/api/line/network-session`, { headers });
    assert.equal(wrongMethod.status, 405);
    const response = await fetch(`${origin}/api/line/network-session`, { method: "POST", headers });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { networkId: "preprod", blockfrostProjectId: "session-fixture-token" });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
