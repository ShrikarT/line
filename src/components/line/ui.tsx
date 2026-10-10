import { cn } from "@/lib/utils";
import { shortHex } from "@/lib/line/hash.ts";
import { useLine, type Flash } from "@/lib/line/store.ts";
import { getRuntime } from "@/lib/runtime";

const PIXEL = ["bg-navy", "bg-accent", "bg-pink"] as const;

export function PixelMark() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      <span className="size-2 bg-navy" />
      <span className="size-2 bg-accent" />
      <span className="size-2 bg-pink" />
    </span>
  );
}

export function PixelDivider({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)} aria-hidden="true">
      {Array.from({ length: 32 }, (_, i) => (
        <span key={i} className={cn("size-2 shrink-0", PIXEL[i % 3])} />
      ))}
    </div>
  );
}

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
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">
          {kicker}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <PixelMark />
        <h2 className="font-display text-lg font-semibold tracking-tight text-navy">{title}</h2>
      </div>
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
        variant === "primary" && "bg-accent text-accent-fg hover:opacity-90",
        variant === "ghost" && "border border-navy bg-elevated text-navy hover:bg-subtle-fill",
        variant === "danger" && "border border-danger/40 bg-elevated text-danger hover:bg-danger/10",
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
        flash.tone === "ok" && "border-ok/40 bg-ok/10 text-ok",
        flash.tone === "fail" && "border-danger/40 bg-danger/10 text-danger",
        flash.tone === "info" && "border-pink bg-pink/40 text-navy",
      )}
    >
      {flash.text}
    </p>
  );
}

export function ResetRow({ onReset }: { onReset?: () => void } = {}) {
  const runtime = getRuntime();
  if (runtime.mode === "network") return null;
  return onReset ? (
    <Button variant="ghost" onClick={onReset}>
      Reset simulator
    </Button>
  ) : null;
}
