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
});
