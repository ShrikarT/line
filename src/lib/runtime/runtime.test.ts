import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MidnightNetworkRuntime,
  LocalDevelopmentRuntime,
  InMemoryTestRuntime,
  getRuntime,
} from "./index.ts";
import { ISSUER_SK, MERCHANT_A_SK, MERCHANT_A_PK, AGENT_SK } from "../../test/fixtures/keys.ts";

describe("runtime architecture: MidnightNetworkRuntime, LocalDevelopmentRuntime, InMemoryTestRuntime", () => {
  it("MidnightNetworkRuntime defaults to unconfigured in test environment and fails clearly", async () => {
    const net = new MidnightNetworkRuntime({ networkId: "midnight-preprod" });
    assert.equal(net.mode, "network");
    assert.equal(net.networkId, "midnight-preprod");
    assert.equal(net.isConnected(), false);
    assert.equal(net.getContractAddress(), null);

    const status = await net.getStatus();
    assert.equal(status.runtime, "network");
    assert.equal(status.status, "none");
    assert.equal(status.totalReserve, 0);

    await assert.rejects(
      () => net.fundReserve(100, ISSUER_SK),
      /WalletNotConnectedError|No Midnight wallet connection detected/
    );
  });

  it("LocalDevelopmentRuntime executes valid flow and updates public reserve accounting", async () => {
    const local = new LocalDevelopmentRuntime();
    assert.equal(local.mode, "local");
    assert.equal(local.isConnected(), true);

    const fundRes = await local.fundReserve(500, ISSUER_SK);
    assert.equal(fundRes.ok, true);
    assert.ok(fundRes.txHash?.startsWith("0xdev_tx_"));

    const reserve = await local.getReserveStatus();
    assert.equal(reserve.totalReserve, 500);
    assert.equal(reserve.withdrawableReserve, 500);

    const openRes = await local.openLine({
      limit: 150,
      expiry: 10_000,
      callerSk: ISSUER_SK,
      agentSecret: AGENT_SK,
      salt: "salt-0",
    });
    assert.equal(openRes.ok, true);

    const status = await local.getStatus();
    assert.equal(status.status, "open");
    assert.equal(status.lineGeneration, 1);
  });

  it("InMemoryTestRuntime is isolated and reports mode test", async () => {
    const mem = new InMemoryTestRuntime();
    assert.equal(mem.mode, "test");
    assert.equal(mem.getContractAddress(), "0xtest_contract_in_memory");

    const status = await mem.getStatus();
    assert.equal(status.runtime, "test");
  });

  it("getRuntime factory selects preferred runtime properly", () => {
    const testRuntime = getRuntime("test");
    assert.equal(testRuntime.mode, "test");
    const localRuntime = getRuntime("local");
    assert.equal(localRuntime.mode, "local");
    const netRuntime = getRuntime("network");
    assert.equal(netRuntime.mode, "network");
  });

  it("LocalDevelopmentRuntime.draw requires merchantPk and rejects when missing", async () => {
    const local = new LocalDevelopmentRuntime();
    await local.fundReserve(500, ISSUER_SK);
    await local.registerMerchant(MERCHANT_A_PK, ISSUER_SK);
    await local.openLine({
      limit: 150,
      expiry: 10_000,
      callerSk: ISSUER_SK,
      agentSecret: AGENT_SK,
      salt: "salt-0",
    });

    const quoteRes = await local.postQuote({
      amount: 40,
      expiry: 10_000,
      invoiceId: "inv-req-pk",
      nonce: "nonce-1",
      merchantSk: MERCHANT_A_SK,
    });
    assert.equal(quoteRes.ok, true);
    const quoteCommit = quoteRes.output?.Q as string;
    assert.ok(quoteCommit);

    // Call draw without merchantPk -> must fail with MISSING_MERCHANT_PK
    const drawNoPk = await local.draw({
      quoteCommit,
      limit: 150,
      outstanding: 0,
      epoch: 0,
      amount: 40,
      expiry: 10_000,
      callerSk: AGENT_SK,
      agentSecret: AGENT_SK,
      salt: "salt-0",
      newSalt: "salt-1",
      invoiceId: "inv-req-pk",
      quoteNonce: "nonce-1",
      noteNonce: "note-nonce-1",
      noteSalt: "note-salt-1",
    });
    assert.equal(drawNoPk.ok, false);
    assert.equal(drawNoPk.code, "MISSING_MERCHANT_PK");

    // Call draw with merchantPk -> must succeed
    const drawWithPk = await local.draw({
      quoteCommit,
      limit: 150,
      outstanding: 0,
      epoch: 0,
      amount: 40,
      expiry: 10_000,
      callerSk: AGENT_SK,
      agentSecret: AGENT_SK,
      salt: "salt-0",
      newSalt: "salt-1",
      invoiceId: "inv-req-pk",
      quoteNonce: "nonce-1",
      noteNonce: "note-nonce-1",
      noteSalt: "note-salt-1",
      merchantPk: MERCHANT_A_PK,
    });
    assert.equal(drawWithPk.ok, true);
  });
});
