import { cn } from "@/lib/utils";
import { shortHex } from "@/lib/line/hash.ts";
import { useLine, type Flash } from "@/lib/line/store.ts";

export function Panel({
  title,
  kicker,
  children,
  className,
}: {
  title: string;
  kicker?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-elevated p-5 md:p-6",
        className,
      )}
    >
      {kicker ? (
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">
          {kicker}
        </p>
      ) : null}
      <h2 className="font-display text-lg tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium transition-transform duration-[var(--motion-quick)] enabled:active:scale-[0.98] disabled:opacity-40",
        variant === "primary" && "bg-accent text-accent-fg",
        variant === "ghost" && "border border-border bg-transparent text-fg",
        variant === "danger" && "border border-danger/40 text-danger",
      )}
    >
      {children}
    </button>
  );
}

export function Mono({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-subtle">—</span>;
  return (
    <code className="break-all font-mono text-xs text-muted" title={value}>
      {shortHex(value, 8)}
    </code>
  );
}

export function Stat({ label, value, privateHint }: { label: string; value: React.ReactNode; privateHint?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-subtle">
        {label}
        {privateHint ? " · private" : ""}
      </p>
      <div className="mt-1 font-mono text-sm tabular-nums">{value}</div>
    </div>
  );
}

export function FlashBar({ flash }: { flash: Flash | null }) {
  if (!flash) return null;
  return (
    <p
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        flash.tone === "ok" && "border-ok/30 text-ok",
        flash.tone === "fail" && "border-danger/30 text-danger",
        flash.tone === "info" && "border-border text-muted",
      )}
    >
      {flash.text}
    </p>
  );
}

export function ResetRow() {
  const reset = useLine((s) => s.reset);
  return (
    <Button variant="ghost" onClick={reset}>
      Reset ledger
    </Button>
  );
}
