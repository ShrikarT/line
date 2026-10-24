import { createHash } from 'node:crypto';
import * as L from '@midnight-ntwrk/ledger-v8';
import {
  MAX_HANDBACK_CLAIMS,
  MAX_HANDBACK_PLAINTEXT_BYTES,
  MAX_HANDBACK_CIPHERTEXT_HEX_LEN,
  MAX_HANDBACK_PACKAGE_BYTES,
  HANDBACK_PACKAGE_FIELDS,
  HANDBACK_SUMMARY_FIELDS,
  HANDBACK_AAD_FIELDS,
  HANDBACK_CLAIM_FIELDS,
  HANDBACK_DRAW_RECEIPT_FIELDS,
  HANDBACK_REDEMPTION_RECEIPT_REQUIRED_FIELDS,
  HANDBACK_PAYLOAD_FIELDS,
  HANDBACK_ENVELOPE_FIELDS,
  CREATE_HANDBACK_PACKAGE_REQUIRED_FIELDS,
  VERIFY_HANDBACK_PACKAGE_EXPECTED_FIELDS,
  ENCRYPT_HANDBACK_PAYLOAD_FIELDS,
  DECRYPT_HANDBACK_PAYLOAD_FIELDS,
  BOOK_OPENING_FIELDS,
  captureStrictRecord,
  captureStrictArray,
  captureStrictScope,
  captureStrictBookOpening,
  validateHandbackDrawReceipt,
  validateHandbackRedemptionReceipt,
  validateHandbackClaimOpening,
  validateHandbackPayload,
  canonicalHandbackPayloadMessage,
  handbackPayloadDigest,
  validateHandbackEnvelope,
  canonicalHandbackEnvelopeMessage,
  handbackEnvelopeDigest,
  validateHandbackSummary,
  validateHandbackPackage,
  createHandbackAad,
  handbackSummaryMessage,
  signHandbackSummary as signHandbackSummaryTs,
  encryptHandbackPayload,
  decryptHandbackPayload,
  createHandbackPackage,
  verifyHandbackPackage,
} from '../src/lib/agent/handback.ts';
import { organizationSigningBytes } from './organization-auth.mjs';

export {
  MAX_HANDBACK_CLAIMS,
  MAX_HANDBACK_PLAINTEXT_BYTES,
  MAX_HANDBACK_CIPHERTEXT_HEX_LEN,
  MAX_HANDBACK_PACKAGE_BYTES,
  HANDBACK_PACKAGE_FIELDS,
  HANDBACK_SUMMARY_FIELDS,
  HANDBACK_AAD_FIELDS,
  HANDBACK_CLAIM_FIELDS,
  HANDBACK_DRAW_RECEIPT_FIELDS,
  HANDBACK_REDEMPTION_RECEIPT_REQUIRED_FIELDS,
  HANDBACK_PAYLOAD_FIELDS,
  HANDBACK_ENVELOPE_FIELDS,
  CREATE_HANDBACK_PACKAGE_REQUIRED_FIELDS,
  VERIFY_HANDBACK_PACKAGE_EXPECTED_FIELDS,
  ENCRYPT_HANDBACK_PAYLOAD_FIELDS,
  DECRYPT_HANDBACK_PAYLOAD_FIELDS,
  BOOK_OPENING_FIELDS,
  captureStrictRecord,
  captureStrictArray,
  captureStrictScope,
  captureStrictBookOpening,
  validateHandbackDrawReceipt,
  validateHandbackRedemptionReceipt,
  validateHandbackClaimOpening,
  validateHandbackPayload,
  canonicalHandbackPayloadMessage,
  handbackPayloadDigest,
  validateHandbackEnvelope,
  canonicalHandbackEnvelopeMessage,
  handbackEnvelopeDigest,
  validateHandbackSummary,
  validateHandbackPackage,
  createHandbackAad,
  handbackSummaryMessage,
  encryptHandbackPayload,
  decryptHandbackPayload,
  createHandbackPackage,
  verifyHandbackPackage,
};

function canonicalize(value) {
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

export function handbackPackageCanonicalMessage(pkg) {
  const clean = validateHandbackPackage(pkg);
  return 'line:agent-handback-package/v1\0' + JSON.stringify(canonicalize(clean));
}

export function handbackPackageDigest(pkg) {
  return createHash('sha256').update(handbackPackageCanonicalMessage(pkg)).digest('hex');
}

export function signHandbackSummary(summary, runnerSigningKey) {
  const capturedSummary = validateHandbackSummary(summary, true);
  if (typeof runnerSigningKey !== 'string' || !/^[0-9a-f]{64}$/.test(runnerSigningKey)) {
    throw new Error('Invalid runnerSigningKey format.');
  }
  const message = handbackSummaryMessage(capturedSummary);
  const sig = L.signData(runnerSigningKey, organizationSigningBytes(message));
  return typeof sig === 'string' ? sig : Buffer.from(sig).toString('hex');
}
