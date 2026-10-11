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
 *   line.expireNote     expire a note and lock its compensation budget
 *   line.compensate     allocate credit and a private cash obligation once
 *   line.refund.acknowledge issuer reports a refund; no actual cash verification
 *   line.withdrawFees   issuer releases fees earned at claim redemption
 *   line.disableMerchant issuer disables a merchant (blocks new quotes only)
 *   line.repay          issuer acknowledges repayment
 *
 * State file: .line-mcp-state.json in the working directory.
 * This is a local simulator, not a Midnight node.
 */
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateRefundRecord } from "../src/lib/line/types.ts";

const STATE_PATH = process.env.LINE_MCP_STATE ?? join(process.cwd(), ".line-mcp-state.json");
const COMPENSATION_POLICY = "private-refund-full-cost-lock-v1";

const tools = [
  {
    name: "line.status",
    description: "Public ledger snapshot: status, commitments, action clock, generation, reserves. Never returns books.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "line.reserve.status",
    description: "Public reserve accounting: claims, pending/earned fees, compensation and reported-refund budgets, and withdrawable capacity.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "line.seed",
    description: "Load a scripted demo snapshot (0–18) into the MCP ledger.",
    inputSchema: {
      type: "object",
      properties: { step: { type: "number" }, feeFlat: { type: "integer", minimum: 0 }, feeBps: { type: "integer", minimum: 0, maximum: 10000 } },
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
      properties: {
        quoteId: { type: "string" },
        fee: { type: "number", description: "Optional explicit fee; must equal the issuer-approved quote fee. Omission computes the exact agreed fee." },
      },
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
    name: "line.expireNote",
    description: "Expire an unredeemed draw note and lock its full principal-plus-fee budget for compensation. Does not credit debt or pay cash.",
    inputSchema: {
      type: "object",
      properties: {
        noteCommitment: { type: "string" },
      },
      required: ["noteCommitment"],
    },
  },
  {
    name: "line.compensate",
    description: "Allocate compensation for an expired unredeemed note once: offset the original borrower's debt and privately commit any cash still owed. Old-generation notes cannot affect a new book.",
    inputSchema: { type: "object", properties: { noteCommitment: { type: "string" } }, required: ["noteCommitment"] },
  },
  {
    name: "line.refund.acknowledge",
    description: "Issuer reports a cash refund against its exact private obligation and a unique payment reference. No actual cash is verified; the full original-cost budget stays locked.",
    inputSchema: { type: "object", properties: { noteCommitment: { type: "string" }, paymentRef: { type: "string" } }, required: ["noteCommitment", "paymentRef"] },
  },
  {
    name: "line.withdrawFees",
    description: "Issuer releases accounting fees earned at merchant claim redemption. Pending draw fees cannot be withdrawn; no tokens move.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "line.disableMerchant",
    description:
      "Issuer disables a registered merchant: blocks their new quotes; already-posted quotes stay drawable.",
    inputSchema: {
      type: "object",
      properties: {
        merchantPk: { type: "string", description: "Merchant public key (hex). Defaults to merchant B." },
      },
    },
  },
  {
    name: "line.repay",
    description: "Issuer acknowledges an off-chain repayment and restores capacity.",
    inputSchema: {
      type: "object",
      properties: { amount: { type: "number" }, paymentRef: { type: "string", description: "Optional explicit issuer-reported event identity. Omission uses the one-use mcp-repay demo reference." } },
      required: ["amount"],
    },
  },
];

function readState() {
  if (!existsSync(STATE_PATH)) return null;
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  if (state?.deadlineUnits !== "unix-seconds") {
    throw new Error("Legacy MCP deadline units are unsupported. Call line.seed to reset this local simulator state; action-count deadlines cannot be converted to Unix seconds.");
  }
  if (state?.feePolicy !== "flat-plus-ceil-bps-v1" || !Number.isSafeInteger(state.ledger?.feeFlat) ||
      state.ledger.feeFlat < 0 || !Number.isSafeInteger(state.ledger?.feeBps) || state.ledger.feeBps < 0 || state.ledger.feeBps > 10000) {
    throw new Error("Legacy MCP fee policy is unsupported. Call line.seed to reset this local simulator state; unpriced quotes cannot be migrated automatically.");
  }
  if (state?.compensationPolicy !== COMPENSATION_POLICY || !Array.isArray(state.refunds) ||
      ["totalReserve", "encumberedReserve", "redeemedReserve", "feeReserve", "pendingFeeReserve", "refundReserve", "reportedRefundReserve"].some(field => !Number.isSafeInteger(state.ledger?.[field]) || state.ledger[field] < 0) ||
      !Array.isArray(state.ledger?.notes) || !Array.isArray(state.notes) ||
      (state.ledger?.notes ?? []).some(note => !Number.isSafeInteger(note.fee) || note.fee < 0 || typeof note.compensationAllocated !== "boolean" || typeof note.cashRefundOwed !== "boolean" || typeof note.refundAcknowledged !== "boolean" || typeof note.refundCommitment !== "string" || typeof note.refundPaymentNullifier !== "string" || !HEX64.test(note.refundPaymentNullifier)) ||
      (state.notes ?? []).some(note => !Number.isSafeInteger(note.preimage?.fee) || note.preimage.fee < 0)) {
    throw new Error("Legacy MCP compensation policy is unsupported. Call line.seed to explicitly reset this local simulator state; old fee-unbound notes and refund budgets cannot be migrated automatically.");
  }
  if (["encumberedReserve", "redeemedReserve", "feeReserve", "pendingFeeReserve", "refundReserve", "reportedRefundReserve"].reduce((sum, field) => sum + BigInt(state.ledger[field]), 0n) > BigInt(state.ledger.totalReserve)) {
    throw new Error("MCP compensation reserve deficit. Call line.seed to explicitly reset this invalid local simulator state.");
  }
  for (const refund of state.refunds) validateRefundRecord(refund);
  if (state.ledger.notes.some(note => note.refundAcknowledged ? note.refundPaymentNullifier === "0".repeat(64) || !state.ledger.nullifiers.includes(note.refundPaymentNullifier) : note.refundPaymentNullifier !== "0".repeat(64))) {
    throw new Error("Invalid MCP note-bound refund payment identity. Call line.seed to explicitly reset this invalid local simulator state.");
  }
  return state;
}

function writeState(state) {
  writeFileSync(STATE_PATH, JSON.stringify({ ...state, deadlineUnits: "unix-seconds", feePolicy: "flat-plus-ceil-bps-v1", compensationPolicy: COMPENSATION_POLICY }, null, 2));
}

function lockedReserve(ledger) {
  return ledger.encumberedReserve + ledger.redeemedReserve + ledger.feeReserve + ledger.pendingFeeReserve + ledger.refundReserve + ledger.reportedRefundReserve;
}

function publicStatus(ledger) {
  const locked = lockedReserve(ledger);
  const withdrawable = Math.max(0, (ledger.totalReserve ?? 0) - locked);
  return {
    deadlineUnits: "unix-seconds",
    status: ledger.status,
    actionClock: ledger.actionClock,
    lineGeneration: ledger.lineGeneration,
    identityCommitment: ledger.identityCommitment,
    lineCommitment: ledger.lineCommitment,
    contractDomain: ledger.contractDomain,
    totalReserve: ledger.totalReserve,
    encumberedReserve: ledger.encumberedReserve,
    redeemedReserve: ledger.redeemedReserve,
    feeReserve: ledger.feeReserve ?? 0,
    pendingFeeReserve: ledger.pendingFeeReserve,
    refundReserve: ledger.refundReserve,
    reportedRefundReserve: ledger.reportedRefundReserve,
    compensationPolicy: COMPENSATION_POLICY,
    feePolicy: "flat-plus-ceil-bps-v1",
    feeFlat: ledger.feeFlat,
    feeBps: ledger.feeBps,
    withdrawableReserve: withdrawable,
    quotes: (ledger.quotes ?? []).map((q) => ({
      commitment: q.commitment,
      lineGeneration: q.lineGeneration,
      used: q.used,
    })),
    notes: (ledger.notes ?? []).map((n) => ({
      commitment: n.commitment,
      amount: n.amount,
      fee: n.fee,
      redeemed: n.redeemed,
      cancelled: n.cancelled,
      expiry: n.expiry,
      lineGeneration: n.lineGeneration,
      compensationAllocated: n.compensationAllocated,
      refundCommitment: n.refundCommitment,
      cashRefundOwed: n.cashRefundOwed,
      refundAcknowledged: n.refundAcknowledged,
      refundPaymentNullifier: n.refundPaymentNullifier,
    })),
    nullifiers: ledger.nullifiers,
    note: "Public view only. Private credit books (limit, balance, quote preimage) are confidential.",
  };
}

const HEX64 = /^[0-9a-fA-F]{64}$/;

/**
 * M5: asBytes32/pad32 throw on inputs whose UTF-8 bytes exceed 32 (unless the
 * input is exactly 64 hex chars). Pre-validate every string that will be
 * encoded so a bad input yields a clean {ok:false} instead of a crash.
 */
function fitsBytes32(value) {
  if (typeof value !== "string") return false;
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  if (HEX64.test(clean)) return true;
  return new TextEncoder().encode(value).length <= 32;
}

export async function handleMessage(msg) {
  // L10: JSON-RPC notifications (no id, e.g. notifications/initialized) must
  // receive NO response — not even an error.
  const isNotification = msg == null || msg.id === undefined || msg.id === null;
  if (isNotification) return undefined;

  try {
    return await dispatch(msg);
  } catch (err) {
    // M5: never crash the stdio server on a throwing handler — report -32603.
    return {
      jsonrpc: "2.0",
      id: msg.id ?? null,
      error: { code: -32603, message: `internal error: ${err?.message ?? String(err)}` },
    };
  }
}

async function dispatch(msg) {
  const protocol = await import("../src/lib/line/protocol.ts");
  const demo = await import("../src/dev/demo.ts");
  const encoding = await import("../src/lib/line/encoding.ts");
  const keys = await import("../src/test/fixtures/keys.ts");

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
    // L10: guard against non-numeric/NaN step — snapshotAt(NaN) would return a
    // step-0 snapshot mislabeled with step: NaN.
    const step = Number(args.step ?? 0);
    if (!Number.isInteger(step) || step < 0 || step > 18) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: "step must be an integer 0–18" }) }] },
      };
    }
    const feeFlat = args.feeFlat ?? 0, feeBps = args.feeBps ?? 0;
    if (!Number.isSafeInteger(feeFlat) || feeFlat < 0 || !Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps > 10000) {
      return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: "Invalid issuer fee policy." }) }] } };
    }
    const snap = demo.snapshotAt(step, { feeFlat, feeBps });
    writeState({
      ledger: snap.ledger,
      agent: snap.agent,
      invoices: snap.invoices,
      notes: snap.notes,
      refunds: [],
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
          content: [{ type: "text", text: JSON.stringify({ total: 0, encumbered: 0, redeemed: 0, feeReserve: 0, pendingFeeReserve: 0, refundReserve: 0, reportedRefundReserve: 0, withdrawable: 0, compensationPolicy: COMPENSATION_POLICY }) }],
        },
      };
    }
    const locked = lockedReserve(state.ledger);
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
              feeReserve: state.ledger.feeReserve ?? 0,
              pendingFeeReserve: state.ledger.pendingFeeReserve,
              refundReserve: state.ledger.refundReserve,
              reportedRefundReserve: state.ledger.reportedRefundReserve,
              compensationPolicy: COMPENSATION_POLICY,
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
    const invoiceId = String(args.invoiceId);
    // M5: >32-byte invoiceId used to crash the stdio server via pad32 overflow.
    // Validate lengths up front so it returns a clean {ok:false} instead.
    if (!fitsBytes32(invoiceId)) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: "invoiceId exceeds 32 bytes" }) }] },
      };
    }
    if (!fitsBytes32(merchantSecret)) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: "merchantSecret is not a valid 32-byte secret" }) }] },
      };
    }
    const r = protocol.postQuote(
      state.ledger,
      {
        caller: merchantSecret,
        invoiceId,
        expiry: Math.floor(Date.now() / 1000) + 10_000,
        nonce: encoding.toHex(encoding.randomBytes32()),
      },
      // The invoice amount is a private witness: Q commits to it, but it is
      // never a public parameter and never lands on the ledger.
      { amount: Number(args.amount) },
    );
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
      invoiceId,
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
    const r = protocol.draw(
      state.ledger,
      {
        agentSecret: state.agent.secret,
        // PUBLIC: the opaque quote commitment. Books + invoice preimage are witnesses.
        quoteCommit: inv.Q,
        newSalt: encoding.toHex(encoding.randomBytes32()),
        noteNonce: encoding.toHex(encoding.randomBytes32()),
        noteSalt: encoding.toHex(encoding.randomBytes32()),
        fee: args.fee === undefined ? Number(encoding.requiredDrawFee(BigInt(inv.amount), BigInt(state.ledger.feeFlat), BigInt(state.ledger.feeBps))) : Number(args.fee),
      },
      { books: state.agent.witness, quote: inv.preimage },
    );
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
    const notes = state ? publicStatus(state.ledger).notes : [];
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
    const r = protocol.redeemDraw(
      state.ledger,
      {
        caller: merchantSecret,
        noteCommitment: note.D,
        // PUBLIC noteExpiry circuit parameter: the expiry committed in the note.
        noteExpiry: note.preimage.expiry,
        noteSalt: note.salt,
      },
      // The note preimage (incl. the redeemAmount() witness) is private.
      { note: note.preimage },
    );
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

  if (name === "line.expireNote") {
    const state = readState();
    const target = String(args.noteCommitment ?? "");
    if (!state || !target) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: "No active ledger or note commitment" }) }] },
      };
    }
    const r = protocol.cancelOrExpireNote(state.ledger, { noteCommitment: target });
    if (!r.ok) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: r.reason }) }] },
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
              public: publicStatus(r.ledger),
              message: "Expired note cancelled. Full principal-plus-fee budget locked for compensation; no refund paid.",
            }),
          },
        ],
      },
    };
  }

  if (name === "line.compensate" || name === "line.refund.acknowledge") {
    const state = readState(), target = args.noteCommitment;
    const response = body => ({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(body) }] } });
    if (typeof target !== "string" || !target || !state) return response({ ok: false, message: "No active ledger or note commitment" });
    const note = state.notes.find(note => note.D === target);
    if (!note) return response({ ok: false, message: "Original note opening not found in local private store" });
    const schemas = await import("../src/lib/line/types.ts");
    if (name === "line.compensate") {
      const result = protocol.cancelOrExpireNote(state.ledger, {
        caller: keys.ISSUER_SK, action: 1, note,
        compensation: { note: note.preimage, noteSalt: note.salt, newSalt: encoding.toHex(encoding.randomBytes32()), books: state.agent?.witness },
      });
      if (!result.ok) return response({ ok: false, message: result.reason });
      const allocation = result.refund;
      const record = schemas.validateRefundRecord({
        version: 1, networkId: "local-development", contractAddress: "local-mcp", contractDomain: allocation.domain,
        lineGeneration: allocation.lineGeneration, identityCommitment: allocation.identity, noteCommitment: allocation.noteCommit,
        refundCommitment: allocation.commitment, amount: allocation.amount, allocatedCredit: allocation.allocatedCredit,
        salt: allocation.salt, status: "allocated", updatedAt: Date.now(),
      });
      state.ledger = result.ledger;
      if (result.witness) state.agent.witness = result.witness;
      state.refunds.push(record);
      writeState(state);
      return response({ ok: true, public: publicStatus(result.ledger), message: "Compensation allocated once. Any owed cash remains private and unpaid." });
    }
    const stored = state.refunds.find(refund => refund.noteCommitment === target);
    if (!stored) return response({ ok: false, message: "Private refund obligation has not been allocated" });
    const obligation = schemas.validateRefundRecord(stored);
    if (typeof args.paymentRef !== "string") return response({ ok: false, message: "A unique payment reference is required" });
    try { encoding.canonicalPaymentReferenceBytes(args.paymentRef); }
    catch { return response({ ok: false, message: "Invalid refund payment reference" }); }
    const receiptExpiry = Math.floor(Date.now() / 1000) + 10_000;
    const result = protocol.cancelOrExpireNote(state.ledger, { caller: keys.ISSUER_SK, action: 2, note, refundAck: { identity: obligation.identityCommitment, amount: obligation.amount, salt: obligation.salt, paymentRef: args.paymentRef, receiptExpiry } });
    if (!result.ok) return response({ ok: false, message: result.reason });
    const report = schemas.validateRefundRecord({ ...obligation, status: "issuer-reported", paymentReference: args.paymentRef, receiptExpiry, updatedAt: Date.now() });
    state.ledger = result.ledger;
    state.refunds = state.refunds.map(record => record.noteCommitment === target ? report : record);
    writeState(state);
    return response({ ok: true, public: publicStatus(result.ledger), message: "Issuer reported refund acknowledgment. No cash payment is verified; full original-cost budget remains locked." });
  }

  if (name === "line.withdrawFees") {
    const state = readState();
    if (!state) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: "No active ledger" }) }] },
      };
    }
    const r = protocol.withdrawFees(state.ledger, { caller: keys.ISSUER_SK });
    if (!r.ok) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: r.reason }) }] },
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
              fees: r.fees,
              public: publicStatus(r.ledger),
              message: "Accrued fees released to issuer.",
            }),
          },
        ],
      },
    };
  }

  if (name === "line.disableMerchant") {
    const state = readState();
    if (!state) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: "No active ledger" }) }] },
      };
    }
    const merchantPk = args.merchantPk ?? keys.MERCHANT_B_PK;
    // M5: bad input must yield a clean {ok:false}, not a crash in asBytes32.
    if (!fitsBytes32(merchantPk)) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: "merchantPk is not a valid 32-byte value" }) }] },
      };
    }
    const r = protocol.disableMerchant(state.ledger, { caller: keys.ISSUER_SK, merchantPk });
    if (!r.ok) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: r.reason }) }] },
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
              merchantPk,
              note: "Merchant disabled. New quotes from this merchant are blocked; already-posted quotes stay drawable.",
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
    const paymentRef = args.paymentRef === undefined ? "mcp-repay" : args.paymentRef;
    if (typeof paymentRef !== "string") return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: "Invalid repayment payment reference" }) }] } };
    try { encoding.canonicalPaymentReferenceBytes(paymentRef); }
    catch { return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify({ ok: false, message: "Invalid repayment payment reference" }) }] } }; }
    const rcpt = {
      identity: state.agent.witness.I,
      currentC: state.ledger.lineCommitment,
      amount,
      paymentRef,
      nonce: encoding.toHex(encoding.randomBytes32()),
      expiry: Math.floor(Date.now() / 1000) + 10_000,
      contractDomain: state.ledger.contractDomain,
    };
    const r = protocol.acknowledgeRepayment(
      state.ledger,
      {
        caller: keys.ISSUER_SK,
        newSalt: encoding.toHex(encoding.randomBytes32()),
        // PUBLIC receiptExpiry circuit parameter. Books + receipt are witnesses.
        receiptExpiry: rcpt.expiry,
      },
      { books: state.agent.witness, receipt: rcpt },
    );
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

  // L10: unknown tool name is invalid params (-32602), not method-not-found.
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `unknown tool: ${name}` } };
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
    // L10: notifications get no response — handleMessage returns undefined.
    if (res === undefined) return;
    process.stdout.write(JSON.stringify(res) + "\n");
  });
}
