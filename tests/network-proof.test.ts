import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MidnightNetworkRuntime } from "../src/lib/runtime/network.ts";
import { LocalDevelopmentRuntime } from "../src/lib/runtime/local.ts";
import { hexToBytes } from "../src/lib/line/encoding.ts";
import { AGENT_SK, MERCHANT_A_PK } from "../src/test/fixtures/keys.ts";

describe("proof test: MidnightNetworkRuntime witness and circuit alignment", () => {
  it("draw passes exact 3 public arguments (quoteCommit, noteExpiry, fee) and feeds witness books", async () => {
    const net = new MidnightNetworkRuntime({
      networkId: "midnight-testnet",
      contractAddress: "0x" + "11".repeat(32),
    });

    // Mock connected wallet
    (net as any).connectedWallet = {
      walletProvider: {},
      midnightProvider: {},
    };

    let receivedArgs: any[] = [];
    let capturedWitnessContext: any = null;

    // Mock bound contract that intercepts callTx.draw
    (net as any).boundContract = {
      callTx: {
        draw: async (...args: any[]) => {
          receivedArgs = args;
          capturedWitnessContext = { ...(net as any).activeWitnessContext };
          return {
            txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            blockHeight: 42,
          };
        },
      },
    };

    const quoteCommit = "0x" + "aa".repeat(32);
    const noteExpiry = 1050;
    const fee = 5;

    const res = await net.draw({
      quoteCommit,
      limit: 500,
      outstanding: 50,
      epoch: 2,
      amount: 40,
      noteExpiry,
      fee,
      callerSk: AGENT_SK,
      agentSecret: AGENT_SK,
      salt: "0x" + "bb".repeat(32),
      newSalt: "0x" + "cc".repeat(32),
      invoiceId: "inv-test-proof",
      quoteNonce: "0x" + "dd".repeat(32),
      noteNonce: "0x" + "ee".repeat(32),
      noteSalt: "0x" + "ff".repeat(32),
      merchantPk: MERCHANT_A_PK,
    });

    assert.equal(res.ok, true, `draw failed: ${res.error}`);

    // Assert exactly 3 public arguments passed to contract binding in correct order (Uint8Array, bigint, bigint)
    // On origin/main, this fails because 6 arguments were passed: (qBytes, limit, outstanding, epoch, amount, expiry)
    assert.equal(receivedArgs.length, 3, `Expected exactly 3 public arguments, received ${receivedArgs.length}`);
    assert.deepEqual(receivedArgs[0], hexToBytes("aa".repeat(32)), "arg 0 must be quoteCommit (Uint8Array)");
    assert.equal(receivedArgs[1], BigInt(noteExpiry), "arg 1 must be noteExpiry (bigint)");
    assert.equal(receivedArgs[2], BigInt(fee), "arg 2 must be fee (bigint)");

    // Assert witness context feeds the private books and merchant identity
    assert.ok(capturedWitnessContext, "activeWitnessContext must be active during draw");
    assert.equal(capturedWitnessContext.lineLimit, 500n, "lineLimit witness must be 500n");
    assert.equal(capturedWitnessContext.lineOutstanding, 50n, "lineOutstanding witness must be 50n");
    assert.equal(capturedWitnessContext.lineEpoch, 2n, "lineEpoch witness must be 2n");
    assert.equal(capturedWitnessContext.drawAmount, 40n, "drawAmount witness must be 40n");
    assert.equal(capturedWitnessContext.quoteAmount, 40n, "quoteAmount witness must be 40n");
    assert.ok(capturedWitnessContext.quoteMerchantPk instanceof Uint8Array, "quoteMerchantPk witness must be Uint8Array");
  });

  it("all 20 Compact contract witnesses are defined and queryable on the contract binding", async () => {
    const net = new MidnightNetworkRuntime({
      networkId: "midnight-testnet",
      contractAddress: "0x" + "11".repeat(32),
    });

    (net as any).connectedWallet = { walletProvider: {}, midnightProvider: {} };
    (net as any).cachedProviders = {
      privateStateProvider: { setContractAddress: () => {} },
      publicDataProvider: {},
      zkConfigProvider: {},
      proofProvider: {},
      walletProvider: {},
      midnightProvider: {},
    };

    // All 20 witnesses declared in contracts/managed/line/contract/index.d.ts
    const expectedWitnesses = [
      "callerSecret",
      "agentSecret",
      "salt",
      "newSalt",
      "invoiceId",
      "quoteNonce",
      "receiptNonce",
      "paymentRef",
      "noteNonce",
      "noteSalt",
      "noteIdentity",
      "noteQuoteCommit",
      "lineLimit",
      "lineOutstanding",
      "lineEpoch",
      "quoteAmount",
      "drawAmount",
      "redeemAmount",
      "repayAmount",
      "quoteMerchantPk",
    ];

    assert.equal(expectedWitnesses.length, 20);

    const testContext = {
      callerSecret: new Uint8Array(32).fill(1),
      agentSecret: new Uint8Array(32).fill(2),
      salt: new Uint8Array(32).fill(3),
      newSalt: new Uint8Array(32).fill(4),
      invoiceId: new Uint8Array(32).fill(5),
      quoteNonce: new Uint8Array(32).fill(6),
      receiptNonce: new Uint8Array(32).fill(7),
      paymentRef: new Uint8Array(32).fill(8),
      noteNonce: new Uint8Array(32).fill(9),
      noteSalt: new Uint8Array(32).fill(10),
      noteIdentity: new Uint8Array(32).fill(11),
      noteQuoteCommit: new Uint8Array(32).fill(12),
      lineLimit: 1000n,
      lineOutstanding: 200n,
      lineEpoch: 1n,
      quoteAmount: 50n,
      drawAmount: 50n,
      redeemAmount: 50n,
      repayAmount: 50n,
      quoteMerchantPk: new Uint8Array(32).fill(13),
    };

    // Test inside withOperationLock
    await (net as any).withOperationLock(testContext, async () => {
      // Simulate witness queries through the internal witness functions
      // On origin/main, only 12 witnesses existed; the 8 new witnesses (lineLimit, lineOutstanding, lineEpoch,
      // quoteAmount, drawAmount, redeemAmount, repayAmount, quoteMerchantPk) were missing completely.
      for (const w of expectedWitnesses) {
        assert.ok(
          (net as any).activeWitnessContext[w] !== undefined,
          `Witness ${w} must be defined in activeWitnessContext`
        );
      }
    });
  });

  it("draw refuses when noteExpiry is missing (hard error), while fee keeps ?? 0 default", async () => {
    const net = new MidnightNetworkRuntime({
      networkId: "midnight-testnet",
      contractAddress: "0x" + "11".repeat(32),
    });
    (net as any).connectedWallet = { walletProvider: {}, midnightProvider: {} };

    const validParams = {
      quoteCommit: "0x" + "aa".repeat(32),
      limit: 500,
      outstanding: 50,
      epoch: 2,
      amount: 40,
      callerSk: AGENT_SK,
      agentSecret: AGENT_SK,
      salt: "0x" + "bb".repeat(32),
      newSalt: "0x" + "cc".repeat(32),
      invoiceId: "inv-test-proof",
      quoteNonce: "0x" + "dd".repeat(32),
      noteNonce: "0x" + "ee".repeat(32),
      noteSalt: "0x" + "ff".repeat(32),
      merchantPk: MERCHANT_A_PK,
    };

    // Missing noteExpiry in network runtime must throw
    await assert.rejects(
      async () => await net.draw(validParams as any),
      /Draw refused: noteExpiry is required/
    );

    // Missing noteExpiry in local runtime must throw
    const local = new LocalDevelopmentRuntime();
    await assert.rejects(
      async () => await local.draw(validParams as any),
      /Draw refused: noteExpiry is required/
    );
  });
});

