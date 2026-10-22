// Passwords and verified settings live only in this worker's memory. No storage,
// network, signing or transaction API is available through this protocol.
export {};
type RecordValue = { accountId: string; receivingAddress: string; passphrase: string; expiresAt: number; configuration: { networkId: string } };
const records = new Map<string, RecordValue>();
const scope = self as unknown as { onconnect: (event: MessageEvent) => void };
function prune() { for (const [key, value] of records) if (value.expiresAt <= Date.now()) records.delete(key); }
scope.onconnect = event => {
  const port = event.ports[0];
  port.onmessage = event => {
    const { id, token, operation, record } = event.data ?? {};
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(token ?? "")) return;
    prune(); let value: RecordValue | null = null;
    if (operation === "remember") {
      if (!record || typeof record.passphrase !== "string" || record.passphrase.length < 8 || record.passphrase.length > 4096 ||
        !/^[a-f0-9]{64}$/.test(record.accountId ?? "") || typeof record.receivingAddress !== "string" || record.receivingAddress.length > 256 ||
        record.configuration?.networkId !== "preprod" || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= Date.now() || record.expiresAt > Date.now() + 12 * 60 * 60 * 1000 + 1000 ||
        !records.has(token) && records.size >= 8) { port.postMessage({ id, ok: false }); return; }
      records.set(token, record);
    } else if (operation === "resume") value = records.get(token) ?? null;
    else if (operation === "forget") records.delete(token);
    else return;
    port.postMessage({ id, ok: true, value });
  };
  port.start();
};
setInterval(prune, 60_000);
