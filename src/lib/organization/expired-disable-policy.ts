import { EXPIRED_OPENING, type ExpiredStateEvidence } from "./expired-opening-policy.ts";

/** One retained disable, pinned to its verified finalized draw predecessor. */
export const EXPIRED_DISABLE = Object.freeze({
  ...EXPIRED_OPENING,
  txId: "0054af76ef4d913f967d607a266633d5fb6c7d6db18b79b4ddb7c6d9158649cce6",
  merchantPk: "f3148e603b799ce669c1f7d780e6195203817374d8d5505f349535c80d2d5e48",
  merchantAddress: "mn_addr_preprod1jwv0vel7mt86rnj976uu7fz5qrr0m7x96gm3ygv0nlw7nu2nmqkqe826t0",
  baselineHeight: 3102203,
  baselineHash: "13d5551f24549e40163593496d37607654db72581c321a5d23cbd2ea291892ce",
  baselineStateSha256: "6a719b9fa4fd187e102f158c040d7c4b9586d02c2df31fe4fc8f72c561a87cf7",
});

/** Metadata admits review only; canonical bytes, replay and evidence remain mandatory. */
export function matchesExpiredDisableScope(pending: {
  kind?: unknown; circuit?: unknown; txId?: unknown; contractAddress?: unknown; sourceFingerprint?: unknown;
} | null | undefined): boolean {
  return pending?.kind === "call" && pending.circuit === "disableMerchant"
    && pending.txId === EXPIRED_DISABLE.txId && pending.contractAddress === EXPIRED_DISABLE.address
    && pending.sourceFingerprint === EXPIRED_DISABLE.sourceFingerprint;
}
export type ExpiredDisableEvidence = ExpiredStateEvidence & { schema: "line:expired-disable-evidence/v1" };
