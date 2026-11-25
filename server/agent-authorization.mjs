import { createHash } from 'node:crypto';
import { addressFromKey, verifySignature } from '@midnight-ntwrk/ledger-v8';
import { organizationRecipient, organizationSigningBytes } from './organization-auth.mjs';
import { agentGrantMessage } from '../src/lib/agent/grant.ts';
export { agentGrantMessage } from '../src/lib/agent/grant.ts';

const HEX = /^[0-9a-f]{64}$/;
const U64 = (1n << 64n) - 1n;
const requireValue = (condition, message) => { if (!condition) throw Error(message); };

export function agentGrantDigest(scope) {
  return createHash('sha256').update(agentGrantMessage(scope)).digest('hex');
}

export function verifyAgentGrant(scope, proof, expected, now = Date.now()) {
  const message = agentGrantMessage(scope);
  requireValue(Number.isSafeInteger(now) && scope.issuedAt <= now && now < scope.expiresAt, 'Agent grant is not currently valid.');
  // The caller supplies its pinned deployment/pairing identity, never a subset
  // inferred from the untrusted incoming grant.
  for (const key of ['networkId', 'facilityAddress', 'domain', 'sourceFingerprint', 'ownerAddress', 'runnerOrigin', 'runnerPublicKey', 'runnerSigningPublicKey', 'returnPublicKey', 'agentPk', 'generation', 'bookCommitment']) {
    requireValue(expected && Object.hasOwn(expected, key) && expected[key] === scope[key], `Agent grant ${key} does not match the pinned pairing.`);
  }
  requireValue(proof && typeof proof === 'object' && Object.keys(proof).every(key => ['scheme', 'verifyingKey', 'signature'].includes(key)) && (proof.scheme === undefined || proof.scheme === 'schnorr_bip340') && HEX.test(proof.verifyingKey) && /^[0-9a-f]{128}$/.test(proof.signature), 'Invalid agent grant signature format.');
  let valid = false;
  try {
    valid = addressFromKey(proof.verifyingKey) === organizationRecipient(scope.ownerAddress) && verifySignature(proof.verifyingKey, organizationSigningBytes(message), proof.signature);
  } catch {}
  requireValue(valid, 'Agent grant owner signature is invalid.');
  return agentGrantDigest(scope);
}

export function agentInputDigest(document, objective) {
  requireValue(typeof document === 'string' && document.trim() && [...document].length <= 5000, 'Supply a document of up to 5000 Unicode code points.');
  requireValue(typeof objective === 'string' && objective.trim() && [...objective].length <= 500, 'Supply an objective of up to 500 Unicode code points.');
  const encoded = JSON.stringify([document, objective]);
  requireValue(Buffer.byteLength(encoded) <= 30 * 1024, 'The encoded task input is too large.');
  return createHash('sha256').update('line:agent-input/v1\0').update(encoded).digest('hex');
}

/** A lifetime spend counter is separate from the circuit's outstanding balance.
 * Reserved costs survive uncertain transactions; repayment never resets either. */
export function requireAgentBudget(scope, { spent, reserved, revoked }, { service, merchantPk, principal, fee }, now = Date.now()) {
  agentGrantMessage(scope);
  requireValue(now >= scope.issuedAt && now < scope.expiresAt && !revoked, 'Agent authorization is inactive.');
  requireValue(scope.allowedServices.includes(service) && scope.allowedMerchants.includes(merchantPk), 'Supplier is outside the agent authorization.');
  requireValue([spent, reserved, principal, fee].every(value => typeof value === 'bigint' && value >= 0n && value <= U64) && principal > 0n, 'Invalid agent budget values.');
  requireValue(fee <= BigInt(scope.maxFee), 'Purchase fee exceeds the authorized maximum.');
  const charge = principal + fee;
  requireValue(charge <= U64 && spent + reserved + charge <= BigInt(scope.maxSpend), 'Purchase exceeds the remaining lifetime authorization.');
  return charge;
}
