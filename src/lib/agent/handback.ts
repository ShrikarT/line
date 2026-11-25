import type {
  AgentBookOpeningPayload,
  AgentEncryptedEnvelope,
  AgentGrantScope,
} from './types.ts';
import * as L from '@midnight-ntwrk/ledger-v8';
import {
  assertWebCrypto,
  hexToBytes,
  toHex,
  importX25519PrivateKey,
  importX25519PublicKey,
  x25519PublicKey,
  assertUsableX25519Recipient,
  validateRawX25519Key,
  validateSchnorrKey,
  validateBookOpeningPayload,
} from './pairing.ts';
import {
  agentGrantMessage,
  browserAgentGrantDigest,
  grantOwnerRecipient,
} from './grant.ts';
import {
  drawNoteCommit,
  lineStateCommit,
  agentId,
  type DrawNotePreimage,
} from '../line/encoding.ts';
import { organizationMessageBytes } from '../organization/signing.ts';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX66 = /^[0-9a-f]{66}$/;
const HEX24 = /^[0-9a-f]{24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEC_UINT64 = /^(0|[1-9][0-9]{0,19})$/;
const UINT64_MAX = 18_446_744_073_709_551_615n;
const ALL_ZEROS_64 = '0'.repeat(64);

export const MAX_HANDBACK_CLAIMS = 50;
export const MAX_HANDBACK_PLAINTEXT_BYTES = 110_000;
export const MAX_HANDBACK_CIPHERTEXT_HEX_LEN = 220_032; // (110_000 + 16) * 2
export const MAX_HANDBACK_PACKAGE_BYTES = 250_000;

export interface AgentHandbackDrawReceipt {
  circuit: 'draw';
  contractAddress: string;
  identifier: string;
  txHash: string;
  blockHeight: number;
  blockHash: string;
  sourceFingerprint: string;
  outcome: 'success';
}

export interface AgentHandbackRedemptionReceipt {
  circuit: 'redeemDraw';
  contractAddress: string;
  txHash: string;
  blockHeight: number;
  blockHash: string;
  sourceFingerprint: string;
  outcome: 'success';
  noteCommitment: string;
  amount: string;
  identifier?: string;
}

export interface AgentHandbackClaimOpening {
  contractAddress: string;
  domain: string;
  identity: string;
  merchantPk: string;
  quoteCommitment: string;
  amount: string;
  fee: string;
  expiry: string;
  generation: string;
  noteNonce: string;
  noteSalt: string;
  noteCommitment: string;
  redeemed: boolean;
  taskId: string;
  orderId: string;
  drawIdentifier: string;
  drawReceipt: AgentHandbackDrawReceipt;
  redemptionReceipt: AgentHandbackRedemptionReceipt | null;
}

export interface AgentHandbackPayload {
  schema: 'line:agent-handback-payload/v1';
  grantId: string;
  facilityAddress: string;
  finalBook: AgentBookOpeningPayload;
  claims: AgentHandbackClaimOpening[];
}

export const HANDBACK_PACKAGE_FIELDS = Object.freeze([
  'schema',
  'handbackId',
  'grantId',
  'grantDigest',
  'pairingPackageDigest',
  'runnerSigningPublicKey',
  'returnPublicKey',
  'networkId',
  'facilityAddress',
  'domain',
  'sourceFingerprint',
  'agentPk',
  'generation',
  'storeRevision',
  'finalBookCommitment',
  'spent',
  'reserved',
  'claimsCount',
  'payloadDigest',
  'retiredAt',
  'envelopeDigest',
  'encryptedPayload',
  'runnerSignature',
] as const);

export const HANDBACK_SUMMARY_FIELDS = Object.freeze([
  'agentPk',
  'claimsCount',
  'domain',
  'envelopeDigest',
  'facilityAddress',
  'finalBookCommitment',
  'generation',
  'grantDigest',
  'grantId',
  'handbackId',
  'networkId',
  'pairingPackageDigest',
  'payloadDigest',
  'reserved',
  'retiredAt',
  'returnPublicKey',
  'runnerSigningPublicKey',
  'sourceFingerprint',
  'spent',
  'storeRevision',
] as const);

export interface AgentHandbackSummary {
  agentPk: string;
  claimsCount: number;
  domain: string;
  envelopeDigest: string;
  facilityAddress: string;
  finalBookCommitment: string;
  generation: string;
  grantDigest: string;
  grantId: string;
  handbackId: string;
  networkId: 'preprod';
  pairingPackageDigest: string;
  payloadDigest: string;
  reserved: '0';
  retiredAt: number;
  returnPublicKey: string;
  runnerSigningPublicKey: string;
  sourceFingerprint: string;
  spent: string;
  storeRevision: number;
}

export interface AgentHandbackPackage {
  schema: 'line:agent-handback-package/v1';
  handbackId: string;
  grantId: string;
  grantDigest: string;
  pairingPackageDigest: string;
  runnerSigningPublicKey: string;
  returnPublicKey: string;
  networkId: 'preprod';
  facilityAddress: string;
  domain: string;
  sourceFingerprint: string;
  agentPk: string;
  generation: string;
  storeRevision: number;
  finalBookCommitment: string;
  spent: string;
  reserved: '0';
  claimsCount: number;
  payloadDigest: string;
  retiredAt: number;
  envelopeDigest: string;
  encryptedPayload: AgentEncryptedEnvelope;
  runnerSignature: string;
}

export const HANDBACK_AAD_FIELDS = Object.freeze([
  'agentPk',
  'claimsCount',
  'domain',
  'facilityAddress',
  'finalBookCommitment',
  'generation',
  'grantDigest',
  'grantId',
  'handbackId',
  'iv',
  'networkId',
  'nonce',
  'pairingPackageDigest',
  'payloadDigest',
  'purpose',
  'reserved',
  'retiredAt',
  'returnPublicKey',
  'runnerSigningPublicKey',
  'sourceFingerprint',
  'spent',
  'storeRevision',
  'version',
] as const);

export const HANDBACK_CLAIM_FIELDS = Object.freeze([
  'contractAddress',
  'domain',
  'identity',
  'merchantPk',
  'quoteCommitment',
  'amount',
  'fee',
  'expiry',
  'generation',
  'noteNonce',
  'noteSalt',
  'noteCommitment',
  'redeemed',
  'taskId',
  'orderId',
  'drawIdentifier',
  'drawReceipt',
  'redemptionReceipt',
] as const);

export const HANDBACK_DRAW_RECEIPT_FIELDS = Object.freeze([
  'circuit',
  'contractAddress',
  'identifier',
  'txHash',
  'blockHeight',
  'blockHash',
  'sourceFingerprint',
  'outcome',
] as const);

export const HANDBACK_REDEMPTION_RECEIPT_REQUIRED_FIELDS = Object.freeze([
  'circuit',
  'contractAddress',
  'txHash',
  'blockHeight',
  'blockHash',
  'sourceFingerprint',
  'outcome',
  'noteCommitment',
  'amount',
] as const);

export const HANDBACK_PAYLOAD_FIELDS = Object.freeze([
  'schema',
  'grantId',
  'facilityAddress',
  'finalBook',
  'claims',
] as const);

export const HANDBACK_ENVELOPE_FIELDS = Object.freeze([
  'version',
  'purpose',
  'ephemeralPublicKey',
  'nonce',
  'iv',
  'ciphertext',
] as const);

export const CREATE_HANDBACK_PACKAGE_REQUIRED_FIELDS = Object.freeze([
  'handbackId',
  'scope',
  'grantDigest',
  'pairingPackageDigest',
  'storeRevision',
  'retiredAt',
  'finalBook',
  'claims',
  'runnerSigningPrivateKey',
  'nonceHex',
] as const);

export const VERIFY_HANDBACK_PACKAGE_EXPECTED_FIELDS = Object.freeze([
  'pinnedScope',
  'expectedGrantDigest',
  'expectedPairingPackageDigest',
  'initialBookOpening',
  'minRevision',
  'recipientPrivateKeyHex',
] as const);

export const ENCRYPT_HANDBACK_PAYLOAD_FIELDS = Object.freeze([
  'summary',
  'payload',
  'recipientPublicKeyHex',
  'nonceHex',
] as const);

export const DECRYPT_HANDBACK_PAYLOAD_FIELDS = Object.freeze([
  'envelope',
  'summary',
  'recipientPrivateKeyHex',
] as const);

export const BOOK_OPENING_FIELDS = Object.freeze([
  'agentSecret',
  'salt',
  'limit',
  'outstanding',
  'epoch',
  'generation',
] as const);

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      const prop = (value as any)[key];
      if (prop && typeof prop === 'object' && !Object.isFrozen(prop)) {
        deepFreeze(prop);
      }
    }
  }
  return value;
}

export function captureStrictRecord<T extends Record<string, any>>(
  value: unknown,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = [],
  label: string,
): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected a plain object.`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`Invalid ${label}: expected plain object prototype.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`Invalid ${label}: symbol properties are not permitted.`);
  }

  const ownNames = Object.getOwnPropertyNames(value);
  const allowedSet = new Set<string>([...requiredFields, ...optionalFields]);

  for (const key of ownNames) {
    if (!allowedSet.has(key)) {
      throw new Error(`Invalid ${label}: contains disallowed or unknown property ${key}.`);
    }
  }

  for (const key of requiredFields) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`Invalid ${label}: missing required property ${key}.`);
    }
  }

  const captured = Object.create(null) as Record<string, any>;
  for (const key of ownNames) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc) {
      throw new Error(`Invalid ${label}: missing property descriptor for ${key}.`);
    }
    if (desc.get !== undefined || desc.set !== undefined || !('value' in desc)) {
      throw new Error(`Invalid ${label}: accessors are not permitted on ${key}.`);
    }
    if (!desc.enumerable) {
      throw new Error(`Invalid ${label}: non-enumerable properties are not permitted on ${key}.`);
    }
    captured[key] = desc.value;
  }

  return captured as T;
}

export function captureStrictArray(
  value: unknown,
  maxLen: number,
  label: string,
): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected an array.`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error(`Invalid ${label}: expected standard Array prototype.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`Invalid ${label}: symbol properties are not permitted on array.`);
  }
  if (!Number.isSafeInteger(value.length) || value.length < 0 || value.length > maxLen) {
    throw new Error(`Invalid ${label}: array length out of bounds (exceeds capacity).`);
  }
  const ownNames = Object.getOwnPropertyNames(value);
  if (ownNames.length !== value.length + 1) {
    throw new Error(`Invalid ${label}: sparse arrays or extra array properties are not permitted.`);
  }

  const result = new Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const key = String(i);
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc) {
      throw new Error(`Invalid ${label}: missing element at index ${i}.`);
    }
    if (desc.get !== undefined || desc.set !== undefined || !('value' in desc)) {
      throw new Error(`Invalid ${label}: accessors are not permitted on array index ${i}.`);
    }
    if (!desc.enumerable) {
      throw new Error(`Invalid ${label}: non-enumerable elements are not permitted on array index ${i}.`);
    }
    result[i] = desc.value;
  }
  return result;
}

function canonicalize(value: any): any {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonicalize(value[k])]),
    );
  }
  return value;
}

export function captureStrictScope(scopeInput: unknown): AgentGrantScope {
  const scopeFields = [
    'schema',
    'grantId',
    'networkId',
    'facilityAddress',
    'domain',
    'sourceFingerprint',
    'ownerAddress',
    'runnerOrigin',
    'runnerPublicKey',
    'runnerSigningPublicKey',
    'returnPublicKey',
    'agentPk',
    'generation',
    'bookCommitment',
    'nonce',
    'issuedAt',
    'expiresAt',
    'maxSpend',
    'maxFee',
    'allowedServices',
    'allowedMerchants',
  ] as const;

  const captured = captureStrictRecord<Record<string, any>>(scopeInput, scopeFields, [], 'Agent grant scope');

  if (captured.schema !== 'line:agent-grant/v1') {
    throw new Error('Invalid agent grant schema.');
  }
  if (captured.networkId !== 'preprod') {
    throw new Error('Invalid agent grant networkId.');
  }
  if (typeof captured.grantId !== 'string' || !UUID.test(captured.grantId)) {
    throw new Error('Invalid agent grant grantId.');
  }
  for (const key of [
    'facilityAddress',
    'domain',
    'sourceFingerprint',
    'runnerPublicKey',
    'runnerSigningPublicKey',
    'returnPublicKey',
    'agentPk',
    'bookCommitment',
    'nonce',
  ] as const) {
    if (typeof captured[key] !== 'string' || !HEX64.test(captured[key]) || captured[key] === ALL_ZEROS_64) {
      throw new Error(`Invalid agent grant ${key}.`);
    }
  }
  for (const key of ['generation', 'maxSpend', 'maxFee'] as const) {
    if (typeof captured[key] !== 'string' || !DEC_UINT64.test(captured[key]) || BigInt(captured[key]) > UINT64_MAX) {
      throw new Error(`Invalid agent grant ${key}.`);
    }
  }
  if (typeof captured.issuedAt !== 'number' || !Number.isSafeInteger(captured.issuedAt) || captured.issuedAt <= 0) {
    throw new Error('Invalid agent grant issuedAt.');
  }
  if (typeof captured.expiresAt !== 'number' || !Number.isSafeInteger(captured.expiresAt) || captured.expiresAt <= captured.issuedAt) {
    throw new Error('Invalid agent grant expiresAt.');
  }
  if (typeof captured.ownerAddress !== 'string') {
    throw new Error('Invalid agent grant ownerAddress.');
  }
  grantOwnerRecipient(captured.ownerAddress);
  if (typeof captured.runnerOrigin !== 'string') {
    throw new Error('Invalid agent grant runnerOrigin.');
  }

  const allowedServices = captureStrictArray(captured.allowedServices, 16, 'Agent grant scope allowedServices') as string[];
  for (const s of allowedServices) {
    if (typeof s !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(s)) {
      throw new Error('Invalid agent grant allowedServices entry.');
    }
  }

  const allowedMerchants = captureStrictArray(captured.allowedMerchants, 16, 'Agent grant scope allowedMerchants') as string[];
  for (const m of allowedMerchants) {
    if (typeof m !== 'string' || !HEX64.test(m) || m === ALL_ZEROS_64) {
      throw new Error('Invalid agent grant allowedMerchants entry.');
    }
  }

  const cleanScope: AgentGrantScope = {
    schema: captured.schema,
    grantId: captured.grantId,
    networkId: captured.networkId,
    facilityAddress: captured.facilityAddress.toLowerCase(),
    domain: captured.domain.toLowerCase(),
    sourceFingerprint: captured.sourceFingerprint.toLowerCase(),
    ownerAddress: captured.ownerAddress.toLowerCase(),
    runnerOrigin: captured.runnerOrigin,
    runnerPublicKey: captured.runnerPublicKey.toLowerCase(),
    runnerSigningPublicKey: captured.runnerSigningPublicKey.toLowerCase(),
    returnPublicKey: captured.returnPublicKey.toLowerCase(),
    agentPk: captured.agentPk.toLowerCase(),
    generation: captured.generation,
    bookCommitment: captured.bookCommitment.toLowerCase(),
    nonce: captured.nonce.toLowerCase(),
    issuedAt: captured.issuedAt,
    expiresAt: captured.expiresAt,
    maxSpend: captured.maxSpend,
    maxFee: captured.maxFee,
    allowedServices: [...allowedServices],
    allowedMerchants: allowedMerchants.map((m) => m.toLowerCase()),
  };

  agentGrantMessage(cleanScope);
  return deepFreeze(cleanScope);
}

export function captureStrictBookOpening(bookInput: unknown): AgentBookOpeningPayload {
  const captured = captureStrictRecord<Record<string, any>>(bookInput, BOOK_OPENING_FIELDS, [], 'Book opening payload');
  const validated = validateBookOpeningPayload(captured);
  return deepFreeze({
    agentSecret: validated.agentSecret,
    salt: validated.salt,
    limit: validated.limit,
    outstanding: validated.outstanding,
    epoch: validated.epoch,
    generation: validated.generation,
  });
}

export function validateHandbackDrawReceipt(receipt: unknown): AgentHandbackDrawReceipt {
  const r = captureStrictRecord<Record<string, any>>(receipt, HANDBACK_DRAW_RECEIPT_FIELDS, [], 'Handback draw receipt');
  if (r.circuit !== 'draw') {
    throw new Error('Handback draw receipt invalid circuit.');
  }
  if (typeof r.contractAddress !== 'string' || !HEX64.test(r.contractAddress) || r.contractAddress === ALL_ZEROS_64) {
    throw new Error('Handback draw receipt invalid contractAddress.');
  }
  if (typeof r.identifier !== 'string' || !HEX66.test(r.identifier)) {
    throw new Error('Handback draw receipt invalid identifier.');
  }
  if (typeof r.txHash !== 'string' || !HEX64.test(r.txHash) || r.txHash === ALL_ZEROS_64) {
    throw new Error('Handback draw receipt invalid txHash.');
  }
  if (typeof r.blockHeight !== 'number' || !Number.isSafeInteger(r.blockHeight) || r.blockHeight <= 0) {
    throw new Error('Handback draw receipt invalid blockHeight.');
  }
  if (typeof r.blockHash !== 'string' || !HEX64.test(r.blockHash) || r.blockHash === ALL_ZEROS_64) {
    throw new Error('Handback draw receipt invalid blockHash.');
  }
  if (typeof r.sourceFingerprint !== 'string' || !HEX64.test(r.sourceFingerprint) || r.sourceFingerprint === ALL_ZEROS_64) {
    throw new Error('Handback draw receipt invalid sourceFingerprint.');
  }
  if (r.outcome !== 'success') {
    throw new Error('Handback draw receipt invalid outcome.');
  }
  return deepFreeze({
    circuit: 'draw',
    contractAddress: r.contractAddress,
    identifier: r.identifier,
    txHash: r.txHash,
    blockHeight: r.blockHeight,
    blockHash: r.blockHash,
    sourceFingerprint: r.sourceFingerprint,
    outcome: 'success',
  });
}

export function validateHandbackRedemptionReceipt(receipt: unknown): AgentHandbackRedemptionReceipt {
  const r = captureStrictRecord<Record<string, any>>(
    receipt,
    HANDBACK_REDEMPTION_RECEIPT_REQUIRED_FIELDS,
    ['identifier'],
    'Handback redemption receipt',
  );
  if (r.circuit !== 'redeemDraw') {
    throw new Error('Handback redemption receipt invalid circuit.');
  }
  if (typeof r.contractAddress !== 'string' || !HEX64.test(r.contractAddress) || r.contractAddress === ALL_ZEROS_64) {
    throw new Error('Handback redemption receipt invalid contractAddress.');
  }
  if (typeof r.txHash !== 'string' || !HEX64.test(r.txHash) || r.txHash === ALL_ZEROS_64) {
    throw new Error('Handback redemption receipt invalid txHash.');
  }
  if (typeof r.blockHeight !== 'number' || !Number.isSafeInteger(r.blockHeight) || r.blockHeight <= 0) {
    throw new Error('Handback redemption receipt invalid blockHeight.');
  }
  if (typeof r.blockHash !== 'string' || !HEX64.test(r.blockHash) || r.blockHash === ALL_ZEROS_64) {
    throw new Error('Handback redemption receipt invalid blockHash.');
  }
  if (typeof r.sourceFingerprint !== 'string' || !HEX64.test(r.sourceFingerprint) || r.sourceFingerprint === ALL_ZEROS_64) {
    throw new Error('Handback redemption receipt invalid sourceFingerprint.');
  }
  if (r.outcome !== 'success') {
    throw new Error('Handback redemption receipt invalid outcome.');
  }
  if (typeof r.noteCommitment !== 'string' || !HEX64.test(r.noteCommitment) || r.noteCommitment === ALL_ZEROS_64) {
    throw new Error('Handback redemption receipt invalid noteCommitment.');
  }
  if (typeof r.amount !== 'string' || !DEC_UINT64.test(r.amount) || BigInt(r.amount) > UINT64_MAX || BigInt(r.amount) === 0n) {
    throw new Error('Handback redemption receipt invalid amount.');
  }
  if (r.identifier !== undefined) {
    if (typeof r.identifier !== 'string' || !HEX66.test(r.identifier)) {
      throw new Error('Handback redemption receipt invalid identifier.');
    }
  }
  return deepFreeze({
    circuit: 'redeemDraw',
    contractAddress: r.contractAddress,
    txHash: r.txHash,
    blockHeight: r.blockHeight,
    blockHash: r.blockHash,
    sourceFingerprint: r.sourceFingerprint,
    outcome: 'success',
    noteCommitment: r.noteCommitment,
    amount: r.amount,
    ...(r.identifier !== undefined ? { identifier: r.identifier } : {}),
  });
}

export function validateHandbackClaimOpening(claim: unknown): AgentHandbackClaimOpening {
  const c = captureStrictRecord<Record<string, any>>(claim, HANDBACK_CLAIM_FIELDS, [], 'Handback claim opening');

  for (const f of ['contractAddress', 'domain', 'identity', 'merchantPk', 'quoteCommitment', 'noteNonce', 'noteSalt', 'noteCommitment'] as const) {
    if (typeof c[f] !== 'string' || !HEX64.test(c[f]) || c[f] === ALL_ZEROS_64) {
      throw new Error(`Handback claim opening invalid ${f}.`);
    }
  }

  for (const f of ['amount', 'fee', 'expiry', 'generation'] as const) {
    if (typeof c[f] !== 'string' || !DEC_UINT64.test(c[f]) || BigInt(c[f]) > UINT64_MAX) {
      throw new Error(`Handback claim opening invalid ${f}.`);
    }
  }
  if (BigInt(c.amount) === 0n) {
    throw new Error('Handback claim opening amount must be positive.');
  }
  if (BigInt(c.expiry) === 0n) {
    throw new Error('Handback claim opening expiry must be positive.');
  }
  if (BigInt(c.generation) === 0n) {
    throw new Error('Handback claim opening generation must be positive.');
  }
  if (typeof c.redeemed !== 'boolean') {
    throw new Error('Handback claim opening invalid redeemed flag.');
  }
  if (typeof c.taskId !== 'string' || !UUID.test(c.taskId)) {
    throw new Error('Handback claim opening invalid taskId.');
  }
  if (typeof c.orderId !== 'string' || !UUID.test(c.orderId)) {
    throw new Error('Handback claim opening invalid orderId.');
  }
  if (c.taskId !== c.orderId) {
    throw new Error('Handback claim opening taskId and orderId must match.');
  }
  if (typeof c.drawIdentifier !== 'string' || !HEX66.test(c.drawIdentifier)) {
    throw new Error('Handback claim opening invalid drawIdentifier.');
  }

  const drawReceipt = validateHandbackDrawReceipt(c.drawReceipt);
  if (drawReceipt.contractAddress !== c.contractAddress) {
    throw new Error('Handback draw receipt contractAddress mismatch.');
  }
  if (drawReceipt.identifier !== c.drawIdentifier) {
    throw new Error('Handback draw receipt identifier mismatch.');
  }

  let redemptionReceipt: AgentHandbackRedemptionReceipt | null = null;
  if (c.redeemed) {
    if (!c.redemptionReceipt) {
      throw new Error('Handback redeemed claim missing redemptionReceipt.');
    }
    redemptionReceipt = validateHandbackRedemptionReceipt(c.redemptionReceipt);
    if (redemptionReceipt.contractAddress !== c.contractAddress) {
      throw new Error('Handback redemption receipt contractAddress mismatch.');
    }
    if (redemptionReceipt.noteCommitment !== c.noteCommitment) {
      throw new Error('Handback redemption receipt noteCommitment mismatch.');
    }
    if (redemptionReceipt.amount !== c.amount) {
      throw new Error('Handback redemption receipt amount mismatch.');
    }
  } else {
    if (c.redemptionReceipt !== null) {
      throw new Error('Handback unredeemed claim must have null redemptionReceipt.');
    }
  }

  return deepFreeze({
    contractAddress: c.contractAddress,
    domain: c.domain,
    identity: c.identity,
    merchantPk: c.merchantPk,
    quoteCommitment: c.quoteCommitment,
    amount: c.amount,
    fee: c.fee,
    expiry: c.expiry,
    generation: c.generation,
    noteNonce: c.noteNonce,
    noteSalt: c.noteSalt,
    noteCommitment: c.noteCommitment,
    redeemed: c.redeemed,
    taskId: c.taskId,
    orderId: c.orderId,
    drawIdentifier: c.drawIdentifier,
    drawReceipt,
    redemptionReceipt,
  });
}

export function validateHandbackPayload(payload: unknown): AgentHandbackPayload {
  const p = captureStrictRecord<Record<string, any>>(payload, HANDBACK_PAYLOAD_FIELDS, [], 'Handback payload');
  if (p.schema !== 'line:agent-handback-payload/v1') {
    throw new Error('Handback payload invalid schema.');
  }
  if (typeof p.grantId !== 'string' || !UUID.test(p.grantId)) {
    throw new Error('Handback payload invalid grantId.');
  }
  if (typeof p.facilityAddress !== 'string' || !HEX64.test(p.facilityAddress) || p.facilityAddress === ALL_ZEROS_64) {
    throw new Error('Handback payload invalid facilityAddress.');
  }
  const finalBook = captureStrictBookOpening(p.finalBook);
  const rawClaims = captureStrictArray(p.claims, MAX_HANDBACK_CLAIMS, 'Handback payload claims');

  const seenTaskIds = new Set<string>();
  const seenDrawIdentifiers = new Set<string>();
  const seenNoteNonces = new Set<string>();
  const seenNoteCommitments = new Set<string>();

  const claims: AgentHandbackClaimOpening[] = [];
  for (const item of rawClaims) {
    const claim = validateHandbackClaimOpening(item);
    if (claim.contractAddress !== p.facilityAddress) {
      throw new Error('Handback claim contractAddress mismatch with payload facilityAddress.');
    }
    if (seenTaskIds.has(claim.taskId)) {
      throw new Error('Handback duplicate taskId across claims.');
    }
    seenTaskIds.add(claim.taskId);

    if (seenDrawIdentifiers.has(claim.drawIdentifier)) {
      throw new Error('Handback duplicate drawIdentifier across claims.');
    }
    seenDrawIdentifiers.add(claim.drawIdentifier);

    if (seenNoteNonces.has(claim.noteNonce)) {
      throw new Error('Handback duplicate noteNonce across claims.');
    }
    seenNoteNonces.add(claim.noteNonce);

    if (seenNoteCommitments.has(claim.noteCommitment)) {
      throw new Error('Handback duplicate noteCommitment across claims.');
    }
    seenNoteCommitments.add(claim.noteCommitment);

    claims.push(claim);
  }

  return deepFreeze({
    schema: 'line:agent-handback-payload/v1',
    grantId: p.grantId,
    facilityAddress: p.facilityAddress,
    finalBook,
    claims,
  });
}

export function canonicalHandbackPayloadMessage(payload: unknown): string {
  const validated = validateHandbackPayload(payload);
  return 'line:agent-handback-payload/v1\0' + JSON.stringify(canonicalize(validated));
}

export async function handbackPayloadDigest(payload: unknown): Promise<string> {
  const messageBytes = new TextEncoder().encode(canonicalHandbackPayloadMessage(payload));
  const subtle = assertWebCrypto();
  const hashBuf = await subtle.digest('SHA-256', messageBytes);
  return toHex(new Uint8Array(hashBuf));
}

export function validateHandbackEnvelope(envelope: unknown): AgentEncryptedEnvelope {
  const e = captureStrictRecord<Record<string, any>>(envelope, HANDBACK_ENVELOPE_FIELDS, [], 'Handback envelope');
  if (e.version !== 1) {
    throw new Error('Invalid handback envelope version.');
  }
  if (e.purpose !== 'line:agent-handback/v1') {
    throw new Error('Invalid handback envelope purpose.');
  }
  if (typeof e.ephemeralPublicKey !== 'string' || !HEX64.test(e.ephemeralPublicKey) || e.ephemeralPublicKey === ALL_ZEROS_64) {
    throw new Error('Invalid handback envelope ephemeralPublicKey.');
  }
  validateRawX25519Key(e.ephemeralPublicKey, 'ephemeralPublicKey');

  if (typeof e.nonce !== 'string' || !HEX64.test(e.nonce) || e.nonce === ALL_ZEROS_64) {
    throw new Error('Invalid handback envelope nonce.');
  }
  if (typeof e.iv !== 'string' || !HEX24.test(e.iv)) {
    throw new Error('Invalid handback envelope iv.');
  }
  if (
    typeof e.ciphertext !== 'string' ||
    e.ciphertext.length < 32 || // Minimum 16 bytes for AES-GCM auth tag (32 hex characters)
    e.ciphertext.length > MAX_HANDBACK_CIPHERTEXT_HEX_LEN ||
    e.ciphertext.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(e.ciphertext)
  ) {
    throw new Error('Invalid handback envelope ciphertext.');
  }

  return deepFreeze({
    version: 1,
    purpose: 'line:agent-handback/v1',
    ephemeralPublicKey: e.ephemeralPublicKey.toLowerCase(),
    nonce: e.nonce.toLowerCase(),
    iv: e.iv.toLowerCase(),
    ciphertext: e.ciphertext.toLowerCase(),
  });
}

export function canonicalHandbackEnvelopeMessage(envelope: unknown): string {
  const e = validateHandbackEnvelope(envelope);
  const canonical = {
    ciphertext: e.ciphertext,
    ephemeralPublicKey: e.ephemeralPublicKey,
    iv: e.iv,
    nonce: e.nonce,
    purpose: e.purpose,
    version: e.version,
  };
  return 'line:agent-handback-envelope/v1\0' + JSON.stringify(canonical);
}

export async function handbackEnvelopeDigest(envelope: unknown): Promise<string> {
  const messageBytes = new TextEncoder().encode(canonicalHandbackEnvelopeMessage(envelope));
  const subtle = assertWebCrypto();
  const hashBuf = await subtle.digest('SHA-256', messageBytes);
  return toHex(new Uint8Array(hashBuf));
}

export function validateHandbackSummary(
  summary: unknown,
  includeEnvelopeDigest = true,
): AgentHandbackSummary {
  const fields = includeEnvelopeDigest
    ? HANDBACK_SUMMARY_FIELDS
    : HANDBACK_SUMMARY_FIELDS.filter((k) => k !== 'envelopeDigest');

  const s = captureStrictRecord<Record<string, any>>(summary, fields, [], 'Handback summary');

  if (s.networkId !== 'preprod') {
    throw new Error('Handback summary invalid networkId.');
  }
  if (!UUID.test(s.grantId) || !UUID.test(s.handbackId)) {
    throw new Error('Handback summary invalid grantId or handbackId.');
  }
  for (const f of ['agentPk', 'domain', 'facilityAddress', 'finalBookCommitment', 'grantDigest', 'pairingPackageDigest', 'payloadDigest', 'returnPublicKey', 'runnerSigningPublicKey', 'sourceFingerprint'] as const) {
    if (typeof s[f] !== 'string' || !HEX64.test(s[f]) || s[f] === ALL_ZEROS_64) {
      throw new Error(`Handback summary invalid ${f}.`);
    }
  }
  if (includeEnvelopeDigest) {
    if (typeof s.envelopeDigest !== 'string' || !HEX64.test(s.envelopeDigest) || s.envelopeDigest === ALL_ZEROS_64) {
      throw new Error('Handback summary invalid envelopeDigest.');
    }
  }
  for (const f of ['generation', 'spent'] as const) {
    if (typeof s[f] !== 'string' || !DEC_UINT64.test(s[f]) || BigInt(s[f]) > UINT64_MAX) {
      throw new Error(`Handback summary invalid ${f}.`);
    }
  }
  if (BigInt(s.generation) === 0n) {
    throw new Error('Handback summary generation must be positive.');
  }
  if (s.reserved !== '0') {
    throw new Error('Handback summary reserved must be "0".');
  }
  if (!Number.isSafeInteger(s.claimsCount) || s.claimsCount < 0 || s.claimsCount > MAX_HANDBACK_CLAIMS) {
    throw new Error('Handback summary invalid claimsCount.');
  }
  if (!Number.isSafeInteger(s.storeRevision) || s.storeRevision <= 0) {
    throw new Error('Handback summary invalid storeRevision.');
  }
  if (!Number.isSafeInteger(s.retiredAt) || s.retiredAt <= 0) {
    throw new Error('Handback summary invalid retiredAt.');
  }

  const result: any = {
    agentPk: s.agentPk,
    claimsCount: s.claimsCount,
    domain: s.domain,
    facilityAddress: s.facilityAddress,
    finalBookCommitment: s.finalBookCommitment,
    generation: s.generation,
    grantDigest: s.grantDigest,
    grantId: s.grantId,
    handbackId: s.handbackId,
    networkId: 'preprod',
    pairingPackageDigest: s.pairingPackageDigest,
    payloadDigest: s.payloadDigest,
    reserved: '0',
    retiredAt: s.retiredAt,
    returnPublicKey: s.returnPublicKey,
    runnerSigningPublicKey: s.runnerSigningPublicKey,
    sourceFingerprint: s.sourceFingerprint,
    spent: s.spent,
    storeRevision: s.storeRevision,
  };
  if (includeEnvelopeDigest) {
    result.envelopeDigest = s.envelopeDigest;
  }
  return deepFreeze(result);
}

export function createHandbackAad(
  summary: unknown,
  envelope: unknown,
): Uint8Array<ArrayBuffer> {
  const s = validateHandbackSummary(summary, false);
  const e = validateHandbackEnvelope(envelope);

  const aadObj: Record<string, any> = {
    agentPk: s.agentPk,
    claimsCount: s.claimsCount,
    domain: s.domain,
    facilityAddress: s.facilityAddress,
    finalBookCommitment: s.finalBookCommitment,
    generation: s.generation,
    grantDigest: s.grantDigest,
    grantId: s.grantId,
    handbackId: s.handbackId,
    iv: e.iv,
    networkId: s.networkId,
    nonce: e.nonce,
    pairingPackageDigest: s.pairingPackageDigest,
    payloadDigest: s.payloadDigest,
    purpose: 'line:agent-handback/v1',
    reserved: '0',
    retiredAt: s.retiredAt,
    returnPublicKey: s.returnPublicKey,
    runnerSigningPublicKey: s.runnerSigningPublicKey,
    sourceFingerprint: s.sourceFingerprint,
    spent: s.spent,
    storeRevision: s.storeRevision,
    version: 1,
  };

  for (const k of HANDBACK_AAD_FIELDS) {
    if (!Object.hasOwn(aadObj, k)) {
      throw new Error(`Missing field ${k} in handback AAD.`);
    }
  }

  const canonicalAad = Object.fromEntries(
    Object.keys(aadObj)
      .sort()
      .map((k) => [k, aadObj[k]]),
  );
  return new TextEncoder().encode(JSON.stringify(canonicalAad));
}

export function handbackSummaryMessage(summary: unknown): string {
  const s = validateHandbackSummary(summary, true);
  return (
    'Line agent handback checkpoint\n' +
    JSON.stringify(Object.fromEntries(HANDBACK_SUMMARY_FIELDS.map((k) => [k, s[k]])))
  );
}

export async function signHandbackSummary(
  summary: unknown,
  runnerSigningPrivateKey: string,
): Promise<string> {
  const capturedSummary = validateHandbackSummary(summary, true);
  if (typeof runnerSigningPrivateKey !== 'string' || !HEX64.test(runnerSigningPrivateKey)) {
    throw new Error('Invalid runnerSigningPrivateKey format.');
  }
  validateSchnorrKey(runnerSigningPrivateKey, 'runnerSigningPrivateKey');
  const messageStr = handbackSummaryMessage(capturedSummary);
  const signatureBytes = L.signData(
    runnerSigningPrivateKey,
    organizationMessageBytes(messageStr),
  );
  return typeof signatureBytes === 'string' ? signatureBytes : toHex(signatureBytes);
}

export async function encryptHandbackPayload(options: unknown): Promise<AgentEncryptedEnvelope> {
  // Capture all inputs synchronously before ANY await
  const capturedOpts = captureStrictRecord<Record<string, any>>(
    options,
    ENCRYPT_HANDBACK_PAYLOAD_FIELDS,
    [],
    'Encrypt handback payload options',
  );

  const summarySnapshot = validateHandbackSummary(capturedOpts.summary, false);
  const payloadSnapshot = validateHandbackPayload(capturedOpts.payload);
  const nonce = capturedOpts.nonceHex;
  const recipientPublicKeyHex = capturedOpts.recipientPublicKeyHex;

  if (typeof nonce !== 'string' || !HEX64.test(nonce) || nonce === ALL_ZEROS_64) {
    throw new Error('Invalid nonce for handback encryption.');
  }
  validateRawX25519Key(recipientPublicKeyHex, 'recipientPublicKeyHex');

  const payloadJson = JSON.stringify(payloadSnapshot);
  const plaintextBytes = new TextEncoder().encode(payloadJson);
  if (plaintextBytes.byteLength > MAX_HANDBACK_PLAINTEXT_BYTES) {
    throw new Error('Handback payload exceeds maximum plaintext byte capacity.');
  }

  await assertUsableX25519Recipient(recipientPublicKeyHex);
  const recipientCryptoKey = await importX25519PublicKey(recipientPublicKeyHex, 'recipientPublicKey');
  const subtle = assertWebCrypto();

  let ephemeralKeyPair: CryptoKeyPair;
  try {
    const generated = await subtle.generateKey({ name: 'X25519' }, true, ['deriveKey', 'deriveBits']);
    if (!('privateKey' in generated) || !('publicKey' in generated)) {
      throw new Error('Expected an X25519 key pair.');
    }
    ephemeralKeyPair = generated;
  } catch (err: any) {
    throw new Error(`Failed to generate ephemeral X25519 key: ${err?.message ?? String(err)}`);
  }

  const ephemeralPubRaw = new Uint8Array(await subtle.exportKey('raw', ephemeralKeyPair.publicKey));
  const ephemeralPublicKey = toHex(ephemeralPubRaw);

  let sharedBits: ArrayBuffer;
  try {
    sharedBits = await subtle.deriveBits(
      { name: 'X25519', public: recipientCryptoKey },
      ephemeralKeyPair.privateKey,
      256,
    );
  } catch (err: any) {
    throw new Error(`X25519 ECDH key agreement failed: ${err?.message ?? String(err)}`);
  }

  if (!new Uint8Array(sharedBits).some((b) => b !== 0)) {
    throw new Error('X25519 shared secret is zero.');
  }

  const saltBytes = hexToBytes(nonce);
  const ikmKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const infoBytes = new TextEncoder().encode('line:agent-handback/v1');
  const aesKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes },
    ikmKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ivHex = toHex(iv);

  const partialEnvelope: AgentEncryptedEnvelope = {
    version: 1,
    purpose: 'line:agent-handback/v1',
    ephemeralPublicKey,
    nonce,
    iv: ivHex,
    ciphertext: '00'.repeat(16), // dummy for AAD construction
  };

  const aad = createHandbackAad(summarySnapshot, partialEnvelope);
  const ciphertextBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    aesKey,
    plaintextBytes,
  );

  const ciphertextHex = toHex(new Uint8Array(ciphertextBuf));
  if (
    ciphertextHex.length < 32 ||
    ciphertextHex.length > MAX_HANDBACK_CIPHERTEXT_HEX_LEN ||
    ciphertextHex.length % 2 !== 0
  ) {
    throw new Error('Ciphertext exceeds maximum allowed length or is empty.');
  }

  return deepFreeze({
    version: 1,
    purpose: 'line:agent-handback/v1',
    ephemeralPublicKey,
    nonce,
    iv: ivHex,
    ciphertext: ciphertextHex,
  });
}

export async function decryptHandbackPayload(options: unknown): Promise<AgentHandbackPayload> {
  // Capture all inputs synchronously before ANY await
  const capturedOpts = captureStrictRecord<Record<string, any>>(
    options,
    DECRYPT_HANDBACK_PAYLOAD_FIELDS,
    [],
    'Decrypt handback payload options',
  );

  const envelope = validateHandbackEnvelope(capturedOpts.envelope);
  const summary = validateHandbackSummary(capturedOpts.summary, false);
  const recipientPrivateKeyHex = capturedOpts.recipientPrivateKeyHex;

  if (typeof recipientPrivateKeyHex !== 'string' || !HEX64.test(recipientPrivateKeyHex)) {
    throw new Error('Invalid recipientPrivateKey format.');
  }
  validateRawX25519Key(recipientPrivateKeyHex, 'recipientPrivateKey');

  await assertUsableX25519Recipient(envelope.ephemeralPublicKey);
  const recipientCryptoKey = await importX25519PrivateKey(recipientPrivateKeyHex, 'recipientPrivateKey');
  const ephemeralCryptoKey = await importX25519PublicKey(envelope.ephemeralPublicKey, 'ephemeralPublicKey');

  const subtle = assertWebCrypto();
  let sharedBits: ArrayBuffer;
  try {
    sharedBits = await subtle.deriveBits(
      { name: 'X25519', public: ephemeralCryptoKey },
      recipientCryptoKey,
      256,
    );
  } catch (err: any) {
    throw new Error(`X25519 ECDH key agreement failed: ${err?.message ?? String(err)}`);
  }

  if (!new Uint8Array(sharedBits).some((b) => b !== 0)) {
    throw new Error('X25519 shared secret is zero.');
  }

  const saltBytes = hexToBytes(envelope.nonce);
  const ikmKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const infoBytes = new TextEncoder().encode(envelope.purpose);
  const aesKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes },
    ikmKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  const aad = createHandbackAad(summary, envelope);
  let plaintextBuf: ArrayBuffer;
  try {
    plaintextBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(envelope.iv), additionalData: aad, tagLength: 128 },
      aesKey,
      hexToBytes(envelope.ciphertext),
    );
  } catch {
    throw new Error('Decryption failed: authenticated envelope or AAD is corrupted or tampered.');
  }

  // Check plaintext cap BEFORE JSON parse
  if (plaintextBuf.byteLength > MAX_HANDBACK_PLAINTEXT_BYTES) {
    throw new Error('Decrypted plaintext exceeds maximum allowed byte capacity.');
  }

  // Fatal UTF-8 decode
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let plaintextStr: string;
  try {
    plaintextStr = decoder.decode(plaintextBuf);
  } catch {
    throw new Error('Decrypted payload is not valid UTF-8.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintextStr);
  } catch {
    throw new Error('Decrypted payload is not valid JSON.');
  }

  return validateHandbackPayload(parsed);
}

export async function createHandbackPackage(options: unknown): Promise<AgentHandbackPackage> {
  // Capture all caller-provided data synchronously before ANY await!
  const capturedOpts = captureStrictRecord<Record<string, any>>(
    options,
    CREATE_HANDBACK_PACKAGE_REQUIRED_FIELDS,
    ['initialBook'],
    'Create handback package options',
  );

  const handbackId = capturedOpts.handbackId;
  if (typeof handbackId !== 'string' || !UUID.test(handbackId)) {
    throw new Error('Invalid handbackId in createHandbackPackage.');
  }

  const grantDigest = capturedOpts.grantDigest;
  if (typeof grantDigest !== 'string' || !HEX64.test(grantDigest) || grantDigest === ALL_ZEROS_64) {
    throw new Error('Invalid grantDigest: must be 64-character hex string.');
  }

  const pairingPackageDigest = capturedOpts.pairingPackageDigest;
  if (typeof pairingPackageDigest !== 'string' || !HEX64.test(pairingPackageDigest) || pairingPackageDigest === ALL_ZEROS_64) {
    throw new Error('Invalid pairingPackageDigest.');
  }

  const storeRevision = capturedOpts.storeRevision;
  if (typeof storeRevision !== 'number' || !Number.isSafeInteger(storeRevision) || storeRevision <= 0) {
    throw new Error('Invalid storeRevision: must be positive safe integer.');
  }

  const retiredAt = capturedOpts.retiredAt;
  if (typeof retiredAt !== 'number' || !Number.isSafeInteger(retiredAt) || retiredAt <= 0) {
    throw new Error('Invalid retiredAt: must be positive safe integer.');
  }

  const runnerSigningPrivateKey = capturedOpts.runnerSigningPrivateKey;
  if (typeof runnerSigningPrivateKey !== 'string' || !HEX64.test(runnerSigningPrivateKey)) {
    throw new Error('Invalid runnerSigningPrivateKey format.');
  }
  validateSchnorrKey(runnerSigningPrivateKey, 'runnerSigningPrivateKey');

  const nonceHex = capturedOpts.nonceHex;
  if (typeof nonceHex !== 'string' || !HEX64.test(nonceHex) || nonceHex === ALL_ZEROS_64) {
    throw new Error('Invalid nonceHex.');
  }

  const scope = captureStrictScope(capturedOpts.scope);
  if (retiredAt < scope.issuedAt) {
    throw new Error('Invalid retiredAt: must not be earlier than grant issuedAt.');
  }

  const derivedSigningPub = L.signatureVerifyingKey(runnerSigningPrivateKey);
  if (derivedSigningPub !== scope.runnerSigningPublicKey) {
    throw new Error('runnerSigningPrivateKey does not derive scope runnerSigningPublicKey.');
  }

  const finalBook = captureStrictBookOpening(capturedOpts.finalBook);
  const initialBook = capturedOpts.initialBook !== undefined ? captureStrictBookOpening(capturedOpts.initialBook) : undefined;

  const rawClaims = captureStrictArray(capturedOpts.claims, MAX_HANDBACK_CLAIMS, 'Create handback package claims');
  const claims: AgentHandbackClaimOpening[] = [];
  let totalSpent = 0n;

  for (const rawClaim of rawClaims) {
    const claim = validateHandbackClaimOpening(rawClaim);
    if (claim.contractAddress !== scope.facilityAddress) {
      throw new Error('Claim contractAddress does not match scope facilityAddress.');
    }
    if (claim.domain !== scope.domain) {
      throw new Error('Claim domain does not match scope domain.');
    }
    if (claim.identity !== scope.agentPk) {
      throw new Error('Claim identity does not match scope agentPk.');
    }
    if (claim.generation !== scope.generation) {
      throw new Error('Claim generation does not match scope generation.');
    }
    if (!scope.allowedMerchants.includes(claim.merchantPk)) {
      throw new Error('Claim merchant is not authorized in scope.');
    }

    const charge = BigInt(claim.amount) + BigInt(claim.fee);
    if (charge > UINT64_MAX - totalSpent) {
      throw new Error('Claims total amount overflows uint64.');
    }
    totalSpent += charge;
    claims.push(claim);
  }

  if (totalSpent > BigInt(scope.maxSpend)) {
    throw new Error('Claims total spent exceeds grant maxSpend.');
  }

  // Validate finalBook against scope
  const finalAgentPk = toHex(agentId(hexToBytes(finalBook.agentSecret)));
  if (finalAgentPk !== scope.agentPk) {
    throw new Error('finalBook agentSecret does not match scope agentPk.');
  }
  if (finalBook.generation !== scope.generation) {
    throw new Error('finalBook generation does not match scope generation.');
  }
  if (BigInt(finalBook.outstanding) > BigInt(finalBook.limit)) {
    throw new Error('finalBook outstanding exceeds limit.');
  }

  if (initialBook !== undefined) {
    const initialAgentPk = toHex(agentId(hexToBytes(initialBook.agentSecret)));
    if (initialAgentPk !== scope.agentPk) {
      throw new Error('initialBook agentSecret does not match scope agentPk.');
    }
    if (initialBook.generation !== scope.generation) {
      throw new Error('initialBook generation does not match scope generation.');
    }
    const initialCommitment = toHex(
      lineStateCommit(
        {
          domain: hexToBytes(scope.domain),
          identity: hexToBytes(scope.agentPk),
          limit: BigInt(initialBook.limit),
          outstanding: BigInt(initialBook.outstanding),
          epoch: BigInt(initialBook.epoch),
        },
        hexToBytes(initialBook.salt),
      ),
    );
    if (initialCommitment !== scope.bookCommitment) {
      throw new Error('initialBook commitment does not match scope bookCommitment.');
    }
    if (finalBook.agentSecret !== initialBook.agentSecret) {
      throw new Error('finalBook agentSecret changed from initialBook.');
    }
    if (finalBook.limit !== initialBook.limit) {
      throw new Error('finalBook limit changed from initialBook.');
    }
    if (BigInt(finalBook.outstanding) !== BigInt(initialBook.outstanding) + totalSpent) {
      throw new Error('finalBook outstanding does not equal initialBook.outstanding + totalSpent.');
    }
    if (BigInt(finalBook.epoch) !== BigInt(initialBook.epoch) + BigInt(claims.length)) {
      throw new Error('finalBook epoch does not equal initialBook.epoch + claimsCount.');
    }
  } else {
    if (BigInt(finalBook.outstanding) < totalSpent) {
      throw new Error('finalBook outstanding is less than claims totalSpent.');
    }
  }

  // Exact recomputed expected grant digest from scope
  const expectedGrantDigestVal = await browserAgentGrantDigest(scope);
  if (capturedOpts.grantDigest !== expectedGrantDigestVal) {
    throw new Error('Grant digest mismatch between options and scope.');
  }

  const payload: AgentHandbackPayload = {
    schema: 'line:agent-handback-payload/v1',
    grantId: scope.grantId,
    facilityAddress: scope.facilityAddress,
    finalBook,
    claims,
  };
  const validatedPayload = validateHandbackPayload(payload);
  const payloadDigestVal = await handbackPayloadDigest(validatedPayload);

  // Compute final book commitment using shared lineStateCommit helper
  const finalBookCommitment = toHex(
    lineStateCommit(
      {
        domain: hexToBytes(scope.domain),
        identity: hexToBytes(scope.agentPk),
        limit: BigInt(finalBook.limit),
        outstanding: BigInt(finalBook.outstanding),
        epoch: BigInt(finalBook.epoch),
      },
      hexToBytes(finalBook.salt),
    ),
  );

  const spentStr = totalSpent.toString();

  const partialSummary: Omit<AgentHandbackSummary, 'envelopeDigest'> = {
    agentPk: scope.agentPk,
    claimsCount: validatedPayload.claims.length,
    domain: scope.domain,
    facilityAddress: scope.facilityAddress,
    finalBookCommitment,
    generation: scope.generation,
    grantDigest: expectedGrantDigestVal,
    grantId: scope.grantId,
    handbackId,
    networkId: 'preprod',
    pairingPackageDigest,
    payloadDigest: payloadDigestVal,
    reserved: '0',
    retiredAt,
    returnPublicKey: scope.returnPublicKey,
    runnerSigningPublicKey: scope.runnerSigningPublicKey,
    sourceFingerprint: scope.sourceFingerprint,
    spent: spentStr,
    storeRevision,
  };

  const encryptedPayload = await encryptHandbackPayload({
    summary: partialSummary,
    payload: validatedPayload,
    recipientPublicKeyHex: scope.returnPublicKey,
    nonceHex,
  });

  const envelopeDigestVal = await handbackEnvelopeDigest(encryptedPayload);

  const fullSummary: AgentHandbackSummary = {
    ...partialSummary,
    envelopeDigest: envelopeDigestVal,
  };

  const runnerSignature = await signHandbackSummary(fullSummary, runnerSigningPrivateKey);

  return deepFreeze({
    schema: 'line:agent-handback-package/v1',
    handbackId,
    grantId: scope.grantId,
    grantDigest: expectedGrantDigestVal,
    pairingPackageDigest,
    runnerSigningPublicKey: scope.runnerSigningPublicKey,
    returnPublicKey: scope.returnPublicKey,
    networkId: 'preprod',
    facilityAddress: scope.facilityAddress,
    domain: scope.domain,
    sourceFingerprint: scope.sourceFingerprint,
    agentPk: scope.agentPk,
    generation: scope.generation,
    storeRevision,
    finalBookCommitment,
    spent: spentStr,
    reserved: '0',
    claimsCount: validatedPayload.claims.length,
    payloadDigest: payloadDigestVal,
    retiredAt,
    envelopeDigest: envelopeDigestVal,
    encryptedPayload,
    runnerSignature,
  });
}

export function validateHandbackPackage(pkg: unknown): AgentHandbackPackage {
  const p = captureStrictRecord<Record<string, any>>(pkg, HANDBACK_PACKAGE_FIELDS, [], 'Handback package');

  if (p.schema !== 'line:agent-handback-package/v1') {
    throw new Error('Handback validation failed: invalid schema.');
  }
  if (typeof p.handbackId !== 'string' || !UUID.test(p.handbackId)) {
    throw new Error('Handback validation failed: invalid handbackId.');
  }
  if (typeof p.grantId !== 'string' || !UUID.test(p.grantId)) {
    throw new Error('Handback validation failed: invalid grantId.');
  }
  if (p.networkId !== 'preprod') {
    throw new Error('Handback validation failed: invalid networkId.');
  }
  for (const f of [
    'grantDigest',
    'pairingPackageDigest',
    'runnerSigningPublicKey',
    'returnPublicKey',
    'facilityAddress',
    'domain',
    'sourceFingerprint',
    'agentPk',
    'finalBookCommitment',
    'payloadDigest',
    'envelopeDigest',
  ] as const) {
    if (typeof p[f] !== 'string' || !HEX64.test(p[f]) || p[f] === ALL_ZEROS_64) {
      throw new Error(`Handback validation failed: invalid ${f}.`);
    }
  }
  for (const f of ['generation', 'spent'] as const) {
    if (typeof p[f] !== 'string' || !DEC_UINT64.test(p[f]) || BigInt(p[f]) > UINT64_MAX) {
      throw new Error(`Handback validation failed: invalid ${f}.`);
    }
  }
  if (BigInt(p.generation) === 0n) {
    throw new Error('Handback validation failed: generation must be positive.');
  }
  if (p.reserved !== '0') {
    throw new Error('Handback validation failed: reserved is not 0.');
  }
  if (typeof p.storeRevision !== 'number' || !Number.isSafeInteger(p.storeRevision) || p.storeRevision <= 0) {
    throw new Error('Handback validation failed: invalid storeRevision.');
  }
  if (typeof p.claimsCount !== 'number' || !Number.isSafeInteger(p.claimsCount) || p.claimsCount < 0 || p.claimsCount > MAX_HANDBACK_CLAIMS) {
    throw new Error('Handback validation failed: invalid claimsCount.');
  }
  if (typeof p.retiredAt !== 'number' || !Number.isSafeInteger(p.retiredAt) || p.retiredAt <= 0) {
    throw new Error('Handback validation failed: invalid retiredAt.');
  }
  if (typeof p.runnerSignature !== 'string' || !/^[0-9a-f]{128}$/i.test(p.runnerSignature)) {
    throw new Error('Handback validation failed: invalid runner signature format.');
  }

  // Validate and detach nested envelope BEFORE any serialization or byte capacity measurement
  const envelope = validateHandbackEnvelope(p.encryptedPayload);

  // Construct detached validated package containing ONLY verified primitive values and detached envelope
  const validated: AgentHandbackPackage = {
    schema: 'line:agent-handback-package/v1',
    handbackId: p.handbackId,
    grantId: p.grantId,
    grantDigest: p.grantDigest.toLowerCase(),
    pairingPackageDigest: p.pairingPackageDigest.toLowerCase(),
    runnerSigningPublicKey: p.runnerSigningPublicKey.toLowerCase(),
    returnPublicKey: p.returnPublicKey.toLowerCase(),
    networkId: 'preprod',
    facilityAddress: p.facilityAddress.toLowerCase(),
    domain: p.domain.toLowerCase(),
    sourceFingerprint: p.sourceFingerprint.toLowerCase(),
    agentPk: p.agentPk.toLowerCase(),
    generation: p.generation,
    storeRevision: p.storeRevision,
    finalBookCommitment: p.finalBookCommitment.toLowerCase(),
    spent: p.spent,
    reserved: '0',
    claimsCount: p.claimsCount,
    payloadDigest: p.payloadDigest.toLowerCase(),
    retiredAt: p.retiredAt,
    envelopeDigest: p.envelopeDigest.toLowerCase(),
    encryptedPayload: envelope,
    runnerSignature: p.runnerSignature.toLowerCase(),
  };

  // Byte capacity measured strictly on detached validated package where all fields are verified primitives
  const pkgJson = JSON.stringify(validated);
  const rawBytesCount = new TextEncoder().encode(pkgJson).byteLength;
  if (rawBytesCount > MAX_HANDBACK_PACKAGE_BYTES) {
    throw new Error('Handback validation failed: package exceeds maximum byte capacity.');
  }

  return deepFreeze(validated);
}

export async function verifyHandbackPackage(
  pkgInput: unknown,
  expected: unknown,
): Promise<{
  finalBook: AgentBookOpeningPayload;
  claims: AgentHandbackClaimOpening[];
  summary: AgentHandbackSummary;
}> {
  // 1. Snapshot and strictly validate expected verification pins synchronously before ANY await
  const capturedExpected = captureStrictRecord<Record<string, any>>(
    expected,
    VERIFY_HANDBACK_PACKAGE_EXPECTED_FIELDS,
    [],
    'Expected verification pins',
  );

  // Validate minRevision: safe non-negative integer policy
  const minRevision = capturedExpected.minRevision;
  if (typeof minRevision !== 'number' || !Number.isSafeInteger(minRevision) || minRevision < 0) {
    throw new Error('Handback validation failed: minRevision must be a safe non-negative integer.');
  }

  // Validate recipient private key format
  const recipientPrivateKeyHex = capturedExpected.recipientPrivateKeyHex;
  if (typeof recipientPrivateKeyHex !== 'string' || !HEX64.test(recipientPrivateKeyHex)) {
    throw new Error('Handback validation failed: invalid recipientPrivateKey format.');
  }
  validateRawX25519Key(recipientPrivateKeyHex, 'recipientPrivateKey');

  // Validate pinnedScope via canonical grant validator
  const pinnedScope = captureStrictScope(capturedExpected.pinnedScope);

  const expectedPairingPackageDigest = capturedExpected.expectedPairingPackageDigest;
  if (typeof expectedPairingPackageDigest !== 'string' || !HEX64.test(expectedPairingPackageDigest) || expectedPairingPackageDigest === ALL_ZEROS_64) {
    throw new Error('Handback validation failed: invalid expectedPairingPackageDigest format.');
  }

  const expectedGrantDigest = capturedExpected.expectedGrantDigest;
  if (typeof expectedGrantDigest !== 'string' || !HEX64.test(expectedGrantDigest) || expectedGrantDigest === ALL_ZEROS_64) {
    throw new Error('Handback validation failed: invalid expectedGrantDigest format.');
  }

  const initialBook = captureStrictBookOpening(capturedExpected.initialBookOpening);

  // 2. Snapshot and strictly validate complete package primitive schema & detached envelope synchronously before ANY await
  const p = validateHandbackPackage(pkgInput);

  if (p.grantId !== pinnedScope.grantId) {
    throw new Error('Handback validation failed: grantId does not match pinned scope.');
  }
  if (p.pairingPackageDigest !== expectedPairingPackageDigest) {
    throw new Error('Handback validation failed: pairingPackageDigest mismatch.');
  }
  if (p.runnerSigningPublicKey !== pinnedScope.runnerSigningPublicKey) {
    throw new Error('Handback validation failed: runnerSigningPublicKey mismatch.');
  }
  if (p.returnPublicKey !== pinnedScope.returnPublicKey) {
    throw new Error('Handback validation failed: returnPublicKey mismatch.');
  }
  if (p.networkId !== pinnedScope.networkId) {
    throw new Error('Handback validation failed: networkId mismatch.');
  }
  if (p.facilityAddress !== pinnedScope.facilityAddress) {
    throw new Error('Handback validation failed: facilityAddress mismatch.');
  }
  if (p.domain !== pinnedScope.domain) {
    throw new Error('Handback validation failed: domain mismatch.');
  }
  if (p.sourceFingerprint !== pinnedScope.sourceFingerprint) {
    throw new Error('Handback validation failed: sourceFingerprint mismatch.');
  }
  if (p.agentPk !== pinnedScope.agentPk) {
    throw new Error('Handback validation failed: agentPk mismatch.');
  }
  if (p.generation !== pinnedScope.generation) {
    throw new Error('Handback validation failed: generation mismatch.');
  }
  if (p.storeRevision <= minRevision) {
    throw new Error('Handback validation failed: storeRevision not strictly greater than minRevision.');
  }
  if (BigInt(p.spent) > BigInt(pinnedScope.maxSpend)) {
    throw new Error('Handback validation failed: spent exceeds grant maxSpend.');
  }
  if (p.retiredAt < pinnedScope.issuedAt) {
    throw new Error('Handback validation failed: retiredAt predates grant issuedAt.');
  }
  if (typeof p.runnerSignature !== 'string' || !/^[0-9a-f]{128}$/.test(p.runnerSignature)) {
    throw new Error('Handback validation failed: invalid runner signature format.');
  }

  // 3. Now run async validations
  // Recipient private key must derive expected browser return public key
  const derivedReturnPub = await x25519PublicKey(recipientPrivateKeyHex);
  if (derivedReturnPub !== pinnedScope.returnPublicKey) {
    throw new Error('Handback validation failed: recipientPrivateKey does not derive expected returnPublicKey.');
  }
  await assertUsableX25519Recipient(pinnedScope.returnPublicKey);

  // Exact supplied expected grant digest recomputed from scope
  const recomputedGrantDigest = await browserAgentGrantDigest(pinnedScope);
  if (capturedExpected.expectedGrantDigest !== recomputedGrantDigest) {
    throw new Error('Handback validation failed: expectedGrantDigest mismatch with pinned scope.');
  }
  if (p.grantDigest !== recomputedGrantDigest) {
    throw new Error('Handback validation failed: grantDigest mismatch.');
  }

  // Validate envelope digest
  const canonicalEnvDigest = await handbackEnvelopeDigest(p.encryptedPayload);
  if (p.envelopeDigest !== canonicalEnvDigest) {
    throw new Error('Handback validation failed: envelopeDigest mismatch.');
  }

  const summary: AgentHandbackSummary = {
    agentPk: p.agentPk,
    claimsCount: p.claimsCount,
    domain: p.domain,
    envelopeDigest: p.envelopeDigest,
    facilityAddress: p.facilityAddress,
    finalBookCommitment: p.finalBookCommitment,
    generation: p.generation,
    grantDigest: p.grantDigest,
    grantId: p.grantId,
    handbackId: p.handbackId,
    networkId: 'preprod',
    pairingPackageDigest: p.pairingPackageDigest,
    payloadDigest: p.payloadDigest,
    reserved: '0',
    retiredAt: p.retiredAt,
    returnPublicKey: p.returnPublicKey,
    runnerSigningPublicKey: p.runnerSigningPublicKey,
    sourceFingerprint: p.sourceFingerprint,
    spent: p.spent,
    storeRevision: p.storeRevision,
  };

  // 4. Verify runner signature BEFORE decryption
  const messageStr = handbackSummaryMessage(summary);
  let sigValid = false;
  try {
    sigValid = L.verifySignature(
      pinnedScope.runnerSigningPublicKey,
      organizationMessageBytes(messageStr),
      p.runnerSignature,
    );
  } catch {
    sigValid = false;
  }
  if (!sigValid) {
    throw new Error('Handback validation failed: runner signature is invalid.');
  }

  // 5. Verify initial book baseline against pinned scope
  const initialAgentPk = toHex(agentId(hexToBytes(initialBook.agentSecret)));
  if (initialAgentPk !== pinnedScope.agentPk) {
    throw new Error('Handback validation failed: initial book agentSecret does not match pinned scope agentPk.');
  }
  if (initialBook.generation !== pinnedScope.generation) {
    throw new Error('Handback validation failed: initial book generation does not match pinned scope.');
  }
  const initialCommitment = toHex(
    lineStateCommit(
      {
        domain: hexToBytes(pinnedScope.domain),
        identity: hexToBytes(pinnedScope.agentPk),
        limit: BigInt(initialBook.limit),
        outstanding: BigInt(initialBook.outstanding),
        epoch: BigInt(initialBook.epoch),
      },
      hexToBytes(initialBook.salt),
    ),
  );
  if (initialCommitment !== pinnedScope.bookCommitment) {
    throw new Error('Handback validation failed: initial book does not match pinned scope bookCommitment.');
  }

  // 6. Decrypt payload using AAD
  const partialSummary: Omit<AgentHandbackSummary, 'envelopeDigest'> = { ...summary };
  delete (partialSummary as any).envelopeDigest;

  const decryptedPayload = await decryptHandbackPayload({
    envelope: p.encryptedPayload,
    summary: partialSummary,
    recipientPrivateKeyHex,
  });

  // 7. Post-decryption verification: payload digest & claims count
  const computedPayloadDigest = await handbackPayloadDigest(decryptedPayload);
  if (computedPayloadDigest !== p.payloadDigest) {
    throw new Error('Handback validation failed: decrypted payloadDigest mismatch.');
  }
  if (decryptedPayload.claims.length !== p.claimsCount) {
    throw new Error('Handback validation failed: claims count mismatch.');
  }
  if (decryptedPayload.grantId !== pinnedScope.grantId || decryptedPayload.facilityAddress !== pinnedScope.facilityAddress) {
    throw new Error('Handback validation failed: payload grantId or facilityAddress mismatch.');
  }

  // 8. Verify final book openings & arithmetic
  const finalBook = decryptedPayload.finalBook;
  if (finalBook.agentSecret !== initialBook.agentSecret) {
    throw new Error('Handback validation failed: agentSecret changed.');
  }
  if (BigInt(finalBook.generation) !== BigInt(initialBook.generation)) {
    throw new Error('Handback validation failed: generation changed.');
  }
  const initialLimit = BigInt(initialBook.limit);
  const initialOutstanding = BigInt(initialBook.outstanding);
  const initialEpoch = BigInt(initialBook.epoch);
  const finalLimit = BigInt(finalBook.limit);
  const finalOutstanding = BigInt(finalBook.outstanding);
  const finalEpoch = BigInt(finalBook.epoch);
  const spentBigInt = BigInt(p.spent);

  if (finalLimit !== initialLimit) {
    throw new Error('Handback validation failed: final limit changed.');
  }
  if (initialOutstanding + spentBigInt > UINT64_MAX) {
    throw new Error('Handback validation failed: outstanding arithmetic overflow.');
  }
  if (finalOutstanding !== initialOutstanding + spentBigInt) {
    throw new Error('Handback validation failed: final outstanding does not equal initial + spent.');
  }
  if (finalOutstanding > finalLimit) {
    throw new Error('Handback validation failed: outstanding exceeds limit.');
  }
  const claimsLengthBigInt = BigInt(decryptedPayload.claims.length);
  if (initialEpoch + claimsLengthBigInt > UINT64_MAX) {
    throw new Error('Handback validation failed: epoch arithmetic overflow.');
  }
  if (finalEpoch !== initialEpoch + claimsLengthBigInt) {
    throw new Error('Handback validation failed: final epoch does not equal initial + claimsCount.');
  }

  const computedFinalCommitment = toHex(
    lineStateCommit(
      {
        domain: hexToBytes(pinnedScope.domain),
        identity: hexToBytes(pinnedScope.agentPk),
        limit: finalLimit,
        outstanding: finalOutstanding,
        epoch: finalEpoch,
      },
      hexToBytes(finalBook.salt),
    ),
  );
  if (computedFinalCommitment !== p.finalBookCommitment) {
    throw new Error('Handback validation failed: final book commitment mismatch.');
  }

  // 9. Verify each claim opening & drawNoteCommit
  let totalClaimsCharge = 0n;
  for (const claim of decryptedPayload.claims) {
    if (claim.contractAddress !== pinnedScope.facilityAddress) {
      throw new Error('Handback validation failed: claim contractAddress mismatch.');
    }
    if (claim.domain !== pinnedScope.domain) {
      throw new Error('Handback validation failed: claim domain mismatch.');
    }
    if (claim.identity !== pinnedScope.agentPk) {
      throw new Error('Handback validation failed: claim identity mismatch.');
    }
    if (claim.generation !== pinnedScope.generation) {
      throw new Error('Handback validation failed: claim generation mismatch.');
    }
    if (!pinnedScope.allowedMerchants.includes(claim.merchantPk)) {
      throw new Error('Handback validation failed: claim merchant not authorized in scope.');
    }

    const preimage: DrawNotePreimage = {
      domain: hexToBytes(claim.domain),
      lineGeneration: BigInt(claim.generation),
      identity: hexToBytes(claim.identity),
      quoteCommit: hexToBytes(claim.quoteCommitment),
      merchantPk: hexToBytes(claim.merchantPk),
      amount: BigInt(claim.amount),
      fee: BigInt(claim.fee),
      noteNonce: hexToBytes(claim.noteNonce),
      expiry: BigInt(claim.expiry),
    };

    const computedNoteCommitment = toHex(drawNoteCommit(preimage, hexToBytes(claim.noteSalt)));
    if (computedNoteCommitment !== claim.noteCommitment) {
      throw new Error('Handback validation failed: claim noteCommitment mismatch.');
    }

    if (claim.drawReceipt.contractAddress !== pinnedScope.facilityAddress) {
      throw new Error('Handback validation failed: draw receipt facility mismatch.');
    }
    if (claim.drawReceipt.identifier !== claim.drawIdentifier) {
      throw new Error('Handback validation failed: draw receipt identifier mismatch.');
    }
    if (claim.drawReceipt.sourceFingerprint !== pinnedScope.sourceFingerprint) {
      throw new Error('Handback validation failed: draw receipt sourceFingerprint mismatch.');
    }

    if (claim.redeemed) {
      if (!claim.redemptionReceipt) {
        throw new Error('Handback validation failed: redeemed claim missing redemption receipt.');
      }
      if (claim.redemptionReceipt.contractAddress !== pinnedScope.facilityAddress) {
        throw new Error('Handback validation failed: redemption receipt facility mismatch.');
      }
      if (claim.redemptionReceipt.noteCommitment !== claim.noteCommitment) {
        throw new Error('Handback validation failed: redemption receipt noteCommitment mismatch.');
      }
      if (claim.redemptionReceipt.amount !== claim.amount) {
        throw new Error('Handback validation failed: redemption receipt amount mismatch.');
      }
      if (claim.redemptionReceipt.sourceFingerprint !== pinnedScope.sourceFingerprint) {
        throw new Error('Handback validation failed: redemption receipt sourceFingerprint mismatch.');
      }
    } else {
      if (claim.redemptionReceipt !== null) {
        throw new Error('Handback validation failed: unredeemed claim has redemption receipt.');
      }
    }

    const charge = BigInt(claim.amount) + BigInt(claim.fee);
    if (charge > UINT64_MAX - totalClaimsCharge) {
      throw new Error('Handback validation failed: claims total charge overflow.');
    }
    totalClaimsCharge += charge;
  }

  if (totalClaimsCharge !== spentBigInt) {
    throw new Error('Handback validation failed: sum of claims does not equal package spent.');
  }

  return deepFreeze({
    finalBook,
    claims: decryptedPayload.claims,
    summary,
  });
}
