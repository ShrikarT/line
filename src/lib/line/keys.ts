import { agentId, issuerPublicKey, merchantPublicKey, pad32, toHex } from "./encoding.ts";

/** Deterministic 32-byte demo secrets. Not production keys. */
export const ISSUER_SK = toHex(pad32("line:demo:issuer"));
export const MERCHANT_A_SK = toHex(pad32("line:demo:merchant:a"));
export const MERCHANT_B_SK = toHex(pad32("line:demo:merchant:b"));
export const AGENT_SK = toHex(pad32("line:demo:agent"));
export const INSTANCE_NONCE = toHex(pad32("line:demo:instance:1"));

export const ISSUER_PK = toHex(issuerPublicKey(pad32("line:demo:issuer")));
export const MERCHANT_A_PK = toHex(merchantPublicKey(pad32("line:demo:merchant:a")));
export const MERCHANT_B_PK = toHex(merchantPublicKey(pad32("line:demo:merchant:b")));
export const AGENT_ID = toHex(agentId(pad32("line:demo:agent")));

/** Aliases for backward compatibility with single-merchant desks */
export const MERCHANT_SK = MERCHANT_A_SK;
export const MERCHANT_PK = MERCHANT_A_PK;
export const ISSUER = ISSUER_SK;
export const MERCHANT = MERCHANT_SK;
export const AGENT = AGENT_SK;
