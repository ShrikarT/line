import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { snapshotAt } from "./demo.ts";

describe("scripted demo snapshots", () => {
  it("step 1 publishes C/status and does not store a limit field", () => {
    const s = snapshotAt(1);
    assert.equal(s.ledger.status, "open");
    assert.ok(s.ledger.lineCommitment);
    assert.equal(s.agent?.witness?.L, 150);
    assert.equal("limit" in s.ledger, false);
    assert.equal("outstanding" in s.ledger, false);
  });

  it("step 4 has B=40 and rotated C", () => {
    const a = snapshotAt(1);
    const s = snapshotAt(4);
    assert.equal(s.agent?.witness?.B, 40);
    assert.notEqual(s.ledger.lineCommitment, a.ledger.lineCommitment);
  });

  it("step 5 actually runs a replay and records failure without rotating C", () => {
    const a = snapshotAt(4);
    const b = snapshotAt(5);
    assert.equal(b.replayRan, true);
    assert.ok(b.lastFail);
    assert.equal(b.lastFail, "Clearance could not be proven.");
    assert.equal(b.ledger.lineCommitment, a.ledger.lineCommitment);
    assert.equal(b.ledger.clock, a.ledger.clock);
  });

  it("step 6 actually runs an over-limit draw that fails", () => {
    const a = snapshotAt(4);
    const b = snapshotAt(6);
    assert.equal(b.overLimitRan, true);
    assert.ok(b.lastFail);
    assert.equal(b.ledger.lineCommitment, a.ledger.lineCommitment);
    assert.match(b.lastFailReason ?? "", /capacity|exceed/i);
  });

  it("step 8 is 120 outstanding after issuer ack", () => {
    const s = snapshotAt(8);
    assert.equal(s.agent?.witness?.B, 120);
    assert.equal(s.ledger.status, "open");
  });

  it("step 9 is defaulted with B=120 privately", () => {
    const s = snapshotAt(9);
    assert.equal(s.ledger.status, "defaulted");
    assert.equal(s.agent?.witness?.B, 120);
  });

  it("step 10 actually runs a post-default draw that fails", () => {
    const a = snapshotAt(9);
    const b = snapshotAt(10);
    assert.equal(b.postDefaultRan, true);
    assert.ok(b.lastFail);
    assert.equal(b.ledger.status, "defaulted");
    assert.equal(b.ledger.lineCommitment, a.ledger.lineCommitment);
  });
});
