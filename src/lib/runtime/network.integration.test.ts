import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MidnightNetworkRuntime } from "./network.ts";
import {
  WalletNotConnectedError,
  ContractNotConfiguredError,
  ContractNotFoundError,
  ContractIncompatibleError,
  NetworkUnreachableError,
  WalletApprovalRejectedError,
} from "./errors.ts";
import { isWalletInjected, connectWallet } from "./wallet.ts";

describe("network integration: MidnightNetworkRuntime & wallet connector", () => {
  it("initializes with explicit configuration and exposes runtime metadata", () => {
    const net = new MidnightNetworkRuntime({
      networkId: "midnight-testnet",
      indexerUri: "https://indexer.testnet-02.midnight.network/api/v1/graphql",
      indexerWsUri: "wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws",
      nodeUri: "https://rpc.testnet-02.midnight.network",
      proofServerUri: "http://127.0.0.1:6300",
    });

    assert.equal(net.mode, "network");
    assert.equal(net.networkId, "midnight-testnet");
    assert.equal(net.indexerUri, "https://indexer.testnet-02.midnight.network/api/v1/graphql");
    assert.equal(net.nodeUri, "https://rpc.testnet-02.midnight.network");
    assert.equal(net.proofServerUri, "http://127.0.0.1:6300");
    assert.equal(net.isConnected(), false);
    assert.equal(net.getContractAddress(), null);
  });

  it("joinContract rejects empty address with ContractNotConfiguredError", async () => {
    const net = new MidnightNetworkRuntime();
    await assert.rejects(
      () => net.joinContract(""),
      (err) => err instanceof ContractNotConfiguredError
    );
  });

  it("joinContract rejects unreachable indexer with NetworkUnreachableError", async () => {
    const net = new MidnightNetworkRuntime({
      indexerUri: "http://127.0.0.1:19999/graphql/invalid",
      indexerWsUri: "ws://127.0.0.1:19999/graphql/ws",
    });

    await assert.rejects(
      () => net.joinContract("01".repeat(32)),
      (err) => err instanceof NetworkUnreachableError
    );
  });

  it("mutations reject with WalletNotConnectedError when wallet is unattached", async () => {
    const net = new MidnightNetworkRuntime();

    await assert.rejects(
      () => net.fundReserve(100, "0x00"),
      (err) => err instanceof WalletNotConnectedError
    );

    await assert.rejects(
      () => net.withdrawReserve(50, "0x00"),
      (err) => err instanceof WalletNotConnectedError
    );

    await assert.rejects(
      () => net.registerMerchant("0x11".repeat(32), "0x00"),
      (err) => err instanceof WalletNotConnectedError
    );

    await assert.rejects(
      () =>
        net.openLine({
          limit: 150,
          expiry: 10000,
          callerSk: "0x00",
          agentSecret: "0x01",
          salt: "salt-0",
        }),
      (err) => err instanceof WalletNotConnectedError
    );

    await assert.rejects(
      () =>
        net.postQuote({
          amount: 40,
          expiry: 2000,
          invoiceId: "inv-1",
          nonce: "nonce-1",
          merchantSk: "0x02",
        }),
      (err) => err instanceof WalletNotConnectedError
    );

    await assert.rejects(
      () =>
        net.draw({
          quoteCommit: "0x" + "00".repeat(32),
          limit: 150,
          outstanding: 0,
          epoch: 0,
          amount: 40,
          expiry: 2000,
          callerSk: "0x00",
          agentSecret: "0x01",
          salt: "salt-0",
          newSalt: "salt-1",
          invoiceId: "inv-1",
          quoteNonce: "nonce-1",
          noteNonce: "nonce-2",
          noteSalt: "salt-note",
        }),
      (err) => err instanceof WalletNotConnectedError
    );
  });

  it("wallet connector throws WalletNotConnectedError in non-browser Node environment", async () => {
    assert.equal(isWalletInjected(), false);
    await assert.rejects(
      () => connectWallet(),
      (err) => err instanceof WalletNotConnectedError
    );
  });

  it("wallet connector maps user rejection to WalletApprovalRejectedError", async () => {
    const fakeMidnight = {
      "lace-test": {
        rdns: "io.midnight.lace",
        name: "Lace Test",
        icon: "icon.png",
        connect: async () => {
          throw new Error("User rejected the connection request");
        },
      },
    };

    const origWindow = globalThis.window;
    (globalThis as any).window = { midnight: fakeMidnight };

    try {
      await assert.rejects(
        () => connectWallet("io.midnight.lace"),
        (err) => err instanceof WalletApprovalRejectedError
      );
    } finally {
      (globalThis as any).window = origWindow;
    }
  });

  it("VaultPrivateStateProvider encrypts and retrieves state via passwordProvider", async () => {
    const { VaultPrivateStateProvider } = await import("./vault-provider.ts");
    const provider = new VaultPrivateStateProvider({
      passwordProvider: () => "TestVaultSecretPassword456!",
      networkId: "midnight-testnet",
    });

    const testContract = "0x" + "11".repeat(32);
    provider.setContractAddress(testContract);

    const testState = {
      callerSecret: [1, 2, 3, 4],
      agentSecret: [5, 6, 7, 8],
      balance: 150,
    };

    await provider.set("agent-line-state", testState);
    const retrieved = await provider.get("agent-line-state");
    assert.deepEqual(retrieved, testState);

    await provider.remove("agent-line-state");
    const afterClear = await provider.get("agent-line-state");
    assert.equal(afterClear, null);
  });

  it("VaultPrivateStateProvider throws when contract address is not configured", async () => {
    const { VaultPrivateStateProvider } = await import("./vault-provider.ts");
    const provider = new VaultPrivateStateProvider({
      passwordProvider: () => "pwd",
    });

    await assert.rejects(
      () => provider.get("id-1"),
      /setContractAddress must be called before accessing private state/
    );

    await assert.rejects(
      () => provider.set("id-1", {}),
      /setContractAddress must be called before accessing private state/
    );
  });

  it("validateTxResult strictly rejects empty, zero, or malformed transaction receipts", () => {
    const net = new MidnightNetworkRuntime();
    const validate = (net as any).validateTxResult.bind(net);

    // Missing txHash
    const r1 = validate({}, "fundReserve");
    assert.equal(r1.ok, false);
    assert.equal(r1.code, "TRANSACTION_FINALIZATION_FAILED");

    // Zero txHash "0x0"
    const r2 = validate({ txHash: "0x0" }, "fundReserve");
    assert.equal(r2.ok, false);

    // Whitespace txHash
    const r3 = validate({ txHash: "   " }, "fundReserve");
    assert.equal(r3.ok, false);

    // Rejected draw must return the exact generic invariant error
    const rDraw = validate({ txHash: "" }, "draw");
    assert.equal(rDraw.ok, false);
    assert.equal(rDraw.error, "Clearance could not be proven.");

    // Valid finalized transaction
    const rValid = validate({ txHash: "0xabcdef1234567890", blockHeight: 105 }, "fundReserve");
    assert.equal(rValid.ok, true);
    assert.equal(rValid.txHash, "0xabcdef1234567890");
    assert.equal(rValid.blockHeight, 105);
  });
});
