import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MidnightNetworkRuntime,
  LocalDevelopmentRuntime,
  InMemoryTestRuntime,
  getRuntime,
} from "./index.ts";
import { ISSUER_SK, MERCHANT_A_SK, AGENT_SK } from "../../test/fixtures/keys.ts";

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
});
