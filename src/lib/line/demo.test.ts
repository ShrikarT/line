import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { snapshotAt } from "./demo.ts";

describe("scripted demo snapshots", () => {
  it("step 1 registers Merchant B", () => {
    const s = snapshotAt(1);
    const mB = Object.keys(s.ledger.registeredMerchants);
    assert.equal(mB.length, 2);
  });

  it("step 2 funds reserve to 500", () => {
    const s = snapshotAt(2);
    assert.equal(s.ledger.totalReserve, 500);
    assert.equal(s.ledger.encumberedReserve, 0);
  });

  it("step 3 opens line 150 privately", () => {
    const s = snapshotAt(3);
    assert.equal(s.ledger.status, "open");
    assert.ok(s.ledger.lineCommitment);
    assert.equal(s.agent?.witness?.L, 150);
    assert.equal("limit" in s.ledger, false);
    assert.equal("outstanding" in s.ledger, false);
  });

  it("step 5 draws 40, rotates C, creates D1, encumbers 40 reserve", () => {
    const s3 = snapshotAt(3);
    const s5 = snapshotAt(5);
    assert.equal(s5.agent?.witness?.B, 40);
    assert.notEqual(s5.ledger.lineCommitment, s3.ledger.lineCommitment);
    assert.equal(s5.ledger.encumberedReserve, 40);
    assert.equal(s5.notes.length, 1);
  });

  it("step 6 executes Merchant B redemption attack on D1 and fails", () => {
    const s = snapshotAt(6);
    assert.equal(s.wrongMerchantRan, true);
    assert.ok(s.lastFail);
    assert.match(s.lastFailReason ?? "", /designated merchant|opening|NOTE_AUTH/i);
    assert.equal(s.ledger.encumberedReserve, 40);
  });

  it("step 7 Merchant A redeems D1; encumbered moves to redeemed", () => {
    const s = snapshotAt(7);
    assert.equal(s.ledger.encumberedReserve, 0);
    assert.equal(s.ledger.redeemedReserve, 40);
  });

  it("step 8 Merchant A double redemption fails", () => {
    const s = snapshotAt(8);
    assert.equal(s.doubleRedeemRan, true);
    assert.ok(s.lastFail);
    assert.match(s.lastFailReason ?? "", /NOTE_USED|already redeemed/i);
  });

  it("step 10 over-limit draw (40 + 120 > 150) runs and fails", () => {
    const s = snapshotAt(10);
    assert.equal(s.overLimitRan, true);
    assert.ok(s.lastFail);
    assert.match(s.lastFailReason ?? "", /capacity|exceed/i);
  });

  it("step 11 issuer ack 40 restores capacity", () => {
    const s = snapshotAt(11);
    assert.equal(s.agent?.witness?.B, 0);
    assert.equal(s.lastAcked, 40);
  });

  it("step 13 draws 120, creates D2, encumbers 120 reserve", () => {
    const s = snapshotAt(13);
    assert.equal(s.agent?.witness?.B, 120);
    assert.equal(s.ledger.encumberedReserve, 120);
    assert.equal(s.notes.length, 2);
  });

  it("step 14 issuer withdrawal of encumbered funds runs and fails", () => {
    const s = snapshotAt(14);
    assert.equal(s.withdrawBlockedRan, true);
    assert.ok(s.lastFail);
    assert.match(s.lastFailReason ?? "", /unencumbered/i);
  });

  it("step 15 Merchant B redeems D2 successfully", () => {
    const s = snapshotAt(15);
    assert.equal(s.ledger.encumberedReserve, 0);
    assert.equal(s.ledger.redeemedReserve, 160);
  });

  it("step 16 defaults line and step 17 post-default draw fails", () => {
    const s16 = snapshotAt(16);
    assert.equal(s16.ledger.status, "defaulted");
    const s17 = snapshotAt(17);
    assert.equal(s17.postDefaultRan, true);
    assert.ok(s17.lastFail);
  });
});
