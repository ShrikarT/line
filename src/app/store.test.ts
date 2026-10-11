import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useAppStore } from "./store.ts";
import { setRuntime, InMemoryTestRuntime } from "../lib/runtime/index.ts";
import { purgeLegacyPlaintextStorage, lockVaultSession, unlockVaultSession,
  onVaultSessionLock, removeEncryptedPrefix, loadEncryptedJson } from "../lib/security/vault.ts";

describe("production store: full lifecycle, vault custody & witnesses", () => {
  beforeEach(async () => {
    purgeLegacyPlaintextStorage();
    lockVaultSession();
    await removeEncryptedPrefix("line:vault:");
    await removeEncryptedPrefix("line:journal:");
    // Use fresh isolated in-memory test runtime for each test
    setRuntime(new InMemoryTestRuntime());
    // Reset store state
    useAppStore.setState({
      isVaultUnlocked: false,
      recoveryRequired: false,
      operationBusy: false,
      txLifecycle: "idle",
      lastTxHash: null,
      lastBlockHeight: null,
      flash: null,
      agentLineRecord: null,
      merchantQuotes: [],
      drawNotes: [],
      repayments: [],
      refunds: [],
      historicalAgentKeys: [],
      agentRecord: null,
      issuerRecord: null,
      merchantRecord: null,
      invoices: [],
      notes: [],
    });
  });

  it("refuses operations when vault is locked", async () => {
    const store = useAppStore.getState();
    assert.equal(store.isVaultUnlocked, false);

    // Attempting operations without unlocking vault or setting keys must fail cleanly
    const fundOk = await store.doFundReserve(500);
    assert.equal(fundOk, false);
    assert.match(useAppStore.getState().flash?.text ?? "", /Vault is locked/);

    const openOk = await store.doOpen(150);
    assert.equal(openOk, false);

    const quoteOk = await store.doQuote(40, "inv-1");
    assert.equal(quoteOk, false);
    assert.match(useAppStore.getState().flash?.text ?? "", /Vault is locked/);

    const drawOk = await store.doDraw("0xnonexistent");
    assert.equal(drawOk, false);
    assert.match(useAppStore.getState().flash?.text ?? "", /Clearance could not be proven/);
  });

  it("unlocks vault with passphrase and manages role identities", async () => {
    const store = useAppStore.getState();
    const unlocked = await store.unlockVault("CorrectSessionPassword123!");
    assert.equal(unlocked, true);
    assert.equal(useAppStore.getState().isVaultUnlocked, true);

    // Generate cryptographic identities for all three roles
    const issuerSk = await useAppStore.getState().generateIdentity("issuer");
    assert.equal(issuerSk.length, 64);
    assert.equal(useAppStore.getState().issuerRecord?.issuerSecret, issuerSk);

    const merchantSk = await useAppStore.getState().generateIdentity("merchant");
    assert.equal(merchantSk.length, 64);
    assert.ok(useAppStore.getState().merchantRecord?.merchantPk);

    const agentSk = await useAppStore.getState().generateIdentity("agent");
    assert.equal(agentSk.length, 64);
    assert.ok(useAppStore.getState().agentRecord?.identityCommitment);
  });

  it("executes complete lifecycle: fund -> register -> open -> quote -> draw -> redeem -> repay-ack", async () => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");

    // 1. Initialize role identities
    await store.generateIdentity("issuer");
    await store.generateIdentity("merchant");
    await store.generateIdentity("agent");

    const merchantPk = useAppStore.getState().merchantRecord?.merchantPk;
    assert.ok(merchantPk);

    // 2. Fund reserve
    const fundOk = await store.doFundReserve(500);
    assert.equal(fundOk, true);
    assert.equal(useAppStore.getState().ledger.totalReserve, 500);
    assert.equal(useAppStore.getState().ledger.withdrawableReserve, 500);

    // 3. Register merchant
    const regOk = await store.doRegisterMerchant(merchantPk);
    assert.equal(regOk, true);

    // 4. Open credit line
    const openOk = await store.doOpen(150);
    assert.equal(openOk, true);
    assert.equal(useAppStore.getState().ledger.status, "open");
    assert.equal(useAppStore.getState().agentRecord?.L, 150);
    assert.equal(useAppStore.getState().agentRecord?.B, 0);

    // 5. Merchant posts a quote
    const quoteOk = await store.doQuote(40, "invoice-alpha-1");
    assert.equal(quoteOk, true);
    assert.equal(useAppStore.getState().merchantQuotes.length, 1);
    const postedQuote = useAppStore.getState().merchantQuotes[0];
    assert.equal(postedQuote.amount, 40);
    assert.equal(postedQuote.status, "open");

    // 6. Agent draws against the quote
    const drawOk = await store.doDraw(postedQuote.quoteCommitment);
    assert.equal(drawOk, true);
    assert.equal(useAppStore.getState().agentRecord?.B, 40);
    assert.equal(useAppStore.getState().agentRecord?.epoch, 1);
    assert.equal(useAppStore.getState().drawNotes.length, 1);
    assert.equal(useAppStore.getState().ledger.encumberedReserve, 40);
    assert.equal(useAppStore.getState().ledger.withdrawableReserve, 460);

    const note = useAppStore.getState().drawNotes[0];
    assert.equal(note.status, "active");
    assert.equal(note.amount, 40);
    assert.ok(note.noteSalt);
    assert.ok(note.noteNonce);

    // 7. Merchant redeems the note against reserve
    const redeemOk = await store.doRedeem(note.noteCommitment);
    assert.equal(redeemOk, true);
    assert.equal(useAppStore.getState().ledger.encumberedReserve, 0);
    assert.equal(useAppStore.getState().ledger.redeemedReserve, 40);
    assert.equal(useAppStore.getState().drawNotes[0].status, "redeemed");

    // Double redemption must fail
    const doubleRedeemOk = await store.doRedeem(note.noteCommitment);
    assert.equal(doubleRedeemOk, false);

    // 8. Issuer acknowledges off-chain repayment
    const ackOk = await store.doAck(40, "wire-ref-abc-123");
    assert.equal(ackOk, true);
    assert.equal(useAppStore.getState().agentRecord?.B, 0);
    assert.equal(useAppStore.getState().agentRecord?.epoch, 2);
    assert.equal(useAppStore.getState().repayments.length, 1);
    assert.equal(useAppStore.getState().repayments[0].status, "acknowledged");
  });

  it("journals the current closing book, refuses debt deletion and preserves merchant claims on reopening", async () => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    await store.generateIdentity("merchant");
    await store.generateIdentity("agent");
    assert.equal(await store.doFundReserve(500), true);
    assert.equal(await store.doRegisterMerchant(), true);
    assert.equal(await store.doOpen(150), true);
    assert.equal(await store.doQuote(40, "closing-store-invoice"), true);
    assert.equal(await store.doDraw(useAppStore.getState().merchantQuotes[0].quoteCommitment), true);
    const before = useAppStore.getState().ledger;
    assert.equal(await store.doStatus("closed"), false);
    assert.equal(useAppStore.getState().ledger.lineCommitment, before.lineCommitment);
    assert.equal(useAppStore.getState().ledger.status, "open");
    assert.equal(await store.doStatus("defaulted"), true);
    assert.equal(await store.doStatus("open"), true);
    assert.equal(useAppStore.getState().agentRecord?.B, 40);
    assert.equal(await store.doAck(40, "rail:preview:USD:event:closing-store"), true);
    assert.equal(await store.doStatus("closed"), true);
    assert.equal(useAppStore.getState().ledger.encumberedReserve, 40);
    assert.equal(await store.doOpen(200), true);
    assert.equal(useAppStore.getState().ledger.lineGeneration, before.lineGeneration + 1);
    assert.equal(await store.doRedeem(useAppStore.getState().drawNotes[0].noteCommitment), true);
    assert.equal(useAppStore.getState().ledger.redeemedReserve, 40);
  });

  it("handles transfer packages across isolated environments cleanly", async () => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    await store.generateIdentity("merchant");
    await store.generateIdentity("agent");

    await store.doFundReserve(500);
    await store.doRegisterMerchant();
    await store.doOpen(150);
    await store.doQuote(35, "inv-pkg-test");

    const quoteCommit = useAppStore.getState().merchantQuotes[0].quoteCommitment;

    // Export quote package
    const quotePkg = store.exportQuotePackage(quoteCommit);
    assert.ok(quotePkg);
    assert.equal(quotePkg.format, "line:quote-package:v3");
    assert.equal(quotePkg.deadlineUnits, "unix-seconds");
    assert.equal(quotePkg.feePolicy, "flat-plus-ceil-bps-v1");
    assert.equal(quotePkg.feeFlat, 0);
    assert.equal(quotePkg.feeBps, 0);
    assert.equal(quotePkg.fee, 0);
    assert.ok(quotePkg.expiry > Math.floor(Date.now() / 1000));
    assert.equal(quotePkg.amount, 35);

    // Clear merchant quotes from store to simulate an isolated agent environment
    useAppStore.setState({ merchantQuotes: [], invoices: [] });
    assert.equal(useAppStore.getState().merchantQuotes.length, 0);

    assert.equal(store.importQuotePackage({ ...quotePkg, format: "line:quote-package:v1", deadlineUnits: undefined }), false);
    assert.equal(store.importQuotePackage({ ...quotePkg, format: "line:quote-package:v2" }), false);
    assert.equal(store.importQuotePackage({ ...quotePkg, deadlineUnits: undefined }), false);
    assert.equal(store.importQuotePackage({ ...quotePkg, feePolicy: undefined }), false);
    assert.equal(store.importQuotePackage({ ...quotePkg, feeFlat: undefined }), false);
    assert.equal(store.importQuotePackage({ ...quotePkg, feeBps: undefined }), false);
    assert.equal(store.importQuotePackage({ ...quotePkg, fee: 1 }), false);
    assert.equal(store.importQuotePackage({ ...quotePkg, feeFlat: 1, fee: 1 }), false);
    assert.equal(store.importQuotePackage({ ...quotePkg, expiry: NaN }), false);
    assert.equal(useAppStore.getState().merchantQuotes.length, 0);

    // Import quote package
    const importQuoteOk = store.importQuotePackage(quotePkg);
    assert.equal(importQuoteOk, true);
    assert.equal(useAppStore.getState().merchantQuotes.length, 1);

    // Draw using imported package
    const drawOk = await store.doDraw(quotePkg);
    assert.equal(drawOk, true);
    assert.equal(useAppStore.getState().drawNotes.length, 1);

    const noteCommit = useAppStore.getState().drawNotes[0].noteCommitment;

    // Export draw note package
    const notePkg = store.exportDrawNotePackage(noteCommit);
    assert.ok(notePkg);
    assert.equal(notePkg.format, "line:note-package:v3");
    assert.equal(notePkg.deadlineUnits, "unix-seconds");
    assert.equal(notePkg.expiry, quotePkg.expiry);
    assert.equal(notePkg.amount, 35);
    assert.equal(notePkg.fee, 0);
    assert.ok(notePkg.noteSalt);

    // Clear notes from store to simulate an isolated merchant environment
    useAppStore.setState({ drawNotes: [], notes: [] });
    assert.equal(useAppStore.getState().drawNotes.length, 0);

    assert.equal(store.importDrawNotePackage({ ...notePkg, format: "line:note-package:v1", deadlineUnits: undefined }), false);
    assert.equal(store.importDrawNotePackage({ ...notePkg, format: "line:note-package:v2" }), false);
    assert.equal(store.importDrawNotePackage({ ...notePkg, deadlineUnits: undefined }), false);
    assert.equal(store.importDrawNotePackage({ ...notePkg, fee: undefined }), false);
    assert.equal(store.importDrawNotePackage({ ...notePkg, expiry: Number.MAX_SAFE_INTEGER + 1 }), false);
    assert.equal(useAppStore.getState().drawNotes.length, 0);

    // Import draw note package
    const importNoteOk = store.importDrawNotePackage(notePkg);
    assert.equal(importNoteOk, true);
    assert.equal(useAppStore.getState().drawNotes.length, 1);

    // Redeem imported note
    const redeemOk = await store.doRedeem(notePkg);
    assert.equal(redeemOk, true);
    assert.equal(useAppStore.getState().ledger.redeemedReserve, 35);
  });
  it("redeems an original-generation fee-bearing package without prior import after the issuer replaces its line", async () => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    for (const role of ["issuer", "merchant", "agent"] as const) await store.generateIdentity(role);
    assert.equal(await store.doFundReserve(200), true);
    assert.equal(await store.doRegisterMerchant(), true);
    assert.equal(await store.doOpen(100, { feeFlat: 5, feeBps: 0 }), true);
    assert.equal(await store.doQuote(40, "historical-direct-package"), true);
    assert.equal(await store.doDraw(useAppStore.getState().merchantQuotes[0].quoteCommitment), true);
    const pkg = store.exportDrawNotePackage(useAppStore.getState().drawNotes[0].noteCommitment)!;
    assert.equal(await store.doAck(45, "historical-package-repayment"), true);
    assert.equal(await store.doStatus("closed"), true);
    assert.equal(await store.doOpen(120), true);
    assert.equal(useAppStore.getState().ledger.lineGeneration, 2);
    useAppStore.setState({ drawNotes: [], notes: [] });
    assert.equal(await store.doRedeem(pkg), true);
    const stored = useAppStore.getState().drawNotes[0];
    assert.equal(stored.lineGeneration, 1); assert.equal(stored.fee, 5); assert.equal(stored.noteCommitment, pkg.noteCommitment);
    assert.equal(stored.status, "redeemed");
    store.lockVault();
    assert.equal(await store.unlockVault("VaultPassphrase12345!"), true);
    assert.equal(useAppStore.getState().drawNotes[0].lineGeneration, 1);
    assert.equal(useAppStore.getState().drawNotes[0].noteCommitment, pkg.noteCommitment);
    assert.equal(useAppStore.getState().recoveryRequired, false);
  });
  it("preserves journal-backed credentials while the original agent compensates an expired historical note", async (t) => {
    let now = Math.floor(Date.now() / 1000);
    t.mock.method(Date, "now", () => now * 1000);
    const runtime = new InMemoryTestRuntime(undefined, { clock: () => now }); setRuntime(runtime);
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    for (const role of ["issuer", "merchant", "agent"] as const) await store.generateIdentity(role);
    const issuerSk = useAppStore.getState().issuerRecord!.issuerSecret;
    assert.equal(await store.doFundReserve(200), true);
    assert.equal(await store.doRegisterMerchant(), true);
    assert.equal(await store.doOpen(100, { feeFlat: 5, feeBps: 0 }), true);
    assert.equal(await store.doQuote(40, "original-agent-historical-refund"), true);
    assert.equal(await store.doDraw(useAppStore.getState().merchantQuotes[0].quoteCommitment), true);
    const note = useAppStore.getState().drawNotes[0];
    assert.equal(await store.doAck(45, "historical-agent-full-repayment"), true);
    const originalLine = useAppStore.getState().agentLineRecord!;
    // External issuer actions replace the book. Removing only the legacy credential mirror
    // must not erase credentials retained by this vault's confirmed operation journal.
    assert.equal((await runtime.setStatus("closed", issuerSk, { closingBook: {
      limit: originalLine.limit, outstanding: 0, epoch: originalLine.epoch, salt: originalLine.salt } })).ok, true);
    assert.equal((await runtime.openLine({ limit: 120, expiry: now + 20000, callerSk: issuerSk,
      agentSecret: "39".repeat(32), salt: "3a".repeat(32) })).ok, true);
    const currentC = (await runtime.getStatus()).lineCommitment;
    const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress()}`;
    await removeEncryptedPrefix(`${prefix}:issuer`);
    useAppStore.setState({ issuerRecord: null });
    store.lockVault(); now = note.expiry;
    assert.equal(await store.unlockVault("VaultPassphrase12345!"), false, "the vault decrypts but the obsolete book remains unreconciled");
    assert.equal(useAppStore.getState().isVaultUnlocked, true);
    assert.equal(useAppStore.getState().issuerRecord, null);
    assert.equal(useAppStore.getState().recoveryRequired, true, "normal unlock must not treat the obsolete book as current");
    assert.equal(await store.doExpireNote(note.noteCommitment), true);
    assert.equal((await runtime.getStatus()).lineCommitment, currentC);
    assert.equal(useAppStore.getState().agentLineRecord, null); assert.equal(useAppStore.getState().agentRecord, null);
    assert.deepEqual(useAppStore.getState().historicalAgentKeys, [{ identityCommitment: note.identityCommitment, agentSecret: originalLine.agentSecret }]);
    assert.equal(useAppStore.getState().refunds[0].amount, 45); assert.equal(useAppStore.getState().refunds[0].allocatedCredit, 0);
    assert.deepEqual(await loadEncryptedJson(`${prefix}:historical-agent-keys`, "VaultPassphrase12345!"), useAppStore.getState().historicalAgentKeys);
    store.lockVault();
    assert.deepEqual(useAppStore.getState().historicalAgentKeys, []);
    assert.equal(await store.unlockVault("VaultPassphrase12345!"), true);
    assert.equal(useAppStore.getState().agentLineRecord, null); assert.equal(useAppStore.getState().agentRecord, null);
    assert.equal(useAppStore.getState().issuerRecord?.issuerSecret, issuerSk); assert.equal(useAppStore.getState().historicalAgentKeys[0].agentSecret, originalLine.agentSecret);
    assert.equal(useAppStore.getState().refunds[0].amount, 45); assert.equal(useAppStore.getState().recoveryRequired, false);
  });

  it("enforces capacity boundaries and gives generic error copy on over-draw", async () => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    await store.generateIdentity("merchant");
    await store.generateIdentity("agent");

    await store.doFundReserve(500);
    await store.doRegisterMerchant();
    await store.doOpen(100); // Limit = 100

    // Quote 120 exceeds limit of 100
    await store.doQuote(120, "inv-overdraw");
    const overQuote = useAppStore.getState().merchantQuotes[0];

    const drawOk = await store.doDraw(overQuote.quoteCommitment);
    assert.equal(drawOk, false);
    // AGENTS.md hard constraint: generic error copy on rejected draws
    assert.equal(useAppStore.getState().flash?.text, "Clearance could not be proven.");
  });

  it("refuses doDraw and doAck when agent vault record is missing", async () => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    await store.generateIdentity("merchant");
    await store.generateIdentity("agent");
    await store.doFundReserve(500);
    await store.doRegisterMerchant();
    await store.doOpen(150);
    await store.doQuote(40, "inv-no-agent");
    const quote = useAppStore.getState().merchantQuotes[0];
    assert.ok(quote);

    // Clear agent vault record
    useAppStore.setState({ agentLineRecord: null, agentRecord: null });

    const drawOk = await store.doDraw(quote.quoteCommitment);
    assert.equal(drawOk, false);
    assert.equal(
      useAppStore.getState().flash?.text,
      "Clearance could not be proven."
    );

    const ackOk = await store.doAck(20, "wire-no-agent");
    assert.equal(ackOk, false);
    assert.equal(
      useAppStore.getState().flash?.text,
      "Repay ack refused: vault record missing for this agent."
    );
  });

  it("enforces fee capacity boundaries and updates outstanding with fee", async () => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    await store.generateIdentity("merchant");
    await store.generateIdentity("agent");
    await store.doFundReserve(500);
    await store.doRegisterMerchant();
    assert.equal(await store.doOpen(100, { feeFlat: 10, feeBps: 0 }), true);

    // Issuer approved a flat fee of 10: amount 95 fits alone, but debt 105 exceeds the limit.
    await store.doQuote(95, "inv-fee-overdraw");
    const quoteOver = useAppStore.getState().merchantQuotes[0];
    assert.ok(quoteOver);
    assert.equal(quoteOver.fee, 10);

    const drawFail = await store.doDraw(quoteOver.quoteCommitment);
    assert.equal(drawFail, false);
    assert.equal(useAppStore.getState().flash?.text, "Clearance could not be proven.");

    // 2. Successful draw with fee: amount = 40, fee = 10 -> newOutstanding = 50
    await store.doQuote(40, "inv-fee-ok");
    const quoteOk = useAppStore.getState().merchantQuotes.find((q) => q.displayInvoiceId === "inv-fee-ok");
    assert.ok(quoteOk);
    assert.equal(quoteOk.fee, 10);

    // Neither the agent nor a modified imported quote can waive or increase the approved fee.
    for (const fee of [0, 11]) {
      useAppStore.setState({ merchantQuotes: useAppStore.getState().merchantQuotes.map((q) => q.quoteCommitment === quoteOk.quoteCommitment ? { ...q, fee } : q) });
      assert.equal(await store.doDraw(quoteOk.quoteCommitment), false);
      assert.equal(useAppStore.getState().flash?.text, "Clearance could not be proven.");
      assert.equal(useAppStore.getState().agentLineRecord?.outstanding, 0);
    }
    useAppStore.setState({ merchantQuotes: useAppStore.getState().merchantQuotes.map((q) => q.quoteCommitment === quoteOk.quoteCommitment ? { ...q, fee: 10 } : q) });

    const drawPass = await store.doDraw(quoteOk.quoteCommitment);
    assert.equal(drawPass, true);
    assert.equal(useAppStore.getState().agentLineRecord?.outstanding, 50);
    assert.equal(useAppStore.getState().agentRecord?.B, 50);

    // The same issuer-approved policy remains attached to subsequent quotes.
    await store.doQuote(30, "inv-fee-zero");
    const quoteZero = useAppStore.getState().merchantQuotes.find((q) => q.displayInvoiceId === "inv-fee-zero");
    assert.ok(quoteZero);
    assert.equal(quoteZero.fee, 10);

    const drawZero = await store.doDraw(quoteZero.quoteCommitment);
    assert.equal(drawZero, true);
    assert.equal(useAppStore.getState().agentLineRecord?.outstanding, 90);
    assert.equal(useAppStore.getState().agentRecord?.B, 90);
  });

  it("automatic session expiry synchronously purges decrypted state and preserves public queries", async () => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    await store.doFundReserve(500);
    useAppStore.setState({ dual: { circuit: "openLine", publicView: "public", privateView: "secret book", ok: true } });
    let unsubscribe = () => {};
    const expired = new Promise<void>((resolve) => { unsubscribe = onVaultSessionLock(resolve); });
    unlockVaultSession("VaultPassphrase12345!", 0.0002);
    await expired;
    unsubscribe();
    assert.equal(useAppStore.getState().isVaultUnlocked, false);
    assert.equal(useAppStore.getState().issuerRecord, null);
    assert.equal(useAppStore.getState().dual, null);
    assert.deepEqual(useAppStore.getState().merchantQuotes, []);
    assert.deepEqual(useAppStore.getState().drawNotes, []);
    assert.equal(await store.doFundReserve(100), false);
    await store.refreshStatus();
    assert.equal(useAppStore.getState().ledger.totalReserve, 500);
    assert.equal(await store.unlockVault("VaultPassphrase12345!"), true);
    assert.ok(useAppStore.getState().issuerRecord?.issuerSecret);
  });

  it("rejects every privileged action against the live vault even with stale UI credentials", async (t) => {
    const runtime = new InMemoryTestRuntime();
    setRuntime(runtime);
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    await store.generateIdentity("merchant");
    await store.generateIdentity("agent");
    await store.doFundReserve(500);
    await store.doRegisterMerchant();
    await store.doOpen(150);
    await store.doQuote(40, "locked-first");
    await store.doDraw(useAppStore.getState().merchantQuotes[0].quoteCommitment);
    await store.doQuote(20, "locked-next");
    const stale = useAppStore.getState();
    const quoteCommit = stale.merchantQuotes[1].quoteCommitment;
    const noteCommit = stale.drawNotes[0].noteCommitment;
    let runtimeCalls = 0;
    const methods = ["fundReserve", "withdrawReserve", "withdrawFees", "registerMerchant", "disableMerchant",
      "openLine", "postQuote", "draw", "redeemDraw", "cancelOrExpireNote", "acknowledgeRepayment", "setStatus"] as const;
    for (const method of methods) t.mock.method(runtime, method, () => { runtimeCalls++; throw new Error("Locked runtime invoked"); });
    lockVaultSession();
    const actions = [() => store.doFundReserve(10), () => store.doWithdrawReserve(10),
      () => store.doWithdrawFees(), () => store.doRegisterMerchant("00".repeat(32)),
      () => store.doDisableMerchant("00".repeat(32)), () => store.doOpen(100),
      () => store.doQuote(10, "locked"), () => store.doDraw(quoteCommit),
      () => store.doRedeem(noteCommit), () => store.doExpireNote(noteCommit),
      () => store.doAck(10, "locked"), () => store.doRefundAck(noteCommit, "locked-refund"), () => store.doStatus("closed")];
    for (const action of actions) {
      useAppStore.setState({ ...stale, isVaultUnlocked: true });
      assert.equal(await action(), false);
    }
    assert.equal(runtimeCalls, 0);
    assert.equal(store.exportQuotePackage("00".repeat(32)), null);
    assert.equal(store.exportDrawNotePackage("00".repeat(32)), null);
    assert.equal(store.importQuotePackage({}), false);
    assert.equal(store.importDrawNotePackage({}), false);
    await assert.rejects(store.generateIdentity("issuer"), /Vault is locked/);
    await assert.rejects(store.importIdentity("issuer", "01".repeat(32)), /Vault is locked/);
    assert.equal(useAppStore.getState().issuerRecord, null);
    assert.equal(useAppStore.getState().agentRecord, null);
    assert.equal(useAppStore.getState().merchantRecord, null);
  });

  it("does not republish credentials from a save completing after lock", async () => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    const record = { issuerSecret: "01".repeat(32) };
    const save = store.saveIssuerRecord(record);
    lockVaultSession();
    await save;
    assert.equal(useAppStore.getState().issuerRecord, null);
    assert.equal(useAppStore.getState().isVaultUnlocked, false);
    assert.equal(await store.unlockVault("VaultPassphrase12345!"), true);
    assert.deepEqual(useAppStore.getState().issuerRecord, record);
  });

  it("rechecks revocation between approval notification and privileged runtime execution", async (t) => {
    const runtime = new InMemoryTestRuntime();
    setRuntime(runtime);
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    let calls = 0;
    t.mock.method(runtime, "fundReserve", async () => { calls++; throw new Error("Must not execute after revocation"); });
    let revoked = false;
    const unsubscribe = useAppStore.subscribe((state) => {
      if (!revoked && state.txLifecycle === "wallet-approval") {
        revoked = true;
        lockVaultSession();
      }
    });
    try {
      assert.equal(await store.doFundReserve(500), false);
      assert.equal(revoked, true);
      assert.equal(calls, 0);
      assert.equal(useAppStore.getState().issuerRecord, null);
      assert.equal(useAppStore.getState().txLifecycle, "failed");
    } finally { unsubscribe(); }
  });

  it("a stale unlock decrypt cannot restore credentials after lock", async (t) => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    store.lockVault();
    let release!: () => void;
    let entered!: () => void;
    const decryptEntered = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const decrypt = globalThis.crypto.subtle.decrypt.bind(globalThis.crypto.subtle);
    t.mock.method(globalThis.crypto.subtle, "decrypt", async (...args: Parameters<SubtleCrypto["decrypt"]>) => {
      entered();
      await gate;
      return decrypt(...args);
    });
    const unlock = store.unlockVault("VaultPassphrase12345!");
    await decryptEntered;
    lockVaultSession();
    release();
    assert.equal(await unlock, false);
    assert.equal(useAppStore.getState().issuerRecord, null);
    assert.equal(useAppStore.getState().isVaultUnlocked, false);
  });

  it("an older failed decrypt cannot lock a newer successful session", async (t) => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    const expected = useAppStore.getState().issuerRecord;
    store.lockVault();
    let release!: () => void;
    let entered!: () => void;
    const decryptEntered = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const decrypt = globalThis.crypto.subtle.decrypt.bind(globalThis.crypto.subtle);
    let first = true;
    t.mock.method(globalThis.crypto.subtle, "decrypt", async (...args: Parameters<SubtleCrypto["decrypt"]>) => {
      if (first) { first = false; entered(); await gate; }
      return decrypt(...args);
    });
    const oldUnlock = store.unlockVault("WrongPassword12345!");
    await decryptEntered;
    assert.equal(await store.unlockVault("VaultPassphrase12345!"), true);
    release();
    assert.equal(await oldUnlock, false);
    assert.equal(useAppStore.getState().isVaultUnlocked, true);
    assert.deepEqual(useAppStore.getState().issuerRecord, expected);
  });

  it("encrypts a confirmed draw completing after lock without restoring decrypted books", async () => {
    const runtime = new InMemoryTestRuntime();
    setRuntime(runtime);
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    await store.generateIdentity("merchant");
    await store.generateIdentity("agent");
    await store.doFundReserve(500);
    await store.doRegisterMerchant();
    await store.doOpen(150);
    await store.doQuote(40, "draw-lock-recovery");
    const quote = useAppStore.getState().merchantQuotes[0];
    let release!: () => void;
    let entered!: () => void;
    const drawConfirmed = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const draw = runtime.draw.bind(runtime);
    runtime.draw = async (params) => { const result = await draw(params); entered(); await gate; return result; };
    const purchase = store.doDraw(quote.quoteCommitment);
    await drawConfirmed;
    store.lockVault();
    release();
    assert.equal(await purchase, true);
    assert.equal(useAppStore.getState().agentRecord, null);
    assert.equal(useAppStore.getState().agentLineRecord, null);
    assert.deepEqual(useAppStore.getState().drawNotes, []);
    assert.equal(useAppStore.getState().ledger.encumberedReserve, 40);
    const prefix = `line:vault:${runtime.networkId}:${runtime.getContractAddress() ?? "unconfigured"}`;
    const stored = await loadEncryptedJson<{ outstanding: number; salt: string }>(`${prefix}:agent-line`, "VaultPassphrase12345!");
    assert.equal(stored?.outstanding, 40);
    assert.ok(stored?.salt);
    assert.equal(await store.unlockVault("VaultPassphrase12345!"), true);
    assert.equal(useAppStore.getState().agentRecord?.B, 40);
    assert.equal(useAppStore.getState().drawNotes.length, 1);
    assert.equal(useAppStore.getState().merchantQuotes[0].status, "consumed");
    await assert.rejects(store.generateIdentity("agent"), /issued line opening/);
    await assert.rejects(store.importIdentity("agent", "02".repeat(32)), /issued line opening/);
    await assert.rejects(store.saveAgentRecord({ ...useAppStore.getState().agentRecord!, lineCommitment: "", L: 0, B: 0, epoch: 0, salt: "" }), /issued line opening/);
    assert.equal(useAppStore.getState().agentRecord?.B, 40);
  });

  it("recovers a lost draw response from its exact public commitment without drawing twice", async () => {
    const runtime = new InMemoryTestRuntime();
    setRuntime(runtime);
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    for (const role of ["issuer", "merchant", "agent"] as const) await store.generateIdentity(role);
    assert.equal(await store.doFundReserve(500), true);
    assert.equal(await store.doRegisterMerchant(), true);
    assert.equal(await store.doOpen(150), true);
    assert.equal(await store.doQuote(40, "response-loss"), true);
    const quote = useAppStore.getState().merchantQuotes[0];
    const draw = runtime.draw.bind(runtime);
    let calls = 0;
    runtime.draw = async (params, options) => { calls++; await draw(params, options); throw new Error("Response lost after execution"); };
    assert.equal(await store.doDraw(quote.quoteCommitment), false);
    assert.equal(useAppStore.getState().recoveryRequired, true);
    assert.equal(useAppStore.getState().agentRecord?.B, 0);
    assert.equal((await runtime.getStatus()).encumberedReserve, 40);
    assert.equal(await store.recoverOperations(), true);
    assert.equal(useAppStore.getState().recoveryRequired, false);
    assert.equal(useAppStore.getState().agentRecord?.B, 40);
    assert.equal(useAppStore.getState().drawNotes.length, 1);
    assert.equal(await store.doDraw(quote.quoteCommitment), false);
    assert.equal(calls, 1);
  });

  it("preserves credentials generated after the most recent confirmed circuit on unlock", async () => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    assert.equal(await store.doFundReserve(100), true);
    const merchant = await store.generateIdentity("merchant");
    const agent = await store.generateIdentity("agent");
    store.lockVault();
    assert.equal(await store.unlockVault("VaultPassphrase12345!"), true);
    assert.equal(useAppStore.getState().merchantRecord?.merchantSecret, merchant);
    assert.equal(useAppStore.getState().agentRecord?.agentSecret, agent);
  });

  for (const failure of ["confirmation-write", "legacy-mirror"] as const) {
    it(`recovers a successful draw after a failed ${failure} without losing the prewritten opening`, async (t) => {
      const runtime = new InMemoryTestRuntime();
      setRuntime(runtime);
      const store = useAppStore.getState();
      await store.unlockVault("VaultPassphrase12345!");
      for (const role of ["issuer", "merchant", "agent"] as const) await store.generateIdentity(role);
      await store.doFundReserve(500);
      await store.doRegisterMerchant();
      await store.doOpen(150);
      await store.doQuote(40, `failed-${failure}`);
      const quote = useAppStore.getState().merchantQuotes[0];
      const draw = runtime.draw.bind(runtime);
      const encrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle);
      let writes = 0;
      runtime.draw = async (params, options) => {
        const result = await draw(params, options);
        t.mock.method(globalThis.crypto.subtle, "encrypt", async (...args: any[]) => {
          writes++;
          if (writes === (failure === "confirmation-write" ? 1 : 2)) throw new Error("Simulated encrypted write failure");
          return (encrypt as any)(...args);
        });
        return result;
      };
      assert.equal(await store.doDraw(quote.quoteCommitment), failure === "legacy-mirror");
      assert.equal((await runtime.getStatus()).encumberedReserve, 40);
      store.lockVault();
      assert.equal(await store.unlockVault("VaultPassphrase12345!"), true);
      assert.equal(useAppStore.getState().agentRecord?.B, 40);
      assert.equal(useAppStore.getState().drawNotes.length, 1);
      assert.equal(useAppStore.getState().merchantQuotes[0].status, "consumed");
      assert.equal(useAppStore.getState().recoveryRequired, false);
    });
  }

  it("keeps an ambiguous reserve submission blocked when its book commitment is unchanged", async () => {
    const runtime = new InMemoryTestRuntime();
    setRuntime(runtime);
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    let calls = 0;
    const fund = runtime.fundReserve.bind(runtime);
    runtime.fundReserve = async (...args) => { calls++; await fund(...args); throw new Error("Unknown outcome"); };
    assert.equal(await store.doFundReserve(100), false);
    assert.equal(await store.doFundReserve(100), false);
    assert.equal(calls, 1);
    assert.equal((await runtime.getStatus()).totalReserve, 100);
    assert.equal(useAppStore.getState().recoveryRequired, true);
  });

  it("reconciles a saved reserve transaction ID only when its exact successful receipt arrives", async () => {
    const runtime = new InMemoryTestRuntime();
    const observedRuntime: import("../lib/runtime/types.ts").LineRuntime = runtime;
    setRuntime(runtime);
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    const id = "ab".repeat(32);
    const fund = runtime.fundReserve.bind(runtime);
    let calls = 0;
    runtime.fundReserve = async (amount, caller, options) => {
      await options?.beforeSubmit?.({ txId: id });
      calls++;
      await fund(amount, caller, options);
      throw new Error("Lost evaluation receipt");
    };
    observedRuntime.getTransactionReceipt = async () => null;
    assert.equal(await store.doFundReserve(100), false);
    assert.equal(await store.doFundReserve(100), false);
    assert.equal(calls, 1);
    // Provider simulation for journal reconciliation; no network finality claim.
    observedRuntime.getTransactionReceipt = async transactionId => ({ ok: true, disposition: "confirmed-success",
      txId: transactionId, txHash: "evaluation-fund-receipt", blockHeight: 1 });
    assert.equal(await store.recoverOperations(), true);
    assert.equal(useAppStore.getState().recoveryRequired, false);
    assert.equal(useAppStore.getState().ledger.totalReserve, 100);
    assert.equal(calls, 1);
  });

  it("serializes actions and refuses credential replacement during a submitted operation", async () => {
    const runtime = new InMemoryTestRuntime();
    setRuntime(runtime);
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    await store.generateIdentity("issuer");
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const fund = runtime.fundReserve.bind(runtime);
    runtime.fundReserve = async (...args) => { entered(); await gate; return fund(...args); };
    const pending = store.doFundReserve(100);
    await started;
    assert.equal(await store.doFundReserve(100), false);
    await assert.rejects(store.generateIdentity("issuer"));
    assert.equal(await store.unlockVault("OtherPassword123!"), false);
    release();
    assert.equal(await pending, true);
    assert.equal((await runtime.getStatus()).totalReserve, 100);
    assert.equal(useAppStore.getState().operationBusy, false);
  });

  it("recognizes an acknowledged payment reference after another draw instead of crediting it twice", async () => {
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    for (const role of ["issuer", "merchant", "agent"] as const) await store.generateIdentity(role);
    await store.doFundReserve(500);
    await store.doRegisterMerchant();
    await store.doOpen(150);
    for (const invoice of ["first", "second"]) {
      assert.equal(await store.doQuote(40, invoice), true);
      const quote = useAppStore.getState().merchantQuotes.at(-1)!;
      assert.equal(await store.doDraw(quote.quoteCommitment), true);
      if (invoice === "first") assert.equal(await store.doAck(40, "real-payment-001"), true);
    }
    assert.equal(useAppStore.getState().agentRecord?.B, 40);
    const clock = useAppStore.getState().ledger.actionClock;
    assert.equal(await store.doAck(40, "real-payment-001"), true);
    assert.equal(useAppStore.getState().agentRecord?.B, 40);
    assert.equal(useAppStore.getState().ledger.actionClock, clock);
    assert.equal(useAppStore.getState().repayments.length, 1);
    assert.equal(await store.doAck(20, "real-payment-001"), false);
  });

  it("recovers lost compensation and reported-refund responses without duplicate credit or releasing unverified cash holds", async (t) => {
    let now = Math.floor(Date.now() / 1000);
    t.mock.method(Date, "now", () => now * 1000);
    const runtime = new InMemoryTestRuntime(undefined, { clock: () => now });
    setRuntime(runtime);
    const store = useAppStore.getState();
    await store.unlockVault("VaultPassphrase12345!");
    for (const role of ["issuer", "merchant", "agent"] as const) await store.generateIdentity(role);
    assert.equal(await store.doFundReserve(200), true);
    assert.equal(await store.doRegisterMerchant(), true);
    assert.equal(await store.doOpen(100, { feeFlat: 5, feeBps: 0 }), true);
    assert.equal(await store.doQuote(40, "recover-compensation"), true);
    assert.equal(await store.doDraw(useAppStore.getState().merchantQuotes[0].quoteCommitment), true);
    const note = useAppStore.getState().drawNotes[0];
    assert.equal(note.fee, 5);
    assert.equal(await store.doAck(20, "wire-compensation-prepayment"), true);
    store.lockVault();
    now = note.expiry;
    assert.equal(await store.unlockVault("VaultPassphrase12345!"), true);
    const cancel = runtime.cancelOrExpireNote.bind(runtime);
    let allocations = 0, acknowledgements = 0;
    runtime.cancelOrExpireNote = async (commitment, caller, options) => {
      const result = await cancel(commitment, caller, options);
      if (result.ok && options?.compensation) { allocations++; throw new Error("Allocation response lost after execution"); }
      if (result.ok && options?.refundAck) { acknowledgements++; throw new Error("Reported refund response lost after execution"); }
      return result;
    };
    assert.equal(await store.doExpireNote(note.noteCommitment), false);
    assert.equal(useAppStore.getState().recoveryRequired, true);
    assert.equal(useAppStore.getState().agentLineRecord?.outstanding, 25);
    assert.equal((await runtime.getStatus()).refundReserve, 45);
    const observe = runtime.getRecoveryEvidence.bind(runtime);
    for (const invalid of [{ compensationAllocated: false }, { refundCommitment: "ff".repeat(32) }, { cashRefundOwed: false }]) {
      runtime.getRecoveryEvidence = async query => {
        const evidence = await observe(query);
        return evidence.note ? { ...evidence, note: { ...evidence.note, ...invalid } } : evidence;
      };
      assert.equal(await store.recoverOperations(), false, "candidate C alone cannot establish the prepared compensation effect");
      assert.equal(useAppStore.getState().agentLineRecord?.outstanding, 25);
    }
    runtime.getRecoveryEvidence = observe;
    assert.equal(await store.recoverOperations(), true);
    assert.equal(useAppStore.getState().agentLineRecord?.outstanding, 0);
    assert.equal(useAppStore.getState().refunds.length, 1);
    const refund = useAppStore.getState().refunds[0];
    assert.equal(refund.amount, 20);
    assert.equal(refund.allocatedCredit, 25);
    assert.equal(refund.status, "allocated");
    assert.equal((await runtime.getRecoveryEvidence({ noteCommit: note.noteCommitment })).note?.refundCommitment, refund.refundCommitment);
    assert.equal(await store.doRefundAck(note.noteCommitment, "wire-compensation-refund"), false);
    assert.equal(useAppStore.getState().recoveryRequired, true);
    assert.equal(useAppStore.getState().refunds[0].status, "allocated");
    runtime.getRecoveryEvidence = async query => {
      const evidence = await observe(query);
      return evidence.note ? { ...evidence, note: { ...evidence.note, refundAcknowledged: false } } : evidence;
    };
    assert.equal(await store.recoverOperations(), false, "the allocated marker and unchanged C cannot prove refund acknowledgement");
    assert.equal(useAppStore.getState().refunds[0].status, "allocated");
    runtime.getRecoveryEvidence = async query => {
      const evidence = await observe(query);
      return query?.nullifier ? { ...evidence, nullifier: { value: query.nullifier, present: false } } : evidence;
    };
    assert.equal(await store.recoverOperations(), false, "another payment's acknowledgement marker cannot confirm this supplied reference");
    assert.equal(useAppStore.getState().refunds[0].status, "allocated");
    runtime.getRecoveryEvidence = async query => {
      const evidence = await observe(query);
      return evidence.note ? { ...evidence, note: { ...evidence.note, refundPaymentNullifier: "ff".repeat(32) } } : evidence;
    };
    assert.equal(await store.recoverOperations(), false, "a globally consumed payment reference does not prove this note acknowledged that reference");
    assert.equal(useAppStore.getState().refunds[0].status, "allocated");
    runtime.getRecoveryEvidence = observe;
    assert.equal(await store.recoverOperations(), true);
    assert.equal(useAppStore.getState().refunds[0].status, "issuer-reported");
    assert.equal(useAppStore.getState().refunds.length, 1);
    assert.equal(useAppStore.getState().ledger.refundReserve, 0);
    assert.equal(useAppStore.getState().ledger.reportedRefundReserve, 45);
    assert.equal(useAppStore.getState().ledger.withdrawableReserve, 155);
    assert.equal(await store.doRefundAck(note.noteCommitment, "wire-compensation-refund"), true);
    assert.equal(await store.doRefundAck(note.noteCommitment, "different-refund-reference"), false);
    assert.equal(allocations, 1);
    assert.equal(acknowledgements, 1);
  });
});
