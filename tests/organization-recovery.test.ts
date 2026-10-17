import test from "node:test";
import assert from "node:assert/strict";
import { bech32m } from "@scure/base";
import * as R from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger } from "../contracts/managed/organization/contract/index.js";
import { blankPrivate, WITNESSES } from "../src/lib/line/compact-harness.ts";
import { issuerPublicKey, merchantPublicKey, toHex } from "../src/lib/line/encoding.ts";
import { matchesRestoredFacility } from "../src/lib/organization/recovery.ts";
import type { OrganizationFacility } from "../src/lib/organization/account.ts";

test("restored books must match actual generated Compact commitments and fixed recipients", () => {
  const issuer = new Uint8Array(32).fill(1), agent = new Uint8Array(32).fill(2), merchant = new Uint8Array(32).fill(3), nonce = new Uint8Array(32).fill(4), salt = new Uint8Array(32).fill(5), receiving = new Uint8Array(32).fill(6);
  const contract = new Contract(WITNESSES), ps = blankPrivate({ callerSecret: issuer, agentSecret: agent, salt, lineLimit: 100n });
  const initial = contract.initialState(R.createConstructorContext(ps, "00".repeat(32)), issuerPublicKey(issuer), merchantPublicKey(merchant), nonce, { bytes: receiving }, { bytes: receiving }, new Uint8Array(32));
  const facility: OrganizationFacility = { id: "facility", name: "Recovery control", address: "ab".repeat(32), instanceNonce: toHex(nonce), maintenanceKey: "11".repeat(32), assetColor: "00".repeat(32), issuerRecipient: bech32m.encodeFromBytes("mn_addr_preprod", receiving), merchants: [{ name: "Supplier", publicKey: toHex(merchantPublicKey(merchant)), address: bech32m.encodeFromBytes("mn_addr_preprod", receiving) }], agentSecret: toHex(agent), salt: toHex(salt), limit: 0n, outstanding: 0n, epoch: 0n, generation: 0n };
  assert(matchesRestoredFacility(ledger(initial.currentContractState.data), facility, toHex(issuer)));
  const context = R.createCircuitContext(R.dummyContractAddress(), "00".repeat(32), initial.currentContractState, ps, undefined, undefined, 1000);
  const opened = contract.circuits.openLine(context, 10000n, 0n, 0n);
  const book = ledger(opened.context.currentQueryContext.state), current = { ...facility, generation: 1n, limit: 100n };
  assert(matchesRestoredFacility(book, current, toHex(issuer)));
  for (const change of [{ outstanding: 1n }, { limit: 101n }, { salt: "ff".repeat(32) }, { epoch: 1n }, { generation: 0n }, { instanceNonce: "ff".repeat(32) }, { assetColor: "ff".repeat(32) }, { issuerRecipient: bech32m.encodeFromBytes("mn_addr_preprod", new Uint8Array(32).fill(7)) }]) assert.equal(matchesRestoredFacility(book, { ...current, ...change }, toHex(issuer)), false);
  assert.equal(matchesRestoredFacility(book, current, "ff".repeat(32)), false);
});
