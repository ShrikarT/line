import { ContractState as LedgerContractState } from "@midnight-ntwrk/ledger-v8";
import { ContractState as CompactRuntimeContractState } from "@midnight-ntwrk/compact-runtime";
import { ledger } from "../../../contracts/managed/organization/contract/index.js";
import { EXPIRED_OPENING as defaultPolicy } from "./expired-opening-policy.ts";
import { hexToBytes, toHex } from "../bytes.ts";

export const CIRCUITS = Object.freeze([
  "registerMerchant",
  "disableMerchant",
  "fundReserve",
  "withdrawUnencumberedReserve",
  "withdrawFees",
  "openLine",
  "postQuote",
  "draw",
  "redeemDraw",
  "cancelOrExpireNote",
  "acknowledgeRepayment",
  "setStatus",
] as const);

export type CircuitName = (typeof CIRCUITS)[number];

export const FINALIZED_FACILITY_STATE_PATH = "/api/organization/network/finalized-facility-state";

const MAX_RAW_STATE_BYTES = 256 * 1024; // 256 KiB
const MAX_HEX_STATE_CHARS = 524288; // 256 * 1024 * 2
const MAX_ALLOWED_TOLERANCE_MS = 300_000; // 5 minutes hard max

/** Pinned public evidence of finalized facility state on Midnight Preprod.
 * Provider-backed read under TLS node/indexer trust; not an independent full-node or light-client proof.
 */
export interface FinalizedFacilityStateEvidence {
  readonly schema: "line:finalized-facility-state/v1";
  readonly networkId: "preprod";
  readonly facilityAddress: string;
  readonly sourceFingerprint: string;
  readonly genesisHash: string;
  readonly runtimeSpecVersion: number;
  readonly maintenanceCounter: number;
  readonly finalized: {
    readonly hash: string;
    readonly height: number;
    readonly timestampMs: number;
    readonly state: string; // canonical serialized contract state hex
  };
}

/** Mandatory six-pin specification for independent browser verification.
 * No optional or undefined fields; all six records must be provided.
 */
export interface ExpectedFacilityPins {
  readonly owner: string;
  readonly facilityAddress: string;
  readonly domain: string;
  readonly agent: string;
  readonly generation: bigint | number;
  readonly commitment: string;
}

export interface ValidationClockOptions {
  now?: () => number;
  maxClockDriftMs?: number;
  maxStalenessMs?: number;
  policy?: {
    genesisHash?: string;
    runtimeSpecVersion?: number;
    sourceFingerprint?: string;
  };
}

export interface DecodedFinalizedFacility {
  facilityAddress: string;
  status: number;
  lineGeneration: bigint;
  contractDomain: string;
  lineCommit: string;
  identityCommit: string;
  issuer: string;
  issuerPayoutRecipient: string;
  actionClock: bigint;
  settlementTokenColor: string;
  totalReserve: bigint;
  encumberedReserve: bigint;
  redeemedReserve: bigint;
  feeReserve: bigint;
  pendingFeeReserve: bigint;
  refundReserve: bigint;
  reportedRefundReserve: bigint;
  feeFlat: bigint;
  feeBps: bigint;
  lineExpiry: bigint;
  maintenanceCounter: number;
  finalizedHash: string;
  finalizedHeight: number;
  finalizedTimestampMs: number;
}

function assertPlainRecord(obj: unknown, name: string): asserts obj is Record<string | symbol, unknown> {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error(`The finalized facility state could not be verified: ${name} must be a plain object.`);
  }
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`The finalized facility state could not be verified: ${name} must be a plain object.`);
  }
}

function assertExactRecords(obj: Record<string | symbol, unknown>, allowedKeys: readonly string[], recordName: string): void {
  const allOwnKeys = Reflect.ownKeys(obj);
  for (const key of allOwnKeys) {
    if (typeof key !== "string" || !allowedKeys.includes(key)) {
      const displayKey = typeof key === "symbol" ? key.toString() : String(key);
      throw new Error(`The finalized facility state could not be verified: Unknown property "${displayKey}" in ${recordName}.`);
    }
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (!desc || !desc.enumerable) {
      throw new Error(`The finalized facility state could not be verified: Non-enumerable property "${key}" in ${recordName}.`);
    }
    if (desc.get !== undefined || desc.set !== undefined) {
      throw new Error(`The finalized facility state could not be verified: Getters/setters are not permitted on "${key}" in ${recordName}.`);
    }
  }
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      throw new Error(`The finalized facility state could not be verified: Missing mandatory field "${key}" in ${recordName}.`);
    }
  }
}

function assertAllowedDescriptors(obj: Record<string | symbol, unknown>, allowedKeys: readonly string[], recordName: string): void {
  const allOwnKeys = Reflect.ownKeys(obj);
  for (const key of allOwnKeys) {
    if (typeof key !== "string" || !allowedKeys.includes(key)) {
      const displayKey = typeof key === "symbol" ? key.toString() : String(key);
      throw new Error(`The finalized facility state could not be verified: Unknown property "${displayKey}" in ${recordName}.`);
    }
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (!desc || !desc.enumerable) {
      throw new Error(`The finalized facility state could not be verified: Non-enumerable property "${key}" in ${recordName}.`);
    }
    if (desc.get !== undefined || desc.set !== undefined) {
      throw new Error(`The finalized facility state could not be verified: Getters/setters are not permitted on "${key}" in ${recordName}.`);
    }
  }
}

function getNoGetterDescriptor(obj: Record<string | symbol, unknown>, key: string, recordName: string): PropertyDescriptor {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc) {
    throw new Error(`The finalized facility state could not be verified: Missing mandatory field "${key}" in ${recordName}.`);
  }
  if (desc.get !== undefined || desc.set !== undefined) {
    throw new Error(`The finalized facility state could not be verified: Getters/setters are not permitted on "${key}" in ${recordName}.`);
  }
  return desc;
}

/** Browser-side independent validator for finalized facility state evidence.
 * Deserializes raw contract state via ledger-v8 and Compact runtime separately from original bytes,
 * validates canonical serialization, checks all 12 circuit verifier keys,
 * verifies maintenance counter, verifies clock freshness within documented 5-minute tolerance,
 * and asserts all 6 facility pins (owner, facility, domain, agent, generation, commitment) independently.
 */
export async function validateFinalizedFacilityStateEvidence(
  value: unknown,
  verifierKey: (name: string) => Promise<Uint8Array>,
  expectedPins: ExpectedFacilityPins,
  options: ValidationClockOptions = {}
): Promise<{
  evidence: FinalizedFacilityStateEvidence;
  state: LedgerContractState;
  book: ReturnType<typeof ledger>;
  decoded: DecodedFinalizedFacility;
}> {
  if (typeof verifierKey !== "function") {
    throw new Error("The finalized facility state could not be verified: verifierKey must be a function.");
  }

  // 1. Strict record descriptor validation on expectedPins before reading or awaiting anything
  assertPlainRecord(expectedPins, "expected pins");
  const allowedPinKeys = ["agent", "commitment", "domain", "facilityAddress", "generation", "owner"] as const;
  assertExactRecords(expectedPins, allowedPinKeys, "expected pins");

  const descOwner = getNoGetterDescriptor(expectedPins, "owner", "expected pins");
  if (typeof descOwner.value !== "string" || !/^[0-9a-f]{64}$/i.test(descOwner.value)) {
    throw new Error("The finalized facility state could not be verified: A valid 64-hex expected owner address is required.");
  }
  const detachedExpectedOwner = descOwner.value.toLowerCase();

  const descFacility = getNoGetterDescriptor(expectedPins, "facilityAddress", "expected pins");
  if (typeof descFacility.value !== "string" || !/^[0-9a-f]{64}$/i.test(descFacility.value)) {
    throw new Error("The finalized facility state could not be verified: Expected facility address must be a 64-hex string.");
  }
  const detachedExpectedFacility = descFacility.value.toLowerCase();

  const descDomain = getNoGetterDescriptor(expectedPins, "domain", "expected pins");
  if (typeof descDomain.value !== "string" || !/^[0-9a-f]{64}$/i.test(descDomain.value)) {
    throw new Error("The finalized facility state could not be verified: Expected contract domain must be a 64-hex string.");
  }
  const detachedExpectedDomain = descDomain.value.toLowerCase();

  const descAgent = getNoGetterDescriptor(expectedPins, "agent", "expected pins");
  if (typeof descAgent.value !== "string" || !/^[0-9a-f]{64}$/i.test(descAgent.value)) {
    throw new Error("The finalized facility state could not be verified: Expected agent identity must be a 64-hex string.");
  }
  const detachedExpectedAgent = descAgent.value.toLowerCase();

  const descGen = getNoGetterDescriptor(expectedPins, "generation", "expected pins");
  let detachedExpectedGeneration: bigint;
  if (typeof descGen.value === "bigint") {
    if (descGen.value < 0n || descGen.value > 0xffff_ffff_ffff_ffffn) {
      throw new Error("The finalized facility state could not be verified: Line generation must be a non-negative 64-bit integer.");
    }
    detachedExpectedGeneration = descGen.value;
  } else if (typeof descGen.value === "number") {
    if (!Number.isSafeInteger(descGen.value) || descGen.value < 0) {
      throw new Error("The finalized facility state could not be verified: Line generation must be a non-negative safe integer.");
    }
    detachedExpectedGeneration = BigInt(descGen.value);
  } else {
    throw new Error("The finalized facility state could not be verified: Line generation must be a number or bigint.");
  }

  const descCommit = getNoGetterDescriptor(expectedPins, "commitment", "expected pins");
  if (typeof descCommit.value !== "string" || !/^[0-9a-f]{64}$/i.test(descCommit.value)) {
    throw new Error("The finalized facility state could not be verified: Expected book commitment must be a 64-hex string.");
  }
  const detachedExpectedCommitment = descCommit.value.toLowerCase();

  // 2. Strict record descriptor validation on value (evidence)
  assertPlainRecord(value, "evidence");
  const allowedEvidenceKeys = [
    "facilityAddress",
    "finalized",
    "genesisHash",
    "maintenanceCounter",
    "networkId",
    "runtimeSpecVersion",
    "schema",
    "sourceFingerprint",
  ] as const;
  assertExactRecords(value, allowedEvidenceKeys, "evidence");

  const descSchema = getNoGetterDescriptor(value, "schema", "evidence");
  if (descSchema.value !== "line:finalized-facility-state/v1") {
    throw new Error("The finalized facility state could not be verified: Unsupported evidence schema.");
  }
  const detachedSchema = descSchema.value;

  const descNetwork = getNoGetterDescriptor(value, "networkId", "evidence");
  if (descNetwork.value !== "preprod") {
    throw new Error("The finalized facility state could not be verified: Evidence network must be preprod.");
  }
  const detachedNetworkId = descNetwork.value;

  const descFacAddr = getNoGetterDescriptor(value, "facilityAddress", "evidence");
  if (typeof descFacAddr.value !== "string" || !/^[0-9a-f]{64}$/i.test(descFacAddr.value)) {
    throw new Error("The finalized facility state could not be verified: Invalid facility address format.");
  }
  const detachedFacilityAddress = descFacAddr.value.toLowerCase();

  const descSource = getNoGetterDescriptor(value, "sourceFingerprint", "evidence");
  if (typeof descSource.value !== "string" || !/^[0-9a-f]{64}$/i.test(descSource.value)) {
    throw new Error("The finalized facility state could not be verified: Invalid source fingerprint format.");
  }
  const detachedSourceFingerprint = descSource.value.toLowerCase();

  const descGenesis = getNoGetterDescriptor(value, "genesisHash", "evidence");
  if (typeof descGenesis.value !== "string" || !/^[0-9a-f]{64}$/i.test(descGenesis.value)) {
    throw new Error("The finalized facility state could not be verified: Invalid genesis hash format.");
  }
  const detachedGenesisHash = descGenesis.value.toLowerCase();

  const descRuntime = getNoGetterDescriptor(value, "runtimeSpecVersion", "evidence");
  if (typeof descRuntime.value !== "number" || !Number.isSafeInteger(descRuntime.value) || descRuntime.value <= 0) {
    throw new Error("The finalized facility state could not be verified: Invalid runtime spec version format.");
  }
  const detachedRuntimeSpecVersion = descRuntime.value;

  const descCounter = getNoGetterDescriptor(value, "maintenanceCounter", "evidence");
  if (
    typeof descCounter.value !== "number" ||
    !Number.isSafeInteger(descCounter.value) ||
    descCounter.value < 0 ||
    descCounter.value > 0xffff_ffff
  ) {
    throw new Error("The finalized facility state could not be verified: Invalid maintenance counter.");
  }
  const detachedMaintenanceCounter = descCounter.value;

  const descFinalized = getNoGetterDescriptor(value, "finalized", "evidence");
  assertPlainRecord(descFinalized.value, "finalized block details");
  const allowedFinalizedKeys = ["hash", "height", "state", "timestampMs"] as const;
  assertExactRecords(descFinalized.value, allowedFinalizedKeys, "finalized block details");

  const descHash = getNoGetterDescriptor(descFinalized.value, "hash", "finalized block details");
  if (typeof descHash.value !== "string" || !/^[0-9a-f]{64}$/i.test(descHash.value)) {
    throw new Error("The finalized facility state could not be verified: Invalid finalized block hash.");
  }
  const detachedFinalizedHash = descHash.value.toLowerCase();

  const descHeight = getNoGetterDescriptor(descFinalized.value, "height", "finalized block details");
  if (typeof descHeight.value !== "number" || !Number.isSafeInteger(descHeight.value) || descHeight.value <= 0) {
    throw new Error("The finalized facility state could not be verified: Invalid finalized block height.");
  }
  const detachedFinalizedHeight = descHeight.value;

  const descTime = getNoGetterDescriptor(descFinalized.value, "timestampMs", "finalized block details");
  if (typeof descTime.value !== "number" || !Number.isSafeInteger(descTime.value) || descTime.value <= 0) {
    throw new Error("The finalized facility state could not be verified: Invalid finalized block timestamp.");
  }
  const detachedFinalizedTimestampMs = descTime.value;

  const descState = getNoGetterDescriptor(descFinalized.value, "state", "finalized block details");
  if (
    typeof descState.value !== "string" ||
    !/^[0-9a-fA-F]*$/.test(descState.value) ||
    descState.value.length % 2 !== 0 ||
    descState.value.length > MAX_HEX_STATE_CHARS
  ) {
    throw new Error("The finalized facility state could not be verified: Invalid contract state hex encoding or bounds exceeded.");
  }
  const detachedRawHex = descState.value.toLowerCase();

  // 3. Strict record descriptor validation on options and policy before reading or awaiting anything
  assertPlainRecord(options, "validation options");
  const allowedOptionKeys = ["maxClockDriftMs", "maxStalenessMs", "now", "policy"] as const;
  assertAllowedDescriptors(options, allowedOptionKeys, "validation options");

  const descNow = Object.getOwnPropertyDescriptor(options, "now");
  let nowFn: () => number = Date.now;
  if (descNow) {
    if (typeof descNow.value !== "function") {
      throw new Error("The finalized facility state could not be verified: options.now must be a function.");
    }
    nowFn = descNow.value as () => number;
  }

  const descDrift = Object.getOwnPropertyDescriptor(options, "maxClockDriftMs");
  const maxClockDriftMs = descDrift ? descDrift.value : MAX_ALLOWED_TOLERANCE_MS;
  if (!Number.isSafeInteger(maxClockDriftMs) || maxClockDriftMs < 0 || maxClockDriftMs > MAX_ALLOWED_TOLERANCE_MS) {
    throw new Error(`The finalized facility state could not be verified: Clock drift tolerance must be between 0 and ${MAX_ALLOWED_TOLERANCE_MS} ms (5 minutes).`);
  }

  const descStale = Object.getOwnPropertyDescriptor(options, "maxStalenessMs");
  const maxStalenessMs = descStale ? descStale.value : MAX_ALLOWED_TOLERANCE_MS;
  if (!Number.isSafeInteger(maxStalenessMs) || maxStalenessMs < 0 || maxStalenessMs > MAX_ALLOWED_TOLERANCE_MS) {
    throw new Error(`The finalized facility state could not be verified: Clock staleness tolerance must be between 0 and ${MAX_ALLOWED_TOLERANCE_MS} ms (5 minutes).`);
  }

  // Pre-await clock freshness check using captured nowFn
  const initialNow = nowFn();
  if (!Number.isSafeInteger(initialNow) || initialNow <= 0) {
    throw new Error("The finalized facility state could not be verified: Current clock time must be a positive safe integer.");
  }
  if (detachedFinalizedTimestampMs > initialNow + maxClockDriftMs) {
    throw new Error("The finalized facility state could not be verified: Finalized block timestamp is too far in the future.");
  }
  if (detachedFinalizedTimestampMs < initialNow - maxStalenessMs) {
    throw new Error("The finalized facility state could not be verified: Finalized block timestamp is stale.");
  }

  // 4. Expected policy checks with strict descriptor validation
  let expectedGenesisHash: string = defaultPolicy.genesisHash.toLowerCase();
  let expectedRuntimeSpecVersion: number = defaultPolicy.runtimeSpecVersion;
  let expectedSourceFingerprint: string = defaultPolicy.sourceFingerprint.toLowerCase();

  const descPolicy = Object.getOwnPropertyDescriptor(options, "policy");
  if (descPolicy && descPolicy.value !== undefined) {
    assertPlainRecord(descPolicy.value, "policy options");
    const allowedPolicyKeys = ["genesisHash", "runtimeSpecVersion", "sourceFingerprint"] as const;
    assertAllowedDescriptors(descPolicy.value, allowedPolicyKeys, "policy options");

    const descGenesisPolicy = Object.getOwnPropertyDescriptor(descPolicy.value, "genesisHash");
    if (descGenesisPolicy && descGenesisPolicy.value !== undefined) {
      if (typeof descGenesisPolicy.value !== "string" || !/^[0-9a-f]{64}$/i.test(descGenesisPolicy.value)) {
        throw new Error("The finalized facility state could not be verified: Invalid genesis hash in policy.");
      }
      expectedGenesisHash = descGenesisPolicy.value.toLowerCase();
    }

    const descRuntimePolicy = Object.getOwnPropertyDescriptor(descPolicy.value, "runtimeSpecVersion");
    if (descRuntimePolicy && descRuntimePolicy.value !== undefined) {
      if (typeof descRuntimePolicy.value !== "number" || !Number.isSafeInteger(descRuntimePolicy.value) || descRuntimePolicy.value <= 0) {
        throw new Error("The finalized facility state could not be verified: Invalid runtime spec version in policy.");
      }
      expectedRuntimeSpecVersion = descRuntimePolicy.value;
    }

    const descSourcePolicy = Object.getOwnPropertyDescriptor(descPolicy.value, "sourceFingerprint");
    if (descSourcePolicy && descSourcePolicy.value !== undefined) {
      if (typeof descSourcePolicy.value !== "string" || !/^[0-9a-f]{64}$/i.test(descSourcePolicy.value)) {
        throw new Error("The finalized facility state could not be verified: Invalid source fingerprint in policy.");
      }
      expectedSourceFingerprint = descSourcePolicy.value.toLowerCase();
    }
  }

  if (detachedSourceFingerprint !== expectedSourceFingerprint) {
    throw new Error("The finalized facility state could not be verified: Contract source fingerprint mismatch.");
  }
  if (detachedGenesisHash !== expectedGenesisHash) {
    throw new Error("The finalized facility state could not be verified: Chain genesis hash mismatch.");
  }
  if (detachedRuntimeSpecVersion !== expectedRuntimeSpecVersion) {
    throw new Error("The finalized facility state could not be verified: Runtime spec version has not been reviewed.");
  }

  // 5. Raw bytes and state deserialization
  const rawBytes = hexToBytes(detachedRawHex);
  if (rawBytes.length > MAX_RAW_STATE_BYTES) {
    throw new Error(`The finalized facility state could not be verified: Contract state raw bytes exceed ${MAX_RAW_STATE_BYTES} bytes.`);
  }

  // Deserialize Compact runtime directly from the original rawBytes
  let book: ReturnType<typeof ledger>;
  try {
    const compactState = CompactRuntimeContractState.deserialize(rawBytes);
    book = ledger(compactState.data);
  } catch {
    throw new Error("The finalized facility state could not be verified: Failed to deserialize Compact runtime state.");
  }

  // Deserialize ledger-v8 directly from the original rawBytes
  let state: LedgerContractState;
  try {
    state = LedgerContractState.deserialize(rawBytes);
  } catch {
    throw new Error("The finalized facility state could not be verified: Failed to deserialize ledger-v8 ContractState.");
  }

  // Canonical reserialization check
  if (toHex(state.serialize()) !== detachedRawHex) {
    throw new Error("The finalized facility state could not be verified: Contract state is not canonically serialized.");
  }
  if (Number(state.maintenanceAuthority.counter) !== detachedMaintenanceCounter) {
    throw new Error("The finalized facility state could not be verified: Maintenance counter does not match contract state.");
  }

  // 6. Check all 12 circuit operations and verifier keys
  const opNames = state.operations().map(v => typeof v === "string" ? v : toHex(v));
  if (opNames.length !== CIRCUITS.length || !opNames.every(n => (CIRCUITS as readonly string[]).includes(n))) {
    throw new Error("The finalized facility state could not be verified: Facility operations do not match the organization release circuits.");
  }

  for (const name of CIRCUITS) {
    const op = state.operation(name);
    if (!op) {
      throw new Error(`The finalized facility state could not be verified: Missing circuit operation: ${name}.`);
    }
    const rawKey = await verifierKey(name);
    if (!(rawKey instanceof Uint8Array)) {
      throw new Error(`The finalized facility state could not be verified: Invalid verifier key returned for ${name}.`);
    }
    // Deep copy expected keybytes immediately upon each resolved callback
    const expectedVk = new Uint8Array(rawKey);
    if (toHex(op.verifierKey) !== toHex(expectedVk)) {
      throw new Error(`The finalized facility state could not be verified: Verifier key mismatch for circuit: ${name}.`);
    }
  }

  // 7. Post-await freshness recheck using captured nowFn (checks BOTH staleness AND future drift)
  const postAwaitNow = nowFn();
  if (!Number.isSafeInteger(postAwaitNow) || postAwaitNow <= 0) {
    throw new Error("The finalized facility state could not be verified: Current clock time must be a positive safe integer.");
  }
  if (detachedFinalizedTimestampMs < postAwaitNow - maxStalenessMs) {
    throw new Error("The finalized facility state could not be verified: Finalized block timestamp became stale during verification.");
  }
  if (detachedFinalizedTimestampMs > postAwaitNow + maxClockDriftMs) {
    throw new Error("The finalized facility state could not be verified: Finalized block timestamp became too far in the future during verification.");
  }

  // 8. Assert all 6 mandatory pins against decoded state
  const ownerHex = toHex(book.issuerPayoutRecipient.bytes).toLowerCase();
  if (ownerHex !== detachedExpectedOwner) {
    throw new Error("The finalized facility state could not be verified: Facility owner does not match expected owner.");
  }

  if (detachedFacilityAddress !== detachedExpectedFacility) {
    throw new Error("The finalized facility state could not be verified: Facility address does not match expected facility.");
  }

  const domainHex = toHex(book.contractDomain).toLowerCase();
  if (domainHex !== detachedExpectedDomain) {
    throw new Error("The finalized facility state could not be verified: Contract domain does not match expected domain.");
  }

  const agentHex = toHex(book.identityCommit).toLowerCase();
  if (agentHex !== detachedExpectedAgent) {
    throw new Error("The finalized facility state could not be verified: Agent identity does not match expected agent.");
  }

  if (book.lineGeneration !== detachedExpectedGeneration) {
    throw new Error("The finalized facility state could not be verified: Line generation does not match expected generation.");
  }

  const commitHex = toHex(book.lineCommit).toLowerCase();
  if (commitHex !== detachedExpectedCommitment) {
    throw new Error("The finalized facility state could not be verified: Line commitment does not match expected commitment.");
  }

  const frozenEvidence: FinalizedFacilityStateEvidence = Object.freeze({
    schema: "line:finalized-facility-state/v1",
    networkId: "preprod",
    facilityAddress: detachedFacilityAddress,
    sourceFingerprint: detachedSourceFingerprint,
    genesisHash: detachedGenesisHash,
    runtimeSpecVersion: detachedRuntimeSpecVersion,
    maintenanceCounter: detachedMaintenanceCounter,
    finalized: Object.freeze({
      hash: detachedFinalizedHash,
      height: detachedFinalizedHeight,
      timestampMs: detachedFinalizedTimestampMs,
      state: detachedRawHex,
    }),
  });

  const decoded: DecodedFinalizedFacility = {
    facilityAddress: detachedFacilityAddress,
    status: Number(book.status),
    lineGeneration: book.lineGeneration,
    contractDomain: domainHex,
    lineCommit: commitHex,
    identityCommit: agentHex,
    issuer: toHex(book.issuer),
    issuerPayoutRecipient: ownerHex,
    actionClock: book.actionClock,
    settlementTokenColor: toHex(book.settlementTokenColor),
    totalReserve: book.totalReserve,
    encumberedReserve: book.encumberedReserve,
    redeemedReserve: book.redeemedReserve,
    feeReserve: book.feeReserve,
    pendingFeeReserve: book.pendingFeeReserve,
    refundReserve: book.refundReserve,
    reportedRefundReserve: book.reportedRefundReserve,
    feeFlat: book.feeFlat,
    feeBps: book.feeBps,
    lineExpiry: book.lineExpiry,
    maintenanceCounter: detachedMaintenanceCounter,
    finalizedHash: detachedFinalizedHash,
    finalizedHeight: detachedFinalizedHeight,
    finalizedTimestampMs: detachedFinalizedTimestampMs,
  };

  return { evidence: frozenEvidence, state, book, decoded };
}

export interface FetchFinalizedFacilityStateOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** Client fetcher for requesting finalized facility state from the same-origin backend.
 * Uses fixed relative same-origin path /api/organization/network/finalized-facility-state
 * with credentials: 'same-origin', mode: 'same-origin', redirect: 'error'.
 * Enforces a 1 MB stream response limit, fatal UTF-8 decoding, generically sanitizes stream and abort exceptions, and parses JSON.
 */
export async function fetchFinalizedFacilityState(
  facilityAddress: string,
  options: FetchFinalizedFacilityStateOptions = {}
): Promise<FinalizedFacilityStateEvidence> {
  if (typeof facilityAddress !== "string" || !/^[0-9a-f]{64}$/i.test(facilityAddress)) {
    throw new Error("A valid 64-character hex facility address is required.");
  }

  assertPlainRecord(options, "fetch options");
  const allowedFetchKeys = ["fetchImpl", "signal"] as const;
  assertAllowedDescriptors(options, allowedFetchKeys, "fetch options");

  const descFetch = Object.getOwnPropertyDescriptor(options, "fetchImpl");
  const fetchFn = descFetch?.value ? (descFetch.value as typeof fetch) : globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("fetchImpl must be a function.");
  }

  const descSignal = Object.getOwnPropertyDescriptor(options, "signal");
  const signal = descSignal?.value ? (descSignal.value as AbortSignal) : undefined;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new Error("signal must be an instance of AbortSignal.");
  }

  let response: Response;
  try {
    response = await fetchFn(FINALIZED_FACILITY_STATE_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Line-Organization": "wallet",
      },
      body: JSON.stringify({ address: facilityAddress.toLowerCase() }),
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      signal,
    });
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      throw new Error("Finalized facility state request aborted");
    }
    throw new Error("Finalized facility state network request failed");
  }

  if (!response.body) {
    throw new Error(`Finalized facility state read failed: response body missing (status ${response.status}).`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Server returned non-JSON response.");
  }

  const reader = response.body.getReader();
  let bytesRead = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      let chunkResult;
      try {
        chunkResult = await reader.read();
      } catch (readErr: unknown) {
        if (signal?.aborted || (readErr instanceof Error && readErr.name === "AbortError")) {
          throw new Error("Finalized facility state request aborted");
        }
        throw new Error("Failed to read finalized facility state stream");
      }
      const { done, value } = chunkResult;
      if (done) break;
      bytesRead += value.length;
      if (bytesRead > 1024 * 1024) {
        try {
          await reader.cancel();
        } catch {}
        throw new Error("Finalized state response exceeded maximum size limit (1 MB).");
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  const totalBuffer = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    totalBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(totalBuffer);
  } catch {
    throw new Error("Server returned malformed UTF-8 response.");
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Server returned malformed JSON response.");
  }

  if (!response.ok) {
    let message = `Finalized facility state read failed with status ${response.status}.`;
    if (data && typeof data === "object" && typeof (data as Record<string, unknown>).error === "string") {
      message = (data as Record<string, unknown>).error as string;
    }
    throw new Error(message);
  }

  return data as FinalizedFacilityStateEvidence;
}
