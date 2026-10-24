import type {
  AgentBookOpeningPayload,
  AgentEncryptedEnvelope,
  AgentGrantProof,
  AgentGrantScope,
  AgentPairingOffer,
  AgentPairingPackage,
} from './types.ts';
import { AGENT_GRANT_FIELDS } from './types.ts';
import { agentGrantMessage } from './grant.ts';

const HEX32 = /^[0-9a-f]{64}$/;
const HEX12 = /^[0-9a-f]{24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEC_INT = /^(0|[1-9][0-9]{0,19})$/;
const U64 = (1n << 64n) - 1n;
const ALL_ZEROS = '0'.repeat(64);
const MAX_CIPHERTEXT_HEX_LEN = 8192; // 4096 raw bytes; book opening JSON is ~250 bytes
const MAX_ORIGIN_BYTES = 200;

function record(value: unknown, fields: readonly string[], label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error(`Invalid ${label} object.`);
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) throw Error(`${label} contains disallowed or missing fields.`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!Object.hasOwn(descriptor, 'value')) throw Error(`${label} cannot contain accessors.`);
  }
  return value as Record<string, any>;
}

function envelopeSnapshot(value: unknown): AgentEncryptedEnvelope {
  const e = record(value, ['version','purpose','ephemeralPublicKey','nonce','iv','ciphertext'], 'Envelope');
  if (e.version !== 1 || !['line:agent-pairing/v1','line:agent-handback/v1'].includes(e.purpose) || typeof e.nonce !== 'string' || !HEX32.test(e.nonce) || e.nonce === ALL_ZEROS || typeof e.iv !== 'string' || !HEX12.test(e.iv) || typeof e.ciphertext !== 'string' || e.ciphertext.length < 32 || e.ciphertext.length > MAX_CIPHERTEXT_HEX_LEN || e.ciphertext.length % 2 || !/^[0-9a-f]+$/.test(e.ciphertext)) throw Error('Invalid authenticated envelope fields.');
  validateRawX25519Key(e.ephemeralPublicKey, 'ephemeralPublicKey');
  return {...e} as AgentEncryptedEnvelope;
}

// PKCS#8 ASN.1 v1 header for X25519: 16 bytes
// 30 2e (SEQUENCE, 46 bytes)
// 02 01 00 (INTEGER 0)
// 30 05 06 03 2b 65 6e (AlgorithmIdentifier: id-X25519 1.3.101.110)
// 04 22 04 20 (OCTET STRING containing 32-byte private key octet string)
const X25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error('Invalid hexadecimal string.');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function assertWebCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.deriveBits !== 'function' || typeof subtle.deriveKey !== 'function'
      || typeof subtle.encrypt !== 'function' || typeof subtle.decrypt !== 'function'
      || typeof subtle.importKey !== 'function' || typeof subtle.exportKey !== 'function') {
    throw new Error('WebCrypto API with SubtleCrypto is not available in the current environment.');
  }
  return subtle;
}

export function validateRawX25519Key(hexKey: string, label: string): Uint8Array<ArrayBuffer> {
  if (typeof hexKey !== 'string' || !HEX32.test(hexKey) || hexKey === ALL_ZEROS) {
    throw new Error(`Invalid ${label}: must be a non-zero 32-byte hexadecimal X25519 key.`);
  }
  return hexToBytes(hexKey);
}

export function validateSchnorrKey(hexKey: string, label: string): void {
  if (typeof hexKey !== 'string' || !HEX32.test(hexKey) || hexKey === ALL_ZEROS) {
    throw new Error(`Invalid ${label}: must be a non-zero 32-byte hexadecimal Schnorr public key.`);
  }
}

export async function generateX25519KeyPair(): Promise<{
  publicKeyHex: string;
  privateKeyHex: string;
}> {
  const subtle = assertWebCrypto();
  let keyPair: CryptoKeyPair;
  try {
    const generated = await subtle.generateKey({ name: 'X25519' }, true, ['deriveKey', 'deriveBits']);
    if (!('privateKey' in generated) || !('publicKey' in generated)) throw Error('Expected an X25519 key pair.');
    keyPair = generated;
  } catch (err: any) {
    throw new Error(`Failed to generate X25519 keypair: ${err?.message ?? String(err)}`);
  }
  const pubRaw = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey));
  const pkcs8Raw = new Uint8Array(await subtle.exportKey('pkcs8', keyPair.privateKey));
  if (pubRaw.byteLength !== 32) {
    throw new Error(`Unexpected X25519 public key length: ${pubRaw.byteLength}`);
  }
  if (pkcs8Raw.byteLength !== 48) {
    throw new Error(`Unexpected X25519 PKCS8 private key length: ${pkcs8Raw.byteLength}`);
  }
  const privRaw = pkcs8Raw.slice(16);
  return {
    publicKeyHex: toHex(pubRaw),
    privateKeyHex: toHex(privRaw),
  };
}

export async function importX25519PublicKey(publicKeyHex: string, label = 'public key'): Promise<CryptoKey> {
  const bytes = validateRawX25519Key(publicKeyHex, label);
  const subtle = assertWebCrypto();
  try {
    return await subtle.importKey('raw', bytes, { name: 'X25519' }, false, []);
  } catch (err: any) {
    throw new Error(`Failed to import X25519 ${label}: ${err?.message ?? String(err)}`);
  }
}

export async function importX25519PrivateKey(privateKeyHex: string, label = 'private key', extractable = false): Promise<CryptoKey> {
  const bytes = validateRawX25519Key(privateKeyHex, label);
  const subtle = assertWebCrypto();
  const fullPkcs8 = new Uint8Array(48);
  fullPkcs8.set(X25519_PKCS8_PREFIX, 0);
  fullPkcs8.set(bytes, 16);
  try {
    return await subtle.importKey('pkcs8', fullPkcs8, { name: 'X25519' }, extractable, ['deriveBits', 'deriveKey']);
  } catch (err: any) {
    throw new Error(`Failed to import X25519 ${label}: ${err?.message ?? String(err)}`);
  }
}

/** Reopen-time identity check; only the public JWK coordinate is returned. */
export async function x25519PublicKey(privateKeyHex: string): Promise<string> {
  const key=await importX25519PrivateKey(privateKeyHex,'retained private key',true);
  const jwk=await assertWebCrypto().exportKey('jwk',key);
  if (typeof jwk.x!=='string') throw Error('Retained X25519 identity has no public coordinate.');
  const bytes=Uint8Array.from(atob(jwk.x.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  return toHex(bytes);
}

/** A non-zero encoding can still be a low-order X25519 point. Reject it before
 * retaining authority that would later require encrypting a handback to it. */
export async function assertUsableX25519Recipient(publicKeyHex: string): Promise<void> {
  const publicKey=await importX25519PublicKey(publicKeyHex,'browser return key'),subtle=assertWebCrypto();
  try {
    const generated=await subtle.generateKey({name:'X25519'},false,['deriveBits']);
    if (!('privateKey' in generated)) throw Error('Expected a fresh X25519 key pair.');
    const shared=new Uint8Array(await subtle.deriveBits({name:'X25519',public:publicKey},generated.privateKey,256));
    if (!shared.some(byte=>byte!==0)) throw Error('X25519 shared secret is zero.');
  } catch {throw Error('The browser return encryption key is unusable.');}
}

/** Structured canonical AAD: deterministic JSON object binding purpose, grantDigest, ephemeralPublicKey, and nonce. */
export function createCanonicalAad(
  purpose: 'line:agent-pairing/v1' | 'line:agent-handback/v1',
  grantDigest: string,
  ephemeralPublicKey: string,
  nonce: string,
): Uint8Array<ArrayBuffer> {
  if (purpose !== 'line:agent-pairing/v1' && purpose !== 'line:agent-handback/v1') {
    throw new Error(`Unsupported envelope purpose: ${purpose}`);
  }
  if (typeof grantDigest !== 'string' || !HEX32.test(grantDigest) || grantDigest === ALL_ZEROS) {
    throw new Error('Invalid grantDigest in AAD.');
  }
  validateRawX25519Key(ephemeralPublicKey, 'ephemeralPublicKey in AAD');
  if (typeof nonce !== 'string' || !HEX32.test(nonce) || nonce === ALL_ZEROS) {
    throw new Error('Invalid nonce in AAD.');
  }

  const structured = {
    ephemeralPublicKey,
    grantDigest,
    nonce,
    purpose,
  };
  return new TextEncoder().encode(JSON.stringify(structured));
}

export function validateBookOpeningPayload(payload: unknown): AgentBookOpeningPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid book opening payload: expected an object.');
  }
  const obj = record(payload, ['agentSecret','epoch','generation','limit','outstanding','salt'], 'Book opening payload');
  const keys = Object.keys(obj).sort();
  const expectedKeys = ['agentSecret', 'epoch', 'generation', 'limit', 'outstanding', 'salt'];
  if (keys.length !== expectedKeys.length || !expectedKeys.every((k, i) => keys[i] === k)) {
    throw new Error('Book opening payload contains disallowed or missing fields.');
  }
  if (typeof obj.agentSecret !== 'string' || !HEX32.test(obj.agentSecret) || obj.agentSecret === ALL_ZEROS) {
    throw new Error('Invalid agentSecret in book opening payload.');
  }
  if (typeof obj.salt !== 'string' || !HEX32.test(obj.salt) || obj.salt === ALL_ZEROS) {
    throw new Error('Invalid salt in book opening payload.');
  }
  for (const decField of ['limit', 'outstanding', 'epoch', 'generation'] as const) {
    const val = obj[decField];
    if (typeof val !== 'string' || !DEC_INT.test(val) || BigInt(val) > U64) {
      throw new Error(`Invalid ${decField} in book opening payload: must be uint64 decimal string.`);
    }
  }
  if (BigInt(obj.outstanding) > BigInt(obj.limit) || BigInt(obj.generation) === 0n) throw Error('Book opening amounts or generation differ.');
  return Object.fromEntries(expectedKeys.map(key => [key,obj[key]])) as unknown as AgentBookOpeningPayload;
}

export async function encryptBookOpening(options: {
  purpose: 'line:agent-pairing/v1' | 'line:agent-handback/v1';
  recipientPublicKeyHex: string;
  grantDigest: string;
  nonce: string;
  payload: AgentBookOpeningPayload;
}): Promise<AgentEncryptedEnvelope> {
  const { purpose, recipientPublicKeyHex, grantDigest, nonce } = options;
  if (purpose !== 'line:agent-pairing/v1' && purpose !== 'line:agent-handback/v1') {
    throw new Error(`Unsupported purpose: ${purpose}`);
  }
  // Capture the allowlisted values before the first await. Caller mutation must
  // never add issuer/vault material to the eventual plaintext.
  const payload = validateBookOpeningPayload(options.payload);
  const recipientCryptoKey = await importX25519PublicKey(recipientPublicKeyHex, 'recipientPublicKey');

  const subtle = assertWebCrypto();
  let ephemeralKeyPair: CryptoKeyPair;
  try {
    const generated = await subtle.generateKey({ name: 'X25519' }, true, ['deriveKey', 'deriveBits']);
    if (!('privateKey' in generated) || !('publicKey' in generated)) throw Error('Expected an X25519 key pair.');
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

  const saltBytes = hexToBytes(nonce);
  if (saltBytes.byteLength !== 32 || nonce === ALL_ZEROS) {
    throw new Error('Invalid nonce for HKDF salt.');
  }

  const ikmKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const infoBytes = new TextEncoder().encode(purpose);
  const aesKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes },
    ikmKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const aad = createCanonicalAad(purpose, grantDigest, ephemeralPublicKey, nonce);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));

  const ciphertextBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    aesKey,
    plaintext,
  );

  const ciphertextHex = toHex(new Uint8Array(ciphertextBuf));
  if (ciphertextHex.length > MAX_CIPHERTEXT_HEX_LEN || ciphertextHex.length === 0) {
    throw new Error('Ciphertext exceeds maximum allowed length or is empty.');
  }

  return {
    version: 1,
    purpose,
    ephemeralPublicKey,
    nonce,
    iv: toHex(iv),
    ciphertext: ciphertextHex,
  };
}

export async function decryptBookOpening(options: {
  envelope: AgentEncryptedEnvelope;
  expectedPurpose: 'line:agent-pairing/v1' | 'line:agent-handback/v1';
  expectedGrantDigest: string;
  expectedNonce: string;
  recipientPrivateKeyHex: string;
}): Promise<AgentBookOpeningPayload> {
  const { expectedPurpose, expectedGrantDigest, expectedNonce, recipientPrivateKeyHex } = options;
  const envelope = envelopeSnapshot(options.envelope);
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Invalid envelope: expected an object.');
  }
  if (envelope.version !== 1) {
    throw new Error(`Unsupported envelope version: ${envelope.version}`);
  }
  if (envelope.purpose !== expectedPurpose) {
    throw new Error(`Envelope purpose mismatch: expected ${expectedPurpose}, got ${envelope.purpose}`);
  }
  if (envelope.nonce !== expectedNonce) {
    throw new Error(`Envelope nonce mismatch: expected ${expectedNonce}, got ${envelope.nonce}`);
  }
  if (!HEX12.test(envelope.iv)) {
    throw new Error('Invalid envelope IV: must be a 12-byte hexadecimal string.');
  }
  if (typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length === 0
      || envelope.ciphertext.length > MAX_CIPHERTEXT_HEX_LEN || !/^[0-9a-f]+$/i.test(envelope.ciphertext)) {
    throw new Error('Invalid envelope ciphertext: must be a non-empty hexadecimal string within bounds.');
  }

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

  const aad = createCanonicalAad(envelope.purpose, expectedGrantDigest, envelope.ephemeralPublicKey, envelope.nonce);
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintextBuf));
  } catch {
    throw new Error('Decrypted payload is not valid JSON.');
  }

  return validateBookOpeningPayload(parsed);
}

/** Public offer checks only. The caller must check/consume its nonce under the
 * durable browser fence lock. An in-memory set is not durable replay protection. */
export function verifyPairingOffer(
  offer: unknown,
  pinned: {
    runnerOrigin: string;
    runnerPublicKey: string;
    runnerSigningPublicKey: string;
  },
  seenNonces?: Set<string>,
  now = Date.now(),
  maxAgeMs = 300_000,
): AgentPairingOffer {
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) {
    throw new Error('Invalid pairing offer: expected an object.');
  }
  const o = offer as Record<string, unknown>;
  record(o, ['schema','runnerOrigin','runnerPublicKey','runnerSigningPublicKey','offerNonce','timestamp'], 'Pairing offer');
  if (o.schema !== 'line:agent-pairing-offer/v1') {
    throw new Error(`Unsupported pairing offer schema: ${o.schema}`);
  }
  if (typeof o.runnerOrigin !== 'string') {
    throw new Error('Invalid runnerOrigin in pairing offer.');
  }
  if (new TextEncoder().encode(o.runnerOrigin).byteLength > MAX_ORIGIN_BYTES) {
    throw new Error('runnerOrigin exceeds 200 bytes.');
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(o.runnerOrigin);
  } catch {
    throw new Error('Invalid runnerOrigin URL.');
  }
  if (parsedUrl.origin !== o.runnerOrigin
      || (parsedUrl.protocol !== 'https:' && (parsedUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)))) {
    throw new Error('runnerOrigin must be HTTPS or loopback HTTP.');
  }
  if (o.runnerOrigin !== pinned.runnerOrigin) {
    throw new Error('runnerOrigin does not match the pinned runner origin.');
  }

  validateRawX25519Key(String(o.runnerPublicKey), 'runnerPublicKey');
  validateSchnorrKey(String(o.runnerSigningPublicKey), 'runnerSigningPublicKey');

  if (o.runnerPublicKey !== pinned.runnerPublicKey) {
    throw new Error('runnerPublicKey does not match pinned identity: key rotation refused.');
  }
  if (o.runnerSigningPublicKey !== pinned.runnerSigningPublicKey) {
    throw new Error('runnerSigningPublicKey does not match pinned identity: key rotation refused.');
  }
  if (o.runnerPublicKey === o.runnerSigningPublicKey) {
    throw new Error('Runner encryption key and signing key must be distinct.');
  }

  const nonce = String(o.offerNonce);
  if (!HEX32.test(nonce) || nonce === ALL_ZEROS) {
    throw new Error('Invalid offerNonce: must be a non-zero 32-byte hexadecimal string.');
  }
  if (seenNonces?.has(nonce)) {
    throw new Error('Duplicate offer nonce: replay rejected.');
  }

  if (!Number.isSafeInteger(o.timestamp) || typeof o.timestamp !== 'number') {
    throw new Error('Invalid timestamp in pairing offer.');
  }
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 || maxAgeMs > 300_000 || Math.abs(now - o.timestamp) > maxAgeMs) {
    throw new Error('Pairing offer timestamp expired or outside acceptable window.');
  }

  return {
    schema: 'line:agent-pairing-offer/v1',
    runnerOrigin: o.runnerOrigin,
    runnerPublicKey: o.runnerPublicKey as string,
    runnerSigningPublicKey: o.runnerSigningPublicKey as string,
    offerNonce: nonce,
    timestamp: o.timestamp,
  };
}

export function createPairingPackage(
  scope: AgentGrantScope,
  ownerSignature: AgentGrantProof,
  encryptedOpening: AgentEncryptedEnvelope,
): AgentPairingPackage {
  if (encryptedOpening.purpose !== 'line:agent-pairing/v1') {
    throw new Error('Encrypted opening must have purpose line:agent-pairing/v1.');
  }
  if (encryptedOpening.nonce !== scope.nonce) {
    throw new Error('Encrypted opening nonce must match grant scope offerNonce.');
  }
  return verifyPairingPackageStructure({
    schema: 'line:agent-pairing-package/v1',
    packageId: scope.grantId,
    offerNonce: scope.nonce,
    scope,
    ownerSignature,
    encryptedOpening,
  });
}

export function verifyPairingPackageStructure(pkg: unknown): AgentPairingPackage {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    throw new Error('Invalid pairing package: expected an object.');
  }
  const p = pkg as Record<string, unknown>;
  record(p, ['schema','packageId','offerNonce','scope','ownerSignature','encryptedOpening'], 'Pairing package');
  if (p.schema !== 'line:agent-pairing-package/v1') {
    throw new Error(`Unsupported pairing package schema: ${p.schema}`);
  }
  if (typeof p.packageId !== 'string' || !UUID.test(p.packageId)) {
    throw new Error('Invalid packageId in pairing package.');
  }
  if (typeof p.offerNonce !== 'string' || !HEX32.test(p.offerNonce)) {
    throw new Error('Invalid offerNonce in pairing package.');
  }
  const scope = p.scope as AgentGrantScope;
  record(scope, AGENT_GRANT_FIELDS, 'Grant scope');
  agentGrantMessage(scope);
  if (!scope || typeof scope !== 'object' || scope.grantId !== p.packageId || scope.nonce !== p.offerNonce) {
    throw new Error('Pairing packageId and offerNonce do not bind to grant scope.');
  }
  const env = envelopeSnapshot(p.encryptedOpening);
  if (!env || typeof env !== 'object' || env.purpose !== 'line:agent-pairing/v1' || env.nonce !== p.offerNonce) {
    throw new Error('Encrypted opening envelope does not bind to pairing package offerNonce.');
  }
  const sig = p.ownerSignature as AgentGrantProof;
  if (sig && typeof sig === 'object') record(sig, sig.scheme === undefined ? ['verifyingKey','signature'] : ['scheme','verifyingKey','signature'], 'Owner signature');
  if (!sig || typeof sig !== 'object' || !HEX32.test(sig.verifyingKey) || !/^[0-9a-f]{128}$/.test(sig.signature)) {
    throw new Error('Invalid owner signature proof in pairing package.');
  }
  if (sig.scheme !== undefined && sig.scheme !== 'schnorr_bip340') throw Error('Unsupported owner signature scheme.');
  // Structural validation only; the receiving runtime must independently verify
  // the real owner signature and pinned full scope before decrypting/activating.
  return structuredClone({...p, encryptedOpening:env}) as unknown as AgentPairingPackage;
}

/** Shared exact-package binding for retained acknowledgements. Key ordering
 * does not change identity; ciphertext bytes and every reviewed field do. */
export function pairingPackageCanonicalMessage(pkg: unknown): string {
  const captured=verifyPairingPackageStructure(pkg);
  const canonical=(value: any): any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  return 'line:agent-pairing-package/v1\0'+JSON.stringify(canonical(captured));
}
export async function browserPairingPackageDigest(pkg: unknown): Promise<string> {
  const bytes=new TextEncoder().encode(pairingPackageCanonicalMessage(pkg));
  return toHex(new Uint8Array(await assertWebCrypto().digest('SHA-256',bytes)));
}
