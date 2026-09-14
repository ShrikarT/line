import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/issuer", label: "Issuer" },
  { to: "/merchant", label: "Merchant" },
  { to: "/agent", label: "Agent" },
  { to: "/explorer", label: "Explorer" },
  { to: "/lab", label: "Attack lab" },
  { to: "/circuits", label: "Circuits" },
  { to: "/roadmap", label: "Roadmap" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link to="/" className="flex items-baseline gap-3">
            <span className="font-display text-lg tracking-tight">Line</span>
            <span className="hidden text-xs text-muted sm:inline">
              Private credit authorization
            </span>
          </Link>
          <nav className="flex flex-wrap gap-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "rounded-sm px-3 py-2 text-sm text-muted transition-colors duration-[var(--motion-quick)] hover:text-fg",
                  pathname === item.to && "bg-elevated text-fg",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
