import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { OrganizationWallet } from './organization-wallet.mjs';
import { OrganizationMerchants } from './organization-merchants.mjs';
import { validateContractArtifacts } from '../scripts/contract-artifacts.mjs';
import * as R from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../contracts/managed/organization/contract/index.js';
import { WITNESSES, blankPrivate } from '../src/lib/line/compact-harness.ts';
import { pad32, issuerPublicKey, merchantPublicKey, drawNoteCommit, toHex, hexToBytes, requiredDrawFee, canonicalInvoiceIdBytes } from '../src/lib/line/encoding.ts';
import { encodeNote, decodeQuote } from '../src/lib/organization/transfers.ts';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const digest = value => createHash('sha256').update(value).digest('hex');

function environment(t) {
  const directory = mkdtempSync(join(tmpdir(), 'line-supplier-agent-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  return { MIDNIGHT_SUPPLIER_MNEMONIC: mnemonic, MIDNIGHT_STORAGE_PASSWORD: 'SupplierStorageControl123!', MIDNIGHT_BLOCKFROST_PROJECT_ID: 'test-provider-control', LINE_SUPPLIER_DATA_DIR: directory };
}

async function storageService(owner, options) {
  const release = validateContractArtifacts({ artifactDir: 'contracts/managed/organization', profile: 'organization', requireKeys: false, requireRelease: false });
  const service = new OrganizationMerchants(options);
  await service.initializeRecords(owner, owner.recipients, release);
  return service;
}

function createBook(owner, recipientBytes) {
  const contract = new Contract(WITNESSES);
  const data = contract.initialState(
    R.createConstructorContext(blankPrivate(), '0'.repeat(64)),
    issuerPublicKey(pad32('issuer-control')),
    merchantPublicKey(owner.keys.merchantA),
    pad32('instance-control'),
    { bytes: recipientBytes },
    { bytes: Buffer.from(owner.recipients.A.addressHex, 'hex') },
    new Uint8Array(32)
  ).currentContractState.data;
  const underlying = ledger(data);
  return new Proxy(underlying, {
    get(target, prop, receiver) {
      if (prop === 'totalReserve') return 10_000_000n;
      if (prop === 'lineGeneration') return 1n;
      if (prop === 'feeFlat') return 1000n;
      if (prop === 'feeBps') return 100n;
      return Reflect.get(target, prop, receiver);
    }
  });
}

function setupMockChain(service, book) {
  service.inspectContract = async () => book;
  service.inspect = async () => book;
  service.operation = async function(id, kind, name, input, after, execute) {
    this.assertJournalWritable();
    const receipt = { id, kind, name, contractAddress: this.state.contractAddress, txHash: `tx-${id}`, blockHeight: 100n, disposition: 'confirmed-success' };
    const next = { ...after, receipts: [...this.state.receipts.filter(x => x.id !== id), receipt], pending: null };
    await this.save(next);
    this.state = next;
    return receipt;
  };
}

function buildClaim(orderQuote, merchantPkHex, fee, noteNonce = 'aa'.repeat(32)) {
  const note = {
    contractAddress: orderQuote.contractAddress,
    domain: orderQuote.domain,
    identity: '88'.repeat(32),
    merchantPk: merchantPkHex,
    quoteCommitment: orderQuote.quoteCommitment,
    amount: orderQuote.amount,
    fee,
    expiry: orderQuote.expiry,
    generation: orderQuote.generation,
    noteNonce,
    noteSalt: '77'.repeat(32),
    noteCommitment: ''
  };
  note.noteCommitment = toHex(drawNoteCommit({domain:hexToBytes(note.domain),lineGeneration:note.generation,identity:hexToBytes(note.identity),quoteCommit:hexToBytes(note.quoteCommitment),merchantPk:hexToBytes(note.merchantPk),amount:note.amount,fee:note.fee,noteNonce:hexToBytes(note.noteNonce),expiry:note.expiry},hexToBytes(note.noteSalt)));
  return note;
}

test('generated invoice digest binds canonical 6-tuple exactly into 32 bytes without truncation', async t => {
  const env = environment(t), owner = await OrganizationWallet.open(env);
  const service = await storageService(owner);
  const recipient = pad32('owner-recipient-fixed');
  const book = createBook(owner, recipient);
  setupMockChain(service, book);

  const id = '11111111-1111-4111-8111-111111111111';
  const address = 'ab'.repeat(32);
  const document = '# Privacy Overview\nVerification uses zero knowledge proofs.';
  const objective = 'What proofs are used for privacy?';

  const order = await service.quote(id, address, 'line-doc-extract-v1', document, objective);
  assert.equal(order.status, 'quoted');
  assert.equal(order.paymentStatus, 'quoted');
  assert.equal(order.deliveryStatus, 'pending');

  const decodedQuote = decodeQuote(order.quotePackage);
  assert.equal(decodedQuote.contractAddress, address);

  // Exact 32 bytes check (64 hex characters)
  const invoiceBytes = hexToBytes(decodedQuote.invoiceId);
  assert.equal(invoiceBytes.length, 32);

  // Verifies binding to canonical tuple network:address:serviceId:id:inputDigest:objectiveDigest
  const expectedTuple = ['preprod', address, 'line-doc-extract-v1', id, digest(document), digest(objective)].join(':');
  const expectedInvoiceId = toHex(canonicalInvoiceIdBytes(digest(expectedTuple)));
  assert.equal(decodedQuote.invoiceId, expectedInvoiceId);

  assert.equal(order.inputDigest, digest(document));
  assert.equal(order.objectiveDigest, digest(objective));

  await service.close();
  await owner.close();
});

test('order terms reject changed objective even when original objective was null', async t => {
  const env = environment(t), owner = await OrganizationWallet.open(env);
  const service = await storageService(owner);
  const recipient = pad32('owner-recipient-fixed');
  const book = createBook(owner, recipient);
  setupMockChain(service, book);

  const id = '22222222-2222-4222-8222-222222222222';
  const address = 'ab'.repeat(32);
  const document = '# Terms\nInitial agreement details.';

  // 1. Quoting with an objective and then changing the objective
  await service.quote(id, address, 'line-doc-extract-v1', document, 'Initial objective');
  await assert.rejects(
    service.quote(id, address, 'line-doc-extract-v1', document, 'Changed objective'),
    /already bound to different terms/
  );

  // 2. Existing order with null objective rejects incoming non-null objective
  const legacyId = '33333333-3333-4333-8333-333333333333';
  service.state.orders.push({
    id: legacyId,
    address,
    service: 'line-doc-extract-v1',
    inputDigest: digest(document),
    objectiveDigest: null,
    document,
    objective: null,
    quote: null,
    status: 'created',
    paymentStatus: 'unpaid',
    deliveryStatus: 'pending',
    result: null,
    createdAt: Date.now(),
    ownerRecipient: toHex(recipient),
    deliveryTimeoutAt: null,
    deliveryError: null
  });
  await service.save();

  await assert.rejects(
    service.quote(legacyId, address, 'line-doc-extract-v1', document, 'New objective on legacy order'),
    /already bound to different terms/
  );

  await service.close();
  await owner.close();
});

test('claim validation enforces exact expected fee, rejects altered claims, and blocks alternate claim for same order', async t => {
  const env = environment(t), owner = await OrganizationWallet.open(env);
  const service = await storageService(owner);
  const recipient = pad32('owner-recipient-fixed');
  const book = createBook(owner, recipient);
  setupMockChain(service, book);

  const id = '44444444-4444-4444-8444-444444444444';
  const address = 'ab'.repeat(32);
  const document = '# Security Policy\nRefunds within 14 days.';
  const objective = 'What is the refund window?';

  const order = await service.quote(id, address, 'line-doc-extract-v1', document, objective);
  const decodedQuote = decodeQuote(order.quotePackage);

  const expectedFee = requiredDrawFee(decodedQuote.amount, book.feeFlat, book.feeBps);

  // 1. Altered fee claim is rejected
  const alteredFeeClaim = buildClaim(decodedQuote, decodedQuote.merchantPk, expectedFee + 1n);
  await assert.rejects(service.redeem(id, encodeNote(alteredFeeClaim)), /exact service order/);

  // 2. Altered commitment claim is rejected
  const alteredCommitClaim = buildClaim({ ...decodedQuote, quoteCommitment: 'ff'.repeat(32) }, decodedQuote.merchantPk, expectedFee);
  await assert.rejects(service.redeem(id, encodeNote(alteredCommitClaim)), /exact service order/);

  // 3. Valid claim succeeds
  const validClaimA = buildClaim(decodedQuote, decodedQuote.merchantPk, expectedFee, '11'.repeat(32));
  const delivered = await service.redeem(id, encodeNote(validClaimA));
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.deliveryStatus, 'delivered');
  assert.equal(delivered.noteCommitment, validClaimA.noteCommitment);
  for (const [field, value] of Object.entries({noteNonce:'ff'.repeat(32),noteSalt:'ff'.repeat(32),identity:'ff'.repeat(32),amount:validClaimA.amount+1n,fee:validClaimA.fee+1n,noteCommitment:'ff'.repeat(32)})) {
    await assert.rejects(service.redeem(id, encodeNote({...validClaimA,[field]:value})), /exact service order|commitment does not match|different claim/);
  }

  // 4. Alternate claim with different noteCommitment is rejected for the same order
  const alternateClaimB = buildClaim(decodedQuote, decodedQuote.merchantPk, expectedFee, '22'.repeat(32));
  await assert.rejects(service.redeem(id, encodeNote(alternateClaimB)), /bound to a different claim/);

  await service.close();
  await owner.close();
});

test('fixed recipient and registered merchant wallet boundaries are enforced', async t => {
  const env = environment(t), owner = await OrganizationWallet.open(env);
  const service = await storageService(owner);
  const recipient = pad32('owner-recipient-fixed');
  const book = createBook(owner, recipient);
  service.inspectContract = async () => book;

  const address = 'ab'.repeat(32);

  // authorizeOrganization only accepts registered issuer payout recipient
  assert.equal(await service.authorizeOrganization(address, toHex(recipient)), true);
  assert.equal(await service.authorizeOrganization(address, '00'.repeat(32)), false);
  assert.equal(await service.authorizeOrganization(address, 'invalid'), false);

  // inspect verifies merchant payout recipient
  assert.equal(await service.inspect(address, 'A'), book);
  await assert.rejects(service.inspect(address, 'B'), /not registered with its own receiving wallet/);
  const originalRecipient = service.recipients.A;
  service.recipients = {...service.recipients,A:{...originalRecipient,addressHex:'ff'.repeat(32)}};
  await assert.rejects(service.inspect(address, 'A'), /not registered with its own receiving wallet/);

  await service.close();
  await owner.close();
});

test('useful result is retained and quote/redeem operations are fully idempotent', async t => {
  const env = environment(t), owner = await OrganizationWallet.open(env);
  const service = await storageService(owner);
  const recipient = pad32('owner-recipient-fixed');
  const book = createBook(owner, recipient);
  setupMockChain(service, book);

  const id = '55555555-5555-4555-8555-555555555555';
  const address = 'ab'.repeat(32);
  const document = '# Product Catalog\n\n## Subscriptions\n- Basic tier is 10 NIGHT.\n- Pro tier is 50 NIGHT.';
  const objective = 'What is the price of Pro tier?';

  // Initial quote
  const orderQuoted = await service.quote(id, address, 'line-doc-extract-v1', document, objective);
  assert.equal(orderQuoted.status, 'quoted');

  // Idempotent re-quote preserves original quote
  const reQuoted = await service.quote(id, address, 'line-doc-extract-v1', document, objective);
  assert.equal(reQuoted.quotePackage, orderQuoted.quotePackage);

  const decodedQuote = decodeQuote(orderQuoted.quotePackage);
  const expectedFee = requiredDrawFee(decodedQuote.amount, book.feeFlat, book.feeBps);
  const validClaim = buildClaim(decodedQuote, decodedQuote.merchantPk, expectedFee, '33'.repeat(32));

  // Initial redeem delivers useful result
  const delivered = await service.redeem(id, encodeNote(validClaim));
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.deliveryStatus, 'delivered');
  assert.equal(delivered.result.service, 'line-doc-extract-v1');
  assert.equal(delivered.result.outcome, 'evidence_found');
  assert(delivered.result.passages.length > 0);

  const proPassage = delivered.result.passages.find(p => p.text.includes('Pro tier is 50 NIGHT'));
  assert(proPassage);
  assert.equal(document.slice(proPassage.start, proPassage.end), proPassage.text);
  assert.deepEqual(proPassage.headingPath, ['Product Catalog', 'Subscriptions']);

  // Idempotent re-redeem returns delivered order without error
  const reDelivered = await service.redeem(id, encodeNote(validClaim));
  assert.equal(reDelivered.status, 'delivered');
  assert.deepEqual(reDelivered.result, delivered.result);

  await service.close();
  await owner.close();
});

test('paid undelivered recovery preserves real state across restart and retries fulfillment without double redemption', async t => {
  const env = environment(t), owner = await OrganizationWallet.open(env);
  let service = await storageService(owner, {fulfill: () => {throw Error('Controlled delivery outage');}});
  const recipient = pad32('owner-recipient-fixed');
  const book = createBook(owner, recipient);
  setupMockChain(service, book);

  const id = '66666666-6666-4666-8666-666666666666';
  const address = 'ab'.repeat(32);
  const doc = '# Data\nImportant metrics.';
  const obj = 'metrics';

  const order = await service.quote(id, address, 'line-doc-extract-v1', doc, obj);
  const decodedQuote = decodeQuote(order.quotePackage);
  const expectedFee = requiredDrawFee(decodedQuote.amount, book.feeFlat, book.feeBps);
  const validClaim = buildClaim(decodedQuote, decodedQuote.merchantPk, expectedFee, '44'.repeat(32));

  const failedDelivery = await service.redeem(id, encodeNote(validClaim));
  assert.equal(failedDelivery.status, 'paid_undelivered');
  assert.equal(failedDelivery.paymentStatus, 'redeemed');
  assert.equal(failedDelivery.deliveryStatus, 'undelivered');
  assert.equal(failedDelivery.result, null);
  assert.match(failedDelivery.deliveryError, /Controlled delivery outage/);

  // Simulate supplier restart
  service.ownsParent = true;
  await service.close();

  const restoredOwner = await OrganizationWallet.open(env);
  service = await storageService(restoredOwner);
  setupMockChain(service, book);

  // Verify real supplier state preserved across restart
  const preservedOrder = service.order(id);
  assert.equal(preservedOrder.status, 'paid_undelivered');
  assert.equal(preservedOrder.paymentStatus, 'redeemed');
  assert.equal(preservedOrder.deliveryStatus, 'undelivered');
  assert.match(preservedOrder.deliveryError, /Controlled delivery outage/);
  const targetRecord = service.state.orders.find(o => o.id === id);
  assert.equal(targetRecord.document, doc);
  assert.equal(targetRecord.objective, obj);
  assert.equal(targetRecord.inputDigest, digest(doc));
  assert.equal(targetRecord.noteCommitment, validClaim.noteCommitment);

  // Retry redemption must NOT call on-chain redeem again
  let redeemedOnChain = false;
  const originalOperation = service.operation.bind(service);
  service.operation = async (opId, ...args) => {
    if (opId.startsWith('redeem-')) redeemedOnChain = true;
    return originalOperation(opId, ...args);
  };

  const recovered = await service.redeem(id, encodeNote(validClaim));
  assert.equal(redeemedOnChain, false, 'Paid retry must rerun fulfillment without calling redeemDraw again');
  assert.equal(recovered.status, 'delivered');
  assert.equal(recovered.deliveryStatus, 'delivered');
  assert.equal(recovered.result.outcome, 'evidence_found');
  assert(recovered.result.passages.length > 0);

  await service.close();
  await restoredOwner.close();
});
