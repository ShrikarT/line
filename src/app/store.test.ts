import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useAppStore } from "./store.ts";
import { setRuntime, InMemoryTestRuntime } from "../lib/runtime/index.ts";
import { purgeLegacyPlaintextStorage, lockVaultSession, removeEncryptedPrefix } from "../lib/security/vault.ts";

describe("production store: full lifecycle, vault custody & witnesses", () => {
  beforeEach(async () => {
    purgeLegacyPlaintextStorage();
    lockVaultSession();
    await removeEncryptedPrefix("line:vault:");
    // Use fresh isolated in-memory test runtime for each test
    setRuntime(new InMemoryTestRuntime());
    // Reset store state
    useAppStore.setState({
      isVaultUnlocked: false,
      txLifecycle: "idle",
      lastTxHash: null,
      lastBlockHeight: null,
      flash: null,
      agentLineRecord: null,
      merchantQuotes: [],
      drawNotes: [],
      repayments: [],
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
    assert.match(useAppStore.getState().flash?.text ?? "", /Issuer private key record missing/);

    const openOk = await store.doOpen(150);
    assert.equal(openOk, false);

    const quoteOk = await store.doQuote(40, "inv-1");
    assert.equal(quoteOk, false);
    assert.match(useAppStore.getState().flash?.text ?? "", /Merchant credentials missing/);

    const drawOk = await store.doDraw("0xnonexistent");
    assert.equal(drawOk, false);
    assert.match(useAppStore.getState().flash?.text ?? "", /Quote record not found/);
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
    assert.equal(quotePkg.format, "line:quote-package:v1");
    assert.equal(quotePkg.amount, 35);

    // Clear merchant quotes from store to simulate an isolated agent environment
    useAppStore.setState({ merchantQuotes: [], invoices: [] });
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
    assert.equal(notePkg.format, "line:note-package:v1");
    assert.equal(notePkg.amount, 35);
    assert.ok(notePkg.noteSalt);

    // Clear notes from store to simulate an isolated merchant environment
    useAppStore.setState({ drawNotes: [], notes: [] });
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
});
