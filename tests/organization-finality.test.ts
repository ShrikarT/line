import test from "node:test";
import assert from "node:assert/strict";
import { OrganizationFinality, OrganizationTimeoutError, withinDeadline } from "../src/lib/organization/finality.ts";
import { readOrganizationWallet } from "../src/lib/organization/account.ts";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";

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
