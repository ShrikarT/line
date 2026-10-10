#!/usr/bin/env node
/** Compiled custody feasibility experiment; never deploys or pays an asset.
 * The experimental source is derived from the complete canonical twelve-circuit
 * contract. Only opening changes: the agent prepares a consent commitment and
 * the issuer accepts its exact terms using a non-secret enrollment identity.
 * Each actor generates its signing secret inside its own child process. No actor
 * or coordinator receives another actor's secret. This does not establish
 * legal-borrower consent, production custody, proving, or historical privacy.
 */
import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as RT from "@midnight-ntwrk/compact-runtime";
import { agentId, issuerPublicKey, merchantPublicKey, lineStateCommit, toHex } from "../src/lib/line/encoding.ts";
import { encodeVaultJson, decodeVaultJson } from "../src/lib/security/vault-codec.ts";

const self = fileURLToPath(import.meta.url);
const COIN = "0".repeat(64);
const NOW = 1_800_000_000;
const wire = value => encodeVaultJson(value);
const unwire = value => decodeVaultJson(value);
const bytes = () => new Uint8Array(randomBytes(32));
function stateBytes(data) {
  const state = new RT.ContractState();
  state.data = data instanceof RT.ContractState ? data.data : data instanceof RT.ChargedState ? data : new RT.ChargedState(data);
  return state.serialize();
}

async function actorMain(role, artifactDir) {
  const secret = bytes(); // Never put this in IPC, a result, or a persisted artifact.
  const publicKey = role === "issuer" ? issuerPublicKey(secret) : role === "agent" ? agentId(secret) : merchantPublicKey(secret);
  const { Contract, ledger } = await import(pathToFileURL(join(artifactDir, "contract/index.js")).href);
  const info = JSON.parse(readFileSync(join(artifactDir, "compiler/contract-info.json"), "utf8"));
  let active;
  let calls;
  const witnesses = Object.fromEntries(info.witnesses.map(({ name }) => [name, ctx => {
    calls.push(name);
    if (name === "callerSecret") return [ctx.privateState, secret];
    if (name === "agentSecret") {
      if (role !== "agent") throw new Error("Actor has no agent signing secret.");
      return [ctx.privateState, secret];
    }
    if (!(name in active.values)) throw new Error(`Missing experiment witness: ${name}`);
    return [ctx.privateState, active.values[name]];
  }]));
  const contract = new Contract(witnesses);
  process.on("message", async message => {
    try {
      active = unwire(message.body);
      assert(!("agentSecret" in active.values) && !("callerSecret" in active.values), "Signing secrets cannot be supplied over actor IPC.");
      calls = [];
      const state = RT.ContractState.deserialize(active.state);
      const ctx = RT.createCircuitContext(RT.dummyContractAddress(), COIN, state.data, {}, undefined, undefined, NOW);
      const result = await contract.circuits[active.name](ctx, ...active.args);
      const data = result.context.currentQueryContext.state;
      const book = ledger(data);
      process.send({ id: message.id, body: wire({ ok: true, state: stateBytes(data), calls,
        public: { identity: book.identityCommit, commitment: book.lineCommit, domain: book.contractDomain,
          T: book.totalReserve, E: book.encumberedReserve, R: book.redeemedReserve,
          quotes: [...book.quotes], notes: [...book.notes] } }) });
    } catch (error) {
      // Generated-contract errors are fixed constraint labels, never witness values.
      process.send({ id: message.id, body: wire({ ok: false, error: error.message, calls }) });
    }
  });
  process.send({ ready: true, publicKey: toHex(publicKey), pid: process.pid });
}

function startActor(role, artifactDir, label = role) {
  const child = fork(self, ["--actor", role, artifactDir], { execArgv: ["--experimental-strip-types"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let counter = 0;
  const pending = new Map();
  let resolveReady, rejectReady;
  const ready = new Promise((yes, no) => { resolveReady = yes; rejectReady = no; });
  const timer = setTimeout(() => rejectReady(new Error("Custody actor startup timed out.")), 60_000);
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
  child.on("error", rejectReady);
  child.on("exit", code => {
    clearTimeout(timer);
    const error = new Error(`Custody actor exited (${code}): ${stderr}`);
    rejectReady(error);
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
  });
  child.on("message", message => {
    if (message.ready) { clearTimeout(timer); resolveReady({ publicKey: new Uint8Array(Buffer.from(message.publicKey, "hex")), pid: message.pid }); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer); request.resolve(unwire(message.body));
  });
  return { child, ready, label, request(body) {
    return new Promise((resolve, reject) => {
      const id = ++counter;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Custody actor operation timed out.")); }, 60_000);
      pending.set(id, { resolve, reject, timer });
      child.send({ id, body: wire(body) }, error => { if (error) { clearTimeout(timer); pending.delete(id); reject(error); } });
    });
  } };
}

async function compile(source, target) {
  await new Promise((yes, no) => {
    const portable = path => relative(process.cwd(), path).split(sep).join("/");
    const child = spawn(process.execPath, ["scripts/compile-compact.mjs", "--skip-zk", portable(source), portable(target)], { stdio: "inherit" });
    child.on("error", no); child.on("close", code => code === 0 ? yes() : no(new Error(`Custody experiment compilation failed: ${code}`)));
  });
}

async function main() {
  const scratch = resolve(".compact-keys"); mkdirSync(scratch, { recursive: true });
  const work = mkdtempSync(join(scratch, "custody-spike-"));
  const source = join(work, "line.compact"), target = join(work, "managed");
  let text = readFileSync("contracts/line.compact", "utf8");
  const start = text.indexOf("export circuit openLine(");
  const end = text.indexOf("export circuit postQuote(", start);
  const opening = text.slice(start, end);
  const needle = "  const k = agentSecret();\n  const I = agentId(k);";
  assert.equal(opening.split(needle).length, 2, "Canonical opening changed; review the experiment instead of applying an uncertain patch.");
  const preparation = `export circuit openLine(action: Uint<8>, expiry: Uint<64>, flatFee: Uint<64>, basisPoints: Uint<64>): [] {
  // Action 0 records an agent's request, not an opened facility.
  // Action 1 retains issuer-exclusive authority to actually open the line.
  const publicAction = disclose(action);
  assert(publicAction <= 1, "enrollment action");
  if (publicAction == 0) {
    assert(status == Status.NONE || status == Status.CLOSED, "line already open");
    const limit = lineLimit();
    assert(limit > 0, "limit");
    assert(blockTimeLt(disclose(expiry)), "expiry");
    assert(basisPoints <= 10000, "fee rate");
    const I = agentId(agentSecret());
    const request = enrollmentCommit(I, limit, salt(), expiry, flatFee, basisPoints, acceptedTerms());
    const pubRequest = disclose(request);
    assert(!enrollments.member(pubRequest), "enrollment exists");
    enrollments.insert(pubRequest, false);
    actionClock.increment(1);
    return;
  }
`;
  let changedOpening = opening.replace("export circuit openLine(expiry: Uint<64>, flatFee: Uint<64>, basisPoints: Uint<64>): [] {\n", preparation);
  changedOpening = changedOpening.replace(needle, `  const I = enrollmentIdentity();
  assert(I != default<Bytes<32>>, "enrollment identity");
  const request = disclose(enrollmentCommit(I, limit, salt(), expiry, flatFee, basisPoints, acceptedTerms()));
  assert(enrollments.member(request), "agent consent missing");
  assert(!enrollments.lookup(request), "agent consent used");
  enrollments.insert(request, true);`);
  const helper = `circuit enrollmentCommit(I: Bytes<32>, limit: Uint<64>, bookSalt: Bytes<32>, expiry: Uint<64>, flatFee: Uint<64>, basisPoints: Uint<64>, terms: Bytes<32>): Bytes<32> {
  const C0 = lineStateCommit(LinePreimage { domain: contractDomain, identity: I, limit: limit, outstanding: 0, epoch: 0 }, bookSalt);
  return persistentHash<Vector<8, Bytes<32>>>([pad(32, "line:spike:enroll"), contractDomain, C0,
    encodeU64((lineGeneration + 1) as Uint<64>), encodeU64(expiry), encodeU64(flatFee), encodeU64(basisPoints), terms]);
}

`;
  text = text.slice(0, start) + helper + changedOpening + text.slice(end);
  text = text.replace("witness agentSecret(): Bytes<32>;", "witness agentSecret(): Bytes<32>;\nwitness enrollmentIdentity(): Bytes<32>;\nwitness acceptedTerms(): Bytes<32>;");
  text = text.replace("export ledger identityCommit: Bytes<32>;", "export ledger enrollments: Map<Bytes<32>, Boolean>;\nexport ledger identityCommit: Bytes<32>;");
  writeFileSync(source, text, "utf8");
  await compile(source, target);
  const info = JSON.parse(readFileSync(join(target, "compiler/contract-info.json"), "utf8"));
  const original = JSON.parse(readFileSync("contracts/managed/line/compiler/contract-info.json", "utf8"));
  assert.deepEqual(info.circuits.map(c => c.name).sort(), original.circuits.map(c => c.name).sort(), "Experiment must preserve all twelve names.");
  assert.deepEqual(info.circuits.filter(c => c.name !== "openLine"), original.circuits.filter(c => c.name !== "openLine"), "Other eleven circuit signatures must remain unchanged.");
  const issuer = startActor("issuer", target), agent = startActor("agent", target);
  const merchantA = startActor("merchant", target, "merchant-a"), merchantB = startActor("merchant", target, "merchant-b");
  const otherAgent = startActor("agent", target, "other-agent");
  const actors = [issuer, agent, merchantA, merchantB, otherAgent];
  try {
    const [i, a, ma, mb, other] = await Promise.all(actors.map(actor => actor.ready));
    assert.equal(new Set([i.pid, a.pid, ma.pid, mb.pid, other.pid]).size, 5);
    const { Contract, ledger } = await import(pathToFileURL(join(target, "contract/index.js")).href);
    const forbidden = Object.fromEntries(info.witnesses.map(({ name }) => [name, () => { throw new Error("Coordinator has no signing secrets or witnesses."); }]));
    const contract = new Contract(forbidden);
    const initial = contract.initialState(RT.createConstructorContext({}, COIN), i.publicKey, ma.publicKey, bytes());
    let state = stateBytes(initial.currentContractState);
    const initialLedger = ledger(initial.currentContractState.data);
    const domain = initialLedger.contractDomain;
    const traces = [];
    async function invoke(actor, name, args, values = {}, accepted = true) {
      const result = await actor.request({ state, name, args, values });
      assert.equal(result.ok, accepted, result.error);
      traces.push({ actor: actor.label, circuit: name, accepted, witnesses: result.calls });
      if (result.ok) state = result.state;
      return result;
    }
    await invoke(issuer, "registerMerchant", [mb.publicKey]);
    await invoke(issuer, "fundReserve", [100n]);
    const salt = bytes(), drawSalt = bytes(), repaymentSalt = bytes();
    const openValues = { enrollmentIdentity: a.publicKey, lineLimit: 40n, salt, acceptedTerms: bytes() };
    const openArgs = [1n, BigInt(NOW + 10_000), 0n, 0n];
    await invoke(issuer, "openLine", openArgs, openValues, false);
    await invoke(agent, "openLine", openArgs, openValues, false);
    const requested = await invoke(agent, "openLine", [0n, ...openArgs.slice(1)], openValues);
    assert(requested.calls.includes("agentSecret") && !requested.calls.includes("callerSecret"));
    await invoke(agent, "openLine", [0n, ...openArgs.slice(1)], openValues, false);
    await invoke(issuer, "openLine", openArgs, { ...openValues, lineLimit: 41n }, false);
    await invoke(issuer, "openLine", [1n, openArgs[1], 1n, 0n], openValues, false);
    await invoke(issuer, "openLine", openArgs, { ...openValues, acceptedTerms: bytes() }, false);
    const opened = await invoke(issuer, "openLine", openArgs, openValues);
    assert(!opened.calls.includes("agentSecret"));
    assert.deepEqual(opened.public.commitment, lineStateCommit({ domain, identity: a.publicKey, limit: 40n, outstanding: 0n, epoch: 0n }, salt));
    const invoiceId = bytes(), quoteNonce = bytes(), noteNonce = bytes(), noteSalt = bytes(), expiry = BigInt(NOW + 500);
    const quote = await invoke(merchantA, "postQuote", [expiry], { invoiceId, quoteNonce, quoteAmount: 25n });
    const Q = quote.public.quotes[0][0];
    const drawValues = { lineLimit: 40n, lineOutstanding: 0n, lineEpoch: 0n, salt, newSalt: drawSalt,
      invoiceId, quoteNonce, drawAmount: 25n, quoteMerchantPk: ma.publicKey, noteNonce, noteSalt };
    await invoke(issuer, "draw", [Q, expiry, 0n], drawValues, false);
    await invoke(merchantB, "draw", [Q, expiry, 0n], drawValues, false);
    await invoke(otherAgent, "draw", [Q, expiry, 0n], drawValues, false);
    const drawn = await invoke(agent, "draw", [Q, expiry, 0n], drawValues);
    assert(!drawn.calls.includes("callerSecret"));
    assert.deepEqual(drawn.public.commitment, lineStateCommit({ domain, identity: a.publicKey, limit: 40n, outstanding: 25n, epoch: 1n }, drawSalt));
    // This is an explicit counterexample, not a successful privacy test.
    const debtReconstructedFromPublicHistory = drawn.public.notes.reduce((sum, [, note]) => sum + note.amount + note.fee, 0n);
    assert.equal(debtReconstructedFromPublicHistory, 25n);
    await invoke(agent, "draw", [Q, expiry, 0n], drawValues, false);
    const secondInvoice = bytes(), secondNonce = bytes();
    const secondQuote = await invoke(merchantB, "postQuote", [expiry], { invoiceId: secondInvoice, quoteNonce: secondNonce, quoteAmount: 20n });
    const secondQ = secondQuote.public.quotes.find(([key]) => toHex(key) !== toHex(Q))[0];
    await invoke(agent, "draw", [secondQ, expiry, 0n], { ...drawValues, lineOutstanding: 25n, lineEpoch: 1n, salt: drawSalt,
      invoiceId: secondInvoice, quoteNonce: secondNonce, drawAmount: 20n, quoteMerchantPk: mb.publicKey }, false);
    const D = drawn.public.notes[0][0];
    const noteValues = { redeemAmount: 25n, noteIdentity: a.publicKey, noteQuoteCommit: Q, noteNonce, noteSalt };
    await invoke(merchantB, "redeemDraw", [D, expiry], noteValues, false);
    await invoke(merchantA, "redeemDraw", [D, expiry], noteValues);
    await invoke(merchantA, "redeemDraw", [D, expiry], noteValues, false);
    const repaymentValues = { lineLimit: 40n, lineOutstanding: 25n, lineEpoch: 1n, salt: drawSalt,
      newSalt: repaymentSalt, repayAmount: 10n, receiptNonce: bytes(), paymentRef: bytes() };
    await invoke(agent, "acknowledgeRepayment", [BigInt(NOW + 500)], repaymentValues, false);
    const repaid = await invoke(issuer, "acknowledgeRepayment", [BigInt(NOW + 500)], repaymentValues);
    assert(!repaid.calls.includes("agentSecret"));
    assert.deepEqual(repaid.public.commitment, lineStateCommit({ domain, identity: a.publicKey, limit: 40n, outstanding: 15n, epoch: 2n }, repaymentSalt));
    assert.equal(repaid.public.E, 0n); assert.equal(repaid.public.R, 25n); assert.equal(repaid.public.T, 100n);
    const report = { schema: "line-custody-feasibility/v2", createdAt: new Date().toISOString(), compiler: info["compiler-version"],
      canonicalChanged: false, exportedCircuits: info.circuits.map(c => c.name), independentlyKeyedActorProcesses: 5,
      coordinatorHasSigningSecrets: false, issuerOpeningUsesAgentSecret: false, issuerRepaymentUsesAgentSecret: false,
      historicalPrivacyPassed: false, publicHistoryCounterexample: "Known-zero singleton debt reconstructed as 25 from its public note.",
      agentFacilityConsentBound: true, legalBorrowerConsentAuthenticated: false, experimentalOpeningActionParameter: true,
      cryptographicProofsGenerated: false, networkFinalityConfirmed: false, assetTransfers: false,
      traces, remaining: ["Accountable borrower authority and complete operating terms", "Canonical runtime/console integration and independent storage",
        "Multi-borrower full-transcript privacy construction", "Proof generation/verification and network metadata",
        "Authentic settlement receipts and customer evidence"] };
    writeFileSync(join(work, "evidence.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ result: "OPENING KEY-SEPARATION FEASIBILITY PASS; HISTORICAL PRIVACY FAILS", evidence: relative(process.cwd(), join(work, "evidence.json")),
      compiler: report.compiler, circuits: report.exportedCircuits.length, actorProcesses: actors.length, signingSecretsShared: false, canonicalChanged: false }));
  } finally {
    for (const { child } of actors) child.kill();
  }
}

try {
  if (process.argv[2] === "--actor") await actorMain(process.argv[3], process.argv[4]);
  else await main();
} catch (error) { console.error(error.message); process.exitCode = 1; }
