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
        "line-panel",
        className,
      )}
    >
      <div className="line-panel-header">
        <div>{kicker ? <p className="line-panel-kicker">{kicker}</p> : null}<h2 className="line-panel-title">{title}</h2></div>
        <PixelMark />
      </div>
      <div className="line-panel-content">{children}</div>
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
        "line-button",
        variant === "primary" && "line-button-primary",
        variant === "ghost" && "line-button-ghost",
        variant === "danger" && "line-button-danger",
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
    <div className="line-stat">
      <p className="line-stat-label">
        {label}
        {privateHint ? " · private" : ""}
      </p>
      <div className="line-stat-value">{value}</div>
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
