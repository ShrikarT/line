export interface PreprodReceipt { id: string; kind: string; name: string; txHash: string; blockHeight: number; disposition: string; }
export interface PreprodSummary {
  network: "preprod"; contractAddress: string | null; phase: string; progress: string; busy: boolean; pending: string | null;
  privateBook: { limit: number; outstanding: number; remaining: number };
  orders: { id: string; service: string; status: string; amount: number; document?: string; result: Record<string, unknown> | null }[];
  receipts: PreprodReceipt[]; settlement: string; custody: string; error?: string | null;
}
