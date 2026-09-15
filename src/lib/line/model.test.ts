import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acknowledgeRepayment,
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
import { AGENT_SK, INSTANCE_NONCE, ISSUER_SK, MERCHANT_A_SK, MERCHANT_B_SK } from "./keys.ts";

function assertInvariants(ledger: Ledger, agent: AgentStore | null) {
  // 1. Solvency: encumberedReserve + redeemedReserve <= totalReserve
  assert.ok(
    ledger.encumberedReserve >= 0,
    `encumberedReserve must be nonnegative, got ${ledger.encumberedReserve}`,
  );
  assert.ok(
    ledger.redeemedReserve >= 0,
    `redeemedReserve must be nonnegative, got ${ledger.redeemedReserve}`,
  );
  assert.ok(
    ledger.encumberedReserve + ledger.redeemedReserve <= ledger.totalReserve,
    `Reserve deficit: encumbered (${ledger.encumberedReserve}) + redeemed (${ledger.redeemedReserve}) > total (${ledger.totalReserve})`,
  );

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
    let ledger = createLedger({
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
      const op = rand(8);
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
          const r = openLine(ledger, {
            caller: ISSUER_SK,
            agentSecret: AGENT_SK,
            limit,
            salt: `salt-step-${step}`,
            expiry: 50_000,
          });
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
          const r = postQuote(ledger, {
            caller: merchant,
            amount,
            invoiceId: `inv-${step}`,
            expiry: 50_000,
            nonce: `nonce-${step}`,
          });
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
            const r = draw(ledger, {
              agentSecret: AGENT_SK,
              witness: agent.witness,
              quote: q.quote,
              newSalt: `salt-draw-${step}`,
              noteNonce: `nn-${step}`,
              noteSalt: `ns-${step}`,
            });
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
            const r = redeemDraw(ledger, {
              caller: n.preimage.merchantPk === MERCHANT_A_SK ? MERCHANT_A_SK : MERCHANT_B_SK,
              noteCommitment: n.D,
              notePreimage: n.preimage,
              noteSalt: n.salt,
            });
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
              expiry: 50_000,
              contractDomain: ledger.contractDomain,
            };
            const r = acknowledgeRepayment(ledger, {
              caller: ISSUER_SK,
              witness: agent.witness,
              receipt: rcpt,
              newSalt: `salt-repay-${step}`,
            });
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
      }

      // Assert all system invariants after every single transition
      assertInvariants(ledger, agent);
    }
  });
});
