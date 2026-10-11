import { test, expect } from "@playwright/test";

const journalModule = "/src/lib/security/operation-journal.ts";
const vaultModule = "/src/lib/security/vault.ts";
const password = "browser-journal-regression-password";
const contractAddress = "a".repeat(64), sourceFingerprint = "b".repeat(64);
const beforeCommitment = "c".repeat(64), candidateCommitment = "d".repeat(64);
// These are synthetic public commitments for journal boundary tests, not confirmed network execution.
const args = { journalModule, vaultModule, password, contractAddress, sourceFingerprint, beforeCommitment, candidateCommitment };

test("console recovery button reconciles a lost local draw response without another charge", async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/agent");
  const outcome = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/app/store.ts");
    const { getRuntime } = await import("/src/lib/runtime/index.ts");
    const store = useAppStore.getState();
    if (!(await store.unlockVault("console-recovery-browser-password"))) throw new Error("Unlock failed");
    for (const role of ["issuer", "merchant", "agent"] as const) await store.generateIdentity(role);
    for (const result of [await store.doFundReserve(500), await store.doRegisterMerchant(), await store.doOpen(150),
      await store.doQuote(40, "browser-response-loss")]) if (!result) throw new Error("Setup failed");
    const runtime = getRuntime();
    const draw = runtime.draw.bind(runtime);
    let calls = 0;
    runtime.draw = async (params, options) => { calls++; await draw(params, options); throw new Error("Lost local response"); };
    const quote = useAppStore.getState().merchantQuotes[0].quoteCommitment;
    const ok = await store.doDraw(quote);
    (window as any).__recoveryCalls = () => calls;
    return { ok, privateBalance: useAppStore.getState().agentRecord?.B, reserve: (await runtime.getStatus()).encumberedReserve };
  });
  expect(outcome).toEqual({ ok: false, privateBalance: 0, reserve: 40 });
  const recover = page.getByRole("button", { name: "Reconcile Operation" });
  await expect(recover).toBeVisible();
  await recover.click();
  // Replacing the vault session briefly clears decrypted UI state. Wait for
  // reconciliation itself, rather than treating that temporary hide as success.
  await expect.poll(() => page.evaluate(async () => {
    const { useAppStore } = await import("/src/app/store.ts");
    return useAppStore.getState().agentRecord?.B;
  })).toBe(40);
  await expect(recover).toBeHidden();
  const recovered = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/app/store.ts");
    return { balance: useAppStore.getState().agentRecord?.B, notes: useAppStore.getState().drawNotes.length,
      blocked: useAppStore.getState().recoveryRequired, calls: (window as any).__recoveryCalls() };
  });
  expect(recovered).toEqual({ balance: 40, notes: 1, blocked: false, calls: 1 });
  expect(pageErrors).toEqual([]);
});

test("real browser reload retains the prepared opening without treating it as confirmed", async ({ page }) => {
  await page.goto("/");
  const networkId = "browser-journal-reload";
  await page.evaluate(async ({ journalModule, vaultModule, password, contractAddress, sourceFingerprint, beforeCommitment, candidateCommitment, networkId }) => {
    const vault = await import(vaultModule), journal = await import(journalModule);
    vault.unlockVaultSession(password);
    const scoped = journal.createOperationJournal({ networkId, contractAddress, sourceFingerprint }, password);
    await scoped.withExclusive(async (lease: import("../src/lib/security/operation-journal.ts").OperationJournalLease) => {
      await lease.prepare({ id: "draw:reload", kind: "draw", fingerprint: "e".repeat(64), beforeCommitment, candidateCommitment,
        beforeSnapshot: { debt: 0n, salt: new Uint8Array(32).fill(21) },
        candidateSnapshot: { debt: (1n << 64n) - 1n, salt: new Uint8Array(32).fill(22),
          note: { nonce: new Uint8Array([23, 24]), label: "private-draw-opening-before-submission" } } });
      await lease.markSubmitting("draw:reload", { transactionId: "test:pending-transaction" });
    });
  }, { ...args, networkId });

  await page.reload();
  const recovered = await page.evaluate(async ({ journalModule, vaultModule, password, contractAddress, sourceFingerprint, networkId }) => {
    const vault = await import(vaultModule), journal = await import(journalModule);
    const initiallyLocked = !vault.isVaultSessionUnlocked();
    let lockedCode = "";
    try { journal.createOperationJournal({ networkId, contractAddress, sourceFingerprint }, password); }
    catch (error) { lockedCode = (error as { code: string }).code; }
    vault.unlockVaultSession(password);
    const scoped = journal.createOperationJournal({ networkId, contractAddress, sourceFingerprint }, password);
    return scoped.withExclusive(async (lease: import("../src/lib/security/operation-journal.ts").OperationJournalLease) => {
      const record = await lease.read(), operation = record.operations[0];
      const candidate = operation.candidateSnapshot as { debt: bigint; salt: Uint8Array; note: { nonce: Uint8Array; label: string } };
      let retryError = "";
      try { await lease.markSubmitting(operation.id); } catch (error) { retryError = (error as Error).message; }
      return { initiallyLocked, lockedCode, state: operation.status, txId: operation.transactionId,
        debt: candidate.debt.toString(), isBytes: candidate.salt instanceof Uint8Array, salt: Array.from(candidate.salt),
        nonce: Array.from(candidate.note.nonce), label: candidate.note.label,
        confirmed: journal.latestConfirmedOperation(record) !== null, retryError };
    });
  }, { ...args, networkId });
  expect(recovered).toMatchObject({ initiallyLocked: true, lockedCode: "VAULT_LOCKED", state: "submitting",
    txId: "test:pending-transaction", debt: "18446744073709551615", isBytes: true, salt: Array(32).fill(22),
    nonce: [23, 24], label: "private-draw-opening-before-submission", confirmed: false });
  expect(recovered.retryError).toContain("cannot be retried");
});

test("two real tabs share exclusive Web Lock ownership and closing the owner retains its unresolved intent", async ({ page, context }) => {
  await page.goto("/");
  const second = await context.newPage(); await second.goto("/");
  const networkId = "browser-journal-tabs";
  const storageKey = `line:journal:v1:${networkId}:${contractAddress}`;
  await page.evaluate(async ({ journalModule, vaultModule, password, contractAddress, sourceFingerprint, beforeCommitment, candidateCommitment, networkId }) => {
    const vault = await import(vaultModule), journal = await import(journalModule); vault.unlockVaultSession(password);
    const state = { entered: false, error: "" };
    (window as unknown as { journalOwner: typeof state }).journalOwner = state;
    const scoped = journal.createOperationJournal({ networkId, contractAddress, sourceFingerprint }, password);
    void scoped.withExclusive(async (lease: import("../src/lib/security/operation-journal.ts").OperationJournalLease) => {
      await lease.prepare({ id: "draw:tab-one", kind: "draw", fingerprint: "e".repeat(64), beforeCommitment, candidateCommitment,
        beforeSnapshot: { debt: 0n }, candidateSnapshot: { debt: 7n, salt: new Uint8Array([71]) } });
      await lease.markSubmitting("draw:tab-one");
      state.entered = true;
      await new Promise<void>(() => { /* The browser destroys this owner before the callback can finish. */ });
    }).catch((error: Error) => { state.error = error.message; });
  }, { ...args, networkId });
  await expect.poll(() => page.evaluate(() => (window as unknown as { journalOwner: { entered: boolean } }).journalOwner.entered)).toBe(true);

  await second.evaluate(async ({ journalModule, vaultModule, password, contractAddress, sourceFingerprint, beforeCommitment, candidateCommitment, networkId }) => {
    const vault = await import(vaultModule), journal = await import(journalModule); vault.unlockVaultSession(password);
    const state = { entered: false, done: false, error: "" };
    (window as unknown as { journalWaiter: typeof state }).journalWaiter = state;
    const scoped = journal.createOperationJournal({ networkId, contractAddress, sourceFingerprint }, password);
    void scoped.withExclusive(async (lease: import("../src/lib/security/operation-journal.ts").OperationJournalLease) => {
      state.entered = true;
      await lease.prepare({ id: "draw:tab-two", kind: "draw", fingerprint: "f".repeat(64), beforeCommitment, candidateCommitment,
        beforeSnapshot: { debt: 0n }, candidateSnapshot: { debt: 9n, salt: new Uint8Array([91]) } });
    }).catch((error: Error) => { state.error = error.message; }).finally(() => { state.done = true; });
  }, { ...args, networkId });
  await expect.poll(() => second.evaluate(async storageKey => {
    const snapshot = await navigator.locks.query();
    return { held: snapshot.held?.some(lock => lock.name === storageKey && lock.mode === "exclusive"),
      queued: snapshot.pending?.some(lock => lock.name === storageKey),
      waiterEntered: (window as unknown as { journalWaiter: { entered: boolean } }).journalWaiter.entered };
  }, storageKey)).toEqual({ held: true, queued: true, waiterEntered: false });

  await page.close();
  await expect.poll(() => second.evaluate(() => (window as unknown as { journalWaiter: { done: boolean } }).journalWaiter.done)).toBe(true);
  const result = await second.evaluate(async ({ journalModule, vaultModule, password, contractAddress, sourceFingerprint, networkId }) => {
    const journal = await import(journalModule); await import(vaultModule);
    const scoped = journal.createOperationJournal({ networkId, contractAddress, sourceFingerprint }, password);
    const state = (window as unknown as { journalWaiter: { entered: boolean; error: string } }).journalWaiter;
    const record = await scoped.withExclusive((lease: import("../src/lib/security/operation-journal.ts").OperationJournalLease) => lease.read());
    return { ...state, ids: record.operations.map((op: import("../src/lib/security/operation-journal.ts").JournalOperation) => op.id), status: record.operations[0].status };
  }, { ...args, networkId });
  expect(result.entered).toBe(true); expect(result.error).toContain("requires reconciliation");
  expect(result.ids).toEqual(["draw:tab-one"]); expect(result.status).toBe("submitting");
});

test("aborting a real successful IDB replacement preserves the prior candidate for reload recovery", async ({ page }) => {
  await page.goto("/");
  const networkId = "browser-journal-abort";
  const before = await page.evaluate(async ({ journalModule, vaultModule, password, contractAddress, sourceFingerprint, beforeCommitment, candidateCommitment, networkId }) => {
    const vault = await import(vaultModule), journal = await import(journalModule); vault.unlockVaultSession(password);
    const scope = { networkId, contractAddress, sourceFingerprint }, scoped = journal.createOperationJournal(scope, password);
    await scoped.withExclusive(async (lease: import("../src/lib/security/operation-journal.ts").OperationJournalLease) => {
      await lease.prepare({ id: "draw:abort", kind: "draw", fingerprint: "e".repeat(64), beforeCommitment, candidateCommitment,
        beforeSnapshot: { debt: 0n }, candidateSnapshot: { debt: 31n, salt: new Uint8Array([31, 32]), label: "confidential-journal-candidate" } });
      await lease.markSubmitting("draw:abort");
    });
    const request = indexedDB.open("line_vault_db", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const envelope = async () => new Promise<string>((resolve, reject) => {
      const transaction = database.transaction("encrypted_keys", "readonly"), get = transaction.objectStore("encrypted_keys").get(scoped.storageKey);
      transaction.oncomplete = () => resolve(JSON.stringify(get.result)); transaction.onabort = () => reject(transaction.error);
    });
    const priorEnvelope = await envelope();
    const originalPut = IDBObjectStore.prototype.put; let putSucceeded = false;
    IDBObjectStore.prototype.put = function (value, key) {
      const put = key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
      if (this.name === "encrypted_keys" && value?.id === scoped.storageKey) {
        const transaction = this.transaction;
        put.addEventListener("success", () => { putSucceeded = true; transaction.abort(); }, { once: true });
      }
      return put;
    };
    let confirmCode = "";
    try {
      await scoped.withExclusive(async (lease: import("../src/lib/security/operation-journal.ts").OperationJournalLease) => {
        await lease.read();
        try { await lease.confirm("draw:abort", { ...scope, kind: "observedCandidate", lineCommitment: candidateCommitment }); }
        catch (error) { confirmCode = (error as { code: string }).code; }
      });
    } finally { IDBObjectStore.prototype.put = originalPut; }
    const afterEnvelope = await envelope(); database.close();
    return { putSucceeded, confirmCode, priorEnvelope, afterEnvelope };
  }, { ...args, networkId });
  expect(before.putSucceeded).toBe(true); expect(before.confirmCode).toBe("VAULT_PERSISTENCE_ERROR");
  expect(before.afterEnvelope).toBe(before.priorEnvelope);
  expect(before.afterEnvelope).toContain('"ciphertextHex"'); expect(before.afterEnvelope).not.toContain("confidential-journal-candidate");

  await page.reload();
  const after = await page.evaluate(async ({ journalModule, vaultModule, password, contractAddress, sourceFingerprint, candidateCommitment, networkId }) => {
    const vault = await import(vaultModule), journal = await import(journalModule); vault.unlockVaultSession(password);
    const scope = { networkId, contractAddress, sourceFingerprint };
    return journal.createOperationJournal(scope, password).withExclusive(async (lease: import("../src/lib/security/operation-journal.ts").OperationJournalLease) => {
      const operation = (await lease.read()).operations[0];
      const candidate = operation.candidateSnapshot as { debt: bigint; salt: Uint8Array; label: string };
      const priorStatus = operation.status;
      await lease.confirm(operation.id, { ...scope, kind: "observedCandidate", lineCommitment: candidateCommitment });
      return { priorStatus, debt: candidate.debt.toString(), salt: Array.from(candidate.salt), label: candidate.label,
        confirmedStatus: (await lease.read()).operations[0].status };
    });
  }, { ...args, networkId });
  expect(after).toEqual({ priorStatus: "submitting", debt: "31", salt: [31, 32], label: "confidential-journal-candidate", confirmedStatus: "confirmed" });
});

test("captured confirmed recovery finishes after lock and stays encrypted across reload", async ({ page }) => {
  await page.goto("/");
  const networkId = "browser-journal-confirmed";
  const persisted = await page.evaluate(async ({ journalModule, vaultModule, password, contractAddress, sourceFingerprint, beforeCommitment, candidateCommitment, networkId }) => {
    const vault = await import(vaultModule), journal = await import(journalModule); vault.unlockVaultSession(password);
    const scope = { networkId, contractAddress, sourceFingerprint }, scoped = journal.createOperationJournal(scope, password);
    let newSubmissionCode = "";
    await scoped.withExclusive(async (lease: import("../src/lib/security/operation-journal.ts").OperationJournalLease) => {
      const input = { id: "draw:confirmed", kind: "draw" as const, fingerprint: "e".repeat(64), beforeCommitment, candidateCommitment,
        beforeSnapshot: { debt: 0n }, candidateSnapshot: { debt: 57n, salt: new Uint8Array(32).fill(57), label: "private-confirmed-recovery" } };
      await lease.prepare(input); await lease.markSubmitting(input.id); vault.lockVaultSession();
      await lease.confirm(input.id, { ...scope, kind: "observedCandidate", lineCommitment: candidateCommitment });
      try { await lease.prepare({ ...input, id: "draw:after-lock" }); } catch (error) { newSubmissionCode = (error as { code: string }).code; }
    });
    const request = indexedDB.open("line_vault_db", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const envelope = await new Promise<string>((resolve, reject) => {
      const transaction = database.transaction("encrypted_keys", "readonly"), get = transaction.objectStore("encrypted_keys").get(scoped.storageKey);
      transaction.oncomplete = () => resolve(JSON.stringify(get.result)); transaction.onabort = () => reject(transaction.error);
    }); database.close();
    return { newSubmissionCode, envelope, locked: !vault.isVaultSessionUnlocked() };
  }, { ...args, networkId });
  expect(persisted.newSubmissionCode).toBe("VAULT_LOCKED"); expect(persisted.locked).toBe(true);
  expect(persisted.envelope).toContain('"ciphertextHex"'); expect(persisted.envelope).not.toContain("private-confirmed-recovery");
  expect(persisted.envelope).not.toContain("candidateSnapshot");

  await page.reload();
  const recovered = await page.evaluate(async ({ journalModule, vaultModule, password, contractAddress, sourceFingerprint, networkId }) => {
    const vault = await import(vaultModule), journal = await import(journalModule); vault.unlockVaultSession(password);
    return journal.createOperationJournal({ networkId, contractAddress, sourceFingerprint }, password).withExclusive(async (lease: import("../src/lib/security/operation-journal.ts").OperationJournalLease) => {
      const record = await lease.read(), confirmed = journal.latestConfirmedOperation(record);
      const candidate = confirmed.candidateSnapshot as { debt: bigint; salt: Uint8Array; label: string };
      return { count: record.operations.length, status: confirmed.status, acknowledged: confirmed.acknowledged,
        debt: candidate.debt.toString(), bytes: candidate.salt instanceof Uint8Array, salt: Array.from(candidate.salt), label: candidate.label };
    });
  }, { ...args, networkId });
  expect(recovered).toEqual({ count: 1, status: "confirmed", acknowledged: false, debt: "57", bytes: true,
    salt: Array(32).fill(57), label: "private-confirmed-recovery" });
});
