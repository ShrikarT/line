import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { AgentStore, AgentStoreError } from '../server/agent-store.mjs';

function createHex(fillByte = 0x11): string {
  return Buffer.alloc(32, fillByte).toString('hex');
}

function createHex66(fillByte = 0x11): string {
  return Buffer.alloc(33, fillByte).toString('hex');
}

async function createTempDir() {
  const parent = await mkdtemp(join(tmpdir(), 'agent-store-test-'));
  // Let the production store create its dedicated child. Windows hosted runner
  // temp roots can carry explicit unrelated ACLs, which must remain rejected.
  const root = join(parent, 'private');
  return {
    root,
    cleanup: async () => {
      assert(resolve(parent).startsWith(resolve(tmpdir()) + sep + 'agent-store-test-'));
      await rm(parent, { recursive: true, force: true });
    },
  };
}

const PASSWORD = 'test-agent-store-password-16chars';
const BINDING = createHex(0xaa);
const SOURCE_FINGERPRINT = createHex(0xbb);

test('AgentStore initializes new directory with composite state and validates initial schema', async () => {
  const { root, cleanup } = await createTempDir();
  try {
    const store = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });
    assert.equal(store.version, 1);
    assert.equal(store.binding, BINDING);
    assert.equal(store.sourceFingerprint, SOURCE_FINGERPRINT);
    assert.equal(store.revision, 0);
    assert.deepEqual(store.listTasks(), []);
    assert.deepEqual(store.listBooks(), []);
    assert.deepEqual(store.listGrants(), []);
    assert.equal(store.getPending(), null);
    assert.deepEqual(store.listReceipts(), []);
    await store.close();
  } finally {
    await cleanup();
  }
});

test('AgentStore.open rejects missing or invalid binding and sourceFingerprint', async () => {
  const { root, cleanup } = await createTempDir();
  try {
    await assert.rejects(
      AgentStore.open({
        directory: root,
        password: PASSWORD,
        binding: '',
        sourceFingerprint: SOURCE_FINGERPRINT,
      }),
      /Agent store binding must be an explicit 64-character lowercase hex provenance digest/,
    );
    await assert.rejects(
      AgentStore.open({
        directory: root,
        password: PASSWORD,
        binding: BINDING,
        sourceFingerprint: '',
      }),
      /Agent store sourceFingerprint must be an explicit 64-character lowercase hex contract source digest/,
    );
    await assert.rejects(
      AgentStore.open({
        directory: root,
        password: PASSWORD,
      } as any),
      /Agent store binding must be an explicit 64-character lowercase hex provenance digest/,
    );
  } finally {
    await cleanup();
  }
});

test('Exclusive lease prevents concurrent open on same directory', async () => {
  const { root, cleanup } = await createTempDir();
  try {
    const store1 = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });
    await assert.rejects(
      AgentStore.open({
        directory: root,
        password: PASSWORD,
        binding: BINDING,
        sourceFingerprint: SOURCE_FINGERPRINT,
      }),
      /already owned by a live process|already has an owner|cannot acquire its lease/,
    );
    await store1.close();

    // After close, opening again succeeds
    const store2 = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });
    await store2.close();
  } finally {
    await cleanup();
  }
});

test('Wrong password, mismatched binding, and mismatched sourceFingerprint are rejected on reopen', async () => {
  const { root, cleanup } = await createTempDir();
  try {
    const store = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });
    const grantId = randomUUID();
    await store.commit(draft => {
      draft.grants[grantId] = {
        grantId,
        facilityAddress: createHex(0x11),
        maxSpend: 10_000n,
        maxFee: 500n,
        allowedServices: ['line-doc-extract-v1'],
        expiresAt: Date.now() + 100_000,
        generation: 1n,
      };
    });
    await store.close();

    // Reopening with wrong password fails
    await assert.rejects(
      AgentStore.open({
        directory: root,
        password: 'wrong-passphrase-different-16chars',
        binding: BINDING,
        sourceFingerprint: SOURCE_FINGERPRINT,
      }),
      /unauthenticated or incompatible checkpoint/,
    );

    // Reopening with different binding digest fails
    const otherBinding = createHex(0xcc);
    await assert.rejects(
      AgentStore.open({
        directory: root,
        password: PASSWORD,
        binding: otherBinding,
        sourceFingerprint: SOURCE_FINGERPRINT,
      }),
      /unauthenticated or incompatible checkpoint|provenance binding/,
    );

    // Reopening with different sourceFingerprint digest fails
    const otherSourceFingerprint = createHex(0xdd);
    await assert.rejects(
      AgentStore.open({
        directory: root,
        password: PASSWORD,
        binding: BINDING,
        sourceFingerprint: otherSourceFingerprint,
      }),
      /Store sourceFingerprint does not match expected contract source fingerprint/,
    );

    // Reopening with correct credentials succeeds
    const reopened = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });
    assert.equal(reopened.revision, 1);
    assert.equal(reopened.sourceFingerprint, SOURCE_FINGERPRINT);
    await reopened.close();
  } finally {
    await cleanup();
  }
});

test('Graceful reopen and process restart preserves composite state with exact syntactic bytes, candidate, and task/book linkage', async () => {
  const { root, cleanup } = await createTempDir();
  try {
    const store = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });

    const taskId = randomUUID();
    const orderId = randomUUID();
    const facilityAddress = createHex(0x22);
    const grantId = randomUUID();
    const exactSyntacticSignedBytes = '000102030405060708090a0b0c0d0e0f'.repeat(16);
    const exactIdentifier66 = createHex66(0x33);
    const exactTxHash64 = createHex(0x44);

    const task = {
      id: taskId,
      orderId,
      grantId,
      facilityAddress,
      serviceId: 'line-doc-extract-v1',
      document: 'Sample source document text',
      objective: 'Extract citations',
      inputDigest: createHex(0x33),
      status: 'payment_pending',
      paymentStatus: 'pending',
      deliveryStatus: 'pending',
      result: null,
      receipts: [],
      error: null,
      history: [{ status: 'payment_pending', timestamp: 1_800_000_000 }],
      createdAt: 1_800_000_000,
      updatedAt: 1_800_000_000,
    };

    const book = {
      facilityAddress,
      agentSecret: createHex(0x44),
      salt: createHex(0x55),
      limit: 250_000n,
      outstanding: 50_000n,
      epoch: 1n,
      generation: 1n,
    };

    const grant = {
      grantId,
      facilityAddress,
      domain: createHex(0x66),
      agentPk: createHex(0x77),
      maxSpend: 100_000n,
      maxFee: 5_000n,
      allowedServices: ['line-doc-extract-v1'],
      expiresAt: 1_900_000_000,
      generation: 1n,
    };

    const pending = {
      id: randomUUID(),
      taskId,
      facilityAddress,
      circuit: 'draw',
      sourceFingerprint: SOURCE_FINGERPRINT,
      candidateBook: {
        facilityAddress,
        agentSecret: createHex(0x44),
        salt: createHex(0x99),
        limit: 250_000n,
        outstanding: 75_000n,
        epoch: 2n,
        generation: 1n,
      },
      candidateNote: {
        contractAddress: facilityAddress,
        amount: 25_000n,
        noteCommitment: createHex(0xaa),
      },
      identifier: exactIdentifier66,
      transaction: exactSyntacticSignedBytes,
      transactionHash: exactTxHash64,
      disposition: 'submission-attempted' as const,
    };

    const receipt = {
      circuit: 'draw',
      contractAddress: facilityAddress,
      txHash: createHex(0xcc),
      blockHeight: 3_100_050,
    };

    await store.commit(draft => {
      draft.tasks[taskId] = task;
      draft.books[facilityAddress.toLowerCase()] = book;
      draft.grants[grantId] = grant;
      draft.pending = pending;
      draft.receipts.push(receipt);
    });

    assert.equal(store.revision, 1);
    await store.close();

    // Reopen from disk (simulating graceful process restart)
    const reopened = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });
    assert.equal(reopened.revision, 1);

    const loadedTask = reopened.getTask(taskId);
    assert.deepEqual(loadedTask, task);
    assert.equal(reopened.getTaskByOrderId(orderId)?.id, taskId);

    const loadedBook = reopened.getBook(facilityAddress);
    assert.deepEqual(loadedBook, book);
    assert.equal(loadedBook?.limit, 250_000n);
    assert.equal(loadedBook?.outstanding, 50_000n);

    const loadedGrant = reopened.getGrant(grantId);
    assert.deepEqual(loadedGrant, grant);
    assert.equal(loadedGrant?.maxSpend, 100_000n);

    const loadedPending = reopened.getPending();
    assert.notEqual(loadedPending, null);
    assert.equal(loadedPending?.transaction, exactSyntacticSignedBytes);
    assert.equal(loadedPending?.identifier, exactIdentifier66);
    assert.equal(loadedPending?.transactionHash, exactTxHash64);
    assert.equal(loadedPending?.sourceFingerprint, SOURCE_FINGERPRINT);
    assert.equal(loadedPending?.candidateBook.outstanding, 75_000n);
    assert.equal(loadedPending?.candidateBook.epoch, 2n);
    assert.equal(loadedPending?.disposition, 'submission-attempted');

    const loadedReceipts = reopened.listReceipts();
    assert.equal(loadedReceipts.length, 1);
    assert.deepEqual(loadedReceipts[0], receipt);

    await reopened.close();
  } finally {
    await cleanup();
  }
});

test('Abrupt child process termination and recovery reclaims dead process lease and preserves state', async () => {
  const { root, cleanup } = await createTempDir();
  try {
    const taskId = randomUUID();
    const facilityAddress = createHex(0x25);

    // Spawn a child process to open store, commit a record, and exit immediately without close()
    const script = `
      import { AgentStore } from './server/agent-store.mjs';
      const store = await AgentStore.open({
        directory: ${JSON.stringify(root)},
        password: ${JSON.stringify(PASSWORD)},
        binding: ${JSON.stringify(BINDING)},
        sourceFingerprint: ${JSON.stringify(SOURCE_FINGERPRINT)}
      });
      await store.commit(draft => {
        draft.tasks[${JSON.stringify(taskId)}] = {
          id: ${JSON.stringify(taskId)},
          orderId: ${JSON.stringify(randomUUID())},
          grantId: ${JSON.stringify(randomUUID())},
          facilityAddress: ${JSON.stringify(facilityAddress)},
          serviceId: 'line-doc-extract-v1',
          document: 'child doc',
          objective: 'child obj',
          inputDigest: ${JSON.stringify(createHex(0x55))},
          status: 'queued',
          paymentStatus: 'unpaid',
          deliveryStatus: 'pending',
          result: null,
          receipts: [],
          history: [],
          createdAt: 1000,
          updatedAt: 1000
        };
      });
      // Abruptly exit without calling store.close(), leaving lease file owned by this PID
      process.exit(0);
    `;

    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
        windowsHide: true,
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Child exited with code ${code}`));
      });
    });

    // Parent process reopens the store; EncryptedCheckoutStore detects dead owner PID and reclaims lease
    const parentStore = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });
    assert.equal(parentStore.revision, 1);
    const recoveredTask = parentStore.getTask(taskId);
    assert.notEqual(recoveredTask, null);
    assert.equal(recoveredTask?.id, taskId);

    await parentStore.close();
  } finally {
    await cleanup();
  }
});

test('Concurrent commit calls are serialized and increment revision monotonically', async () => {
  const { root, cleanup } = await createTempDir();
  try {
    const store = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });

    const count = 5;
    const taskIds: string[] = [];

    const promises = Array.from({ length: count }, (_, i) => {
      const taskId = randomUUID();
      taskIds.push(taskId);
      return store.commit(draft => {
        draft.tasks[taskId] = {
          id: taskId,
          orderId: randomUUID(),
          grantId: randomUUID(),
          facilityAddress: createHex(0x10 + i),
          serviceId: 'text-metrics',
          document: `doc-${i}`,
          objective: `obj-${i}`,
          inputDigest: createHex(0x20 + i),
          status: 'queued',
          paymentStatus: 'unpaid',
          deliveryStatus: 'pending',
          result: null,
          receipts: [],
          history: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      });
    });

    await Promise.all(promises);

    assert.equal(store.revision, count);
    assert.equal(store.listTasks().length, count);

    for (const id of taskIds) {
      assert.notEqual(store.getTask(id), null);
    }

    await store.close();
  } finally {
    await cleanup();
  }
});

test('Commit failure preserves last committed memory and failure during write poisons store', async () => {
  const { root, cleanup } = await createTempDir();
  try {
    const store = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });

    const initialTask = {
      id: randomUUID(),
      orderId: randomUUID(),
      grantId: randomUUID(),
      facilityAddress: createHex(0x33),
      serviceId: 'text-metrics',
      document: 'initial doc',
      objective: 'initial obj',
      inputDigest: createHex(0x44),
      status: 'queued',
      paymentStatus: 'unpaid',
      deliveryStatus: 'pending',
      result: null,
      receipts: [],
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await store.commit(draft => {
      draft.tasks[initialTask.id] = initialTask;
    });

    assert.equal(store.revision, 1);

    // 1. Mutator throws: memory is untouched
    await assert.rejects(
      store.commit(() => {
        throw new Error('User mutator error');
      }),
      /User mutator error/,
    );
    assert.equal(store.revision, 1);
    assert.equal(store.listTasks().length, 1);

    // 2. Validation error: invariant violation (paid-but-undelivered marked completed)
    await assert.rejects(
      store.commit(draft => {
        const badTask = {
          ...initialTask,
          id: randomUUID(),
          orderId: randomUUID(),
          paymentStatus: 'paid',
          deliveryStatus: 'undelivered',
          status: 'completed',
        };
        draft.tasks[badTask.id] = badTask;
      }),
      /paid-but-undelivered and cannot be completed/,
    );
    assert.equal(store.revision, 1);
    assert.equal(store.listTasks().length, 1);

    // 3. Failure during disk save: memory is not promoted and store becomes poisoned for writes
    const originalSave = (store as any).store.save;
    (store as any).store.save = async () => {
      throw new Error('Injected disk power-loss failure');
    };

    await assert.rejects(
      store.commit(draft => {
        const newTask = {
          ...initialTask,
          id: randomUUID(),
          orderId: randomUUID(),
        };
        draft.tasks[newTask.id] = newTask;
      }),
      /Injected disk power-loss failure/,
    );

    // Verify last committed memory was NOT promoted
    assert.equal(store.revision, 1);
    assert.equal(store.listTasks().length, 1);

    // Verify that subsequent writes fail closed (poisoned)
    (store as any).store.save = originalSave;
    await assert.rejects(
      store.commit(draft => {
        draft.revision += 1;
      }),
      /poisoned by a previous persistence failure/,
    );

    // Verify reopen from disk recovers the intact previous state
    await store.close();
    const reopened = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });
    assert.equal(reopened.revision, 1);
    assert.equal(reopened.listTasks().length, 1);
    assert.equal(reopened.getTask(initialTask.id)?.id, initialTask.id);
    await reopened.close();
  } finally {
    await cleanup();
  }
});

test('Retained mutator references and returned candidate mutation cannot modify memory or disk', async () => {
  const { root, cleanup } = await createTempDir();
  try {
    const store = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });

    const externalTask = {
      id: randomUUID(),
      orderId: randomUUID(),
      grantId: randomUUID(),
      facilityAddress: createHex(0x55),
      serviceId: 'text-metrics',
      document: 'original text',
      objective: 'original objective',
      inputDigest: createHex(0x66),
      status: 'queued',
      paymentStatus: 'unpaid',
      deliveryStatus: 'pending',
      result: null,
      receipts: [],
      history: [],
      createdAt: 1000,
      updatedAt: 1000,
    };

    // Commit assigns an external reference into draft
    await store.commit(draft => {
      draft.tasks[externalTask.id] = externalTask;
    });

    // Caller mutates its external reference AFTER commit
    externalTask.document = 'MUTATED TEXT';
    externalTask.status = 'failed';

    // Verify store in-memory state is unaffected
    assert.equal(store.getTask(externalTask.id)?.document, 'original text');
    assert.equal(store.getTask(externalTask.id)?.status, 'queued');

    // Mutator returns a new candidate object; caller retains reference and mutates it
    const returnedBook = {
      facilityAddress: createHex(0x77),
      agentSecret: createHex(0x88),
      salt: createHex(0x99),
      limit: 100_000n,
      outstanding: 10_000n,
      epoch: 1n,
      generation: 1n,
    };

    await store.commit(draft => {
      return {
        ...draft,
        books: {
          ...draft.books,
          [returnedBook.facilityAddress.toLowerCase()]: returnedBook,
        },
      };
    });

    returnedBook.outstanding = 999_999n;
    assert.equal(store.getBook(returnedBook.facilityAddress)?.outstanding, 10_000n);

    // Verify disk state on reopen is also completely intact
    await store.close();
    const reopened = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });
    assert.equal(reopened.getTask(externalTask.id)?.document, 'original text');
    assert.equal(reopened.getBook(returnedBook.facilityAddress)?.outstanding, 10_000n);
    await reopened.close();
  } finally {
    await cleanup();
  }
});

test('Monotonic revision cannot be reset or bypassed by mutator', async () => {
  const { root, cleanup } = await createTempDir();
  try {
    const store = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });
    assert.equal(store.revision, 0);

    // Mutator tries to reset revision to 0 or arbitrary number
    await store.commit(draft => {
      (draft as any).revision = 0;
    });
    // Store forces revision to previous + 1
    assert.equal(store.revision, 1);

    await store.commit(draft => {
      return {
        ...draft,
        revision: 999,
      };
    });
    // Store forces revision to previous + 1
    assert.equal(store.revision, 2);

    // Mutator attempts to alter schema or binding: rejected
    await assert.rejects(
      store.commit(draft => {
        return {
          ...draft,
          schema: 'line:malicious-schema/v1',
        };
      }),
      /Cannot alter store schema/,
    );
    assert.equal(store.revision, 2);

    await assert.rejects(
      store.commit(draft => {
        return {
          ...draft,
          binding: createHex(0xee),
        };
      }),
      /Cannot alter store binding provenance/,
    );
    assert.equal(store.revision, 2);

    await assert.rejects(
      store.commit(draft => {
        return {
          ...draft,
          sourceFingerprint: createHex(0xee),
        };
      }),
      /Cannot alter store sourceFingerprint/,
    );
    assert.equal(store.revision, 2);

    await store.close();
  } finally {
    await cleanup();
  }
});

test('Reject malformed pending, missing task linkage, and incomplete candidates', async () => {
  const { root, cleanup } = await createTempDir();
  try {
    const store = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });
    const taskId = randomUUID();
    const facilityAddress = createHex(0x12);

    await store.commit(draft => {
      draft.tasks[taskId] = {
        id: taskId,
        orderId: randomUUID(),
        grantId: randomUUID(),
        facilityAddress,
        serviceId: 'text-metrics',
        document: 'doc',
        objective: 'obj',
        inputDigest: createHex(0x34),
        status: 'payment_pending',
        paymentStatus: 'pending',
        deliveryStatus: 'pending',
        result: null,
        receipts: [],
        history: [],
        createdAt: 1000,
        updatedAt: 1000,
      };
    });

    const validCandidateBook = {
      facilityAddress,
      agentSecret: createHex(0x44),
      salt: createHex(0x55),
      limit: 100_000n,
      outstanding: 20_000n,
      epoch: 1n,
      generation: 1n,
    };
    const validCandidateNote = {
      contractAddress: facilityAddress,
      amount: 20_000n,
      noteCommitment: createHex(0x66),
    };

    // 1. Pending references non-existent task
    await assert.rejects(
      store.commit(draft => {
        draft.pending = {
          id: randomUUID(),
          taskId: randomUUID(), // non-existent
          facilityAddress,
          circuit: 'draw',
          sourceFingerprint: SOURCE_FINGERPRINT,
          candidateBook: validCandidateBook,
          candidateNote: validCandidateNote,
          identifier: null,
          transaction: null,
          transactionHash: null,
          disposition: 'prepared',
        };
      }),
      /references non-existent task/,
    );

    // 2. Pending facilityAddress mismatch with linked task
    await assert.rejects(
      store.commit(draft => {
        draft.pending = {
          id: randomUUID(),
          taskId,
          facilityAddress: createHex(0x99), // mismatch
          circuit: 'draw',
          sourceFingerprint: SOURCE_FINGERPRINT,
          candidateBook: validCandidateBook,
          candidateNote: validCandidateNote,
          identifier: null,
          transaction: null,
          transactionHash: null,
          disposition: 'prepared',
        };
      }),
      /facilityAddress must match linked task/,
    );

    // 3. prepared pending operation with non-null signed fields
    await assert.rejects(
      store.commit(draft => {
        draft.pending = {
          id: randomUUID(),
          taskId,
          facilityAddress,
          circuit: 'draw',
          sourceFingerprint: SOURCE_FINGERPRINT,
          candidateBook: validCandidateBook,
          candidateNote: validCandidateNote,
          identifier: createHex66(0x77), // illegal for prepared
          transaction: null,
          transactionHash: null,
          disposition: 'prepared',
        };
      }),
      /prepared pending operation must have null identifier/,
    );

    // 4. signed pending operation with malformed identifier (not 66 hex)
    await assert.rejects(
      store.commit(draft => {
        draft.pending = {
          id: randomUUID(),
          taskId,
          facilityAddress,
          circuit: 'draw',
          sourceFingerprint: SOURCE_FINGERPRINT,
          candidateBook: validCandidateBook,
          candidateNote: validCandidateNote,
          identifier: 'malformed-tx-id',
          transaction: '01020304',
          transactionHash: createHex(0x88),
          disposition: 'signed',
        };
      }),
      /requires 66-character lowercase hex identifier/,
    );

    // 5. signed pending operation with odd transaction hex length
    await assert.rejects(
      store.commit(draft => {
        draft.pending = {
          id: randomUUID(),
          taskId,
          facilityAddress,
          circuit: 'draw',
          sourceFingerprint: SOURCE_FINGERPRINT,
          candidateBook: validCandidateBook,
          candidateNote: validCandidateNote,
          identifier: createHex66(0x77),
          transaction: '0102030', // odd length
          transactionHash: createHex(0x88),
          disposition: 'signed',
        };
      }),
      /requires bounded even lowercase hex transaction bytes/,
    );

    // 6. Missing candidateBook
    await assert.rejects(
      store.commit(draft => {
        draft.pending = {
          id: randomUUID(),
          taskId,
          facilityAddress,
          circuit: 'draw',
          sourceFingerprint: SOURCE_FINGERPRINT,
          candidateBook: null as any,
          candidateNote: validCandidateNote,
          identifier: null,
          transaction: null,
          transactionHash: null,
          disposition: 'prepared',
        };
      }),
      /requires a candidateBook record/,
    );

    await store.close();
  } finally {
    await cleanup();
  }
});

test('Close awaits admitted in-flight commit before releasing lease', async () => {
  const { root, cleanup } = await createTempDir();
  try {
    const store = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });

    let commitCompleted = false;
    const commitPromise = store.commit(async draft => {
      // Simulate asynchronous work / persistence
      await new Promise(r => setTimeout(r, 100));
      const grantId = randomUUID();
      draft.grants[grantId] = {
        grantId,
        facilityAddress: createHex(0x11),
        maxSpend: 10_000n,
        maxFee: 500n,
        allowedServices: ['line-doc-extract-v1'],
        expiresAt: Date.now() + 100_000,
        generation: 1n,
      };
      commitCompleted = true;
    });

    // Close requested while commit is in-flight
    const closePromise = store.close();

    await Promise.all([commitPromise, closePromise]);
    assert.equal(commitCompleted, true);

    // Subsequent commit is rejected because store is closed
    await assert.rejects(
      store.commit(d => {
        d.revision += 1;
      }),
      /Agent store is closed/,
    );

    // Reopening confirms that the in-flight commit was durably saved
    const reopened = await AgentStore.open({
      directory: root,
      password: PASSWORD,
      binding: BINDING,
      sourceFingerprint: SOURCE_FINGERPRINT,
    });
    assert.equal(reopened.revision, 1);
    assert.equal(reopened.listGrants().length, 1);
    await reopened.close();
  } finally {
    await cleanup();
  }
});
