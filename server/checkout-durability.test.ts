import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createServer, type Server } from "node:http";
import { CheckoutEvaluation, CheckoutError } from "./checkout-engine.ts";
import type { CircuitCall, PrivateState } from "../src/lib/line/compact-harness.ts";
import { checkoutMiddleware } from "./checkout-http.ts";
import { EncryptedCheckoutStore, type CheckoutCheckpointStore } from "./checkout-storage.ts";

const PASSWORD = "test-only-checkpoint-passphrase";
test("checkpoint recovery rejects the pre-domain-commitment snapshot version", async () => {
  const f = await fixture();
  try {
    const engine = await CheckoutEvaluation.create(f.store);
    const legacy = { ...(engine as any).snapshot(), version: 3 };
    assert.throws(() => CheckoutEvaluation.recover(legacy, f.store), /Invalid checkout snapshot/);
  } finally { await f.close(); }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "line-checkout-durable-"));
  const directory = join(root, "private");
  let store = await EncryptedCheckoutStore.open(directory, PASSWORD);
  return { root, directory, get store() { return store; }, async reopen(password = PASSWORD) { await store.close(); store = await EncryptedCheckoutStore.open(directory, password); return store; }, async close() { await store.close(); await rm(root, { recursive: true, force: true }); } };
}

for (const boundary of ["allocation", "refund-report"] as const) {
  test(`encrypted restart preserves ${boundary} exactly once with original private refund opening`, async () => {
    const f = await fixture(); let now = 1_800_000_000, interrupted = false;
    const store: CheckoutCheckpointStore = { mode: "encrypted-disk", loadAll: () => f.store.loadAll(), remove: id => f.store.remove(id), close: () => f.store.close(),
      async save(id, value) {
        await f.store.save(id, value);
        const order = (value as any).orders[0]?.[1];
        if (!interrupted && order?.phase === "compensated" && (boundary === "allocation" || order.compensation.reportedReference)) {
          interrupted = true; throw new Error("Lost process after compensation publication");
        }
      } };
    try {
      const engine = await CheckoutEvaluation.create(store, { clock: () => now }); await engine.configure(100, 200);
      const access = engine as unknown as { transition(ps: PrivateState, op: CircuitCall): Promise<unknown> }, transition = access.transition.bind(engine);
      access.transition = async (ps, op) => { if (op.name === "redeemDraw") throw new CheckoutError(503, "Merchant unavailable"); return transition(ps, op); };
      await assert.rejects(engine.purchase("text-analysis", "durable refund", "durable-refund-order"), /Merchant unavailable/);
      await engine.acknowledge(10, "durable-incoming-ref"); now += 600;
      if (boundary === "allocation") await assert.rejects(engine.purchase("text-analysis", "durable refund", "durable-refund-order"), /checkpoint failed/);
      else {
        assert.equal((await engine.purchase("text-analysis", "durable refund", "durable-refund-order")).outcome, "compensated");
        await assert.rejects(engine.reportRefund("durable-refund-order", "durable-outgoing-ref"), /checkpoint failed/);
      }
      assert.throws(() => engine.publicView(), /requires server restart/);
      const reopened = await f.reopen(), snapshot = (await reopened.loadAll())[0];
      const recovered = CheckoutEvaluation.recover(snapshot, reopened, { clock: () => now });
      const receipts = await Promise.all(Array.from({ length: 3 }, () => recovered.purchase("text-analysis", "durable refund", "durable-refund-order")));
      for (const receipt of receipts) assert.deepEqual(receipt, receipts[0]); assert.equal(receipts[0].outcome, "compensated");
      assert.equal(recovered.publicView().deliveries, 0); assert.equal(recovered.issuerView().privateBooks.outstanding, 0);
      assert.equal(recovered.issuerView().refunds[0].amount, 10); assert.equal("refunds" in recovered.publicView(), false);
      if (boundary === "allocation") assert.equal(recovered.publicView().refundReserve, 25);
      const first = await recovered.reportRefund("durable-refund-order", "durable-outgoing-ref");
      assert.equal(first.totalReserve, 200); assert.equal(first.refundReserve, 0); assert.equal(first.reportedRefundReserve, 25);
      assert.deepEqual(await recovered.reportRefund("durable-refund-order", "durable-outgoing-ref"), first);
    } finally { await f.close(); }
  });
}

for (const phase of ["prepared", "quoted", "authorized", "redeemed", "delivered"] as const) {
  test(`restart resumes durable ${phase} purchase with the original quote/note and exactly one accounting charge`, async () => {
    const f = await fixture();
    let interrupted = false;
    const store: CheckoutCheckpointStore = {
      mode: "encrypted-disk", loadAll: () => f.store.loadAll(), remove: id => f.store.remove(id), close: () => f.store.close(),
      async save(id, value) {
        await f.store.save(id, value);
        const snapshot = value as { orders: [string, { phase: string }][] };
        if (!interrupted && snapshot.orders[0]?.[1].phase === phase) { interrupted = true; throw new Error("Simulated process loss after durable publication."); }
      },
    };
    try {
      const original = await CheckoutEvaluation.create(store);
      await original.configure(100, 200);
      await assert.rejects(original.purchase("text-analysis", "private input alpha alpha.", "boundary-purchase-id"), /checkpoint failed/);
      assert.throws(() => original.publicView(), /requires server restart/);
      await assert.rejects(original.purchase("text-analysis", "private input alpha alpha.", "boundary-purchase-id"), /requires server restart/);
      const reopened = await f.reopen();
      const [snapshot] = await reopened.loadAll();
      const before = snapshot as { orders: [string, { receipt: { quote: string; note: string | null } }][] };
      const recovered = CheckoutEvaluation.recover(snapshot, reopened);
      assert.equal(recovered.id, original.id);
      assert.equal(recovered.agentToken, original.agentToken);
      const receipts = await Promise.all(Array.from({ length: 5 }, () => recovered.purchase("text-analysis", "private input alpha alpha.", "boundary-purchase-id")));
      assert.equal(receipts[0].quote, before.orders[0][1].receipt.quote);
      if (before.orders[0][1].receipt.note) assert.equal(receipts[0].note, before.orders[0][1].receipt.note);
      for (const receipt of receipts) assert.deepEqual(receipt, receipts[0]);
      assert.equal(receipts[0].outcome, "delivered");
      assert.equal(receipts[0].output?.words, 4);
      assert.equal(recovered.issuerView().privateBooks.outstanding, 25);
      assert.equal(recovered.publicView().redeemedReserve, 25);
      assert.equal(recovered.publicView().encumberedReserve, 0);
      assert.equal(recovered.publicView().deliveries, 1);
      for (const stage of ["merchant-quote-posted", "authorization-accepted", "merchant-claim-redeemed", "service-delivered"]) assert.equal(receipts[0].stages.filter(item => item === stage).length, 1);
    } finally { await f.close(); }
  });
}

test("recovered facility funding and acknowledgement references cannot be applied twice across later purchases", async () => {
  const f = await fixture();
  try {
    const initial = await CheckoutEvaluation.create(f.store);
    await initial.configure(100, 200);
    await initial.purchase("text-analysis", "first", "first-recovered-id");
    await initial.acknowledge(25, "durable-payment-ref");
    const reopened = await f.reopen();
    const recovered = CheckoutEvaluation.recover((await reopened.loadAll())[0], reopened);
    await recovered.configure(100, 200);
    await recovered.purchase("cost-report", "second", "second-recovered-id");
    await recovered.acknowledge(25, "durable-payment-ref");
    assert.equal(recovered.issuerView().privateBooks.outstanding, 20);
    assert.equal(recovered.publicView().totalReserve, 200);
    await assert.rejects(recovered.acknowledge(24, "durable-payment-ref"), /another amount/);
    await assert.rejects(recovered.purchase("text-analysis", "changed", "first-recovered-id"), /different purchase terms/);
  } finally { await f.close(); }
});

test("failed checkpoint publication fail-stops mutations and restart restores the last committed state", async () => {
  const f = await fixture();
  let fail = false;
  const store: CheckoutCheckpointStore = { mode: "encrypted-disk", loadAll: () => f.store.loadAll(), remove: id => f.store.remove(id), close: () => f.store.close(), async save(id, snapshot) { if (fail) throw new Error("Injected write failure."); await f.store.save(id, snapshot); } };
  try {
    const engine = await CheckoutEvaluation.create(store);
    await engine.configure(100, 200);
    fail = true;
    await assert.rejects(engine.purchase("text-analysis", "write must commit", "failed-write-order"), /checkpoint failed/);
    await assert.rejects(engine.acknowledge(1, "failed-write-ack"), /requires server restart/);
    const reopened = await f.reopen();
    const restored = CheckoutEvaluation.recover((await reopened.loadAll())[0], reopened);
    assert.equal(restored.publicView().orders.length, 0);
    assert.equal(restored.issuerView().privateBooks.outstanding, 0);
    await restored.purchase("text-analysis", "write must commit", "failed-write-order");
    assert.equal(restored.issuerView().privateBooks.outstanding, 25);
  } finally { await f.close(); }
});

test("actual failed filesystem publication rejects success and removes its temporary checkpoint", async () => {
  const f = await fixture();
  const id = "11111111-1111-4111-8111-111111111111";
  try {
    // A directory at the destination forces same-volume atomic rename to fail.
    await mkdir(join(f.directory, `${id}.checkpoint`));
    await assert.rejects(f.store.save(id, { secret: "not published", units: 18446744073709551615n }), /could not be committed/);
    assert.equal((await readdir(f.directory)).some(file => file.endsWith(".tmp")), false);
    assert.equal((await readdir(join(f.directory, `${id}.checkpoint`))).length, 0);
  } finally { await f.close(); }
});

test("pending checkpoint reads fail closed and HTTP-compatible idle waits reveal only committed state", async () => {
  const f = await fixture();
  let hold = false, reached!: () => void, release!: () => void;
  const entered = new Promise<void>(resolveEntered => { reached = resolveEntered; });
  const gate = new Promise<void>(resolveGate => { release = resolveGate; });
  const store: CheckoutCheckpointStore = { mode: "encrypted-disk", loadAll: () => f.store.loadAll(), remove: id => f.store.remove(id), close: () => f.store.close(), async save(id, snapshot) { if (hold) { hold = false; reached(); await gate; } await f.store.save(id, snapshot); } };
  try {
    const engine = await CheckoutEvaluation.create(store);
    hold = true;
    const configure = engine.configure(100, 200);
    await entered;
    assert.throws(() => engine.publicView(), /still committing/);
    let idleResolved = false;
    const idle = engine.whenIdle().then(() => { idleResolved = true; });
    await new Promise<void>(resolveTurn => setImmediate(resolveTurn));
    assert.equal(idleResolved, false);
    release();
    await configure; await idle;
    assert.equal(engine.publicView().opened, true);
    assert.equal(engine.publicView().totalReserve, 200);
  } finally { release(); await f.close(); }
});

test("funded but unopened durable facility resumes its original terms without funding twice", async () => {
  const f = await fixture();
  let interrupted = false;
  const store: CheckoutCheckpointStore = { mode: "encrypted-disk", loadAll: () => f.store.loadAll(), remove: id => f.store.remove(id), close: () => f.store.close(), async save(id, value) {
    await f.store.save(id, value);
    const snapshot = value as { fundedReserve: bigint; opened: boolean };
    if (!interrupted && snapshot.fundedReserve > 0n && !snapshot.opened) { interrupted = true; throw new Error("Process loss after funding commit."); }
  } };
  try {
    const original = await CheckoutEvaluation.create(store);
    await assert.rejects(original.configure(100, 200), /checkpoint failed/);
    const reopened = await f.reopen();
    const recovered = CheckoutEvaluation.recover((await reopened.loadAll())[0], reopened);
    assert.equal(recovered.publicView().totalReserve, 200);
    assert.equal(recovered.publicView().opened, false);
    await assert.rejects(recovered.configure(101, 200), /original facility terms/);
    await recovered.configure(100, 200);
    assert.equal(recovered.publicView().totalReserve, 200);
    assert.equal(recovered.publicView().opened, true);
  } finally { await f.close(); }
});

test("disk checkpoints expose no private input, keys or books and reject wrong passwords, tampering, record swaps and source mismatch", async () => {
  const f = await fixture();
  try {
    const engine = await CheckoutEvaluation.create(f.store);
    await engine.configure(73123, 85231);
    await engine.purchase("text-analysis", "never plaintext customer document", "no-plaintext-order");
    const other = await CheckoutEvaluation.create(f.store);
    const file = join(f.directory, `${engine.id}.checkpoint`);
    const original = await readFile(file, "utf8");
    for (const forbidden of ["never plaintext", "73123", "85231", engine.agentToken, engine.issuerToken, "privateState", "outstanding", "callerSecret", "lineLimit"]) assert.equal(original.includes(forbidden), false);
    await f.reopen("wrong-test-checkpoint-passphrase");
    await assert.rejects(f.store.loadAll(), /unauthenticated or incompatible/);
    await f.reopen();
    const envelope = JSON.parse(original);
    envelope.ciphertext = (envelope.ciphertext[0] === "A" ? "B" : "A") + envelope.ciphertext.slice(1);
    await writeFile(file, JSON.stringify(envelope));
    await assert.rejects(f.store.loadAll(), /unauthenticated or incompatible/);
    await writeFile(file, original);
    const otherFile = join(f.directory, `${other.id}.checkpoint`);
    const otherOriginal = await readFile(otherFile);
    await writeFile(otherFile, original);
    await assert.rejects(f.store.loadAll(), /unauthenticated or incompatible/);
    await writeFile(otherFile, otherOriginal);
    const mismatch = JSON.parse(original); mismatch.binding = "0".repeat(64);
    await writeFile(file, JSON.stringify(mismatch));
    await assert.rejects(f.store.loadAll(), /unauthenticated or incompatible/);
    await writeFile(file, original);
    assert.equal((await f.store.loadAll()).length, 2);
    assert.equal((await readdir(f.directory)).some(name => name.endsWith(".tmp")), false);
  } finally { await f.close(); }
});

test("exclusive directory lease rejects a second live writer", async () => {
  const f = await fixture();
  try { await assert.rejects(EncryptedCheckoutStore.open(f.directory, PASSWORD), /live process/); }
  finally { await f.close(); }
});

test("storage configuration cannot adopt a directory containing unrelated project files", async () => {
  const root = await mkdtemp(join(tmpdir(), "line-checkout-unrelated-"));
  try {
    await writeFile(join(root, "customer-project.txt"), "must remain untouched");
    await assert.rejects(EncryptedCheckoutStore.open(root, PASSWORD), /dedicated directory/);
    assert.equal(await readFile(join(root, "customer-project.txt"), "utf8"), "must remain untouched");
    assert.deepEqual(await readdir(root), ["customer-project.txt"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("genuine child-process death leaves recoverable encrypted state and stale lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "line-checkout-process-restart-"));
  const directory = join(root, "private");
  const script = `const {EncryptedCheckoutStore}=await import('./server/checkout-storage.ts'); const {CheckoutEvaluation}=await import('./server/checkout-engine.ts'); const store=await EncryptedCheckoutStore.open(process.env.TEST_CHECKOUT_DIR,process.env.TEST_CHECKOUT_PASSWORD); const engine=await CheckoutEvaluation.create(store); await engine.configure(100,200); const receipt=await engine.purchase('text-analysis','durable child document','child-process-order'); console.log(JSON.stringify({id:engine.id,agentToken:engine.agentToken,receipt})); process.exit(0);`;
  let recoveredStore: EncryptedCheckoutStore | undefined;
  try {
    const result = await new Promise<string>((resolveResult, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { cwd: resolve("."), env: { ...process.env, TEST_CHECKOUT_DIR: directory, TEST_CHECKOUT_PASSWORD: PASSWORD }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", reject); child.on("exit", code => code === 0 ? resolveResult(stdout) : reject(new Error(stderr)));
    });
    const prior = JSON.parse(result);
    recoveredStore = await EncryptedCheckoutStore.open(directory, PASSWORD);
    const recovered = CheckoutEvaluation.recover((await recoveredStore.loadAll())[0], recoveredStore);
    assert.equal(recovered.id, prior.id); assert.equal(recovered.agentToken, prior.agentToken);
    assert.deepEqual(await recovered.purchase("text-analysis", "durable child document", "child-process-order"), prior.receipt);
    assert.equal(recovered.publicView().deliveries, 1);
    assert.equal(recovered.issuerView().privateBooks.outstanding, 25);
  } finally { await recoveredStore?.close(); await rm(root, { recursive: true, force: true }); }
});

test("genuine process death preserves an unpaid merchant claim and privately compensates its partial repayment after expiry", async () => {
  const root = await mkdtemp(join(tmpdir(), "line-checkout-expired-process-")), directory = join(root, "private");
  const script = `const {EncryptedCheckoutStore}=await import('./server/checkout-storage.ts'); const {CheckoutEvaluation}=await import('./server/checkout-engine.ts'); const store=await EncryptedCheckoutStore.open(process.env.TEST_CHECKOUT_DIR,process.env.TEST_CHECKOUT_PASSWORD); const engine=await CheckoutEvaluation.create(store,{clock:()=>1800000000}); await engine.configure(100,200); const transition=engine.transition.bind(engine); engine.transition=async(ps,op)=>{if(op.name==='redeemDraw')throw new Error('merchant unavailable');return transition(ps,op)}; try{await engine.purchase('text-analysis','child expired service','child-expired-order')}catch(e){if(e.message!=='merchant unavailable')throw e} await engine.acknowledge(10,'child-incoming-receipt'); console.log(JSON.stringify({id:engine.id,agentToken:engine.agentToken,note:engine.publicView().orders[0].note}));process.exit(0);`;
  let store: EncryptedCheckoutStore | undefined;
  try {
    const output = await new Promise<string>((resolveResult, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { cwd: resolve("."), env: { ...process.env, TEST_CHECKOUT_DIR: directory, TEST_CHECKOUT_PASSWORD: PASSWORD }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", reject); child.on("exit", code => code === 0 ? resolveResult(stdout) : reject(new Error(stderr)));
    });
    const original = JSON.parse(output); store = await EncryptedCheckoutStore.open(directory, PASSWORD);
    const engine = CheckoutEvaluation.recover((await store.loadAll())[0], store, { clock: () => 1_800_000_600 });
    assert.equal(engine.id, original.id); assert.equal(engine.agentToken, original.agentToken);
    const receipt = await engine.purchase("text-analysis", "child expired service", "child-expired-order");
    assert.equal(receipt.outcome, "compensated"); assert.equal(receipt.note, original.note); assert.equal(engine.publicView().deliveries, 0);
    assert.equal(engine.issuerView().privateBooks.outstanding, 0); assert.equal(engine.issuerView().refunds[0].amount, 10);
    assert.equal(engine.publicView().refundReserve, 25); assert.equal("refunds" in engine.publicView(), false);
    const acknowledged = await engine.reportRefund("child-expired-order", "child-outgoing-receipt");
    assert.equal(acknowledged.reportedRefundReserve, 25); assert.equal(acknowledged.payout, "not-connected");
    await store.close(); store = await EncryptedCheckoutStore.open(directory, PASSWORD);
    const restored = CheckoutEvaluation.recover((await store.loadAll())[0], store, { clock: () => 1_800_000_600 });
    assert.deepEqual(await restored.reportRefund("child-expired-order", "child-outgoing-receipt"), acknowledged);
  } finally { await store?.close(); await rm(root, { recursive: true, force: true }); }
});

test("recreated HTTP middleware recovers capabilities and exact receipt without accepting the other role", async () => {
  const f = await fixture();
  let middleware = checkoutMiddleware({ storage: f.store });
  let server: Server | undefined;
  async function listen() {
    await middleware.ready();
    server = createServer((req, res) => { void middleware(req, res, () => { res.writeHead(404); res.end(); }); });
    await new Promise<void>(resolveListen => server!.listen(0, "127.0.0.1", resolveListen));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}/api/checkout`;
  }
  async function stop() { if (server) { await new Promise<void>((resolveClose, reject) => server!.close(error => error ? reject(error) : resolveClose())); server = undefined; } await middleware.close(); }
  try {
    let base = await listen();
    const created = await fetch(`${base}/sessions`, { method: "POST" });
    const session = await created.json() as { id: string; issuerToken: string; agentToken: string; durability: string };
    assert.equal(session.durability, "encrypted-disk");
    async function post(role: string, action: string, token: string, value: unknown) { return fetch(`${base}/sessions/${session.id}/${role}/${action}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(value) }); }
    assert.equal((await post("issuer", "configure", session.issuerToken, { limit: 100, reserve: 200 })).status, 200);
    const purchase = { service: "cost-report", document: "HTTP restart survives", requestId: "http-recovery-order" };
    const receipt = await (await post("agent", "purchase", session.agentToken, purchase)).json();
    await stop();
    middleware = checkoutMiddleware({ storage: await f.reopen() });
    base = await listen();
    assert.deepEqual(await (await post("agent", "purchase", session.agentToken, purchase)).json(), receipt);
    assert.equal((await post("issuer", "acknowledge", session.agentToken, { amount: 20, reference: "forged-http-payment" })).status, 403);
    const view = await fetch(`${base}/sessions/${session.id}/issuer`, { headers: { Authorization: `Bearer ${session.issuerToken}` } });
    assert.equal((await view.json()).privateBooks.outstanding, 20);
  } finally { await stop(); await f.close(); }
});
