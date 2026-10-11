import { requiredDrawFee } from "@/lib/line/encoding.ts";

/** Price disclosures derive from the same integer policy proved by Compact. */
export function Pricing({ amount, feeFlat, feeBps }: { amount: number; feeFlat: number; feeBps: number }) {
  let fee: number;
  try {
    if (![amount, feeFlat, feeBps].every(Number.isSafeInteger) || amount <= 0) throw new Error("Invalid price");
    fee = Number(requiredDrawFee(BigInt(amount), BigInt(feeFlat), BigInt(feeBps)));
    if (!Number.isSafeInteger(amount + fee)) throw new Error("Unsafe total");
  } catch {
    return <span className="block text-xs text-muted">Price terms unavailable.</span>;
  }
  return <span className="block text-xs text-muted">Merchant price: {amount} · Line fee: {fee} · Added debt: {amount + fee} units</span>;
}
