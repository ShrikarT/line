#!/usr/bin/env node
/**
 * Line MCP server — JSON-RPC over stdin/stdout.
 *
 * Tools:
 *   line.status         public ledger snapshot (no private books)
 *   line.reserve.status public reserve accounting (total, encumbered, redeemed, withdrawable)
 *   line.seed           load scripted demo snapshot (0–18)
 *   line.quote          merchant creates quote commitment
 *   line.draw           agent draws and issues private settlement note
 *   line.note.status    status of issued draw notes
 *   line.redeem         merchant redeems draw note against issuer reserve
 *   line.repay          issuer acknowledges repayment
 *
 * State file: .line-mcp-state.json in the working directory.
 * This is a local simulator, not a Midnight node.
 */
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const STATE_PATH = process.env.LINE_MCP_STATE ?? join(process.cwd(), ".line-mcp-state.json");

const tools = [
  {
    name: "line.status",
    description: "Public ledger snapshot: status, commitments, action clock, generation, reserves. Never returns books.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "line.reserve.status",
    description: "Public reserve accounting: total, encumbered, redeemed, and withdrawable capacity.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "line.seed",
    description: "Load a scripted demo snapshot (0–18) into the MCP ledger.",
    inputSchema: {
      type: "object",
      properties: { step: { type: "number" } },
      required: ["step"],
    },
  },
  {
    name: "line.quote",
    description: "Post a private quote commitment from a registered merchant.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        invoiceId: { type: "string" },
        merchantSecret: { type: "string" },
      },
      required: ["amount", "invoiceId"],
    },
  },
  {
    name: "line.draw",
    description:
      "Attempt a private draw against an opaque quote commitment already posted on the local ledger.",
    inputSchema: {
      type: "object",
      properties: { quoteId: { type: "string" } },
      required: ["quoteId"],
    },
  },
  {
    name: "line.note.status",
    description: "Inspect public metadata of settlement notes (redemption and expiry status).",
    inputSchema: {
      type: "object",
      properties: { noteCommitment: { type: "string" } },
    },
  },
  {
    name: "line.redeem",
    description: "Merchant proves ownership and redeems a settlement note against issuer reserve.",
    inputSchema: {
      type: "object",
      properties: {
        noteCommitment: { type: "string" },
        merchantSecret: { type: "string" },
      },
      required: ["noteCommitment"],
    },
  },
  {
    name: "line.repay",
    description: "Issuer acknowledges an off-chain repayment and restores capacity.",
    inputSchema: {
      type: "object",
      properties: { amount: { type: "number" } },
      required: ["amount"],
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
  const locked = (ledger.encumberedReserve ?? 0) + (ledger.redeemedReserve ?? 0);
  const withdrawable = Math.max(0, (ledger.totalReserve ?? 0) - locked);
  return {
    status: ledger.status,
    actionClock: ledger.actionClock,
    lineGeneration: ledger.lineGeneration,
    identityCommitment: ledger.identityCommitment,
    lineCommitment: ledger.lineCommitment,
    contractDomain: ledger.contractDomain,
    totalReserve: ledger.totalReserve,
    encumberedReserve: ledger.encumberedReserve,
    redeemedReserve: ledger.redeemedReserve,
    withdrawableReserve: withdrawable,
    quotes: (ledger.quotes ?? []).map((q) => ({
      commitment: q.commitment,
      lineGeneration: q.lineGeneration,
      used: q.used,
    })),
    notes: (ledger.notes ?? []).map((n) => ({
      commitment: n.commitment,
      amount: n.amount,
      redeemed: n.redeemed,
      cancelled: n.cancelled,
      expiry: n.expiry,
      lineGeneration: n.lineGeneration,
    })),
    nullifiers: ledger.nullifiers,
    note: "Public view only. Private credit books (limit, balance, quote preimage) are confidential.",
  };
}

export async function handleMessage(msg) {
  const protocol = await import("../src/lib/line/protocol.ts");
  const demo = await import("../src/lib/line/demo.ts");
  const encoding = await import("../src/lib/line/encoding.ts");
  const keys = await import("../src/lib/line/keys.ts");

  if (msg.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "line", version: "0.3.0" },
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
      notes: snap.notes,
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

  if (name === "line.reserve.status") {
    const state = readState();
    if (!state) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ total: 0, encumbered: 0, redeemed: 0, withdrawable: 0 }) }],
        },
      };
    }
    const locked = (state.ledger.encumberedReserve ?? 0) + (state.ledger.redeemedReserve ?? 0);
    const withdrawable = Math.max(0, (state.ledger.totalReserve ?? 0) - locked);
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              totalReserve: state.ledger.totalReserve,
              encumberedReserve: state.ledger.encumberedReserve,
              redeemedReserve: state.ledger.redeemedReserve,
              withdrawableReserve: withdrawable,
            }),
          },
        ],
      },
    };
  }

  if (name === "line.quote") {
    const state = readState();
    if (!state) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: "No active ledger" }) }] },
      };
    }
    const merchantSecret = args.merchantSecret ?? keys.MERCHANT_A_SK;
    const r = protocol.postQuote(state.ledger, {
      caller: merchantSecret,
      amount: Number(args.amount),
      invoiceId: String(args.invoiceId),
      expiry: state.ledger.actionClock + 10_000,
      nonce: encoding.toHex(encoding.randomBytes32()),
    });
    if (!r.ok) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: r.reason }) }] },
      };
    }
    state.ledger = r.ledger;
    state.invoices = state.invoices ?? [];
    state.invoices.push({
      invoiceId: String(args.invoiceId),
      amount: Number(args.amount),
      Q: r.Q,
      used: false,
      preimage: r.quote,
    });
    writeState(state);
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: JSON.stringify({ ok: true, quoteCommitment: r.Q }) }],
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
      noteNonce: encoding.toHex(encoding.randomBytes32()),
      noteSalt: encoding.toHex(encoding.randomBytes32()),
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
    state.notes = state.notes ?? [];
    state.notes.push(r.note);
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
              noteCommitment: r.note.D,
              note: "Authorization recorded and settlement note created. Books remain private.",
            }),
          },
        ],
      },
    };
  }

  if (name === "line.note.status") {
    const state = readState();
    const target = args.noteCommitment;
    const notes = state?.ledger?.notes ?? [];
    if (target) {
      const match = notes.find((n) => n.commitment === target);
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(match ?? { found: false }) }],
        },
      };
    }
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: { content: [{ type: "text", text: JSON.stringify(notes) }] },
    };
  }

  if (name === "line.redeem") {
    const state = readState();
    const target = args.noteCommitment;
    const note = (state?.notes ?? []).find((n) => n.D === target);
    if (!note) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ ok: false, message: "Note opening not found in merchant store" }) }],
        },
      };
    }
    const merchantSecret =
      args.merchantSecret ??
      (note.preimage.merchantPk === keys.MERCHANT_B_PK ? keys.MERCHANT_B_SK : keys.MERCHANT_A_SK);
    const r = protocol.redeemDraw(state.ledger, {
      caller: merchantSecret,
      noteCommitment: note.D,
      notePreimage: note.preimage,
      noteSalt: note.salt,
    });
    if (!r.ok) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ ok: false, message: r.reason }) }],
        },
      };
    }
    state.ledger = r.ledger;
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
              nullifier: r.N_redeem,
              public: publicStatus(r.ledger),
              message: "Settlement note redeemed successfully against reserve.",
            }),
          },
        ],
      },
    };
  }

  if (name === "line.repay") {
    const state = readState();
    if (!state?.agent?.witness || !state.ledger.lineCommitment) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: "No active line" }) }] },
      };
    }
    const amount = Number(args.amount);
    const rcpt = {
      identity: state.agent.witness.I,
      currentC: state.ledger.lineCommitment,
      amount,
      paymentRef: "mcp-repay",
      nonce: encoding.toHex(encoding.randomBytes32()),
      expiry: state.ledger.actionClock + 10_000,
      contractDomain: state.ledger.contractDomain,
    };
    const r = protocol.acknowledgeRepayment(state.ledger, {
      caller: keys.ISSUER_SK,
      witness: state.agent.witness,
      receipt: rcpt,
      newSalt: encoding.toHex(encoding.randomBytes32()),
    });
    if (!r.ok) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: r.reason }) }] },
      };
    }
    state.ledger = r.ledger;
    state.agent.witness = r.witness;
    writeState(state);
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: JSON.stringify({ ok: true, public: publicStatus(r.ledger) }) }],
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
