import test from "node:test";
import assert from "node:assert/strict";
import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";
import { firstValueFrom, of } from "rxjs";
import { authenticatedOrganizationReads } from "../src/lib/organization/authenticated-reads.ts";

test("all SDK read and finality entry points authenticate before starting and streams authenticate on subscription", async () => {
  const calls: string[] = [];
  const names = ["queryContractState", "queryZSwapAndContractState", "queryDeployContractState", "queryUnshieldedBalances", "watchForContractState", "watchForUnshieldedBalances", "watchForDeployTxData", "watchForTxData"] as const;
  const boundary = Object.fromEntries(names.map(name => [name, async (...args: unknown[]) => { calls.push(name); assert.equal(args[0], "original-signed-reference"); return null; }]));
  const provider = { ...boundary, contractStateObservable: () => { calls.push("state-stream"); return of(null); }, unshieldedBalancesObservable: () => { calls.push("balance-stream"); return of(null); } } as unknown as PublicDataProvider;
  const reads = authenticatedOrganizationReads(provider, async () => { calls.push("authenticate"); });
  for (const name of names) await reads[name]("original-signed-reference");
  assert.deepEqual(calls, names.flatMap(name => ["authenticate", name]));
  calls.length = 0;
  const stream = reads.contractStateObservable("address", { type: "latest" }); assert.deepEqual(calls, []);
  await firstValueFrom(stream); await firstValueFrom(reads.unshieldedBalancesObservable("address", { type: "latest" }));
  assert.deepEqual(calls, ["authenticate", "state-stream", "authenticate", "balance-stream"]);
  const rejected = authenticatedOrganizationReads(provider, async () => { throw Error("Wallet sign-in rejected"); });
  calls.length = 0; await assert.rejects(rejected.queryContractState("address"), /rejected/);
  await assert.rejects(firstValueFrom(rejected.contractStateObservable("address", { type: "latest" })), /rejected/); assert.deepEqual(calls, []);
  assert.equal(authenticatedOrganizationReads(provider), provider);
});
