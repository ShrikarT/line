import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { ContractState as LedgerContractState } from '@midnight-ntwrk/ledger-v8';
import { ContractState as CompactRuntimeContractState } from '@midnight-ntwrk/compact-runtime';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveContractRelease, validateContractArtifacts } from '../scripts/contract-artifacts.mjs?organization=v1';
import { EXPIRED_OPENING as defaultPolicy } from '../src/lib/organization/expired-opening-policy.ts';
import { OrganizationAuthError } from './organization-auth.mjs';

export const CIRCUITS = Object.freeze([
  'registerMerchant',
  'disableMerchant',
  'fundReserve',
  'withdrawUnencumberedReserve',
  'withdrawFees',
  'openLine',
  'postQuote',
  'draw',
  'redeemDraw',
  'cancelOrExpireNote',
  'acknowledgeRepayment',
  'setStatus',
]);

const MAX_RPC_RESPONSE_BYTES = 1024 * 1024; // 1 MB
const MAX_RAW_STATE_BYTES = 256 * 1024; // 256 KiB
const MAX_HEX_STATE_CHARS = 524288; // 256 * 1024 * 2

function createAbortError() {
  const err = new Error('Operation aborted');
  err.name = 'AbortError';
  return err;
}

export function createOrganizationReleaseArtifactsLoader(options = {}) {
  const projectRoot = options.projectRoot ? resolve(options.projectRoot) : null;
  let cachedArtifacts = null;

  return async function loadArtifacts() {
    if (!cachedArtifacts) {
      const artifactDir = resolveContractRelease({
        ...(projectRoot ? { projectRoot } : {}),
        profile: 'organization',
      });
      const release = validateContractArtifacts({
        artifactDir,
        ...(projectRoot ? { projectRoot } : {}),
        profile: 'organization',
      });
      const zk = new NodeZkConfigProvider(release.artifactDir);
      const generated = await import(pathToFileURL(join(release.artifactDir, 'contract/index.js')).href);
      const verifiers = new Map();
      for (const name of CIRCUITS) {
        verifiers.set(name, await zk.getVerifierKey(name));
      }
      const sourceFingerprint = Object.freeze(String(release.inputs.source.sha256).toLowerCase());
      cachedArtifacts = Object.freeze({
        sourceFingerprint,
        decodeLedger: generated.ledger,
        verifiers,
      });
    }

    // Return a detached immutable minimal release identity and copied keys; no mutable cached release/provider exposure
    const verifiersCopy = new Map(
      [...cachedArtifacts.verifiers.entries()].map(([k, v]) => [k, new Uint8Array(v)])
    );

    const detachedRelease = Object.freeze({
      inputs: Object.freeze({
        source: Object.freeze({
          sha256: cachedArtifacts.sourceFingerprint,
        }),
      }),
    });

    return Object.freeze({
      release: detachedRelease,
      sourceFingerprint: cachedArtifacts.sourceFingerprint,
      decodeLedger: cachedArtifacts.decodeLedger,
      verifiers: verifiersCopy,
    });
  };
}

const defaultLoader = createOrganizationReleaseArtifactsLoader();
const rootCaches = new Map();

export async function loadOrganizationReleaseArtifacts(options) {
  if (options?.projectRoot) {
    const root = resolve(options.projectRoot);
    let loader = rootCaches.get(root);
    if (!loader) {
      loader = createOrganizationReleaseArtifactsLoader({ projectRoot: root });
      rootCaches.set(root, loader);
    }
    return loader();
  }
  return defaultLoader();
}

/** Provider-backed read for finalized organization facility state on Midnight Preprod.
 * Provider credentials remain strictly server-side; diagnostics and error messages are redacted.
 * Fail closed on network mismatch, runtime mismatch, wrong owner, missing/incomplete verifier keys,
 * unsafe height/timestamp, non-canonical state, or indexer discrepancy.
 */
export function finalizedFacilityStateReader(options = {}) {
  const { endpoints, fetchImpl = globalThis.fetch, artifactsLoader = loadOrganizationReleaseArtifacts } = options;

  if (!endpoints?.nodeUri || !endpoints?.indexerUri) {
    throw new Error('Facility state reader requires nodeUri and indexerUri endpoints.');
  }

  const nodeUrl = new URL(endpoints.nodeUri);
  const indexerUrl = new URL(endpoints.indexerUri);

  for (const url of [nodeUrl, indexerUrl]) {
    const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    const allowed = isLoopback ? ['https:', 'http:'] : ['https:'];
    if (!allowed.includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error('Invalid provider endpoint configuration: TLS is required for remote upstreams.');
    }
  }

  // Freeze validated URLs at creation time to prevent mutation of endpoints during async awaits
  const validatedNodeUri = Object.freeze(nodeUrl.href);
  const validatedIndexerUri = Object.freeze(indexerUrl.href);

  async function post(url, body, signal) {
    if (signal?.aborted) {
      throw createAbortError();
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') {
        throw createAbortError();
      }
      throw new Error('Provider connection failed.');
    }

    if (!response.ok || !response.body) {
      throw new Error('Provider returned non-success response.');
    }

    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        if (signal?.aborted) {
          try { await reader.cancel(); } catch {}
          throw createAbortError();
        }
        let chunkResult;
        try {
          chunkResult = await reader.read();
        } catch (readErr) {
          if (signal?.aborted || readErr?.name === 'AbortError') {
            throw createAbortError();
          }
          throw new Error('Provider stream read failed.');
        }
        const { done, value } = chunkResult;
        if (done) break;
        size += value.length;
        if (size > MAX_RPC_RESPONSE_BYTES) {
          try { await reader.cancel(); } catch {}
          throw new Error('Provider response exceeded 1 MB limit.');
        }
        chunks.push(value);
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }

    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    } catch {
      throw new Error('Provider returned malformed UTF-8 response.');
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Provider returned malformed JSON response.');
    }
  }

  return async ({ address, sessionRecipient, signal }) => {
    if (signal?.aborted) {
      throw createAbortError();
    }

    if (!address || typeof address !== 'string' || !/^[0-9a-f]{64}$/i.test(address)) {
      throw new OrganizationAuthError('A valid 64-hex facility contract address is required.', 400);
    }
    const cleanAddress = address.toLowerCase();

    if (!sessionRecipient || typeof sessionRecipient !== 'string' || !/^[0-9a-f]{64}$/i.test(sessionRecipient)) {
      throw new OrganizationAuthError('A valid Preprod receiving wallet session is required.', 401);
    }
    const cleanRecipient = sessionRecipient.toLowerCase();

    // Capture expected policy values synchronously BEFORE awaiting artifact load
    const targetGenesis = String(options.policy?.genesisHash ?? defaultPolicy.genesisHash).toLowerCase();
    const targetRuntimeVersion = options.policy?.runtimeSpecVersion ?? defaultPolicy.runtimeSpecVersion;
    const targetTimestampKey = String(options.policy?.timestampKey ?? defaultPolicy.timestampKey);
    const targetSourceFingerprint = options.sourceFingerprint
      ? String(options.sourceFingerprint).toLowerCase()
      : (options.release?.inputs?.source?.sha256 ? String(options.release.inputs.source.sha256).toLowerCase() : null);

    const capturedPreAwaitPolicy = Object.freeze({
      genesisHash: Object.freeze(targetGenesis),
      runtimeSpecVersion: targetRuntimeVersion,
      timestampKey: Object.freeze(targetTimestampKey),
      sourceFingerprint: targetSourceFingerprint ? Object.freeze(targetSourceFingerprint) : null,
    });

    const artifacts = options.verifiers
      ? {
          sourceFingerprint: capturedPreAwaitPolicy.sourceFingerprint ?? defaultPolicy.sourceFingerprint.toLowerCase(),
          decodeLedger: options.decodeLedger,
          verifiers: options.verifiers,
        }
      : await artifactsLoader();

    const capturedPolicy = Object.freeze({
      genesisHash: capturedPreAwaitPolicy.genesisHash,
      runtimeSpecVersion: capturedPreAwaitPolicy.runtimeSpecVersion,
      timestampKey: capturedPreAwaitPolicy.timestampKey,
      sourceFingerprint: capturedPreAwaitPolicy.sourceFingerprint ?? artifacts.sourceFingerprint,
    });

    // Deep-copy each verifier key buffer to avoid shallow-copy reference issues
    const capturedVerifiers = new Map(
      [...artifacts.verifiers.entries()].map(([k, v]) => [k, new Uint8Array(v)])
    );
    const decodeLedger = artifacts.decodeLedger;

    const timeout = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(25000)]);
    let requestId = 0;

    const rpc = async (method, params = []) => {
      const id = ++requestId;
      const res = await post(validatedNodeUri, { jsonrpc: '2.0', id, method, params }, timeout);
      if (res?.jsonrpc !== '2.0' || res.id !== id || res.error || res.result == null) {
        throw new Error('RPC call failed.');
      }
      return res.result;
    };

    // 1. Obtain pinned finalized head
    const rawHead = await rpc('chain_getFinalizedHead');
    if (typeof rawHead !== 'string' || !/^0x[0-9a-f]{64}$/i.test(rawHead)) {
      throw new Error('Invalid finalized head hash returned by node RPC.');
    }
    const head = rawHead.slice(2).toLowerCase();

    // 2. Exact-block header at head
    const header = await rpc('chain_getHeader', ['0x' + head]);
    if (!header?.number || typeof header.number !== 'string' || !/^0x[0-9a-f]+$/i.test(header.number)) {
      throw new Error('Invalid block header number returned by node RPC.');
    }
    const height = Number(BigInt(header.number));
    if (!Number.isSafeInteger(height) || height <= 0) {
      throw new Error('Finalized block height is not a positive safe integer.');
    }

    // 3. Preprod chain genesis verification
    const genesis = await rpc('chain_getBlockHash', [0]);
    if (typeof genesis !== 'string' || !/^0x[0-9a-f]{64}$/i.test(genesis) || genesis.slice(2).toLowerCase() !== capturedPolicy.genesisHash) {
      throw new Error('Preprod genesis mismatch: node is not running reviewed Preprod chain.');
    }

    // 4. Exact-block runtime version at head
    const runtime = await rpc('state_getRuntimeVersion', ['0x' + head]);
    if (runtime?.specName !== 'midnight' || runtime?.specVersion !== capturedPolicy.runtimeSpecVersion) {
      throw new Error('Runtime mismatch: release specVersion has not been reviewed.');
    }

    // 5. Exact-block contract state at head
    const rawState = await rpc('midnight_contractState', [cleanAddress, '0x' + head]);
    if (typeof rawState !== 'string' || !/^(?:0x)?([0-9a-f]{2})+$/i.test(rawState)) {
      throw new Error('Facility contract state unavailable or invalid hex encoding.');
    }
    const rawHex = rawState.replace(/^0x/i, '').toLowerCase();
    if (rawHex.length > MAX_HEX_STATE_CHARS) {
      throw new Error('Contract state hex length exceeds maximum limit.');
    }
    const rawBytes = Buffer.from(rawHex, 'hex');
    if (rawBytes.length > MAX_RAW_STATE_BYTES) {
      throw new Error('Contract state raw size exceeds 256 KiB limit.');
    }

    // 6. Deserialize original rawBytes with Compact runtime directly
    let book;
    try {
      const compactState = CompactRuntimeContractState.deserialize(rawBytes);
      book = decodeLedger(compactState.data);
    } catch {
      throw new Error('Failed to deserialize Compact runtime contract state data.');
    }

    // Validate facility owner against authenticated wallet session recipient
    const ownerHex = Buffer.from(book.issuerPayoutRecipient.bytes).toString('hex').toLowerCase();
    if (ownerHex !== cleanRecipient) {
      throw new OrganizationAuthError('This wallet does not own the selected organization facility.', 403);
    }

    // Separately deserialize original rawBytes with ledger-v8
    let state;
    try {
      state = LedgerContractState.deserialize(rawBytes);
    } catch {
      throw new Error('Failed to deserialize contract state with ledger-v8.');
    }

    // Canonical reserialization check
    if (Buffer.from(state.serialize()).toString('hex') !== rawHex) {
      throw new Error('Contract state bytes are not canonically serialized.');
    }

    // Maintenance counter check (valid Uint32 is between 0n and 0xffff_ffffn inclusive)
    const counterBig = state.maintenanceAuthority.counter;
    if (typeof counterBig !== 'bigint' || counterBig < 0n || counterBig > 0xffff_ffffn) {
      throw new Error('Invalid maintenance authority counter: out of Uint32 range.');
    }
    const maintenanceCounter = Number(counterBig);

    // Check all 12 circuit operations and verifier keys
    const opNames = state.operations().map(v => typeof v === 'string' ? v : Buffer.from(v).toString());
    if (opNames.length !== CIRCUITS.length || opNames.some(n => !CIRCUITS.includes(n))) {
      throw new Error('Facility operations do not match supported release circuits.');
    }

    for (const name of CIRCUITS) {
      const op = state.operation(name);
      if (!op) {
        throw new Error(`Missing circuit operation: ${name}.`);
      }
      const expectedKey = capturedVerifiers.get(name);
      if (!expectedKey || !Buffer.from(op.verifierKey).equals(Buffer.from(expectedKey))) {
        throw new Error(`Verifier key mismatch for circuit: ${name}.`);
      }
    }

    // 7. Exact-block fixed Timestamp.Now storage at head
    const storage = await rpc('state_getStorage', [capturedPolicy.timestampKey, '0x' + head]);
    if (typeof storage !== 'string' || !/^0x[0-9a-f]{16}$/i.test(storage)) {
      throw new Error('Invalid Timestamp.Now storage representation from node.');
    }
    const timestampMs = Number(Buffer.from(storage.slice(2), 'hex').readBigUInt64LE());
    if (!Number.isSafeInteger(timestampMs) || timestampMs <= 0) {
      throw new Error('Invalid Timestamp.Now value decoded from node storage.');
    }

    // 8. Indexer agreement check at exact pinned block (numeric millisecond timestamp)
    const indexed = await post(
      validatedIndexerUri,
      {
        query: 'query LINE_FINALIZED_BLOCK($offset: BlockOffset!) { block(offset:$offset) { hash height timestamp } }',
        variables: { offset: { hash: head } },
      },
      timeout
    );

    const indexedTimestamp = indexed?.data?.block?.timestamp;
    if (
      indexed?.errors ||
      indexed?.data?.block?.hash !== head ||
      indexed?.data?.block?.height !== height ||
      indexedTimestamp !== timestampMs
    ) {
      throw new Error('Node and indexer disagree on finalized block provenance.');
    }

    return {
      schema: 'line:finalized-facility-state/v1',
      networkId: 'preprod',
      facilityAddress: cleanAddress,
      sourceFingerprint: capturedPolicy.sourceFingerprint,
      genesisHash: capturedPolicy.genesisHash,
      runtimeSpecVersion: capturedPolicy.runtimeSpecVersion,
      maintenanceCounter,
      finalized: {
        hash: head,
        height,
        timestampMs,
        state: rawHex,
      },
    };
  };
}
