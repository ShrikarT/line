import { issuerPublicKey, merchantPublicKey, pad32, toHex } from "./encoding.ts";

/** Deterministic 32-byte demo secrets. Not production keys. */
export const ISSUER_SK = toHex(pad32("line:demo:issuer"));
export const MERCHANT_SK = toHex(pad32("line:demo:merchant"));
export const AGENT_SK = toHex(pad32("line:demo:agent"));

export const ISSUER_PK = toHex(issuerPublicKey(pad32("line:demo:issuer")));
export const MERCHANT_PK = toHex(merchantPublicKey(pad32("line:demo:merchant")));

/** @deprecated use ISSUER_SK — kept as an alias for desk copy */
export const ISSUER = ISSUER_SK;
export const MERCHANT = MERCHANT_SK;
export const AGENT = AGENT_SK;
