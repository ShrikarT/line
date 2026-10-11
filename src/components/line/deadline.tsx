export function Deadline({ seconds, label = "Redeem before" }: { seconds: number; label?: string }) {
  const date = new Date(seconds * 1000);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isFinite(date.getTime()))
    return <span className="block text-xs text-muted">Deadline unavailable; obtain the matching package.</span>;
  return <span className="block text-xs text-muted">{label} <time dateTime={date.toISOString()}>{date.toUTCString()}</time></span>;
}
