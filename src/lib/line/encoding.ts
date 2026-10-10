/**
 * Compact encoding replica.
 *
 * Hashing and commitments call `@midnight-ntwrk/compact-runtime`
 * persistentHash / persistentCommit with the same CompactType descriptors
 * the compiler emits for contracts/line.compact. They are not a parallel
 * SHA-256 scheme.
 *
 * Hex helpers are local. compact-runtime's toHex/fromHex use Node `Buffer`,
 * which is not defined in the browser.
 */
import {
  CompactTypeBytes,
  CompactTypeUnsignedInteger,
  CompactTypeVector,
  convertFieldToBytes,
  persistentCommit,
  persistentHash,
  type CompactType,
} from "@midnight-ntwrk/compact-runtime";

export const BYTES32 = new CompactTypeBytes(32);
export const UINT64 = new CompactTypeUnsignedInteger(18446744073709551615n, 8);
const VEC2 = new CompactTypeVector(2, BYTES32);
const VEC4 = new CompactTypeVector(4, BYTES32);
const VEC7 = new CompactTypeVector(7, BYTES32);
const VEC10 = new CompactTypeVector(10, BYTES32);

export type LinePreimage = {
  domain: Uint8Array;
  identity: Uint8Array;
  limit: bigint;
  outstanding: bigint;
  epoch: bigint;
};

class LinePreimageType implements CompactType<LinePreimage> {
  alignment() {
    return BYTES32.alignment().concat(
      BYTES32.alignment().concat(
        UINT64.alignment().concat(UINT64.alignment().concat(UINT64.alignment())),
      ),
    );
  }
  toValue(value: LinePreimage) {
    return BYTES32.toValue(value.domain).concat(
      BYTES32.toValue(value.identity).concat(
        UINT64.toValue(value.limit).concat(
          UINT64.toValue(value.outstanding).concat(UINT64.toValue(value.epoch)),
        ),
      ),
    );
  }
  fromValue(value: Parameters<CompactType<LinePreimage>["fromValue"]>[0]) {
    return {
      domain: BYTES32.fromValue(value),
      identity: BYTES32.fromValue(value),
      limit: UINT64.fromValue(value),
      outstanding: UINT64.fromValue(value),
      epoch: UINT64.fromValue(value),
    };
  }
}

export const LINE_PREIMAGE_TYPE = new LinePreimageType();

export type DrawNotePreimage = {
  domain: Uint8Array;
  lineGeneration: bigint;
  identity: Uint8Array;
  quoteCommit: Uint8Array;
  merchantPk: Uint8Array;
  amount: bigint;
  /** Zero defaults are only for low-level hash fixtures. Product records require fee. */
  fee?: bigint;
  noteNonce: Uint8Array;
  expiry: bigint;
};

class DrawNotePreimageType implements CompactType<DrawNotePreimage> {
  alignment() {
    return BYTES32.alignment().concat(
      UINT64.alignment().concat(
        BYTES32.alignment().concat(
          BYTES32.alignment().concat(
            BYTES32.alignment().concat(
              UINT64.alignment().concat(
                UINT64.alignment().concat(BYTES32.alignment().concat(UINT64.alignment())),
              ),
            ),
          ),
        ),
      ),
    );
  }
  toValue(value: DrawNotePreimage) {
    return BYTES32.toValue(value.domain).concat(
      UINT64.toValue(value.lineGeneration).concat(
        BYTES32.toValue(value.identity).concat(
          BYTES32.toValue(value.quoteCommit).concat(
            BYTES32.toValue(value.merchantPk).concat(
              UINT64.toValue(value.amount).concat(
                UINT64.toValue(value.fee ?? 0n).concat(
                  BYTES32.toValue(value.noteNonce).concat(UINT64.toValue(value.expiry)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
  fromValue(value: Parameters<CompactType<DrawNotePreimage>["fromValue"]>[0]) {
    return {
      domain: BYTES32.fromValue(value),
      lineGeneration: UINT64.fromValue(value),
      identity: BYTES32.fromValue(value),
      quoteCommit: BYTES32.fromValue(value),
      merchantPk: BYTES32.fromValue(value),
      amount: UINT64.fromValue(value),
      fee: UINT64.fromValue(value),
      noteNonce: BYTES32.fromValue(value),
      expiry: UINT64.fromValue(value),
    };
  }
}

export const DRAW_NOTE_PREIMAGE_TYPE = new DrawNotePreimageType();

export type RefundPreimage = {
  domain: Uint8Array;
  lineGeneration: bigint;
  identity: Uint8Array;
  noteCommit: Uint8Array;
  amount: bigint;
};

class RefundPreimageType implements CompactType<RefundPreimage> {
  alignment() {
    return BYTES32.alignment().concat(UINT64.alignment(), BYTES32.alignment(), BYTES32.alignment(), UINT64.alignment());
  }
  toValue(value: RefundPreimage) {
    return BYTES32.toValue(value.domain).concat(UINT64.toValue(value.lineGeneration), BYTES32.toValue(value.identity), BYTES32.toValue(value.noteCommit), UINT64.toValue(value.amount));
  }
  fromValue(value: Parameters<CompactType<RefundPreimage>["fromValue"]>[0]) {
    return { domain: BYTES32.fromValue(value), lineGeneration: UINT64.fromValue(value), identity: BYTES32.fromValue(value), noteCommit: BYTES32.fromValue(value), amount: UINT64.fromValue(value) };
  }
}

export const REFUND_PREIMAGE_TYPE = new RefundPreimageType();

export function refundCommit(preimage: RefundPreimage, salt: Uint8Array): Uint8Array {
  return persistentCommit(REFUND_PREIMAGE_TYPE, preimage, salt);
}

export function pad32(label: string): Uint8Array {
  const out = new Uint8Array(32);
  const enc = new TextEncoder().encode(label);
  if (enc.length > 32) throw new Error(`pad32 overflow: ${label}`);
  out.set(enc);
  return out;
}

/** Lowercase hex. Does not use Node Buffer. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error("expected 32-byte hex");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("Invalid hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export const bytesToHex = toHex;

export function encodeU64(n: bigint): Uint8Array {
  if (n < 0n || n > 18446744073709551615n) {
    throw new Error("Uint<64> out of range");
  }
  return convertFieldToBytes(32, n, "line.encodeU64");
}

/** Versioned off-chain normalization of an exact external payment/allocation ID.
 * The entire UTF-8 reference is length-bound; no truncation, hex guessing or
 * Unicode replacement is allowed. This produces the paymentRef witness bytes,
 * not a replacement for the Compact paymentNullifier or receipt hash. */
export function canonicalPaymentReferenceBytes(reference: string): Uint8Array {
  if (typeof reference !== "string" || !reference.length || reference !== reference.trim())
    throw new Error("Payment reference must be nonempty with no surrounding whitespace.");
  for (let i = 0; i < reference.length; i++) {
    const code = reference.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = reference.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("Malformed Unicode payment reference.");
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error("Malformed Unicode payment reference.");
  }
  const bytes = new TextEncoder().encode(reference);
  if (bytes.length > 4096) throw new Error("Payment reference exceeds 4096 UTF-8 bytes.");
  const parts = [pad32("line:payment-ref:v1"), encodeU64(BigInt(bytes.length))];
  for (let offset = 0; offset < bytes.length; offset += 32) {
    const part = new Uint8Array(32);
    part.set(bytes.subarray(offset, offset + 32)); parts.push(part);
  }
  return persistentHash(new CompactTypeVector(parts.length, BYTES32), parts);
}

export function randomBytes32(): Uint8Array {
  const out = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(out);
  } else {
    // Node.js fallback using dynamic import or global crypto
    try {
      const nodeCrypto = globalThis.crypto;
      nodeCrypto.getRandomValues(out);
    } catch {
      throw new Error("no CSPRNG");
    }
  }
  return out;
}

export const TAG = {
  issuerPk: pad32("line:issuer:pk"),
  merchantPk: pad32("line:merchant:pk"),
  id: pad32("line:id"),
  domain: pad32("line:v2:domain"),
  quote: pad32("line:v3:quote"),
  draw: pad32("line:v2:draw"),
  redeem: pad32("line:v2:redeem"),
  repay: pad32("line:v2:repay"),
  payment: pad32("line:v3:payment"),
} as const;

export function issuerPublicKey(sk: Uint8Array): Uint8Array {
  return persistentHash(VEC2, [TAG.issuerPk, sk]);
}

export function merchantPublicKey(sk: Uint8Array): Uint8Array {
  return persistentHash(VEC2, [TAG.merchantPk, sk]);
}

export function agentId(sk: Uint8Array): Uint8Array {
  return persistentHash(VEC2, [TAG.id, sk]);
}

export function contractDomain(
  issuerPk: Uint8Array,
  initialMerchantPk: Uint8Array,
  instanceNonce: Uint8Array,
): Uint8Array {
  return persistentHash(VEC4, [TAG.domain, issuerPk, initialMerchantPk, instanceNonce]);
}

export function lineStateCommit(preimage: LinePreimage, salt: Uint8Array): Uint8Array {
  return persistentCommit(LINE_PREIMAGE_TYPE, preimage, salt);
}

export function drawNoteCommit(preimage: DrawNotePreimage, salt: Uint8Array): Uint8Array {
  return persistentCommit(DRAW_NOTE_PREIMAGE_TYPE, preimage, salt);
}

export function quoteCommit(parts: {
  merchantPk: Uint8Array;
  invoiceId: Uint8Array;
  amount: bigint;
  expiry: bigint;
  nonce: Uint8Array;
  generation: bigint;
  domain: Uint8Array;
  feeFlat?: bigint;
  feeBps?: bigint;
}): Uint8Array {
  return persistentHash(VEC10, [
    TAG.quote,
    parts.merchantPk,
    parts.invoiceId,
    encodeU64(parts.amount),
    encodeU64(parts.expiry),
    parts.nonce,
    encodeU64(parts.generation),
    parts.domain,
    encodeU64(parts.feeFlat ?? 0n),
    encodeU64(parts.feeBps ?? 0n),
  ]);
}

/** Exact issuer policy arithmetic, retaining full Uint64 precision. */
export function requiredDrawFee(amount: bigint, flat: bigint, bps: bigint): bigint {
  const max = (1n << 64n) - 1n;
  for (const value of [amount, flat, bps]) {
    if (typeof value !== "bigint" || value < 0n || value > max) throw new RangeError("Fee inputs must be Uint64 bigint values");
  }
  if (bps > 10_000n) throw new RangeError("Fee basis points exceed supported rate");
  const fee = flat + (amount * bps + 9_999n) / 10_000n;
  if (fee > max) throw new RangeError("Required fee exceeds Uint64");
  return fee;
}

export function drawNullifier(sk: Uint8Array, Q: Uint8Array, domain: Uint8Array): Uint8Array {
  return persistentHash(VEC4, [TAG.draw, sk, Q, domain]);
}

export function redeemNullifier(sk: Uint8Array, D: Uint8Array, domain: Uint8Array): Uint8Array {
  return persistentHash(VEC4, [TAG.redeem, sk, D, domain]);
}

export function repayNullifier(parts: {
  nonce: Uint8Array;
  identity: Uint8Array;
  currentC: Uint8Array;
  amount: bigint;
  paymentRef: Uint8Array;
  domain: Uint8Array;
}): Uint8Array {
  return persistentHash(VEC7, [
    TAG.repay,
    parts.nonce,
    parts.identity,
    parts.currentC,
    encodeU64(parts.amount),
    parts.paymentRef,
    parts.domain,
  ]);
}

/** One credit allocation per issuer-authenticated payment reference and instance.
 * Mutable books, amount, identity and receipt nonce deliberately do not enter
 * this hash. The issuer secret prevents public guessing of low-entropy IDs. */
export function paymentNullifier(issuerSecret: Uint8Array, paymentRef: Uint8Array, domain: Uint8Array): Uint8Array {
  return persistentHash(VEC4, [TAG.payment, issuerSecret, paymentRef, domain]);
}

export function shortHex(hex: string, n = 8): string {
  if (hex.length <= n * 2 + 1) return hex;
  return `${hex.slice(0, n)}…${hex.slice(-n)}`;
}

/**
 * Deterministic canonical invoice ID encoding:
 * If a 64-character (32-byte) hex string, decodes directly to bytes.
 * Otherwise, encodes ASCII/UTF-8 string padded to 32 bytes with zeros.
 */
export function canonicalInvoiceIdBytes(invoiceId: string): Uint8Array {
  const clean = invoiceId.startsWith("0x") ? invoiceId.slice(2) : invoiceId;
  if (/^[0-9a-fA-F]{64}$/.test(clean)) {
    return fromHex(clean);
  }
  return pad32(invoiceId);
}

export function canonicalInvoiceIdHex(invoiceId: string): string {
  return toHex(canonicalInvoiceIdBytes(invoiceId));
}

