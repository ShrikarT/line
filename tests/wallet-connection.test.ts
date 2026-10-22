import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { cancelWalletConnection, connectWallet, disconnectWallet, getAvailableWallets, getConnectedWallet, getConnectedWalletAccount, getWalletAccount } from "../src/lib/runtime/wallet.ts";
import { diagnoseWalletReads } from "../src/lib/runtime/wallet-diagnostics.ts";
import { bech32m } from "@scure/base";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function connected(getConfiguration = async () => ({ networkId: "preprod" })) {
  return { getConfiguration, getShieldedAddresses() {}, balanceUnsealedTransaction() {}, submitTransaction() {},
    getUnshieldedAddress: async () => ({ unshieldedAddress: "test-receiving-address" }),
    getConnectionStatus: async () => ({ status: "connected", networkId: "preprod" }),
  };
}
function inject(connect) {
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    midnight: { lace: { name: "Lace", rdns: "lace", apiVersion: "4.0.1", connect } },
  } });
}
function diagnosticWallet(patch = {}) {
  return { ...connected(), getShieldedAddresses: async () => ({
    shieldedCoinPublicKey: bech32m.encodeFromBytes("mn_shield-cpk_preprod", new Uint8Array(32).fill(11)),
    shieldedEncryptionPublicKey: bech32m.encodeFromBytes("mn_shield-epk_preprod", new Uint8Array(32).fill(12)),
  }), ...patch };
}
beforeEach(async () => { await disconnectWallet(); mock.timers.enable({ apis: ["setTimeout"] }); });
afterEach(async () => {
  await disconnectWallet(); mock.timers.reset();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("a silent locked-wallet request settles instead of connecting forever", async () => {
  inject(() => new Promise(() => {}));
  let failure;
  const attempt = connectWallet("lace").catch(error => { failure = error; });
  await flush(); mock.timers.tick(120_000); await flush();
  assert.match(failure?.message ?? "still connecting", /timed out/i);
  await attempt;
  assert.equal(getConnectedWallet(), null);
});

test("an unresponsive wallet configuration also has a deadline", async () => {
  inject(async () => connected(() => new Promise(() => {})));
  let failure;
  const attempt = connectWallet("lace").catch(error => { failure = error; });
  await flush(); mock.timers.tick(120_000); await flush();
  assert.match(failure?.message ?? "still verifying", /timed out/i);
  await attempt;
  assert.equal(getConnectedWallet(), null);
});

test("disconnect prevents a late wallet response from reconnecting the account", async () => {
  const pending = deferred(); inject(() => pending.promise);
  const attempt = connectWallet("lace").catch(error => error);
  await disconnectWallet(); pending.resolve(connected()); await attempt;
  assert.equal(getConnectedWallet(), null);
});

test("cancel settles a pending request immediately and permits a successful retry", async () => {
  const pending = deferred(); inject(() => pending.promise);
  const first = connectWallet("lace").catch(error => error);
  cancelWalletConnection();
  assert.match((await first).message, /cancelled/i);
  const next = connected(); inject(async () => next);
  assert.equal(await connectWallet("lace"), next);
  pending.resolve(connected()); await flush();
  assert.equal(getConnectedWallet(), next);
});

test("a replaced attempt cannot clear a newer connection when its rejection arrives", async () => {
  const pending = deferred(); inject(() => pending.promise);
  const old = connectWallet("lace").catch(error => error);
  const next = connected(); inject(async () => next);
  assert.equal(await connectWallet("lace"), next);
  pending.reject(new Error("Wallet locked")); await old; await flush();
  assert.equal(getConnectedWallet(), next);
});

test("cancelling during network verification rejects late configuration results", async () => {
  const config = deferred(); inject(async () => connected(() => config.promise));
  const attempt = connectWallet("lace").catch(error => error); await flush();
  cancelWalletConnection(); config.resolve({ networkId: "preprod" });
  assert.match((await attempt).message, /cancelled/i);
  assert.equal(getConnectedWallet(), null);
});

test("structured locked errors give recovery instructions and do not prevent retry", async () => {
  inject(async () => { throw { code: -1, message: "Wallet is locked" }; });
  await assert.rejects(connectWallet("lace"), /Unlock it in the extension/);
  const next = connected(); inject(async () => next);
  assert.equal(await connectWallet("lace"), next);
});

for (const stage of ["access", "configuration"]) test(`a closed extension channel during ${stage} explains recovery without publishing an account`, async () => {
  const failure = { message: "Remote API with channel 'feature-flags' was shutdown: object can no longer be used." };
  inject(async () => {
    if (stage === "access") throw failure;
    return connected(async () => { throw failure; });
  });
  await assert.rejects(connectWallet("lace"), /Lace connection channel closed.*Refresh this page.*reconnect/i);
  assert.equal(getConnectedWallet(), null);
  assert.equal(getConnectedWalletAccount(), null);
  const next = connected(); inject(async () => next);
  assert.equal(await connectWallet("lace"), next);
});

test("an unresponsive receiving-address request does not wait indefinitely", async () => {
  let failure;
  const api = { ...connected(), getUnshieldedAddress: () => new Promise(() => {}) };
  const account = getWalletAccount(api).catch(error => { failure = error; });
  await flush(); mock.timers.tick(20_000); await flush();
  assert.match(failure?.message ?? "still reading address", /address request timed out/i);
  await account;
});

test("wrong-network responses never become a connected session", async () => {
  inject(async () => connected(async () => ({ networkId: "preview" })));
  await assert.rejects(connectWallet("lace"), /network does not match/);
  assert.equal(getConnectedWallet(), null);
});

test("the connection reports its real stages and publishes the wallet address only on success", async () => {
  const next = connected(); inject(async () => next); const stages = [];
  await connectWallet("lace", "preprod", phase => stages.push(phase));
  assert.deepEqual(stages, ["requesting-access", "verifying-network", "reading-address", "checking-session"]);
  assert.deepEqual(getConnectedWalletAccount(), { address: "test-receiving-address", network: "preprod" });
  await disconnectWallet(); assert.equal(getConnectedWalletAccount(), null);
});

test("a connector response without an available account does not claim to be connected", async () => {
  inject(async () => ({ ...connected(), getUnshieldedAddress: async () => { throw { reason: "Wallet is unavailable" }; } }));
  await assert.rejects(connectWallet("lace"), /Wallet is unavailable/);
  assert.equal(getConnectedWallet(), null); assert.equal(getConnectedWalletAccount(), null);
});

test("a disconnected wallet session cannot pass onboarding", async () => {
  inject(async () => ({ ...connected(), getConnectionStatus: async () => ({ status: "disconnected" }) }));
  await assert.rejects(connectWallet("lace"), /has not established a preprod session/i);
  assert.equal(getConnectedWallet(), null);
});

test("cancel while reading the address cannot publish the late account", async () => {
  const address = deferred(); inject(async () => ({ ...connected(), getUnshieldedAddress: () => address.promise }));
  const attempt = connectWallet("lace").catch(error => error); await flush();
  cancelWalletConnection(); address.resolve({ unshieldedAddress: "late-address" });
  assert.match((await attempt).message, /cancelled/i);
  assert.equal(getConnectedWalletAccount(), null); assert.equal(getConnectedWallet(), null);
});

test("session verification also times out without claiming a connection", async () => {
  inject(async () => ({ ...connected(), getConnectionStatus: () => new Promise(() => {}) }));
  let failure; const attempt = connectWallet("lace").catch(error => { failure = error; });
  await flush(); mock.timers.tick(20_000); await flush();
  assert.match(failure?.message ?? "still checking session", /session check timed out/i);
  await attempt; assert.equal(getConnectedWallet(), null);
});

test("the selected 1AM provider is used without calling Lace or incompatible wallets", async () => {
  const calls = []; const oneAm = connected();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { midnight: {
    "lace-uuid": { name: "Lace", rdns: "io.lace.wallet", apiVersion: "4.0.1", connect: async () => { calls.push("lace"); return connected(); } },
    "1am-uuid": { name: "1AM", rdns: "xyz.1am", apiVersion: "4.0.1", connect: async () => { calls.push("1am"); return oneAm; } },
    legacy: { name: "Legacy", apiVersion: "3.0.0", connect: async () => { throw new Error("Unsupported wallet selected"); } },
  } } });
  assert.deepEqual(getAvailableWallets().filter(w => w.isAvailable).map(w => w.id), ["lace-uuid", "1am-uuid"]);
  assert.equal(await connectWallet("1am-uuid"), oneAm);
  assert.deepEqual(calls, ["1am"]);
});

test("multiple injected wallets require explicit choice and duplicate rdns values cannot redirect it", async () => {
  const a = connected(); const b = connected();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { midnight: {
    first: { name: "First", rdns: "same.rdns", apiVersion: "4.0.1", connect: async () => a },
    second: { name: "Second", rdns: "same.rdns", apiVersion: "4.0.1", connect: async () => b },
  } } });
  await assert.rejects(connectWallet(), /Choose which Midnight wallet/);
  await assert.rejects(connectWallet("same.rdns"), /Choose which Midnight wallet/);
  assert.equal(await connectWallet("second"), b);
});

test("locked errors identify the selected alternative wallet", async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { midnight: {
    "1am-uuid": { name: "1AM", rdns: "xyz.1am", apiVersion: "4.0.1", connect: async () => { throw { reason: "Wallet is locked" }; } },
  } } });
  await assert.rejects(connectWallet("1am-uuid"), /1AM is locked/);
});

test("connector diagnostics distinguish a failing live session read from healthy configuration and identities without retrying", async () => {
  let sessions = 0, payments = 0;
  const wallet = diagnosticWallet({ getConnectionStatus: async () => { sessions++; throw { code: 429, message: "Rate limited" }; }, balanceUnsealedTransaction: () => { payments++; }, submitTransaction: () => { payments++; }, signData: () => { payments++; } });
  const reported = [];
  const results = await diagnoseWalletReads(wallet, "test-receiving-address", () => true, result => reported.push(result), { pauseMs: 0 });
  assert.deepEqual(results.map(row => row.outcome), ["passed", "passed", "passed", "failed"]);
  assert.deepEqual(results.map(row => row.method), ["getConfiguration", "getShieldedAddresses", "getUnshieldedAddress", "getConnectionStatus"]);
  assert.deepEqual(results, reported); assert.equal(sessions, 1); assert.equal(payments, 0);
  assert.equal(results[3].detail, "Connector rate limit"); assert.equal(results[3].code, "429");
  assert(!JSON.stringify(results).includes("test-receiving-address"));
});

test("a failed connection exposes only explicit read-only diagnostics and never publishes a connected API", async () => {
  const wallet = diagnosticWallet({ getConnectionStatus: async () => { throw { code: -32603, message: "Request failed" }; } });
  inject(async () => wallet);
  let target;
  await assert.rejects(connectWallet("lace", "preprod", () => {}, value => { target = value; }), /Request failed/);
  assert.equal(getConnectedWallet(), null); assert.equal(getConnectedWalletAccount(), null);
  assert.deepEqual(Object.keys(target.reads).sort(), ["getConfiguration", "getConnectionStatus", "getShieldedAddresses", "getUnshieldedAddress"].sort());
  const results = await diagnoseWalletReads(target.reads, target.address, () => true, () => {}, { pauseMs: 0 });
  assert.deepEqual(results.map(row => row.outcome), ["passed", "passed", "passed", "failed"]);
  assert.equal(getConnectedWallet(), null);
});

test("configuration failure retains read-only diagnostics before any receiving address is verified", async () => {
  const wallet = diagnosticWallet({ getConfiguration: async () => { throw Error("Request failed"); } });
  inject(async () => wallet);
  let target;
  await assert.rejects(connectWallet("lace", "preprod", () => {}, value => { target = value; }), /Request failed/);
  assert.equal(target.address, null);
  const results = await diagnoseWalletReads(target.reads, target.address, () => true, () => {}, { pauseMs: 0 });
  assert.deepEqual(results.map(row => row.outcome), ["failed", "passed", "passed", "passed"]);
  assert.match(results[2].detail, /no verified connection to compare/);
  assert.equal(getConnectedWallet(), null); assert.equal(getConnectedWalletAccount(), null);
});

test("connector diagnostics redact service credentials, arbitrary wallet messages and public identity bytes", async () => {
  const secretControl = "redaction-control-sensitive";
  const wallet = diagnosticWallet({ getConfiguration: async () => { throw { code: secretControl, message: `https://provider.invalid/?token=${secretControl}` }; } });
  const results = await diagnoseWalletReads(wallet, "test-receiving-address", () => true, () => {}, { pauseMs: 0 });
  assert.equal(results[0].outcome, "failed"); assert.equal(results[0].detail, "Connector read failed");
  const rendered = JSON.stringify(results);
  for (const value of [secretControl, "provider.invalid", "mn_shield", "test-receiving-address"]) assert(!rendered.includes(value));
});

test("a timed-out diagnostic stops and a late reply cannot start another probe", async () => {
  const request = deferred(); let identities = 0;
  const wallet = diagnosticWallet({ getConfiguration: () => request.promise, getShieldedAddresses: async () => { identities++; } });
  const reported = [], work = diagnoseWalletReads(wallet, "test-receiving-address", () => true, row => reported.push(row), { timeoutMs: 10, pauseMs: 0 });
  await flush(); mock.timers.tick(11); await flush();
  const results = await work; assert.equal(results.length, 1); assert.equal(results[0].outcome, "timed out");
  request.resolve({ networkId: "preprod" }); await flush();
  assert.equal(identities, 0); assert.equal(reported.length, 1);
});

test("a wallet change discards diagnostic replies before publication or subsequent reads", async () => {
  const request = deferred(); let current = true, published = 0, identities = 0;
  const wallet = diagnosticWallet({ getConfiguration: () => request.promise, getShieldedAddresses: async () => { identities++; } });
  const work = diagnoseWalletReads(wallet, "test-receiving-address", () => current, () => { published++; }, { pauseMs: 0 });
  await flush(); current = false; request.resolve({ networkId: "preprod" });
  await assert.rejects(work, /connection changed/); assert.equal(published, 0); assert.equal(identities, 0);
});

test("diagnostics report network, recipient and disconnected-session mismatches as failures", async () => {
  const wallet = diagnosticWallet({ getConfiguration: async () => ({ networkId: "mainnet" }), getUnshieldedAddress: async () => ({ unshieldedAddress: "different" }), getConnectionStatus: async () => ({ status: "disconnected", networkId: "preprod" }) });
  const results = await diagnoseWalletReads(wallet, "test-receiving-address", () => true, () => {}, { pauseMs: 0 });
  assert.deepEqual(results.map(row => row.outcome), ["failed", "passed", "failed", "failed"]);
});
