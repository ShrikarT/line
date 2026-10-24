import { EncryptedCheckoutStore } from './checkout-storage.ts';
import { isDeepStrictEqual } from 'node:util';
import { validateRunnerPairingState, validateRunnerPairingTransition } from './agent-pairing.mjs';

export class AgentStoreError extends Error {}

const COMPOSITE_KEY = '7f8b9e10-1234-4567-89ab-cdef01234567';
const SCHEMA = 'line:agent-store/v1';

const HEX64_LOWER = /^[0-9a-f]{64}$/;
const HEX66_LOWER = /^[0-9a-f]{66}$/;
const HEX_LOWER = /^[0-9a-f]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UINT64_MAX = 18_446_744_073_709_551_615n;

const MAX_TASKS = 1_000;
const MAX_BOOKS = 100;
const MAX_GRANTS = 100;
const MAX_RECEIPTS = 5_000;

function isUint64(n) {
  return typeof n === 'bigint' && n >= 0n && n <= UINT64_MAX;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function isSafeKey(key) {
  return (
    typeof key === 'string' &&
    key !== '__proto__' &&
    key !== 'constructor' &&
    key !== 'prototype'
  );
}

export function validateSnapshot(snapshot, expectedBinding, expectedSourceFingerprint) {
  if (!isPlainObject(snapshot)) {
    throw new AgentStoreError('Stored snapshot must be a plain object.');
  }
  if (snapshot.schema !== SCHEMA) {
    throw new AgentStoreError(`Invalid store schema: expected ${SCHEMA}, got ${snapshot.schema}`);
  }
  if (snapshot.version !== 1) {
    throw new AgentStoreError(`Invalid store version: expected 1, got ${snapshot.version}`);
  }
  if (snapshot.binding !== expectedBinding) {
    throw new AgentStoreError('Store binding digest does not match expected provenance binding.');
  }
  if (snapshot.sourceFingerprint !== expectedSourceFingerprint) {
    throw new AgentStoreError('Store sourceFingerprint does not match expected contract source fingerprint.');
  }
  validateRunnerPairingState(snapshot.pairing, expectedSourceFingerprint);
  if (
    typeof snapshot.revision !== 'number' ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0
  ) {
    throw new AgentStoreError('Store revision must be a non-negative integer.');
  }

  // Tasks validation
  if (!isPlainObject(snapshot.tasks)) {
    throw new AgentStoreError('Tasks container must be a plain record.');
  }
  const taskEntries = Object.entries(snapshot.tasks);
  if (taskEntries.length > MAX_TASKS) {
    throw new AgentStoreError(`Tasks capacity exceeded (maximum ${MAX_TASKS}).`);
  }
  const seenOrderIds = new Set();
  for (const [key, task] of taskEntries) {
    if (!isSafeKey(key) || !UUID_REGEX.test(key) || !isPlainObject(task)) {
      throw new AgentStoreError(`Invalid task key or task payload: ${key}`);
    }
    if (task.id !== key) {
      throw new AgentStoreError(`Task key mismatch: ${key} vs ${task.id}`);
    }
    if (typeof task.orderId !== 'string' || !task.orderId.trim() || task.orderId.length > 120) {
      throw new AgentStoreError(`Task ${key} has invalid orderId.`);
    }
    if (seenOrderIds.has(task.orderId)) {
      throw new AgentStoreError(`Duplicate orderId across tasks: ${task.orderId}`);
    }
    seenOrderIds.add(task.orderId);

    if (typeof task.facilityAddress !== 'string' || !HEX64_LOWER.test(task.facilityAddress)) {
      throw new AgentStoreError(`Task ${key} has invalid facilityAddress (must be 64-hex lowercase).`);
    }

    if (typeof task.serviceId !== 'string' || !task.serviceId.trim() || task.serviceId.length > 80) {
      throw new AgentStoreError(`Task ${key} has invalid serviceId.`);
    }
    if (typeof task.document !== 'string' || task.document.length > 50_000) {
      throw new AgentStoreError(`Task ${key} has invalid document.`);
    }
    if (typeof task.objective !== 'string' || task.objective.length > 1_000) {
      throw new AgentStoreError(`Task ${key} has invalid objective.`);
    }
    if (typeof task.inputDigest !== 'string' || !HEX64_LOWER.test(task.inputDigest)) {
      throw new AgentStoreError(`Task ${key} has invalid inputDigest (must be 64-hex lowercase).`);
    }

    // Invariant: paid-but-undelivered cannot be completed
    if (task.paymentStatus === 'paid' && task.deliveryStatus === 'undelivered') {
      if (task.status === 'completed') {
        throw new AgentStoreError(
          `Invariant violation: task ${key} is paid-but-undelivered and cannot be completed.`,
        );
      }
    }

    // Invariant: completed must have paid, delivered, and non-null result
    if (task.status === 'completed') {
      if (task.paymentStatus !== 'paid' || task.deliveryStatus !== 'delivered' || !task.result) {
        throw new AgentStoreError(
          `Invariant violation: completed task ${key} must have paymentStatus paid, deliveryStatus delivered, and non-null result.`,
        );
      }
    }
  }

  // Books validation
  if (!isPlainObject(snapshot.books)) {
    throw new AgentStoreError('Books container must be a plain record.');
  }
  const bookEntries = Object.entries(snapshot.books);
  if (bookEntries.length > MAX_BOOKS) {
    throw new AgentStoreError(`Books capacity exceeded (maximum ${MAX_BOOKS}).`);
  }
  for (const [key, book] of bookEntries) {
    if (!isSafeKey(key) || !HEX64_LOWER.test(key) || !isPlainObject(book)) {
      throw new AgentStoreError(`Invalid book key or payload: ${key}`);
    }
    if (key !== book.facilityAddress.toLowerCase()) {
      throw new AgentStoreError(`Book key does not match facilityAddress: ${key}`);
    }
    if (!HEX64_LOWER.test(book.facilityAddress)) {
      throw new AgentStoreError(`Book facilityAddress must be 64 lowercase hex: ${key}`);
    }
    if (!HEX64_LOWER.test(book.agentSecret)) {
      throw new AgentStoreError(`Book ${key} must have 64-character lowercase hex agentSecret.`);
    }
    if (!HEX64_LOWER.test(book.salt)) {
      throw new AgentStoreError(`Book ${key} must have 64-character lowercase hex salt.`);
    }
    if (!isUint64(book.limit)) {
      throw new AgentStoreError(`Book ${key} limit must be Uint64 bigint.`);
    }
    if (!isUint64(book.outstanding) || book.outstanding > book.limit) {
      throw new AgentStoreError(`Book ${key} outstanding must be Uint64 bigint within limit.`);
    }
    if (!isUint64(book.epoch)) {
      throw new AgentStoreError(`Book ${key} epoch must be Uint64 bigint.`);
    }
    if (!isUint64(book.generation)) {
      throw new AgentStoreError(`Book ${key} generation must be Uint64 bigint.`);
    }
  }

  // Grants validation
  if (!isPlainObject(snapshot.grants)) {
    throw new AgentStoreError('Grants container must be a plain record.');
  }
  const grantEntries = Object.entries(snapshot.grants);
  if (grantEntries.length > MAX_GRANTS) {
    throw new AgentStoreError(`Grants capacity exceeded (maximum ${MAX_GRANTS}).`);
  }
  for (const [key, grant] of grantEntries) {
    if (!isSafeKey(key) || !isPlainObject(grant)) {
      throw new AgentStoreError(`Invalid grant key or payload: ${key}`);
    }
    if (grant.grantId !== key) {
      throw new AgentStoreError(`Grant key mismatch: ${key} vs ${grant.grantId}`);
    }
    if (!HEX64_LOWER.test(grant.facilityAddress)) {
      throw new AgentStoreError(`Grant ${key} has invalid 64-hex lowercase facilityAddress.`);
    }
    if (!isUint64(grant.maxSpend) || grant.maxSpend === 0n) {
      throw new AgentStoreError(`Grant ${key} maxSpend must be positive Uint64 bigint.`);
    }
    if (!isUint64(grant.maxFee)) {
      throw new AgentStoreError(`Grant ${key} maxFee must be Uint64 bigint.`);
    }
    if (!Array.isArray(grant.allowedServices) || !grant.allowedServices.length) {
      throw new AgentStoreError(`Grant ${key} must have allowedServices array.`);
    }
    for (const s of grant.allowedServices) {
      if (typeof s !== 'string' || !s.trim() || s.length > 80) {
        throw new AgentStoreError(`Grant ${key} contains invalid service string.`);
      }
    }
    if (
      typeof grant.expiresAt !== 'number' ||
      !Number.isFinite(grant.expiresAt) ||
      grant.expiresAt <= 0
    ) {
      throw new AgentStoreError(`Grant ${key} expiresAt must be positive finite timestamp.`);
    }
    if (!isUint64(grant.generation)) {
      throw new AgentStoreError(`Grant ${key} generation must be Uint64 bigint.`);
    }
  }

  // Pending validation
  if (snapshot.pending !== null) {
    if (!isPlainObject(snapshot.pending)) {
      throw new AgentStoreError('Pending operation must be null or a plain object.');
    }
    const p = snapshot.pending;
    if (!isSafeKey(p.id) || !UUID_REGEX.test(p.id)) {
      throw new AgentStoreError(`Pending operation has invalid UUID id: ${p.id}`);
    }
    if (!isSafeKey(p.taskId) || !UUID_REGEX.test(p.taskId)) {
      throw new AgentStoreError(`Pending operation has invalid UUID taskId: ${p.taskId}`);
    }
    const linkedTask = snapshot.tasks[p.taskId];
    if (!linkedTask) {
      throw new AgentStoreError(`Pending operation references non-existent task: ${p.taskId}`);
    }
    if (!HEX64_LOWER.test(p.facilityAddress)) {
      throw new AgentStoreError('Pending operation must have 64-character lowercase hex facilityAddress.');
    }
    if (p.facilityAddress.toLowerCase() !== linkedTask.facilityAddress.toLowerCase()) {
      throw new AgentStoreError('Pending facilityAddress must match linked task facilityAddress.');
    }
    if (typeof p.circuit !== 'string' || !p.circuit.trim() || p.circuit.length > 80) {
      throw new AgentStoreError('Pending operation has invalid circuit.');
    }
    if (p.circuit !== 'draw') {
      throw new AgentStoreError(`Pending operation circuit must be 'draw', got '${p.circuit}'`);
    }
    if (!HEX64_LOWER.test(p.sourceFingerprint)) {
      throw new AgentStoreError('Pending sourceFingerprint must be 64-character lowercase hex.');
    }
    if (p.sourceFingerprint !== expectedSourceFingerprint) {
      throw new AgentStoreError('Pending sourceFingerprint must match store sourceFingerprint.');
    }
    if (
      !['prepared', 'signed', 'submission-attempted', 'uncertain'].includes(p.disposition)
    ) {
      throw new AgentStoreError(`Invalid pending disposition: ${p.disposition}`);
    }

    // Both candidateBook and candidateNote are strictly required
    if (!isPlainObject(p.candidateBook)) {
      throw new AgentStoreError('Pending operation requires a candidateBook record.');
    }
    if (!isPlainObject(p.candidateNote)) {
      throw new AgentStoreError('Pending operation requires a candidateNote record.');
    }

    // Validate candidateBook ordinary book fields and matching facility
    const cb = p.candidateBook;
    if (
      !HEX64_LOWER.test(cb.facilityAddress) ||
      cb.facilityAddress.toLowerCase() !== p.facilityAddress.toLowerCase()
    ) {
      throw new AgentStoreError('candidateBook facilityAddress must match pending facilityAddress.');
    }
    if (!HEX64_LOWER.test(cb.agentSecret)) {
      throw new AgentStoreError('candidateBook must have 64-character lowercase hex agentSecret.');
    }
    if (!HEX64_LOWER.test(cb.salt)) {
      throw new AgentStoreError('candidateBook must have 64-character lowercase hex salt.');
    }
    if (!isUint64(cb.limit)) {
      throw new AgentStoreError('candidateBook limit must be Uint64 bigint.');
    }
    if (!isUint64(cb.outstanding) || cb.outstanding > cb.limit) {
      throw new AgentStoreError('candidateBook outstanding must be Uint64 bigint within limit.');
    }
    if (!isUint64(cb.epoch)) {
      throw new AgentStoreError('candidateBook epoch must be Uint64 bigint.');
    }
    if (!isUint64(cb.generation)) {
      throw new AgentStoreError('candidateBook generation must be Uint64 bigint.');
    }

    // Validate candidateNote fields
    const cn = p.candidateNote;
    if (
      !HEX64_LOWER.test(cn.contractAddress) ||
      cn.contractAddress.toLowerCase() !== p.facilityAddress.toLowerCase()
    ) {
      throw new AgentStoreError('candidateNote contractAddress must match pending facilityAddress.');
    }
    if (!HEX64_LOWER.test(cn.noteCommitment)) {
      throw new AgentStoreError('candidateNote noteCommitment must be 64-character lowercase hex.');
    }
    if (!isUint64(cn.amount) || cn.amount === 0n) {
      throw new AgentStoreError('candidateNote amount must be positive Uint64 bigint.');
    }

    // Disposition checks
    if (p.disposition === 'prepared') {
      if (p.identifier !== null || p.transaction !== null || p.transactionHash !== null) {
        throw new AgentStoreError(
          'prepared pending operation must have null identifier, transaction, and transactionHash.',
        );
      }
    } else {
      if (typeof p.identifier !== 'string' || !HEX66_LOWER.test(p.identifier)) {
        throw new AgentStoreError(
          'Signed pending operation requires 66-character lowercase hex identifier.',
        );
      }
      if (
        typeof p.transaction !== 'string' ||
        !HEX_LOWER.test(p.transaction) ||
        p.transaction.length % 2 !== 0 ||
        p.transaction.length < 2 ||
        p.transaction.length > 65536
      ) {
        throw new AgentStoreError(
          'Signed pending operation requires bounded even lowercase hex transaction bytes.',
        );
      }
      if (typeof p.transactionHash !== 'string' || !HEX64_LOWER.test(p.transactionHash)) {
        throw new AgentStoreError(
          'Signed pending operation requires 64-character lowercase hex transactionHash.',
        );
      }
    }
  }

  // Receipts validation
  if (!Array.isArray(snapshot.receipts)) {
    throw new AgentStoreError('Receipts must be an array.');
  }
  if (snapshot.receipts.length > MAX_RECEIPTS) {
    throw new AgentStoreError(`Receipts capacity exceeded (maximum ${MAX_RECEIPTS}).`);
  }
  for (const r of snapshot.receipts) {
    if (!isPlainObject(r)) {
      throw new AgentStoreError('Receipt items must be plain objects.');
    }
    if (typeof r.circuit !== 'string' || !r.circuit.trim() || r.circuit.length > 80) {
      throw new AgentStoreError('Receipt must have circuit string.');
    }
    if (!HEX64_LOWER.test(r.contractAddress)) {
      throw new AgentStoreError('Receipt must have 64-character lowercase hex contractAddress.');
    }
    if (!HEX64_LOWER.test(r.txHash)) {
      throw new AgentStoreError('Receipt must have 64-character lowercase hex txHash.');
    }
    if (r.blockHeight !== undefined) {
      if (!Number.isSafeInteger(r.blockHeight) || r.blockHeight <= 0) {
        throw new AgentStoreError('Receipt blockHeight must be a positive integer.');
      }
    }
  }
  if (snapshot.pairing?.phase === 'active') {
    const accepted = snapshot.pairing.accepted, scope = accepted.package.scope;
    const grant = snapshot.grants[scope.grantId], book = snapshot.books[scope.facilityAddress];
    if (!grant || !book || grant.authorization?.digest !== accepted.acknowledgement.payload.grantDigest ||
        !isDeepStrictEqual(grant.authorization.scope, scope) || !isDeepStrictEqual(grant.authorization.proof, accepted.package.ownerSignature) ||
        book.domain !== scope.domain || book.agentPk !== scope.agentPk || book.generation !== BigInt(scope.generation) ||
        accepted.acknowledgement.payload.storeRevision > snapshot.revision) {
      throw new AgentStoreError('Accepted pairing must retain its grant, book and acknowledgement revision.');
    }
  }
}

export class AgentStore {
  constructor(underlyingStore, binding, sourceFingerprint, initialState) {
    this.store = underlyingStore;
    this._binding = binding;
    this._sourceFingerprint = sourceFingerprint;
    this.state = initialState;
    this.closed = false;
    this.poisoned = false;
    this.queue = Promise.resolve();
  }

  static async open(optionsOrDir, maybePassword, maybeBinding, maybeSourceFingerprint) {
    let directory, password, binding, sourceFingerprint;
    if (optionsOrDir && typeof optionsOrDir === 'object') {
      ({ directory, password, binding, sourceFingerprint } = optionsOrDir);
    } else {
      directory = optionsOrDir;
      password = maybePassword;
      binding = maybeBinding;
      sourceFingerprint = maybeSourceFingerprint;
    }

    if (!directory || typeof directory !== 'string') {
      throw new AgentStoreError('Configure a valid storage directory.');
    }
    if (!password || typeof password !== 'string' || password.length < 16) {
      throw new AgentStoreError('Agent store password must contain at least 16 characters.');
    }
    if (!binding || typeof binding !== 'string' || !HEX64_LOWER.test(binding)) {
      throw new AgentStoreError('Agent store binding must be an explicit 64-character lowercase hex provenance digest.');
    }
    if (!sourceFingerprint || typeof sourceFingerprint !== 'string' || !HEX64_LOWER.test(sourceFingerprint)) {
      throw new AgentStoreError('Agent store sourceFingerprint must be an explicit 64-character lowercase hex contract source digest.');
    }

    const underlying = await EncryptedCheckoutStore.openBound(
      directory,
      password,
      binding,
    );

    try {
      const records = await underlying.loadAll();
      if (records.length > 1) {
        throw new AgentStoreError('Agent store directory has multiple incompatible retained checkpoints.');
      }

      let state;
      if (records.length === 0) {
        state = {
          schema: SCHEMA,
          version: 1,
          binding,
          sourceFingerprint,
          revision: 0,
          tasks: Object.create(null),
          books: Object.create(null),
          grants: Object.create(null),
          pending: null,
          receipts: [],
        };
        validateSnapshot(state, binding, sourceFingerprint);
        await underlying.save(COMPOSITE_KEY, state);
      } else {
        state = records[0];
        validateSnapshot(state, binding, sourceFingerprint);
      }

      return new AgentStore(underlying, binding, sourceFingerprint, state);
    } catch (error) {
      await underlying.close();
      throw error;
    }
  }

  assertOpen() {
    if (this.closed) throw new AgentStoreError('Agent store is closed.');
  }

  assertWritable() {
    this.assertOpen();
    if (this.poisoned) {
      throw new AgentStoreError(
        'Agent store is poisoned by a previous persistence failure; restart and reopen required.',
      );
    }
  }

  snapshot() {
    this.assertOpen();
    return structuredClone(this.state);
  }

  getTask(id) {
    this.assertOpen();
    if (!isSafeKey(id)) return null;
    const task = this.state.tasks[id];
    return task ? structuredClone(task) : null;
  }

  getTaskByOrderId(orderId) {
    this.assertOpen();
    if (typeof orderId !== 'string') return null;
    for (const task of Object.values(this.state.tasks)) {
      if (task.orderId === orderId) {
        return structuredClone(task);
      }
    }
    return null;
  }

  listTasks() {
    this.assertOpen();
    return Object.values(this.state.tasks).map(t => structuredClone(t));
  }

  getBook(facilityAddress) {
    this.assertOpen();
    if (typeof facilityAddress !== 'string' || !isSafeKey(facilityAddress)) return null;
    const book = this.state.books[facilityAddress.toLowerCase()];
    return book ? structuredClone(book) : null;
  }

  listBooks() {
    this.assertOpen();
    return Object.values(this.state.books).map(b => structuredClone(b));
  }

  getGrant(id) {
    this.assertOpen();
    if (!isSafeKey(id)) return null;
    const grant = this.state.grants[id];
    return grant ? structuredClone(grant) : null;
  }

  listGrants() {
    this.assertOpen();
    return Object.values(this.state.grants).map(g => structuredClone(g));
  }

  getPending() {
    this.assertOpen();
    return this.state.pending ? structuredClone(this.state.pending) : null;
  }

  listReceipts() {
    this.assertOpen();
    return this.state.receipts.map(r => structuredClone(r));
  }

  get revision() {
    return this.state.revision;
  }

  get binding() {
    return this.state.binding;
  }

  get sourceFingerprint() {
    return this.state.sourceFingerprint;
  }

  get version() {
    return this.state.version;
  }

  async commit(mutator) {
    this.assertWritable();
    if (typeof mutator !== 'function') {
      throw new AgentStoreError('commit requires a mutator function.');
    }

    const prev = this.queue;
    let release;
    const next = new Promise(resolve => {
      release = resolve;
    });
    this.queue = prev.then(
      () => next,
      () => next,
    );

    await prev.catch(() => {});
    try {
      this.assertWritable();

      const expectedRevision = this.state.revision + 1;
      const draft = structuredClone(this.state);
      draft.revision = expectedRevision;

      const result = await mutator(draft);
      const proposed = result !== undefined ? result : draft;

      // Deep-clone proposed candidate before validation/save/publish so outside references
      // cannot mutate it, including nested references assigned from caller.
      const candidate = structuredClone(proposed);

      // Force revision to previous+1 and reject attempts to replace schema/version/binding/sourceFingerprint,
      // never permit returned candidate resetting revision.
      if (candidate.schema !== SCHEMA) {
        throw new AgentStoreError(`Cannot alter store schema: expected ${SCHEMA}`);
      }
      if (candidate.version !== 1) {
        throw new AgentStoreError('Cannot alter store version.');
      }
      if (candidate.binding !== this.binding) {
        throw new AgentStoreError('Cannot alter store binding provenance.');
      }
      if (candidate.sourceFingerprint !== this.sourceFingerprint) {
        throw new AgentStoreError('Cannot alter store sourceFingerprint.');
      }
      candidate.revision = expectedRevision;

      validateRunnerPairingTransition(this.state.pairing, candidate.pairing);

      validateSnapshot(candidate, this.binding, this.sourceFingerprint);

      try {
        await this.store.save(COMPOSITE_KEY, candidate);
      } catch (saveError) {
        this.poisoned = true;
        throw saveError;
      }

      this.state = candidate;
      return structuredClone(this.state);
    } finally {
      release();
    }
  }

  async close() {
    if (this.closed) return;
    const prev = this.queue;
    let release;
    const next = new Promise(resolve => {
      release = resolve;
    });
    this.queue = prev.then(
      () => next,
      () => next,
    );

    await prev.catch(() => {});
    try {
      if (this.closed) return;
      this.closed = true;
      await this.store.close();
    } finally {
      release();
    }
  }
}
