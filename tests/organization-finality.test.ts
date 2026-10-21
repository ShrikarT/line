import test from "node:test";
import assert from "node:assert/strict";
import { OrganizationFinality, OrganizationTimeoutError, withinDeadline } from "../src/lib/organization/finality.ts";
import { readOrganizationWallet } from "../src/lib/organization/account.ts";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";

const verifiedConfiguration = { networkId: "preprod", indexerUri: "https://indexer.example.test/graphql", indexerWsUri: "wss://indexer.example.test/graphql", substrateNodeUri: "https://node.example.test" };

test("an open organization checks its live network session without refetching service configuration", async () => {
  const calls: string[] = [];
  const wallet = {
    getConfiguration: async () => { calls.push("configuration"); throw Error("Request failed"); },
    getConnectionStatus: async () => { calls.push("session"); return { status: "connected", networkId: "preprod" }; },
    getShieldedAddresses: async () => { calls.push("shielded"); return { shieldedCoinPublicKey: "identity" }; },
    getUnshieldedAddress: async () => { calls.push("receiving"); return { unshieldedAddress: "recipient" }; },
    balanceUnsealedTransaction() { throw Error("No balance approval allowed"); },
    submitTransaction() { throw Error("No submission allowed"); },
  } as unknown as ConnectedAPI;
  const identity = await readOrganizationWallet(wallet, 25_000, () => {}, verifiedConfiguration);
  assert.deepEqual(calls, ["session", "shielded", "receiving"]);
  assert.deepEqual(identity.configuration, verifiedConfiguration);
  identity.configuration.indexerUri = "https://changed.example.test";
  assert.equal(verifiedConfiguration.indexerUri, "https://indexer.example.test/graphql");
});

test("saved service settings cannot hide a disconnected or different-network wallet", async () => {
  for (const status of [{ status: "disconnected" }, { status: "connected", networkId: "mainnet" }]) {
    let addresses = 0, configurationReads = 0;
    const wallet = {
      getConnectionStatus: async () => status,
      getConfiguration: async () => { configurationReads++; return verifiedConfiguration; },
      getShieldedAddresses: async () => { addresses++; return {}; },
      getUnshieldedAddress: async () => { addresses++; return {}; },
      balanceUnsealedTransaction() {}, submitTransaction() {},
    } as unknown as ConnectedAPI;
    await assert.rejects(readOrganizationWallet(wallet, 25_000, () => {}, verifiedConfiguration), /wallet.*preprod session/i);
    assert.equal(addresses, 0); assert.equal(configurationReads, 0);
  }
});

test("a failed live session read cannot fall back to saved configuration or continue after timeout", async () => {
  let finish!: (value: unknown) => void, addresses = 0;
  const wallet = {
    getConnectionStatus: () => new Promise(resolve => { finish = resolve; }),
    getConfiguration: async () => verifiedConfiguration,
    getShieldedAddresses: async () => { addresses++; return {}; },
    getUnshieldedAddress: async () => { addresses++; return {}; },
    balanceUnsealedTransaction() {}, submitTransaction() {},
  } as unknown as ConnectedAPI;
  await assert.rejects(readOrganizationWallet(wallet, 5, () => {}, verifiedConfiguration), OrganizationTimeoutError);
  finish({ status: "connected", networkId: "preprod" });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(addresses, 0);
  wallet.getConnectionStatus = async () => { throw Error("Request failed"); };
  await assert.rejects(readOrganizationWallet(wallet, 25_000, () => {}, verifiedConfiguration), /wallet could not complete the network session check/);
  assert.equal(addresses, 0);
});

test("observation timeout reuses the original live task and never treats absence as failure", async () => {
  let reads = 0, resolve!: (value: string) => void;
  const original = new Promise<string>(yes => { resolve = yes; });
  const finality = new OrganizationFinality(async id => { reads++; assert.equal(id, "original-signed-id"); return original; }, 10);
  await assert.rejects(finality.wait("original-signed-id"), OrganizationTimeoutError);
  await assert.rejects(finality.wait("original-signed-id"), OrganizationTimeoutError);
  assert.equal(reads, 1); resolve("exact finalized receipt");
  assert.equal(await finality.wait("original-signed-id"), "exact finalized receipt"); assert.equal(reads, 1);
});
test("a provider error permits another observation, never another submission", async () => {
  let observations = 0;
  const finality = new OrganizationFinality(async () => { if (++observations === 1) throw new Error("Transport unavailable"); return "same transaction"; }, 100);
  await assert.rejects(finality.wait("id"), /Transport unavailable/);
  assert.equal(await finality.wait("id"), "same transaction"); assert.equal(observations, 2);
});
test("a timed-out approval task cannot resume its caller when a late signature arrives", async () => {
  let finish!: () => void, advancedToSubmission = false;
  const approval = new Promise<void>(resolve => { finish = resolve; });
  await assert.rejects((async () => { await withinDeadline(approval, 5, "Approval expired"); advancedToSubmission = true; })(), OrganizationTimeoutError);
  finish(); await Promise.resolve(); assert.equal(advancedToSubmission, false);
});

test("each stalled wallet identity probe returns within the bound without late continuation", async () => {
  for (const stalled of ["getConfiguration", "getShieldedAddresses", "getUnshieldedAddress"] as const) {
    let resolve!: (value: unknown) => void, continued = false;
    const wallet = {
      getConfiguration: async () => ({ networkId: "preprod" }), getShieldedAddresses: async () => ({}), getUnshieldedAddress: async () => ({}),
      balanceUnsealedTransaction: async () => {}, submitTransaction: async () => {},
      [stalled]: () => new Promise(yes => { resolve = yes; }),
    } as unknown as ConnectedAPI;
    await assert.rejects((async () => { await readOrganizationWallet(wallet, 5); continued = true; })(), OrganizationTimeoutError);
    resolve(stalled === "getConfiguration" ? { networkId: "preprod" } : {});
    await Promise.resolve(); await Promise.resolve(); assert.equal(continued, false);
  }
});

test("wallet identity reads do not overlap or request a signature", async () => {
  let active = 0, peak = 0;
  const read = async (value: object) => {
    peak = Math.max(peak, ++active);
    try {
      if (active > 1) throw new Error("Rate limited");
      await new Promise(resolve => setTimeout(resolve, 1));
      return value;
    } finally { active--; }
  };
  const wallet = {
    getConfiguration: () => read({ networkId: "preprod" }),
    getShieldedAddresses: () => read({ shieldedCoinPublicKey: "identity" }),
    getUnshieldedAddress: () => read({ unshieldedAddress: "recipient" }),
    balanceUnsealedTransaction: () => { throw Error("No balance approval allowed"); },
    submitTransaction: () => { throw Error("No submission allowed"); },
  } as unknown as ConnectedAPI;
  const result = await readOrganizationWallet(wallet);
  assert.equal(result.configuration.networkId, "preprod");
  assert.equal(result.receiving.unshieldedAddress, "recipient");
  assert.equal(peak, 1);
});

test("temporary rate limits recover only the rejected identity read", async () => {
  for (const limited of ["getConfiguration", "getShieldedAddresses", "getUnshieldedAddress"] as const) {
    const counts = { getConfiguration: 0, getShieldedAddresses: 0, getUnshieldedAddress: 0 };
    const read = async (method: typeof limited, value: object) => {
      if (++counts[method] === 1 && method === limited) throw { code: 429, message: "Rate limited" };
      return value;
    };
    const wallet = {
      getConfiguration: () => read("getConfiguration", { networkId: "preprod" }),
      getShieldedAddresses: () => read("getShieldedAddresses", {}),
      getUnshieldedAddress: () => read("getUnshieldedAddress", {}),
      balanceUnsealedTransaction() { throw Error("No balance approval allowed"); },
      submitTransaction() { throw Error("No submission allowed"); },
    } as unknown as ConnectedAPI;
    await readOrganizationWallet(wallet);
    assert.deepEqual(counts, Object.fromEntries(Object.keys(counts).map(method => [method, method === limited ? 2 : 1])));
  }
});

test("persistent wallet rate limits stop with the failing read identified", async () => {
  let calls = 0, laterReads = 0;
  const wallet = {
    getConfiguration: async () => { calls++; throw new Error("Rate limited"); },
    getShieldedAddresses: async () => { laterReads++; return {}; },
    getUnshieldedAddress: async () => { laterReads++; return {}; },
    balanceUnsealedTransaction() {}, submitTransaction() {},
  } as unknown as ConnectedAPI;
  await assert.rejects(readOrganizationWallet(wallet), /wallet.*rate limit.*network configuration/i);
  assert.equal(calls, 3); assert.equal(laterReads, 0);
});

test("an expired wallet read cannot start a later identity request", async () => {
  let resolve!: (value: object) => void, laterReads = 0;
  const wallet = {
    getConfiguration: () => new Promise(yes => { resolve = yes; }),
    getShieldedAddresses: async () => { laterReads++; return {}; },
    getUnshieldedAddress: async () => { laterReads++; return {}; },
    balanceUnsealedTransaction() {}, submitTransaction() {},
  } as unknown as ConnectedAPI;
  await assert.rejects(readOrganizationWallet(wallet, 5), OrganizationTimeoutError);
  resolve({ networkId: "preprod" });
  await new Promise(yes => setTimeout(yes, 10));
  assert.equal(laterReads, 0);
});

test("wallet lock and permission failures are not retried as rate limits", async () => {
  for (const message of ["Wallet is locked", "User rejected address access", "Wallet is unavailable"]) {
    let calls = 0;
    const wallet = { getConfiguration: async () => { calls++; throw Error(message); },
      getShieldedAddresses() {}, getUnshieldedAddress() {}, balanceUnsealedTransaction() {}, submitTransaction() {},
    } as unknown as ConnectedAPI;
    await assert.rejects(readOrganizationWallet(wallet), error => error instanceof Error && error.message === message);
    assert.equal(calls, 1);
  }
});

test("generic wallet failures identify the failed identity read without retrying or advancing", async () => {
  const probes = ["getConfiguration", "getShieldedAddresses", "getUnshieldedAddress"] as const;
  const labels = ["network configuration", "shielded identity", "receiving address"];
  for (const [index, failed] of probes.entries()) {
    for (const failure of [new Error("Request failed"), { reason: "Request failed" }, "Request failed"]) {
      const calls: string[] = [];
      const probe = async (method: typeof probes[number], value: object) => {
        calls.push(method);
        if (method === failed) throw failure;
        return value;
      };
      const wallet = {
        getConfiguration: () => probe("getConfiguration", { networkId: "preprod" }),
        getShieldedAddresses: () => probe("getShieldedAddresses", {}),
        getUnshieldedAddress: () => probe("getUnshieldedAddress", {}),
        signData() { calls.push("signData"); throw Error("Unexpected signature request"); },
        balanceUnsealedTransaction() { calls.push("balance"); throw Error("Unexpected balance request"); },
        submitTransaction() { calls.push("submit"); throw Error("Unexpected submission"); },
      } as unknown as ConnectedAPI;
      await assert.rejects(readOrganizationWallet(wallet), new RegExp(`wallet could not complete the ${labels[index]} check`));
      assert.deepEqual(calls, probes.slice(0, index + 1));
    }
  }
});

test("a revoked session during read backoff prevents another wallet request", async () => {
  let current = true, calls = 0;
  const wallet = { getConfiguration: async () => { calls++; throw Error("Rate limited"); },
    getShieldedAddresses() {}, getUnshieldedAddress() {}, balanceUnsealedTransaction() {}, submitTransaction() {},
  } as unknown as ConnectedAPI;
  const pending = readOrganizationWallet(wallet, 25_000, () => { if (!current) throw Error("Session revoked"); });
  await new Promise(resolve => setTimeout(resolve, 10));
  current = false;
  await assert.rejects(pending, /Session revoked/);
  assert.equal(calls, 1);
});

test("a read deadline cancels a scheduled rate-limit retry", async () => {
  let calls = 0;
  const wallet = { getConfiguration: async () => { calls++; throw Error("Rate limited"); },
    getShieldedAddresses() {}, getUnshieldedAddress() {}, balanceUnsealedTransaction() {}, submitTransaction() {},
  } as unknown as ConnectedAPI;
  await assert.rejects(readOrganizationWallet(wallet, 5), OrganizationTimeoutError);
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal(calls, 1);
});
