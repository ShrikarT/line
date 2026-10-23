import { EXPIRED_DISABLE } from "./expired-disable-policy.ts";
import type { ExpiredStateEvidence } from "./expired-opening-policy.ts";

/** One retained Merchant 2 quote, after the verified compensation receipt. */
export const EXPIRED_QUOTE = Object.freeze({
  ...EXPIRED_DISABLE,
  txId: "0077dc714982d5af87aa9035d5fca6413f7de9367e890d74cfcb4d0644744dfd53",
  quoteCommitment: "3eaa15536ddac4b264da8b410976a7e8370fc64b3fae7c8c12657de5048154c6",
  invoice: "line-merchant2-20261023-02",
  baselineHeight: 3104191,
  baselineHash: "874ecdaf81d73e5e03291eb28855f2993bbebc2259257a3521eb3938896741b8",
  baselineStateSha256: "fb3fc3bc8de79e048d3c5112a51457f166a2a8d928821f715f2377226de62acf",
});
export function matchesExpiredQuoteScope(pending: {
  kind?: unknown; circuit?: unknown; txId?: unknown; contractAddress?: unknown; sourceFingerprint?: unknown;
} | null | undefined): boolean {
  return pending?.kind === "call" && pending.circuit === "postQuote"
    && pending.txId === EXPIRED_QUOTE.txId && pending.contractAddress === EXPIRED_QUOTE.address
    && pending.sourceFingerprint === EXPIRED_QUOTE.sourceFingerprint;
}
export type ExpiredQuoteEvidence = ExpiredStateEvidence & { schema: "line:expired-quote-evidence/v1" };
