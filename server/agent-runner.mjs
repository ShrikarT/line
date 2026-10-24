import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { lineStateCommit, requiredDrawFee, toHex, hexToBytes } from '../src/lib/line/encoding.ts';
import { decodeQuote, encodeNote, decodeNote } from '../src/lib/organization/transfers.ts';
import { encodeVaultJson } from '../src/lib/security/vault-codec.ts';
import { agentGrantDigest, verifyAgentGrant, agentInputDigest, requireAgentBudget } from './agent-authorization.mjs';
import { prepareAgentClaim, decodeAgentDraw } from './agent-midnight.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const need = (condition, message) => { if (!condition) throw new AgentRunnerError(message); };
const sha = value => createHash('sha256').update(value).digest('hex');
const fresh = () => randomBytes(32).toString('hex');
export class AgentRunnerError extends Error {}

/** One serialized writer for one paired facility and its dedicated fee wallet.
 * There are no synthetic success defaults. The SDK adapter owns proving/raw
 * submission/provider verification; the supplier owns quote/redemption/delivery.
 * Pairing activation requires a durable browser-fence verifier supplied by the
 * pairing protocol. Missing setup fails closed, including after restart. */
export class AgentRunner {
  static async create(options) {
    const runner = new AgentRunner(options);
    await runner.validateRestore();
    return runner;
  }
  constructor({ store, adapter, supplier, pairing, assertWriterFence, now = Date.now }) {
    need(store && adapter && supplier && pairing, 'Configure the persistent runner, actual Midnight adapter, supplier and pinned pairing.');
    need(store.sourceFingerprint === pairing.sourceFingerprint, 'Runner storage belongs to another contract source.');
    this.store = store; this.adapter = adapter; this.supplier = supplier; this.pairing = structuredClone(pairing);
    this.assertWriterFence = assertWriterFence ?? (() => { throw new AgentRunnerError('The browser delegation fence has not been verified.'); });
    this.now = now; this.queue = Promise.resolve(); this.closing = false;
  }
  exclusive(action) {
    need(!this.closing, 'Agent runner is closing.');
    const task = this.queue.then(action);
    this.queue = task.catch(() => {});
    return task;
  }
  grant(record, active = true) {
    need(record?.authorization?.scope && record.authorization.proof, 'A signed owner authorization is required.');
    const { scope, proof } = record.authorization;
    const digest = verifyAgentGrant(scope, proof, this.pairing, active ? this.now() : scope.issuedAt);
    need(digest === record.authorization.digest && record.grantId === scope.grantId && record.facilityAddress === scope.facilityAddress && record.maxSpend === BigInt(scope.maxSpend) && record.maxFee === BigInt(scope.maxFee) && record.generation === BigInt(scope.generation) && record.expiresAt === scope.expiresAt && isDeepStrictEqual(record.allowedServices, scope.allowedServices), 'Stored authorization differs from the signed scope.');
    need(typeof record.spent === 'bigint' && record.spent >= 0n && typeof record.reserved === 'bigint' && record.reserved >= 0n && record.spent + record.reserved <= record.maxSpend && typeof record.revoked === 'boolean', 'Stored authorization counters differ.');
    if (active) need(!record.revoked, 'Agent authorization is revoked.');
    return scope;
  }
  async validateRestore() {
    const snapshot = this.store.snapshot();
    for (const record of Object.values(snapshot.grants)) this.grant(record, false);
    if (snapshot.pending) {
      const p = snapshot.pending, task = snapshot.tasks[p.taskId], book = snapshot.books[p.facilityAddress];
      need(task && book && p.circuit === 'draw' && p.sourceFingerprint === this.pairing.sourceFingerprint, 'Retained operation has no matching task, book or release.');
      const quote = decodeQuote(task.quotePackage), expected = prepareAgentClaim(book, quote, { noteNonce: p.candidateNote.noteNonce, noteSalt: p.candidateNote.noteSalt, newSalt: p.candidateBook.salt });
      need(isDeepStrictEqual(expected.candidateBook, p.candidateBook) && encodeNote(expected.candidateNote) === encodeNote(p.candidateNote), 'Retained draw candidate differs from its original task.');
      const grant = snapshot.grants[task.grantId];
      need(grant && p.charge === expected.candidateNote.amount + expected.candidateNote.fee && grant.reserved === p.charge, 'Retained draw differs from its reserved authorization.');
      if (p.identifier !== null) decodeAgentDraw(p, this.pairing.sourceFingerprint);
      else need(p.transaction === null && p.transactionHash === null && p.disposition === 'prepared', 'Unsigned operation has inconsistent signed material.');
    }
  }

  activateDelegation(input) {
    const { scope, proof, book } = structuredClone(input);
    return this.exclusive(async () => {
      const digest = verifyAgentGrant(scope, proof, this.pairing, this.now());
      await this.assertWriterFence(scope);
      need(!this.store.getPending() && !this.store.listGrants().length && !this.store.listBooks().length, 'Return and reconcile the existing delegation before replacing it.');
      const commitment = toHex(lineStateCommit({ domain: hexToBytes(book.domain), identity: hexToBytes(book.agentPk), limit: book.limit, outstanding: book.outstanding, epoch: book.epoch }, hexToBytes(book.salt)));
      need(book.facilityAddress === scope.facilityAddress && book.domain === scope.domain && book.agentPk === scope.agentPk && book.generation === BigInt(scope.generation) && commitment === scope.bookCommitment, 'Delegated book differs from the owner-signed checkpoint.');
      await this.adapter.inspect(book, scope.ownerAddress);
      await this.store.commit(state => {
        state.books[book.facilityAddress] = structuredClone(book);
        state.grants[scope.grantId] = { grantId: scope.grantId, facilityAddress: scope.facilityAddress, maxSpend: BigInt(scope.maxSpend), maxFee: BigInt(scope.maxFee), allowedServices: [...scope.allowedServices], generation: BigInt(scope.generation), expiresAt: scope.expiresAt, authorization: { scope: structuredClone(scope), proof: structuredClone(proof), digest }, spent: 0n, reserved: 0n, revoked: false };
      });
      return { grantId: scope.grantId, digest };
    });
  }

  getTask(id) {
    const task = this.store.getTask(id);
    if (!task) return null;
    // Original bytes/candidates, claims and source input remain in encrypted
    // storage; agent API responses expose only this explicit public task view.
    const { orderId, status, paymentStatus, deliveryStatus, result, brief, receipts, error, updatedAt } = task;
    let cost = null;
    if (task.quotePackage) {
      const quote = decodeQuote(task.quotePackage), fee = requiredDrawFee(quote.amount, quote.feeFlat, quote.feeBps);
      cost = { assetColor: '00'.repeat(32), decimals: 6, merchantPrice: quote.amount.toString(), organizationFee: fee.toString(), totalAllowanceCharge: (quote.amount + fee).toString() };
    }
    return structuredClone({ id, orderId, objective: task.objective, status, paymentStatus, deliveryStatus, cost, result, brief: brief ?? null, receipts, error, denialReason: task.denialReason ?? null, updatedAt });
  }
  listTasks() { return this.store.listTasks().map(task => this.getTask(task.id)); }

  submitTask(request) {
    request = structuredClone(request);
    return this.exclusive(async () => {
      need(UUID.test(request?.orderId), 'A stable UUID order ID is required.');
      need(request.serviceId === 'line-doc-extract-v1', 'This runner supports the reviewed document extraction service.');
      const inputDigest = agentInputDigest(request.document, request.objective);
      const existing = this.store.getTaskByOrderId(request.orderId);
      if (existing) {
        need(existing.inputDigest === inputDigest && existing.grantId === request.grantId && existing.serviceId === request.serviceId && existing.facilityAddress === request.facilityAddress, 'This order ID is already bound to different terms.');
        return this.getTask(existing.id);
      }
      need(!this.store.getPending(), 'Reconcile the retained signed operation before another purchase.');
      const capacity = this.store.snapshot();
      need(Object.keys(capacity.tasks).length < 50 && Buffer.byteLength(encodeVaultJson(capacity)) < 1_000_000, 'The runner task archive is full. Existing payments remain recoverable; stop new purchases until an authenticated archive is configured.');
      const grant = this.store.getGrant(request.grantId), scope = this.grant(grant);
      await this.assertWriterFence(scope);
      need(request.facilityAddress === scope.facilityAddress && scope.allowedServices.includes(request.serviceId), 'Task is outside the owner authorization.');
      const task = { id: request.orderId, orderId: request.orderId, grantId: request.grantId, facilityAddress: request.facilityAddress, serviceId: request.serviceId, document: request.document, objective: request.objective, inputDigest, status: 'quote_pending', paymentStatus: 'unpaid', deliveryStatus: 'pending', result: null, brief: null, receipts: [], error: null, updatedAt: this.now() };
      await this.store.commit(state => { state.tasks[task.id] = task; });
      await this.quoteAndDraw(task.id);
      return this.getTask(task.id);
    });
  }

  async quoteAndDraw(id) {
    let task = this.store.getTask(id), order;
    try {
      order = await this.supplier.createOrder({ id: task.orderId, contractAddress: task.facilityAddress, service: task.serviceId, document: task.document, objective: task.objective });
    } catch {
      // The supplier may already have signed/posted its original quote. Same
      // order identity is retained; a timeout is not an authorization to replace.
      await this.updateTask(id, { status: 'quote_pending', error: 'Supplier quote is unresolved. Continue this saved task.' });
      return;
    }
    let quote, scope, book, candidate, charge, pending;
    try {
      need(order?.id === task.orderId && order.contractAddress === task.facilityAddress && order.service === task.serviceId && order.inputDigest === sha(task.document) && order.objectiveDigest === sha(task.objective) && typeof order.quotePackage === 'string', 'Supplier order differs from the requested task.');
      quote = decodeQuote(order.quotePackage);
      need(quote.contractAddress === task.facilityAddress, 'Supplier quote targets another facility.');
      // Retain the supplier's exact terms even when the owner's policy denies
      // purchase. A retry of this task must not create a fresh quote or draw.
      await this.updateTask(id, { quotePackage: order.quotePackage });
      const grant = this.store.getGrant(task.grantId);
      scope = this.grant(grant); book = this.store.getBook(task.facilityAddress);
      await this.assertWriterFence(scope);
      need(book && quote.domain === scope.domain && quote.generation === BigInt(scope.generation) && quote.expiry > BigInt(Math.floor(this.now() / 1000)), 'Clearance could not be proven.');
      candidate = prepareAgentClaim(book, quote, { noteNonce: fresh(), noteSalt: fresh(), newSalt: fresh() });
      const terms = { service: task.serviceId, merchantPk: quote.merchantPk, principal: quote.amount, fee: candidate.candidateNote.fee };
      charge = requireAgentBudget(scope, grant, terms, this.now());
      pending = { id: randomUUID(), taskId: id, facilityAddress: task.facilityAddress, circuit: 'draw', sourceFingerprint: scope.sourceFingerprint, ...candidate, charge, identifier: null, transaction: null, transactionHash: null, disposition: 'prepared' };
      await this.store.commit(state => {
        need(!state.pending, 'Another operation requires reconciliation.');
        need(isDeepStrictEqual(state.books[task.facilityAddress], book), 'The private book changed before purchase.');
        requireAgentBudget(this.grant(state.grants[task.grantId]), state.grants[task.grantId], terms, this.now());
        state.grants[task.grantId].reserved += charge;
        state.tasks[id] = { ...state.tasks[id], status: 'payment_pending', paymentStatus: 'pending', error: null, updatedAt: this.now() };
        state.pending = pending;
      });
    } catch (error) {
      const reasons = new Map([
        ['Purchase exceeds the remaining lifetime authorization.', 'budget_exceeded'],
        ['Purchase fee exceeds the authorized maximum.', 'fee_exceeded'],
        ['Supplier is outside the agent authorization.', 'supplier_not_authorized'],
        ['Agent grant is not currently valid.', 'authorization_inactive'],
        ['Agent authorization is revoked.', 'authorization_inactive'],
      ]);
      // No prepare/sign/submit has happened. Persist a terminal policy outcome,
      // never provider text or credentials, and leave the exact order intact.
      await this.updateTask(id, { status: 'denied', paymentStatus: 'unpaid', error: 'Clearance could not be proven.', denialReason: reasons.get(error?.message) ?? 'purchase_not_authorized' });
      return;
    }
    try {
      const signed = await this.adapter.prepareDraw({ book, quote, ...candidate, ownerAddress: scope.ownerAddress });
      decodeAgentDraw(signed, scope.sourceFingerprint);
      need(signed.facilityAddress === pending.facilityAddress, 'Prepared draw targets another facility.');
      await this.store.commit(state => { need(state.pending?.id === pending.id, 'Prepared draw changed.'); Object.assign(state.pending, signed, { disposition: 'signed' }); });
    } catch (error) {
      // prepareDraw cannot submit. A persistence failure poisons the store and
      // this attempted commit also fails closed, preserving durable evidence.
      if (this.store.getPending()?.identifier === null) {
        await this.store.commit(state => { state.pending = null; state.grants[task.grantId].reserved -= charge; Object.assign(state.tasks[id], { status: 'failed', paymentStatus: 'unpaid', error: 'Clearance could not be proven.', updatedAt: this.now() }); });
      }
      throw error;
    }
    // Proof/balance may take time. Policy can expire or be revoked while that
    // work is in flight; retain signed bytes and stop before the RPC boundary.
    try {
      const currentScope = this.grant(this.store.getGrant(task.grantId));
      await this.assertWriterFence(currentScope);
      need(quote.expiry > BigInt(Math.floor(this.now() / 1000)), 'Quoted terms have expired.');
      await this.store.commit(state => {
        this.grant(state.grants[task.grantId]);
        need(quote.expiry > BigInt(Math.floor(this.now() / 1000)), 'Quoted terms have expired.');
        state.pending.disposition = 'submission-attempted';
      });
    } catch {
      await this.updateTask(id, { status: 'approval_needed', error: 'Authorization changed before submission. The signed draw is retained and was not submitted by this runner.' });
      return;
    }
    try { await this.adapter.submitOriginal(this.store.getPending()); }
    catch { await this.updateTask(id, { status: 'payment_uncertain', paymentStatus: 'uncertain', error: 'The original signed draw is retained. Reconcile it before another purchase.' }); return; }
    await this.reconcilePending();
    if (!this.store.getPending()) await this.deliver(id);
  }

  continueTask(id) {
    return this.exclusive(async () => {
      const task = this.store.getTask(id);
      need(task, 'Task was not found.');
      if (this.store.getPending()) {
        need(this.store.getPending().taskId === id, 'Reconcile the other pending operation first.');
        await this.reconcilePending();
      } else if (task.status === 'quote_pending') {
        // Supplier idempotency binds all terms; this never changes the order ID.
        await this.quoteAndDraw(id);
      }
      const current = this.store.getTask(id);
      if (!this.store.getPending() && ['claim_authorized', 'redemption_pending', 'redemption_uncertain', 'paid_awaiting_delivery', 'paid_undelivered'].includes(current.status)) await this.deliver(id);
      return this.getTask(id);
    });
  }

  async reconcilePending() {
    const pending = this.store.getPending();
    if (!pending) return;
    await this.validateRestore();
    if (!pending.identifier) {
      // A crash during preparation cannot have submitted; the adapter API has
      // no submission side effect in that phase. No automatic replacement draw.
      await this.store.commit(state => {
        const task = state.tasks[pending.taskId];
        state.grants[task.grantId].reserved -= pending.charge;
        Object.assign(task, { status: 'approval_needed', paymentStatus: 'unpaid', error: 'Preparation stopped before signing. Review a new attempt separately.', updatedAt: this.now() });
        task.originalDraw = structuredClone(pending); state.pending = null;
      });
      return;
    }
    let receipt;
    try { receipt = await this.adapter.reconcile(pending); }
    catch { await this.updateTask(pending.taskId, { status: 'payment_uncertain', paymentStatus: 'uncertain', error: 'Finality is unresolved; the exact signed draw remains saved.' }); return; }
    need(receipt?.identifier === pending.identifier && receipt.contractAddress === pending.facilityAddress && receipt.circuit === 'draw' && receipt.sourceFingerprint === pending.sourceFingerprint && Number.isSafeInteger(receipt.blockHeight) && receipt.blockHeight > 0 && /^[0-9a-f]{64}$/.test(receipt.txHash) && ['success', 'failure'].includes(receipt.outcome), 'The exact finalized draw outcome has not been verified.');
    await this.store.commit(state => {
      need(state.pending?.id === pending.id, 'Retained draw changed during reconciliation.');
      const task = state.tasks[pending.taskId], grant = state.grants[task.grantId];
      grant.reserved -= pending.charge;
      task.originalDraw = structuredClone(pending);
      task.receipts.push(receipt); state.receipts.push(receipt);
      if (receipt.outcome === 'success') {
        state.books[pending.facilityAddress] = pending.candidateBook;
        grant.spent += pending.charge;
        Object.assign(task, { status: 'claim_authorized', paymentStatus: 'authorized', claimPackage: encodeNote(pending.candidateNote), error: null, updatedAt: this.now() });
      } else Object.assign(task, { status: 'failed', paymentStatus: 'failed', error: 'The original draw failed in a finalized block. Network fees may have been charged.', updatedAt: this.now() });
      state.pending = null;
    });
  }

  async deliver(id) {
    let task = this.store.getTask(id);
    if (!task.claimPackage) return;
    // A grant expiry/revocation stops new draws, not an existing merchant claim.
    // Same claim is handed back to the same durable order; never another draw.
    await this.updateTask(id, { status: 'redemption_pending' });
    let order;
    try {
      const submitted = await this.supplier.submitClaim({ id: task.orderId, claim: task.claimPackage });
      const queried = await this.supplier.getOrder(task.orderId);
      order = queried?.order ?? queried ?? submitted;
    } catch { await this.updateTask(id, { status: 'redemption_uncertain', error: 'The existing claim handoff is unresolved. Continue this saved task.' }); return; }
    need(order?.id === task.orderId && order.contractAddress === task.facilityAddress && order.service === task.serviceId, 'Supplier returned another order.');
    const note = decodeNote(task.claimPackage);
    let receipt;
    try { receipt = await this.adapter.verifyRedemption(order, note); }
    catch { await this.updateTask(id, { status: 'redemption_uncertain', error: 'Supplier payout has not been verified.' }); return; }
    if (!receipt) { await this.updateTask(id, { status: 'redemption_uncertain', error: 'Supplier payout has not been verified.' }); return; }
    need(receipt.circuit === 'redeemDraw' && receipt.contractAddress === note.contractAddress && receipt.noteCommitment === note.noteCommitment && receipt.amount === note.amount.toString() && receipt.sourceFingerprint === this.pairing.sourceFingerprint && receipt.outcome === 'success' && Number.isSafeInteger(receipt.blockHeight) && receipt.blockHeight > 0 && /^[0-9a-f]{64}$/.test(receipt.txHash), 'Supplier receipt differs from the authorized claim.');
    let result = null;
    if (order.deliveryStatus === 'delivered') {
      try { result = validateAgentResult(task, order.result); }
      catch { /* Paid state is preserved even when supplier output is invalid. */ }
    }
    await this.store.commit(state => {
      task = state.tasks[id];
      if (!task.receipts.some(row => row.txHash === receipt.txHash && row.circuit === 'redeemDraw')) { task.receipts.push(receipt); state.receipts.push(receipt); }
      Object.assign(task, { paymentStatus: 'paid', result, deliveryStatus: result ? 'delivered' : order.deliveryStatus === 'pending' ? 'pending' : 'undelivered', status: result ? 'result_ready' : order.deliveryStatus === 'pending' ? 'paid_awaiting_delivery' : 'paid_undelivered', error: result ? null : 'Payment is finalized; usable supplier output is not available.', updatedAt: this.now() });
    });
  }
  recordBrief(id, brief) {
    brief = structuredClone(brief);
    return this.exclusive(async () => {
      const task = this.store.getTask(id);
      if (task?.status === 'completed' && isDeepStrictEqual(task.brief, brief)) return this.getTask(id);
      need(task?.status === 'result_ready' && typeof brief?.text === 'string' && brief.text.trim() && [...brief.text].length <= 10000 && Array.isArray(brief.citations) && (brief.citations.length > 0 || task.result.outcome === 'no_matching_evidence') && brief.citations.length <= 30 && brief.citations.every(citation => task.result.passages.some(p => p.start === citation.start && p.end === citation.end)), 'An agent-written brief must cite returned source passages.');
      await this.updateTask(id, { brief: structuredClone(brief), status: 'completed' });
      return this.getTask(id);
    });
  }
  updateTask(id, patch) { return this.store.commit(state => { need(state.tasks[id], 'Task was not found.'); Object.assign(state.tasks[id], patch, { updatedAt: this.now() }); }); }
  async close() { this.closing = true; await this.queue; await this.store.close(); }
}

export function validateAgentResult(task, result) {
  need(task.serviceId === 'line-doc-extract-v1' && result?.service === task.serviceId && result.version === 1 && result.inputDigest === sha(task.document) && result.objectiveDigest === sha(task.objective) && ['evidence_found', 'no_matching_evidence'].includes(result.outcome) && Array.isArray(result.passages) && result.passages.length <= 30 && Buffer.byteLength(JSON.stringify(result)) <= 32 * 1024, 'Supplier output does not match this source task.');
  need(result.passages.every(p => Number.isSafeInteger(p.start) && Number.isSafeInteger(p.end) && p.start >= 0 && p.end > p.start && p.end <= task.document.length && typeof p.text === 'string' && p.text === task.document.slice(p.start, p.end) && Array.isArray(p.headingPath) && p.headingPath.length <= 6 && p.headingPath.every(h => typeof h === 'string' && h.length <= 5000)), 'Supplier evidence offsets differ from the supplied source.');
  need((result.outcome === 'no_matching_evidence') === (result.passages.length === 0), 'Supplier evidence outcome differs from its passages.');
  return { service: result.service, version: result.version, inputDigest: result.inputDigest, objectiveDigest: result.objectiveDigest, outcome: result.outcome, passages: result.passages.map(p => ({ start: p.start, end: p.end, text: p.text, headingPath: [...p.headingPath] })) };
}
