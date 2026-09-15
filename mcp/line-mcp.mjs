#!/usr/bin/env node
/**
 * Line MCP server — JSON-RPC over stdin/stdout.
 *
 * Tools:
 *   line.status  public ledger only (no books)
 *   line.draw    invoke the same reference engine as the desks
 *   line.seed    load scripted demo snapshot N (0–10)
 *
 * State file: .line-mcp-state.json in the working directory.
 * This is a local simulator, not a Midnight node.
 */
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const STATE_PATH = process.env.LINE_MCP_STATE ?? join(process.cwd(), ".line-mcp-state.json");

const tools = [
  {
    name: "line.status",
    description: "Public ledger snapshot: status, commitments, action clock, generation. Never returns books.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "line.draw",
    description:
      "Attempt a draw against an opaque quote commitment already posted on the local ledger.",
    inputSchema: {
      type: "object",
      properties: { quoteId: { type: "string" } },
      required: ["quoteId"],
    },
  },
  {
    name: "line.seed",
    description: "Load a scripted demo snapshot (0–10) into the MCP ledger.",
    inputSchema: {
      type: "object",
      properties: { step: { type: "number" } },
      required: ["step"],
    },
  },
];

function readState() {
  if (!existsSync(STATE_PATH)) return null;
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

function writeState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function publicStatus(ledger) {
  return {
    status: ledger.status,
    actionClock: ledger.actionClock,
    lineGeneration: ledger.lineGeneration,
    identityCommitment: ledger.identityCommitment,
    lineCommitment: ledger.lineCommitment,
    contractDomain: ledger.contractDomain,
    quotes: ledger.quotes.map((q) => ({
      commitment: q.commitment,
      lineGeneration: q.lineGeneration,
      used: q.used,
    })),
    nullifiers: ledger.nullifiers,
    note: "Books are not in this view. Wave 1 is authorization, not settlement.",
  };
}

export async function handleMessage(msg) {
  const protocol = await import("../src/lib/line/protocol.ts");
  const demo = await import("../src/lib/line/demo.ts");
  const encoding = await import("../src/lib/line/encoding.ts");

  if (msg.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "line", version: "0.2.0" },
        capabilities: { tools: {} },
      },
    };
  }

  if (msg.method === "tools/list") {
    return { jsonrpc: "2.0", id: msg.id, result: { tools } };
  }

  if (msg.method !== "tools/call") {
    return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } };
  }

  const name = msg.params?.name;
  const args = msg.params?.arguments ?? {};

  if (name === "line.seed") {
    const step = Number(args.step ?? 0);
    const snap = demo.snapshotAt(step);
    writeState({
      ledger: snap.ledger,
      agent: snap.agent,
      invoices: snap.invoices,
    });
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, step: snap.step, public: publicStatus(snap.ledger) }) },
        ],
      },
    };
  }

  if (name === "line.status") {
    const state = readState();
    if (!state) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                note: "Empty MCP ledger. Call line.seed or use the web desks.",
                status: "none",
              }),
            },
          ],
        },
      };
    }
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(publicStatus(state.ledger)) }],
      },
    };
  }

  if (name === "line.draw") {
    const state = readState();
    const quoteId = args.quoteId;
    if (!state?.agent?.witness || !quoteId) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ ok: false, message: "Clearance could not be proven." }) }],
        },
      };
    }
    const inv = (state.invoices ?? []).find((i) => i.Q === quoteId || i.invoiceId === quoteId);
    if (!inv) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ ok: false, message: "Clearance could not be proven." }) }],
        },
      };
    }
    const r = protocol.draw(state.ledger, {
      agentSecret: state.agent.secret,
      witness: state.agent.witness,
      quote: inv.preimage,
      newSalt: encoding.toHex(encoding.randomBytes32()),
    });
    if (!r.ok) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ ok: false, message: r.message }) }],
        },
      };
    }
    state.ledger = r.ledger;
    state.agent = r.agent;
    state.invoices = state.invoices.map((i) => (i.Q === inv.Q ? { ...i, used: true } : i));
    writeState(state);
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              public: publicStatus(r.ledger),
              note: "Authorization recorded. Amount is not disclosed.",
            }),
          },
        ],
      },
    };
  }

  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown tool" } };
}

const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  console.error("Line MCP listening on stdin. Simulator only — not a Midnight node.");
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const res = await handleMessage(msg);
    process.stdout.write(JSON.stringify(res) + "\n");
  });
}
