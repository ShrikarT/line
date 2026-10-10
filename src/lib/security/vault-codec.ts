import { VaultTamperedError } from "../runtime/errors.ts";

const FORMAT = "line:vault-json/v1";
const MAX_DEPTH = 100;
const MAX_NODES = 100_000;
type Node = [string, ...unknown[]];

/** Tag every value so application objects cannot collide with special-value markers. */
export function encodeVaultJson(value: unknown): string {
  const ancestors = new WeakSet<object>();
  let count = 0;
  function encode(value: unknown, depth: number): Node {
    if (++count > MAX_NODES || depth > MAX_DEPTH) throw new TypeError("Vault payload exceeds codec limits.");
    if (value === null) return ["null"];
    if (value === undefined) return ["undefined"];
    if (typeof value === "string" || typeof value === "boolean") return [typeof value, value];
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError("Non-finite vault number.");
      return ["number", Object.is(value, -0) ? "-0" : value];
    }
    if (typeof value === "bigint") return ["bigint", value.toString()];
    if (value instanceof Uint8Array) return ["bytes", Array.from(value, b => b.toString(16).padStart(2, "0")).join("")];
    if (typeof value !== "object") throw new TypeError("Unsupported vault value.");
    if (ancestors.has(value)) throw new TypeError("Cyclic vault payload.");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const children: Node[] = [];
        for (let i = 0; i < value.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !("value" in descriptor)) throw new TypeError("Sparse or accessor vault array.");
          children.push(encode(descriptor.value, depth + 1));
        }
        return ["array", children];
      }
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new TypeError("Vault objects must be plain records.");
      }
      if (Object.getOwnPropertySymbols(value).length) throw new TypeError("Symbol vault keys are unsupported.");
      const entries: [string, Node][] = [];
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!descriptor.enumerable) continue;
        if (!("value" in descriptor)) throw new TypeError("Accessor vault values are unsupported.");
        entries.push([key, encode(descriptor.value, depth + 1)]);
      }
      return ["object", entries];
    } finally { ancestors.delete(value); }
  }
  return JSON.stringify({ format: FORMAT, payload: encode(value, 0) });
}

export function decodeVaultJson(json: string): unknown {
  try {
    const parsed: unknown = JSON.parse(json);
    // Existing records contained ordinary JSON. Retain read compatibility.
    if (!parsed || typeof parsed !== "object" || !("format" in parsed) ||
        typeof parsed.format !== "string" || !parsed.format.startsWith("line:vault-json/")) return parsed;
    if (parsed.format !== FORMAT || !("payload" in parsed) || Object.keys(parsed).length !== 2) throw new Error("Invalid codec version.");
    let count = 0;
    function decode(node: unknown, depth: number): unknown {
      if (++count > MAX_NODES || depth > MAX_DEPTH || !Array.isArray(node)) throw new Error("Invalid codec node.");
      const [tag, value] = node;
      if (tag === "null" && node.length === 1) return null;
      if (tag === "undefined" && node.length === 1) return undefined;
      if (node.length !== 2) throw new Error("Invalid node arity.");
      if (tag === "string" && typeof value === "string") return value;
      if (tag === "boolean" && typeof value === "boolean") return value;
      if (tag === "number" && value === "-0") return -0;
      if (tag === "number" && typeof value === "number" && Number.isFinite(value)) return value;
      if (tag === "bigint" && typeof value === "string" && /^(0|-?[1-9][0-9]*)$/.test(value)) return BigInt(value);
      if (tag === "bytes" && typeof value === "string" && /^(?:[0-9a-f]{2})*$/.test(value)) {
        return Uint8Array.from(value.match(/../g) ?? [], pair => parseInt(pair, 16));
      }
      if (tag === "array" && Array.isArray(value)) return value.map(child => decode(child, depth + 1));
      if (tag === "object" && Array.isArray(value)) {
        const result: Record<string, unknown> = {};
        for (const entry of value) {
          if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || Object.hasOwn(result, entry[0])) throw new Error("Invalid object entry.");
          Object.defineProperty(result, entry[0], { value: decode(entry[1], depth + 1), enumerable: true, writable: true, configurable: true });
        }
        return result;
      }
      throw new Error("Invalid codec value.");
    }
    return decode(parsed.payload, 0);
  } catch {
    throw new VaultTamperedError("Vault JSON payload is malformed or unsupported.");
  }
}
