import { EXPIRED_DISABLE } from "./expired-disable-policy.ts";
import type { ExpiredStateEvidence } from "./expired-opening-policy.ts";

/** This one signed allocation only, against the verified Merchant 2 draw. */
export const EXPIRED_COMPENSATION = Object.freeze({
  ...EXPIRED_DISABLE,
  txId: "00dd26b256427e8ad3dd29dc7054cf7447c697a383933ea8dd50c5a1aec73c3c27",
  noteCommitment: "9d55f2375cd36e6684ebbc342fa1d9d1d00199b5d2ae5f40b4d6d11e515d23ef",
});

export function matchesExpiredCompensationScope(pending: {
  kind?: unknown; circuit?: unknown; txId?: unknown; contractAddress?: unknown; sourceFingerprint?: unknown;
} | null | undefined): boolean {
  return pending?.kind === "call" && pending.circuit === "cancelOrExpireNote"
    && pending.txId === EXPIRED_COMPENSATION.txId && pending.contractAddress === EXPIRED_COMPENSATION.address
    && pending.sourceFingerprint === EXPIRED_COMPENSATION.sourceFingerprint;
}
export type ExpiredCompensationEvidence = ExpiredStateEvidence & { schema: "line:expired-compensation-evidence/v1" };
