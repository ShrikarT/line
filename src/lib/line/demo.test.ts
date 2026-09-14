import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { snapshotAt } from "./demo.ts";

describe("scripted demo snapshots", () => {
  it("step 3 has B=40 and no 150 on the public ledger", () => {
    const s = snapshotAt(3);
    assert.equal(s.agent?.witness?.B, 40);
    assert.equal(JSON.stringify(s.ledger).includes("150"), false);
    assert.equal(s.ledger.status, "open");
  });
  it("step 5 records a failed 120 without rotating after the 40-draw", () => {
    const a = snapshotAt(3);
    const b = snapshotAt(5);
    assert.ok(b.lastFail);
    assert.equal(b.ledger.lineCommitment, a.ledger.lineCommitment);
  });
  it("step 8 is defaulted with B=120 privately", () => {
    const s = snapshotAt(8);
    assert.equal(s.ledger.status, "defaulted");
    assert.equal(s.agent?.witness?.B, 120);
  });
});
