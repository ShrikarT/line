/** Exact retained identifiers covered by the same audited predecessor argument. */
export const EXPIRED_OPENING_TRANSACTION_IDS = Object.freeze([
  "006c23221e7a0ebe76a1975d827166437f010f611e6a95bd38d6b0c5b55ab524e2",
  "00abb757c332b831dd25c7640f417d50323639ede3361893571e361ec8eae44813",
] as const);

/** Audited recovery checkpoint, not a generic expiry escape. */
export const EXPIRED_OPENING = Object.freeze({
  address: "ab428f74f8a8e72dc66a2f521c932d97860525d848a4d7a3acf0c795b3ef7e73",
  // Retain the original identifier for existing records and callers.
  txId: EXPIRED_OPENING_TRANSACTION_IDS[0],
  sourceFingerprint: "057aa57267c0b8afd537cfb8950946db99bda45954a259c521877bdbb23e5157",
  baselineHeight: 3062090,
  baselineHash: "07e0ca54c514da92538ec7d29b3c1aa9db4f315d6a61bd0142379a20dafc9306",
  baselineStateSha256: "b7ff374bea501e82b6fb2210b1e1fed115f1b3688402cb49b6e1ba2211066cdd",
  genesisHash: "df831b09a8baa92badf47762ce5ac439b7e47e3ed3d39600cfdd44fad552361b",
  runtimeSpecVersion: 1000300,
  timestampKey: "0xf0c365c3cf59d671eb72da0e7a4113c49f1f0515f462cdcf84e0f1d6045dfcbb",
});

/** Metadata scope only. Canonical bytes, candidate, finalized state and TTL must
 * still be verified locally before a review or archive can be admitted.
 */
export function matchesExpiredOpeningScope(pending: {
  kind?: unknown; circuit?: unknown; txId?: unknown; contractAddress?: unknown; sourceFingerprint?: unknown;
} | null | undefined): boolean {
  return pending?.kind === "call" && pending.circuit === "openLine"
    && pending.contractAddress === EXPIRED_OPENING.address
    && pending.sourceFingerprint === EXPIRED_OPENING.sourceFingerprint
    && EXPIRED_OPENING_TRANSACTION_IDS.some(id => id === pending.txId);
}

export type ExpiredStateEvidence = {
  schema: string;
  address: string; genesisHash: string; runtimeSpecVersion: number;
  baseline: { hash: string; height: number; state: string };
  finalized: { hash: string; height: number; timestamp: number; state: string };
};

export type ExpiredOpeningEvidence = ExpiredStateEvidence & { schema: "line:expired-opening-evidence/v1" };
