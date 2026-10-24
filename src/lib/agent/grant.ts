import { bech32m } from '@scure/base';
import { AGENT_GRANT_FIELDS, type AgentGrantScope, type AgentGrantProof } from './types.ts';
import { organizationMessageBytes } from '../organization/signing.ts';

const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const U64 = (1n << 64n) - 1n;
const need = (value: unknown, message: string): void => { if (!value) throw Error(message); };
const amount = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= U64;
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');

export function grantOwnerRecipient(address: string): string {
  try {
    const decoded = bech32m.decodeToBytes(address);
    if (decoded.prefix === 'mn_addr_preprod' && decoded.bytes.length === 32) return hex(decoded.bytes);
  } catch {}
  throw Error('A Preprod receiving wallet is required.');
}

/** One canonical public grant message for browser review and runner verification.
 * This function grants no authority and establishes no durable writer fence. */
export function agentGrantMessage(scope: AgentGrantScope): string {
  need(scope && typeof scope === 'object' && !Array.isArray(scope), 'Invalid agent grant.');
  need(Object.keys(scope).length === AGENT_GRANT_FIELDS.length && AGENT_GRANT_FIELDS.every(key => Object.hasOwn(scope,key) && Object.hasOwn(Object.getOwnPropertyDescriptor(scope,key)!,'value')), 'Unexpected agent grant fields.');
  need(scope.schema === 'line:agent-grant/v1' && scope.networkId === 'preprod' && UUID.test(scope.grantId), 'Unsupported agent grant.');
  for (const key of ['facilityAddress','domain','sourceFingerprint','runnerPublicKey','runnerSigningPublicKey','returnPublicKey','agentPk','bookCommitment','nonce'] as const) need(typeof scope[key] === 'string' && HEX.test(scope[key]), `Invalid agent grant ${key}.`);
  need(scope.runnerPublicKey !== scope.runnerSigningPublicKey, 'Agent runner encryption key and signing key must be distinct.');
  grantOwnerRecipient(scope.ownerAddress);
  let origin: URL | undefined;
  try { origin = new URL(scope.runnerOrigin); } catch {}
  need(origin && origin.origin === scope.runnerOrigin && new TextEncoder().encode(scope.runnerOrigin).length <= 200 && (origin.protocol === 'https:' || origin.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname)), 'Agent runner origin must be HTTPS or loopback HTTP.');
  need(amount(scope.generation) && amount(scope.maxSpend) && BigInt(scope.maxSpend)>0n && amount(scope.maxFee) && BigInt(scope.maxFee)<=BigInt(scope.maxSpend), 'Invalid agent grant amounts.');
  need(Number.isSafeInteger(scope.issuedAt) && scope.issuedAt>0 && Number.isSafeInteger(scope.expiresAt) && scope.expiresAt>scope.issuedAt && scope.expiresAt-scope.issuedAt<=7*86400_000, 'Invalid agent grant lifetime.');
  for (const key of ['allowedServices','allowedMerchants'] as const) {
    const values=scope[key];
    need(Array.isArray(values) && values.length>0 && values.length<=16 && Object.keys(values).length===values.length && Array.from({length:values.length},(_,index)=>Object.getOwnPropertyDescriptor(values,String(index))).every(descriptor=>descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='string'&&(key==='allowedMerchants'?HEX.test(descriptor.value):/^[a-z][a-z0-9-]{0,63}$/.test(descriptor.value))), 'Invalid agent grant supplier scope.');
    need(values.every((value,i)=>i===0||values[i-1]<value), 'Agent grant supplier scope must be sorted and unique.');
  }
  return 'Line autonomous purchasing authorization\n'+JSON.stringify(Object.fromEntries(AGENT_GRANT_FIELDS.map(key=>[key,scope[key]])));
}

export async function browserAgentGrantDigest(scope: AgentGrantScope): Promise<string> {
  const message = new TextEncoder().encode(agentGrantMessage(scope));
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',message)));
}

/** Connector v4 includes a data echo. Retain only the public proof fields and
 * verify against our own canonical message, never against that echo. */
export function walletAgentGrantProof(value: unknown): AgentGrantProof {
  need(value && typeof value==='object' && !Array.isArray(value),'Invalid wallet agent signature.');
  const row=value as Record<string,unknown>;
  need(Object.keys(row).every(key=>['data','scheme','verifyingKey','signature'].includes(key)) && (row.data===undefined||typeof row.data==='string') && (row.scheme===undefined||row.scheme==='schnorr_bip340') && typeof row.verifyingKey==='string' && /^[0-9a-fA-F]{64}$/.test(row.verifyingKey) && typeof row.signature==='string' && /^[0-9a-fA-F]{128}$/.test(row.signature),'Invalid wallet agent signature.');
  return {verifyingKey:(row.verifyingKey as string).toLowerCase(),signature:(row.signature as string).toLowerCase(),...(row.scheme===undefined?{}:{scheme:'schnorr_bip340' as const})};
}

/** Verifies the existing wallet message signature. Scope pinning, expiry,
 * chain ownership and durable staging remain separate required checks. */
export async function verifyBrowserGrantOwner(scope: AgentGrantScope, proof: AgentGrantProof): Promise<void> {
  const message = agentGrantMessage(scope), owner = grantOwnerRecipient(scope.ownerAddress);
  need(proof && typeof proof==='object' && Object.keys(proof).every(key=>['scheme','verifyingKey','signature'].includes(key)) && (proof.scheme===undefined||proof.scheme==='schnorr_bip340') && typeof proof.verifyingKey==='string' && HEX.test(proof.verifyingKey) && typeof proof.signature==='string' && /^[0-9a-f]{128}$/.test(proof.signature), 'Invalid agent grant signature format.');
  const captured = structuredClone(proof);
  const ledger = await import('@midnight-ntwrk/ledger-v8');
  let valid=false;
  try { valid=ledger.addressFromKey(captured.verifyingKey)===owner && ledger.verifySignature(captured.verifyingKey,organizationMessageBytes(message),captured.signature); } catch {}
  need(valid,'Agent grant owner signature is invalid.');
}
