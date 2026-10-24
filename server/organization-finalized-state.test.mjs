import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '@midnight-ntwrk/ledger-v8';
import * as R from '@midnight-ntwrk/compact-runtime';
import { finalizedFacilityStateReader, CIRCUITS, loadOrganizationReleaseArtifacts } from './organization-finalized-state.mjs';
import { OrganizationAuthError } from './organization-auth.mjs';
import {
  validateFinalizedFacilityStateEvidence,
  fetchFinalizedFacilityState,
  FINALIZED_FACILITY_STATE_PATH,
} from '../src/lib/organization/finalized-state.ts';
import { EXPIRED_OPENING as policy } from '../src/lib/organization/expired-opening-policy.ts';
import { ledger, Contract } from '../contracts/managed/organization/contract/index.js';
import { blankPrivate, WITNESSES } from '../src/lib/line/compact-harness.ts';
import { issuerPublicKey, merchantPublicKey, pad32, toHex } from '../src/lib/line/encoding.ts';

const closedStateHex = readFileSync(new URL('../tests/fixtures/organization-closed-state.hex', import.meta.url), 'utf8').trim();
const stateObj = L.ContractState.deserialize(Buffer.from(closedStateHex, 'hex'));
const compactObj = R.ContractState.deserialize(Buffer.from(closedStateHex, 'hex'));
const bookObj = ledger(compactObj.data);
const facilityOwnerHex = toHex(bookObj.issuerPayoutRecipient.bytes).toLowerCase();
const facilityDomainHex = toHex(bookObj.contractDomain).toLowerCase();
const facilityAgentHex = toHex(bookObj.identityCommit).toLowerCase();
const facilityGeneration = bookObj.lineGeneration;
const facilityCommitmentHex = toHex(bookObj.lineCommit).toLowerCase();

// Build map of actual verifier keys from the fixture
const verifiersMap = new Map();
for (const name of CIRCUITS) {
  verifiersMap.set(name, stateObj.operation(name).verifierKey);
}
const dummyRelease = {
  inputs: { source: { sha256: policy.sourceFingerprint } },
};

function createMockTransport({
  head = 'aa'.repeat(32),
  height = 3105000,
  timestampMs = 1792764600000,
  stateHex = closedStateHex,
  genesisHash = policy.genesisHash,
  runtimeSpecVersion = policy.runtimeSpecVersion,
  indexerDisagreement = false,
  indexerTimestamp = timestampMs,
  timestampKey = policy.timestampKey,
  simulateConnectionFailure = false,
} = {}) {
  const rpcCalls = [];
  const indexerCalls = [];
  const storage = Buffer.alloc(8);
  storage.writeBigUInt64LE(BigInt(timestampMs));

  const fetchImpl = async (url, options) => {
    if (options?.signal?.aborted) {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (simulateConnectionFailure) {
      throw new Error('Connection refused at https://internal-secret-node.example');
    }
    const body = JSON.parse(options.body);
    if (url.includes('/rpc')) {
      rpcCalls.push(body);
      const { method, params } = body;
      let result;
      if (method === 'chain_getFinalizedHead') result = '0x' + head;
      else if (method === 'chain_getHeader') result = { number: '0x' + height.toString(16) };
      else if (method === 'chain_getBlockHash') result = '0x' + (params[0] === 0 ? genesisHash : '00'.repeat(32));
      else if (method === 'state_getRuntimeVersion') result = { specName: 'midnight', specVersion: runtimeSpecVersion };
      else if (method === 'midnight_contractState') result = '0x' + stateHex;
      else if (method === 'state_getStorage') result = '0x' + storage.toString('hex');
      else throw new Error('Unexpected RPC method: ' + method);

      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/graphql')) {
      indexerCalls.push(body);
      const data = indexerDisagreement
        ? { block: { hash: head, height: height - 1, timestamp: indexerTimestamp } }
        : { block: { hash: head, height, timestamp: indexerTimestamp } };

      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Unknown URL: ' + url);
  };

  return { fetchImpl, rpcCalls, indexerCalls };
}

test('finalizedFacilityStateReader successfully reads and verifies pinned facility state at exact head with numeric indexer timestamp', async () => {
  const head = 'ab'.repeat(32);
  const height = 3105123;
  const timestampMs = 1792764600000;
  const facilityAddress = 'fe'.repeat(32);

  const mock = createMockTransport({ head, height, timestampMs });
  const reader = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: mock.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });

  const evidence = await reader({
    address: facilityAddress,
    sessionRecipient: facilityOwnerHex,
  });

  assert.equal(evidence.schema, 'line:finalized-facility-state/v1');
  assert.equal(evidence.networkId, 'preprod');
  assert.equal(evidence.facilityAddress, facilityAddress);
  assert.equal(evidence.finalized.hash, head);
  assert.equal(evidence.finalized.height, height);
  assert.equal(evidence.finalized.timestampMs, timestampMs);
  assert.equal(typeof evidence.finalized.timestampMs, 'number');
  assert.equal(evidence.finalized.state, closedStateHex);
  assert.equal(evidence.genesisHash, policy.genesisHash);
  assert.equal(evidence.runtimeSpecVersion, policy.runtimeSpecVersion);

  assert.equal(mock.rpcCalls.length, 6);
  assert.equal(mock.rpcCalls[0].method, 'chain_getFinalizedHead');
  assert.deepEqual(mock.rpcCalls[1].params, ['0x' + head]);
  assert.deepEqual(mock.rpcCalls[2].params, [0]);
  assert.deepEqual(mock.rpcCalls[3].params, ['0x' + head]);
  assert.deepEqual(mock.rpcCalls[4].params, [facilityAddress, '0x' + head]);
  assert.deepEqual(mock.rpcCalls[5].params, [policy.timestampKey, '0x' + head]);
  assert.equal(mock.indexerCalls.length, 1);
});

test('finalizedFacilityStateReader fails closed when authenticated wallet does not own facility', async () => {
  const mock = createMockTransport();
  const reader = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: mock.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });

  const foreignWallet = '11'.repeat(32);
  await assert.rejects(
    () => reader({ address: 'cc'.repeat(32), sessionRecipient: foreignWallet }),
    (err) => {
      assert(err instanceof OrganizationAuthError);
      assert.equal(err.status, 403);
      assert.equal(err.message, 'This wallet does not own the selected organization facility.');
      return true;
    }
  );
});

test('finalizedFacilityStateReader fails closed on Preprod genesis mismatch', async () => {
  const mock = createMockTransport({ genesisHash: 'bad'.padEnd(64, '0') });
  const reader = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: mock.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });

  await assert.rejects(
    () => reader({ address: 'cc'.repeat(32), sessionRecipient: facilityOwnerHex }),
    /Preprod genesis mismatch/
  );
});

test('finalizedFacilityStateReader fails closed on runtime version mismatch', async () => {
  const mock = createMockTransport({ runtimeSpecVersion: 9999999 });
  const reader = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: mock.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });

  await assert.rejects(
    () => reader({ address: 'cc'.repeat(32), sessionRecipient: facilityOwnerHex }),
    /Runtime mismatch/
  );
});

test('finalizedFacilityStateReader fails closed when node and indexer disagree on finalized block (hash, height, or timestamp)', async () => {
  // Height disagreement
  const mockHeight = createMockTransport({ indexerDisagreement: true });
  const readerHeight = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: mockHeight.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });
  await assert.rejects(
    () => readerHeight({ address: 'cc'.repeat(32), sessionRecipient: facilityOwnerHex }),
    /Node and indexer disagree/
  );

  // Timestamp disagreement (numeric mismatch)
  const mockTime = createMockTransport({ timestampMs: 1792764600000, indexerTimestamp: 1792764600999 });
  const readerTime = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: mockTime.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });
  await assert.rejects(
    () => readerTime({ address: 'cc'.repeat(32), sessionRecipient: facilityOwnerHex }),
    /Node and indexer disagree/
  );
});

test('finalizedFacilityStateReader fails closed on extra or unknown contract operations', async () => {
  const alteredState = L.ContractState.deserialize(Buffer.from(closedStateHex, 'hex'));
  alteredState.setOperation('unknownOp', alteredState.operation('registerMerchant'));
  const alteredHex = Buffer.from(alteredState.serialize()).toString('hex');

  const mock = createMockTransport({ stateHex: alteredHex });
  const reader = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: mock.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });

  await assert.rejects(
    () => reader({ address: 'cc'.repeat(32), sessionRecipient: facilityOwnerHex }),
    /Facility operations do not match supported release circuits/
  );
});

test('finalizedFacilityStateReader fails closed when any circuit verifier key does not match release', async () => {
  const corruptedVerifiers = new Map(verifiersMap);
  const badKey = new Uint8Array(corruptedVerifiers.get('registerMerchant'));
  badKey[0] ^= 0xff;
  corruptedVerifiers.set('registerMerchant', badKey);

  const mock = createMockTransport();
  const reader = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: mock.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: corruptedVerifiers,
  });

  await assert.rejects(
    () => reader({ address: 'cc'.repeat(32), sessionRecipient: facilityOwnerHex }),
    /Verifier key mismatch for circuit: registerMerchant/
  );
});

test('finalizedFacilityStateReader enforces raw byte and hex length bounds', async () => {
  const hugeHex = closedStateHex.padEnd(524290, '00');
  const mock = createMockTransport({ stateHex: hugeHex });
  const reader = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: mock.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });

  await assert.rejects(
    () => reader({ address: 'cc'.repeat(32), sessionRecipient: facilityOwnerHex }),
    /Contract state hex length exceeds maximum limit/
  );
});

test('finalizedFacilityStateReader scrubs internal errors and never leaks provider credentials or URLs', async () => {
  const mock = createMockTransport({ simulateConnectionFailure: true });
  const reader = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'https://internal-secret-node.example/rpc?token=super-secret-credential',
      indexerUri: 'https://internal-secret-node.example/graphql?token=super-secret-credential',
    },
    fetchImpl: mock.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });

  await assert.rejects(
    () => reader({ address: 'cc'.repeat(32), sessionRecipient: facilityOwnerHex }),
    (err) => {
      assert(!err.message.includes('super-secret-credential'));
      assert(!err.message.includes('internal-secret-node.example'));
      assert.equal(err.message, 'Provider connection failed.');
      return true;
    }
  );
});

test('finalizedFacilityStateReader honors caller abort signal', async () => {
  const controller = new AbortController();
  controller.abort();

  const mock = createMockTransport();
  const reader = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: mock.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });

  await assert.rejects(
    () => reader({ address: 'cc'.repeat(32), sessionRecipient: facilityOwnerHex, signal: controller.signal }),
    (err) => {
      assert(err.name === 'AbortError' || err.message.includes('aborted'));
      return true;
    }
  );
});

test('validateFinalizedFacilityStateEvidence independently verifies evidence, canonical state, and all six exact pins', async () => {
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };

  const expectedPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  const verifierKey = async (name) => verifiersMap.get(name);
  const result = await validateFinalizedFacilityStateEvidence(evidence, verifierKey, expectedPins, {
    now: () => 1792764610000,
    maxClockDriftMs: 60000,
    maxStalenessMs: 60000,
  });

  assert.equal(result.evidence.schema, 'line:finalized-facility-state/v1');
  assert.equal(result.decoded.lineGeneration, facilityGeneration);
  assert.equal(result.decoded.contractDomain, facilityDomainHex);
  assert.equal(result.decoded.identityCommit, facilityAgentHex);
  assert.equal(result.decoded.lineCommit, facilityCommitmentHex);
  assert.equal(result.decoded.issuerPayoutRecipient, facilityOwnerHex);
  assert.equal(result.decoded.maintenanceCounter, Number(stateObj.maintenanceAuthority.counter));
  assert(Object.isFrozen(result.evidence));
  assert(Object.isFrozen(result.evidence.finalized));
});

test('validateFinalizedFacilityStateEvidence rejects missing mandatory pin fields before any await', async () => {
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };

  const basePins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  let verifierInvocations = 0;
  const verifierKey = async () => {
    verifierInvocations++;
    return new Uint8Array(32);
  };

  for (const field of ['owner', 'facilityAddress', 'domain', 'agent', 'generation', 'commitment']) {
    const incompletePins = { ...basePins };
    delete incompletePins[field];

    await assert.rejects(
      () => validateFinalizedFacilityStateEvidence(evidence, verifierKey, incompletePins),
      new RegExp(`Missing mandatory field "${field}" in expected pins`)
    );
  }
  assert.equal(verifierInvocations, 0);
});

test('validateFinalizedFacilityStateEvidence rejects unknown fields on expected pins', async () => {
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };

  const pinsWithExtra = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
    unauthorizedField: 'attack',
  };

  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, async () => new Uint8Array(32), pinsWithExtra),
    /Unknown property "unauthorizedField" in expected pins/
  );
});

test('validateFinalizedFacilityStateEvidence rejects getters on expected pins and evidence with zero invocations', async () => {
  let pinGetterInvocations = 0;
  const pinsWithGetter = {
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };
  Object.defineProperty(pinsWithGetter, 'owner', {
    get() {
      pinGetterInvocations++;
      return facilityOwnerHex;
    },
    enumerable: true,
    configurable: true,
  });

  const validEvidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };

  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(validEvidence, async () => new Uint8Array(32), pinsWithGetter),
    /Getters\/setters are not permitted on "owner" in expected pins/
  );
  assert.equal(pinGetterInvocations, 0);

  let evidenceGetterInvocations = 0;
  const evidenceWithGetter = { ...validEvidence };
  Object.defineProperty(evidenceWithGetter, 'facilityAddress', {
    get() {
      evidenceGetterInvocations++;
      return 'aa'.repeat(32);
    },
    enumerable: true,
    configurable: true,
  });

  const validPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidenceWithGetter, async () => new Uint8Array(32), validPins),
    /Getters\/setters are not permitted on "facilityAddress" in evidence/
  );
  assert.equal(evidenceGetterInvocations, 0);
});

test('validateFinalizedFacilityStateEvidence rejects malformed or wrong-typed pin fields without coercion', async () => {
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };

  const validPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  // Wrong type: number for owner
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, async () => new Uint8Array(32), { ...validPins, owner: 12345 }),
    /A valid 64-hex expected owner address is required/
  );

  // String for generation (coercion rejected)
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, async () => new Uint8Array(32), { ...validPins, generation: '1' }),
    /Line generation must be a number or bigint/
  );

  // Negative generation
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, async () => new Uint8Array(32), { ...validPins, generation: -1 }),
    /Line generation must be a non-negative safe integer/
  );

  // Non-hex string
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, async () => new Uint8Array(32), { ...validPins, domain: 'not-hex' }),
    /Expected contract domain must be a 64-hex string/
  );
});

test('validateFinalizedFacilityStateEvidence rejects malformed or wrong-typed evidence fields', async () => {
  const validPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  const baseEvidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: 0,
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };

  // Unknown top-level field
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence({ ...baseEvidence, injectedField: true }, async () => new Uint8Array(32), validPins),
    /Unknown property "injectedField" in evidence/
  );

  // Unknown field in finalized block
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence({ ...baseEvidence, finalized: { ...baseEvidence.finalized, rogue: 1 } }, async () => new Uint8Array(32), validPins),
    /Unknown property "rogue" in finalized block details/
  );
});

test('validateFinalizedFacilityStateEvidence enforces 5-minute hard tolerance maximums on options', async () => {
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };

  const expectedPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  // Rejects clock drift > 300,000 ms (5 minutes)
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, async () => new Uint8Array(32), expectedPins, {
      maxClockDriftMs: 300001,
    }),
    /Clock drift tolerance must be between 0 and 300000 ms/
  );

  // Rejects staleness tolerance > 300,000 ms (5 minutes)
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, async () => new Uint8Array(32), expectedPins, {
      maxStalenessMs: 300001,
    }),
    /Clock staleness tolerance must be between 0 and 300000 ms/
  );

  // Rejects negative tolerance
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, async () => new Uint8Array(32), expectedPins, {
      maxClockDriftMs: -1,
    }),
    /Clock drift tolerance must be between 0 and 300000 ms/
  );
});

test('validateFinalizedFacilityStateEvidence rejects stale evidence older than maxStalenessMs', async () => {
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };

  const expectedPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  // Timestamp is 10 minutes behind now, while maxStaleness is 5 minutes (300,000 ms)
  const now = 1792764600000 + 600000;
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, async () => new Uint8Array(32), expectedPins, {
      now: () => now,
      maxStalenessMs: 300000,
    }),
    /Finalized block timestamp is stale/
  );
});

test('validateFinalizedFacilityStateEvidence rejects future timestamps beyond clock drift tolerance', async () => {
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };

  const expectedPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  // Timestamp is 6 minutes in future, maxClockDrift is 5 minutes (300,000 ms)
  const now = 1792764600000 - 360000;
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, async () => new Uint8Array(32), expectedPins, {
      now: () => now,
      maxClockDriftMs: 300000,
    }),
    /Finalized block timestamp is too far in the future/
  );
});

test('validateFinalizedFacilityStateEvidence fails closed on delayed freshness expiration during async verification', async () => {
  const timestampMs = 1792764600000;
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs,
      state: closedStateHex,
    },
  };

  const expectedPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  // At start, timestamp is exactly 4 minutes 50 seconds old (<= 5 minutes staleness limit)
  let currentTime = timestampMs + 290000;
  const now = () => currentTime;

  const verifierKey = async (name) => {
    // Clock advances during async verification across the 12 circuit checks!
    currentTime += 2000; // 12 * 2000 = 24,000 ms, total elapsed becomes 314,000 ms (> 300,000 ms)
    return verifiersMap.get(name);
  };

  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, verifierKey, expectedPins, {
      now,
      maxStalenessMs: 300000,
    }),
    /Finalized block timestamp became stale during verification/
  );
});

test('validateFinalizedFacilityStateEvidence captures fields synchronously and is immune to caller mutations during await', async () => {
  const mutableEvidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };

  const expectedPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  const verifierKey = async (name) => {
    // Malicious caller attempts mutation during async await
    mutableEvidence.facilityAddress = 'dead'.repeat(16);
    mutableEvidence.genesisHash = '00'.repeat(32);
    mutableEvidence.finalized.hash = 'fe'.repeat(32);
    mutableEvidence.finalized.height = 1;
    mutableEvidence.finalized.timestampMs = 999;
    mutableEvidence.finalized.state = '00'.repeat(32);
    return verifiersMap.get(name);
  };

  const result = await validateFinalizedFacilityStateEvidence(mutableEvidence, verifierKey, expectedPins, {
    now: () => 1792764605000,
    maxClockDriftMs: 60000,
    maxStalenessMs: 60000,
  });

  // Returned evidence retains the synchronous captured snapshot, completely unmutated
  assert.equal(result.evidence.facilityAddress, 'aa'.repeat(32));
  assert.equal(result.evidence.genesisHash, policy.genesisHash);
  assert.equal(result.evidence.finalized.hash, 'bb'.repeat(32));
  assert.equal(result.evidence.finalized.height, 3105000);
  assert.equal(result.evidence.finalized.timestampMs, 1792764600000);
  assert.equal(result.evidence.finalized.state, closedStateHex);
});

test('validateFinalizedFacilityStateEvidence immediately deep copies verifier keys returned by provider', async () => {
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };

  const expectedPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  // Provider returns a buffer and then clears it on the next tick
  const verifierKey = async (name) => {
    const original = verifiersMap.get(name);
    const mutableBuf = new Uint8Array(original);
    setTimeout(() => {
      mutableBuf.fill(0);
    }, 1);
    return mutableBuf;
  };

  const result = await validateFinalizedFacilityStateEvidence(evidence, verifierKey, expectedPins, {
    now: () => 1792764605000,
    maxClockDriftMs: 60000,
    maxStalenessMs: 60000,
  });
  assert(result);
});

test('validateFinalizedFacilityStateEvidence fails closed on mismatched domain, agent, generation, or commitment', async () => {
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };

  const basePins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  const verifierKey = async (name) => verifiersMap.get(name);

  const clockOpt = { now: () => 1792764605000 };

  // Mismatched domain
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, verifierKey, { ...basePins, domain: '00'.repeat(32) }, clockOpt),
    /Contract domain does not match expected domain/
  );

  // Mismatched agent
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, verifierKey, { ...basePins, agent: '00'.repeat(32) }, clockOpt),
    /Agent identity does not match expected agent/
  );

  // Mismatched generation
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, verifierKey, { ...basePins, generation: 999n }, clockOpt),
    /Line generation does not match expected generation/
  );

  // Mismatched commitment
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, verifierKey, { ...basePins, commitment: '00'.repeat(32) }, clockOpt),
    /Line commitment does not match expected commitment/
  );
});

test('fetchFinalizedFacilityState uses fixed same-origin path without arbitrary origin and enforces 1MB stream bounds', async () => {
  const requestedUrls = [];
  const requestedOptions = [];

  const mockFetch = async (url, options) => {
    requestedUrls.push(url);
    requestedOptions.push(options);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ schema: 'line:finalized-facility-state/v1' })));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const facilityAddress = 'aa'.repeat(32);
  const evidence = await fetchFinalizedFacilityState(facilityAddress, { fetchImpl: mockFetch });

  // Verifies fixed relative same-origin path and credentials/mode/redirect settings
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0], FINALIZED_FACILITY_STATE_PATH);
  assert.equal(requestedOptions[0].method, 'POST');
  assert.equal(requestedOptions[0].credentials, 'same-origin');
  assert.equal(requestedOptions[0].mode, 'same-origin');
  assert.equal(requestedOptions[0].redirect, 'error');
  assert.deepEqual(JSON.parse(requestedOptions[0].body), { address: facilityAddress });
  assert.equal(evidence.schema, 'line:finalized-facility-state/v1');

  // Enforces 1 MB streaming limit
  const hugeStreamFetch = async () => {
    const chunk = new Uint8Array(64 * 1024);
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (sent > 1024 * 1024 + 65536) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
        sent += chunk.length;
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await assert.rejects(
    () => fetchFinalizedFacilityState(facilityAddress, { fetchImpl: hugeStreamFetch }),
    /Finalized state response exceeded maximum size limit/
  );
});

test('fetchFinalizedFacilityState generically sanitizes stream read errors and abort reasons', async () => {
  const facilityAddress = 'aa'.repeat(32);

  // Abort handling
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => fetchFinalizedFacilityState(facilityAddress, { signal: controller.signal }),
    /Finalized facility state request aborted/
  );

  // Stream read error
  const streamErrorFetch = async () => {
    const stream = new ReadableStream({
      pull(controller) {
        controller.error(new Error('Internal TCP connection reset at node-cluster.internal:9944'));
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await assert.rejects(
    () => fetchFinalizedFacilityState(facilityAddress, { fetchImpl: streamErrorFetch }),
    (err) => {
      assert(!err.message.includes('node-cluster.internal'));
      assert.equal(err.message, 'Failed to read finalized facility state stream');
      return true;
    }
  );
});

test('validateFinalizedFacilityStateEvidence captures options.now synchronously and is immune to options.now mutation during await', async () => {
  const timestampMs = 1792764600000;
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs,
      state: closedStateHex,
    },
  };
  const expectedPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };
  const options = {
    now: () => timestampMs + 1000,
    maxClockDriftMs: 60000,
    maxStalenessMs: 60000,
  };

  const verifierKey = async (name) => {
    // Attempt mutation during async await
    options.now = () => {
      throw new Error('Mutated now function should never be called!');
    };
    return verifiersMap.get(name);
  };

  const result = await validateFinalizedFacilityStateEvidence(evidence, verifierKey, expectedPins, options);
  assert.equal(result.evidence.facilityAddress, 'aa'.repeat(32));
});

test('validateFinalizedFacilityStateEvidence fails closed if clock jumps backwards into future tolerance violation during async verification', async () => {
  const timestampMs = 1792764600000;
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs,
      state: closedStateHex,
    },
  };
  const expectedPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  let currentTime = timestampMs + 1000;
  const now = () => currentTime;

  const verifierKey = async (name) => {
    // Jump 120s into the past; maxClockDriftMs is 60s, so finalizedTimestampMs > postAwaitNow + 60s
    currentTime = timestampMs - 120000;
    return verifiersMap.get(name);
  };

  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, verifierKey, expectedPins, {
      now,
      maxClockDriftMs: 60000,
      maxStalenessMs: 300000,
    }),
    /Finalized block timestamp became too far in the future during verification/
  );
});

test('validateFinalizedFacilityStateEvidence rejects getters on options.now or options.policy before calling them', async () => {
  const evidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };
  const expectedPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };

  let getterCalls = 0;
  const badOptionsNow = Object.defineProperty({ maxClockDriftMs: 60000 }, 'now', {
    get() {
      getterCalls++;
      return () => 1792764605000;
    },
    enumerable: true,
  });

  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, async () => new Uint8Array(32), expectedPins, badOptionsNow),
    /Getters\/setters are not permitted on "now" in validation options/
  );
  assert.equal(getterCalls, 0);

  let policyGetterCalls = 0;
  const badOptionsPolicy = {
    now: () => 1792764605000,
    get policy() {
      policyGetterCalls++;
      return {};
    },
  };

  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(evidence, async () => new Uint8Array(32), expectedPins, badOptionsPolicy),
    /Getters\/setters are not permitted on "policy" in validation options/
  );
  assert.equal(policyGetterCalls, 0);
});

test('validateFinalizedFacilityStateEvidence rejects Symbol properties and non-enumerable properties on options, pins, and evidence', async () => {
  const baseEvidence = {
    schema: 'line:finalized-facility-state/v1',
    networkId: 'preprod',
    facilityAddress: 'aa'.repeat(32),
    sourceFingerprint: policy.sourceFingerprint,
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    maintenanceCounter: Number(stateObj.maintenanceAuthority.counter),
    finalized: {
      hash: 'bb'.repeat(32),
      height: 3105000,
      timestampMs: 1792764600000,
      state: closedStateHex,
    },
  };
  const expectedPins = {
    owner: facilityOwnerHex,
    facilityAddress: 'aa'.repeat(32),
    domain: facilityDomainHex,
    agent: facilityAgentHex,
    generation: facilityGeneration,
    commitment: facilityCommitmentHex,
  };
  const verifierKey = async () => new Uint8Array(32);

  // Symbol property on options
  const symSecret = Symbol('secret');
  const badOptionsSymbol = { [symSecret]: 'malicious', now: () => 1792764605000 };
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(baseEvidence, verifierKey, expectedPins, badOptionsSymbol),
    /Unknown property "Symbol\(secret\)" in validation options/
  );

  // Non-enumerable property on options
  const badOptionsNonEnum = {};
  Object.defineProperty(badOptionsNonEnum, 'now', { value: () => 1792764605000, enumerable: false });
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(baseEvidence, verifierKey, expectedPins, badOptionsNonEnum),
    /Non-enumerable property "now" in validation options/
  );

  // Symbol property on expectedPins
  const badPinsSymbol = { ...expectedPins, [Symbol('hiddenPin')]: 42 };
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(baseEvidence, verifierKey, badPinsSymbol, { now: () => 1792764605000 }),
    /Unknown property "Symbol\(hiddenPin\)" in expected pins/
  );

  // Non-enumerable property on expectedPins
  const badPinsNonEnum = { ...expectedPins };
  Object.defineProperty(badPinsNonEnum, 'facilityAddress', { value: 'aa'.repeat(32), enumerable: false });
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(baseEvidence, verifierKey, badPinsNonEnum, { now: () => 1792764605000 }),
    /Non-enumerable property "facilityAddress" in expected pins/
  );

  // Symbol property on evidence
  const badEvidenceSymbol = { ...baseEvidence, [Symbol('hiddenEv')]: true };
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(badEvidenceSymbol, verifierKey, expectedPins, { now: () => 1792764605000 }),
    /Unknown property "Symbol\(hiddenEv\)" in evidence/
  );

  // Non-enumerable property on evidence
  const badEvidenceNonEnum = { ...baseEvidence };
  Object.defineProperty(badEvidenceNonEnum, 'schema', { value: 'line:finalized-facility-state/v1', enumerable: false });
  await assert.rejects(
    () => validateFinalizedFacilityStateEvidence(badEvidenceNonEnum, verifierKey, expectedPins, { now: () => 1792764605000 }),
    /Non-enumerable property "schema" in evidence/
  );
});

test('finalizedFacilityStateReader is immune to endpoint object mutation after instantiation', async () => {
  const head = 'ab'.repeat(32);
  const height = 3105123;
  const timestampMs = 1792764600000;
  const facilityAddress = 'fe'.repeat(32);

  const mock = createMockTransport({ head, height, timestampMs });
  const mutableEndpoints = {
    nodeUri: 'http://127.0.0.1:9944/rpc',
    indexerUri: 'http://127.0.0.1:8088/graphql',
  };

  const reader = finalizedFacilityStateReader({
    endpoints: mutableEndpoints,
    fetchImpl: mock.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });

  // Mutate endpoints object after instantiation
  mutableEndpoints.nodeUri = 'http://attacker-controlled.example:9944/rpc';
  mutableEndpoints.indexerUri = 'http://attacker-controlled.example:8088/graphql';

  const evidence = await reader({
    address: facilityAddress,
    sessionRecipient: facilityOwnerHex,
  });

  assert.equal(evidence.schema, 'line:finalized-facility-state/v1');
  assert.equal(mock.rpcCalls.length, 6);
  assert.equal(mock.indexerCalls.length, 1);
});

test('loadOrganizationReleaseArtifacts returns detached immutable release identity and defensive verifiers without exposing mutable provider', async () => {
  const artifacts1 = await loadOrganizationReleaseArtifacts();
  assert.equal(artifacts1.verifiers.size, 12);
  assert.equal(artifacts1.zk, undefined); // Provider is not exposed
  assert.equal(Object.isFrozen(artifacts1), true);
  assert.equal(Object.isFrozen(artifacts1.release), true);
  assert.equal(Object.isFrozen(artifacts1.release.inputs), true);
  assert.equal(Object.isFrozen(artifacts1.release.inputs.source), true);
  assert.equal(artifacts1.sourceFingerprint, policy.sourceFingerprint);

  // Attempting to mutate release throws in strict mode
  assert.throws(() => {
    artifacts1.release.inputs.source.sha256 = 'malicious-fingerprint';
  }, TypeError);

  const sampleKey = CIRCUITS[0];
  const origKey = artifacts1.verifiers.get(sampleKey);
  const origByte = origKey[0];

  // Mutating caller copy of verifier map or buffer does not affect internal cache
  artifacts1.verifiers.set('maliciousCircuit', new Uint8Array(32));
  origKey[0] = (origByte + 1) % 256;

  const artifacts2 = await loadOrganizationReleaseArtifacts();
  assert.equal(artifacts2.verifiers.has('maliciousCircuit'), false);
  assert.equal(artifacts2.verifiers.get(sampleKey)[0], origByte);
  assert.equal(artifacts2.sourceFingerprint, policy.sourceFingerprint);
  assert.equal(artifacts2.release.inputs.source.sha256, policy.sourceFingerprint);
});

test('finalizedFacilityStateReader captures policy synchronously before asynchronous provider work', async () => {
  const mutablePolicy = {
    genesisHash: policy.genesisHash,
    runtimeSpecVersion: policy.runtimeSpecVersion,
    timestampKey: policy.timestampKey,
  };
  const mutableRelease = {
    inputs: { source: { sha256: policy.sourceFingerprint } },
  };
  const mock = createMockTransport();
  const reader = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: mock.fetchImpl,
    policy: mutablePolicy,
    release: mutableRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });

  // Mutate mutablePolicy and mutableRelease during the asynchronous execution
  const readPromise = reader({
    address: 'fe'.repeat(32),
    sessionRecipient: facilityOwnerHex,
  });
  mutablePolicy.genesisHash = '00'.repeat(32);
  mutablePolicy.runtimeSpecVersion = 999999;
  mutableRelease.inputs.source.sha256 = 'bad'.repeat(21) + 'b';

  const evidence = await readPromise;
  assert.equal(evidence.genesisHash, policy.genesisHash);
  assert.equal(evidence.runtimeSpecVersion, policy.runtimeSpecVersion);
  assert.equal(evidence.sourceFingerprint, policy.sourceFingerprint);
});

test('finalizedFacilityStateReader and fetchFinalizedFacilityState sanitize abort signal reasons without leaking sensitive URLs or credentials', async () => {
  const sensitiveCredentialUrl = 'https://admin:SECRET_PASSWORD_TOKEN@private-node.example.org:9944/rpc';
  const facilityAddress = 'aa'.repeat(32);

  // fetchFinalizedFacilityState sanitization
  const controller1 = new AbortController();
  controller1.abort(sensitiveCredentialUrl);

  await assert.rejects(
    () => fetchFinalizedFacilityState(facilityAddress, { signal: controller1.signal }),
    (err) => {
      assert(!err.message.includes('SECRET_PASSWORD_TOKEN'));
      assert(!err.message.includes('private-node.example.org'));
      assert.equal(err.message, 'Finalized facility state request aborted');
      return true;
    }
  );

  // finalizedFacilityStateReader sanitization
  const mock = createMockTransport();
  const reader = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: mock.fetchImpl,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });

  const controller2 = new AbortController();
  controller2.abort(sensitiveCredentialUrl);

  await assert.rejects(
    () => reader({
      address: facilityAddress,
      sessionRecipient: facilityOwnerHex,
      signal: controller2.signal,
    }),
    (err) => {
      assert(!err.message.includes('SECRET_PASSWORD_TOKEN'));
      assert(!err.message.includes('private-node.example.org'));
      assert.equal(err.message, 'Operation aborted');
      assert.equal(err.name, 'AbortError');
      return true;
    }
  );
});

test('fatal UTF-8 decoder in fetchFinalizedFacilityState and finalizedFacilityStateReader rejects malformed UTF-8 stream', async () => {
  const facilityAddress = 'aa'.repeat(32);

  // fetchFinalizedFacilityState malformed UTF-8 stream
  const malformedUtf8Fetch = async () => {
    const invalidUtf8Bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0x80, 0x81]);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(invalidUtf8Bytes);
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await assert.rejects(
    () => fetchFinalizedFacilityState(facilityAddress, { fetchImpl: malformedUtf8Fetch }),
    /Server returned malformed UTF-8 response/
  );

  // finalizedFacilityStateReader malformed UTF-8 response
  const malformedReaderFetch = async () => {
    const invalidUtf8Bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0x80, 0x81]);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(invalidUtf8Bytes);
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const reader = finalizedFacilityStateReader({
    endpoints: {
      nodeUri: 'http://127.0.0.1:9944/rpc',
      indexerUri: 'http://127.0.0.1:8088/graphql',
    },
    fetchImpl: malformedReaderFetch,
    release: dummyRelease,
    decodeLedger: ledger,
    verifiers: verifiersMap,
  });

  await assert.rejects(
    () => reader({ address: facilityAddress, sessionRecipient: facilityOwnerHex }),
    /Provider returned malformed UTF-8 response/
  );
});
