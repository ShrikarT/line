import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acknowledgeRepayment,
  cancelOrExpireNote,
  cloneLedger,
  createLedger,
  draw,
  fundReserve,
  openLine,
  postQuote,
  redeemDraw,
  registerMerchant,
  setStatus,
  withdrawUnencumberedReserve,
} from "./protocol.ts";
import type { AgentStore, DrawNote, Ledger, QuotePreimage } from "./types.ts";
import { requiredDrawFee } from "./encoding.ts";
import { AGENT_SK, INSTANCE_NONCE, ISSUER_SK, MERCHANT_A_PK, MERCHANT_A_SK, MERCHANT_B_SK } from "../../test/fixtures/keys.ts";

function assertInvariants(ledger: Ledger, agent: AgentStore | null) {
  // 1. All claim, fee, compensation and reported-refund budgets stay backed.
  assert.ok(
    ledger.encumberedReserve >= 0,
    `encumberedReserve must be nonnegative, got ${ledger.encumberedReserve}`,
  );
  assert.ok(
    ledger.redeemedReserve >= 0,
    `redeemedReserve must be nonnegative, got ${ledger.redeemedReserve}`,
  );
  assert.ok(
    ledger.encumberedReserve + ledger.redeemedReserve + ledger.feeReserve + ledger.pendingFeeReserve + ledger.refundReserve + ledger.reportedRefundReserve <= ledger.totalReserve,
    "All locked reserve budgets must be at most total reserve",
  );
  for (const field of ["feeReserve", "pendingFeeReserve", "refundReserve", "reportedRefundReserve"] as const) assert.ok(Number.isSafeInteger(ledger[field]) && ledger[field] >= 0, `${field} must be a safe nonnegative integer`);
  assert.equal(ledger.pendingFeeReserve, ledger.notes.filter(n => !n.redeemed && !n.cancelled).reduce((sum, n) => sum + n.fee, 0));
  assert.ok(ledger.notes.every(n => !(n.redeemed && n.cancelled)), "A note cannot be redeemed and cancelled");

  // 2. No nullifier duplicate in ledger.nullifiers
  const nullifierSet = new Set(ledger.nullifiers);
  assert.equal(
    nullifierSet.size,
    ledger.nullifiers.length,
    "Duplicate nullifier found in ledger!",
  );

  // 3. No note redeemed twice
  const noteCommitments = new Set(ledger.notes.map((n) => n.commitment));
  assert.equal(noteCommitments.size, ledger.notes.length, "Duplicate note commitments found!");

  // 4. If agent witness is present, B <= L and B >= 0
  if (agent && agent.witness) {
    assert.ok(
      agent.witness.B <= agent.witness.L,
      `Balance (${agent.witness.B}) exceeds limit (${agent.witness.L})`,
    );
    assert.ok(agent.witness.B >= 0, `Balance must be nonnegative, got ${agent.witness.B}`);
  }
}

describe("deterministic state-machine model invariant tests", () => {
  it("maintains all 10 protocol and reserve invariants across a randomized sequence of 50 operations", () => {
    let now = 0;
    let ledger = createLedger({
      clock: () => now,
      issuerSecret: ISSUER_SK,
      merchantSecret: MERCHANT_A_SK,
      instanceNonce: INSTANCE_NONCE,
    });
    let agent: AgentStore | null = null;
    const quotes: { quote: QuotePreimage; Q: string }[] = [];
    const notes: DrawNote[] = [];

    // Register Merchant B initially
    const regB = registerMerchant(ledger, {
      caller: ISSUER_SK,
      merchantPk: MERCHANT_B_SK,
    });
    if (regB.ok) ledger = regB.ledger;

    // PRNG for deterministic reproducibility
    let seed = 42;
    function rand(max: number): number {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.floor((seed / 4294967296) * max);
    }

    for (let step = 0; step < 50; step++) {
      const op = rand(10);
      const prevLedger = cloneLedger(ledger);

      switch (op) {
        case 0: {
          // Fund reserve
          const amount = (rand(3) + 1) * 100;
          const r = fundReserve(ledger, { caller: ISSUER_SK, amount });
          if (r.ok) ledger = r.ledger;
          break;
        }
        case 1: {
          // Withdraw unencumbered
          const amount = (rand(3) + 1) * 50;
          const r = withdrawUnencumberedReserve(ledger, { caller: ISSUER_SK, amount });
          if (r.ok) ledger = r.ledger;
          else {
            // Assert failed operation did not mutate state
            assert.deepEqual(ledger, prevLedger);
          }
          break;
        }
        case 2: {
          // Open line (if none or closed)
          const limit = (rand(3) + 1) * 100;
          const r = openLine(
            ledger,
            {
              caller: ISSUER_SK,
              agentSecret: AGENT_SK,
              salt: `salt-step-${step}`,
              expiry: now + 50_000,
              feeFlat: 3,
              feeBps: 125,
            },
            { limit },
          );
          if (r.ok) {
            ledger = r.ledger;
            agent = r.agent;
          }
          break;
        }
        case 3: {
          // Merchant posts quote
          const merchant = rand(2) === 0 ? MERCHANT_A_SK : MERCHANT_B_SK;
          const amount = (rand(4) + 1) * 20;
          const r = postQuote(
            ledger,
            {
              caller: merchant,
              invoiceId: `inv-${step}`,
              expiry: now + 50_000,
              nonce: `nonce-${step}`,
            },
            { amount },
          );
          if (r.ok) {
            ledger = r.ledger;
            quotes.push({ quote: r.quote, Q: r.Q });
          }
          break;
        }
        case 4: {
          // Agent draws against a live quote
          if (agent && agent.witness && quotes.length > 0) {
            const q = quotes.pop()!;
            const r = draw(
              ledger,
              {
                agentSecret: AGENT_SK,
                quoteCommit: q.Q,
                newSalt: `salt-draw-${step}`,
                fee: Number(requiredDrawFee(BigInt(q.quote.amount), BigInt(ledger.feeFlat), BigInt(ledger.feeBps))),
                noteNonce: `nn-${step}`,
                noteSalt: `ns-${step}`,
              },
              { books: agent.witness, quote: q.quote },
            );
            if (r.ok) {
              ledger = r.ledger;
              agent = r.agent;
              notes.push(r.note);
            }
          }
          break;
        }
        case 5: {
          // Merchant redeems note
          if (notes.length > 0) {
            const n = notes.pop()!;
            const r = redeemDraw(
              ledger,
              {
                caller: n.preimage.merchantPk === MERCHANT_A_PK ? MERCHANT_A_SK : MERCHANT_B_SK,
                noteCommitment: n.D,
                noteExpiry: n.preimage.expiry,
                noteSalt: n.salt,
              },
              { note: n.preimage },
            );
            if (r.ok) ledger = r.ledger;
          }
          break;
        }
        case 6: {
          // Issuer acknowledges repayment
          if (agent && agent.witness && agent.witness.B > 0 && ledger.lineCommitment) {
            const repayAmount = Math.min(agent.witness.B, 20);
            const rcpt = {
              identity: agent.witness.I,
              currentC: ledger.lineCommitment,
              amount: repayAmount,
              paymentRef: `pay-${step}`,
              nonce: `rcpt-${step}`,
              expiry: now + 50_000,
              contractDomain: ledger.contractDomain,
            };
            const r = acknowledgeRepayment(
              ledger,
              {
                caller: ISSUER_SK,
                newSalt: `salt-repay-${step}`,
                receiptExpiry: rcpt.expiry,
              },
              { books: agent.witness, receipt: rcpt },
            );
            if (r.ok) {
              ledger = r.ledger;
              agent.witness = r.witness;
            }
          }
          break;
        }
        case 7: {
          // Status change: default or reopen
          if (ledger.status === "open") {
            const r = setStatus(ledger, { caller: ISSUER_SK, status: "defaulted" });
            if (r.ok) ledger = r.ledger;
          } else if (ledger.status === "defaulted") {
            const r = setStatus(ledger, { caller: ISSUER_SK, status: "open" });
            if (r.ok) ledger = r.ledger;
          }
          break;
        }
        case 8: {
          if (notes.length) {
            const note = notes[rand(notes.length)]!;
            now = Math.max(now, note.preimage.expiry);
            const r = cancelOrExpireNote(ledger, { note });
            if (r.ok) ledger = r.ledger;
            else assert.deepEqual(ledger, prevLedger);
          }
          break;
        }
        case 9: {
          if (notes.length && agent?.witness) {
            const note = notes[rand(notes.length)]!;
            const r = cancelOrExpireNote(ledger, { caller: AGENT_SK, action: 1, note, compensation: { note: note.preimage, noteSalt: note.salt, newSalt: `refund-${step}`, books: agent.witness } });
            if (r.ok) { ledger = r.ledger; if (r.witness) agent.witness = r.witness; }
            else assert.deepEqual(ledger, prevLedger);
          }
          break;
        }
      }

      // Assert all system invariants after every single transition
      assertInvariants(ledger, agent);
    }
  });
});
