import { randomBytes, createHash } from 'node:crypto';
import { bech32m } from '@scure/base';
import { addressFromKey, verifySignature } from '@midnight-ntwrk/ledger-v8';
import { organizationSignInMessage } from '../src/lib/organization/sign-in.ts';

export class OrganizationAuthError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }
export function organizationRecipient(value) {
  try {
    const decoded = bech32m.decodeToBytes(value);
    if (decoded.prefix === 'mn_addr_preprod' && decoded.bytes.length === 32) return Buffer.from(decoded.bytes).toString('hex');
  } catch {}
  throw new OrganizationAuthError('A Preprod receiving wallet is required.', 400);
}
// Connector v4 signs the UTF-8 byte count, not JS's UTF-16 string length.
export function organizationSigningBytes(message) {
  return Buffer.from(`midnight_signed_message:${Buffer.byteLength(message, 'utf8')}:` + message, 'utf8');
}

/** Ephemeral sign-in sessions. A restart requires another wallet signature;
 * it does not discard any durable order or pending payment.
 */
export class OrganizationAuth {
  constructor(origin, now = () => Date.now()) {
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw Error('Configure an HTTPS public origin, or a loopback HTTP origin for local checks.');
    this.origin = origin; this.now = now; this.challenges = new Map(); this.sessions = new Map(); this.sessionListeners = new Set();
    this.cookieName = url.protocol === 'https:' ? '__Host-line_session' : 'line_session';
    this.secure = url.protocol === 'https:';
  }
  prune() {
    for (const [id, entry] of this.challenges) if (entry.expiresAt <= this.now()) this.challenges.delete(id);
    for (const [id, entry] of this.sessions) if (entry.expiresAt <= this.now()) this.invalidateSession(id);
  }
  onSessionInvalidated(listener) { this.sessionListeners.add(listener); return () => this.sessionListeners.delete(listener); }
  invalidateSession(token) { const session = this.sessions.get(token); if (!session) return; this.sessions.delete(token); for (const listener of this.sessionListeners) listener(session); }
  requester(cookie,peer){
    const name=this.cookieName+'_init';
    const matches=typeof cookie==='string'&&cookie.length<=8192?cookie.split(';').map(value=>value.trim()).filter(value=>value.startsWith(name+'=')):[];
    const supplied=matches.length===1?matches[0].slice(name.length+1):'';
    const token=/^[0-9a-f]{64}$/.test(supplied)?supplied:randomBytes(32).toString('hex');
    return {key:createHash('sha256').update(String(peer)).update('\0').update(token).digest('hex'),cookie:`${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=120${this.secure?'; Secure':''}`};
  }
  challenge(address,requester) {
    const recipient = organizationRecipient(address); this.prune();
    if(typeof requester!=='string'||!/^[0-9a-f]{64}$/.test(requester))throw new OrganizationAuthError('A browser sign-in context is required.',400);
    if([...this.challenges.values()].filter(entry=>entry.recipient===recipient&&entry.requester===requester).length>=4)throw new OrganizationAuthError('Too many outstanding sign-in requests in this browser. Retry shortly.',429);
    if (this.challenges.size >= 1000) throw new OrganizationAuthError('Sign-in is busy. Retry shortly.', 429);
    const nonce = randomBytes(32).toString('hex'), expiresAt = this.now() + 120_000;
    const message = organizationSignInMessage(this.origin, address, nonce, expiresAt);
    this.challenges.set(nonce, { recipient, requester, expiresAt, message });
    return { nonce, message, expiresAt };
  }
  finish(input) {
    this.prune();
    const challenge = this.challenges.get(input?.nonce); this.challenges.delete(input?.nonce);
    if (!challenge) throw new OrganizationAuthError('Sign-in expired. Request a new wallet challenge.');
    const proof = input.proof;
    if (!proof || proof.scheme !== undefined && proof.scheme !== 'schnorr_bip340' || !/^[0-9a-fA-F]{64}$/.test(proof.verifyingKey) || !/^[0-9a-fA-F]{128}$/.test(proof.signature)) throw new OrganizationAuthError('The wallet signature format is unsupported.');
    let valid = false;
    try { valid = addressFromKey(proof.verifyingKey.toLowerCase()) === challenge.recipient && verifySignature(proof.verifyingKey.toLowerCase(), organizationSigningBytes(challenge.message), proof.signature.toLowerCase()); } catch {}
    if (!valid) throw new OrganizationAuthError('The wallet signature does not match this sign-in.');
    const existing=[...this.sessions].filter(([,entry])=>entry.recipient===challenge.recipient);
    // Only a verified signature may evict this principal's older sessions.
    if(existing.length>=4)this.invalidateSession(existing[0][0]);
    if (this.sessions.size >= 1000) throw new OrganizationAuthError('Sign-in is busy. Retry shortly.', 429);
    const token = randomBytes(32).toString('hex'), expiresAt = this.now() + 30 * 60_000;
    this.sessions.set(token, { recipient: challenge.recipient, expiresAt });
    return { token, expiresAt };
  }
  require(cookie) {
    this.prune();
    if (typeof cookie !== 'string' || cookie.length > 8192) throw new OrganizationAuthError('Sign in with your organization wallet.');
    const matches = cookie.split(';').map(value => value.trim()).filter(value => value.startsWith(this.cookieName + '='));
    const token = matches.length === 1 ? matches[0].slice(this.cookieName.length + 1) : '';
    const session = this.sessions.get(token);
    if (!session) throw new OrganizationAuthError('Sign in with your organization wallet.');
    return session;
  }
  cookie(token, expiresAt) { return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((expiresAt - this.now()) / 1000))}${this.secure ? '; Secure' : ''}`; }
  revoke(cookie) {
    if (typeof cookie === 'string') for (const value of cookie.split(';')) if (value.trim().startsWith(this.cookieName + '=')) this.invalidateSession(value.trim().slice(this.cookieName.length + 1));
    return this.cookie('', this.now());
  }
  close() { for (const token of this.sessions.keys()) this.invalidateSession(token); this.challenges.clear(); }
}
