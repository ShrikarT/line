#!/usr/bin/env node
/**
 * Thin MCP wrapper. The product is the contract, not this file.
 * Tools: line.draw — submit a quote id against the local demo store.
 *
 * Wave 1 talks JSON-RPC-ish over stdin/stdout so an agent can call draw
 * without a browser. Persistence is the same localStorage key the UI uses
 * only when run next to a browser; here we keep an in-memory ledger.
 */
import { createInterface } from "node:readline";

const help = {
  name: "line",
  tools: [
    {
      name: "line.draw",
      description:
        "Attempt a draw authorization against an opaque quote commitment. Returns clearance or a generic failure.",
      input: { quoteId: "string" },
    },
    {
      name: "line.status",
      description: "Public ledger snapshot: status and commitments only.",
      input: {},
    },
  ],
};

const rl = createInterface({ input: process.stdin, terminal: false });

console.error("Line MCP listening on stdin. Product is the Compact state machine.");

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "tools/list") {
    process.stdout.write(JSON.stringify({ id: msg.id, result: help }) + "\n");
    return;
  }
  if (msg.method === "tools/call" && msg.params?.name === "line.status") {
    process.stdout.write(
      JSON.stringify({
        id: msg.id,
        result: {
          note: "Run the web desks for a live ledger. This process is a stub transport.",
        },
      }) + "\n",
    );
    return;
  }
  if (msg.method === "tools/call" && msg.params?.name === "line.draw") {
    process.stdout.write(
      JSON.stringify({
        id: msg.id,
        result: {
          ok: false,
          message: "Clearance could not be proven.",
          hint: "Use the Agent desk in the web app for the Wave 1 demo ledger.",
        },
      }) + "\n",
    );
  }
});
