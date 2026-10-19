import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bank,
  Code,
  Eye,
  Flask,
  House,
  Lightning,
  List,
  MagnifyingGlass,
  MapTrifold,
  Robot,
  ShieldCheck,
  Storefront,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { WalletButton } from "./wallet-connect";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const NAV = [
  {
    label: "Workspace",
    items: [
      { to: "/", label: "Overview", icon: House },
      { to: "/app", label: "My workspace", icon: Robot },
      { to: "/organization", label: "Organization", icon: Bank },
      { to: "/agents", label: "Agent purchases", icon: Robot },
      { to: "/suppliers", label: "Merchant workspace", icon: Storefront },
    ],
  },
  {
    label: "Protocol tools",
    items: [
      { to: "/issuer", label: "Issuer console", icon: Bank },
      { to: "/agent", label: "Agent console", icon: Robot },
      { to: "/merchant", label: "Merchant console", icon: Storefront },
    ],
  },
  {
    label: "Protocol",
    items: [
      { to: "/explorer", label: "Explorer", icon: Eye },
      { to: "/circuits", label: "Circuits", icon: Code },
      { to: "/lab", label: "Attack lab", icon: Flask },
      { to: "/roadmap", label: "Roadmap", icon: MapTrifold },
    ],
  },
];
const INTRO: Record<
  string,
  { eyebrow: string; title: string; description: string }
> = {
  "/issuer": {
    eyebrow: "01 / Issuer workspace",
    title: "Credit operations",
    description:
      "Set the facility, manage reserve capacity and reconcile the agent's credit book from one place.",
  },
  "/agent": {
    eyebrow: "02 / Agent workspace",
    title: "Agent purchases",
    description:
      "Read your private allowance, request a purchase and carry a merchant claim through its lifecycle.",
  },
  "/merchant": {
    eyebrow: "03 / Merchant workspace",
    title: "Merchant settlement",
    description:
      "Switch between suppliers, publish terms and redeem the claims addressed to your merchant key.",
  },
  "/explorer": {
    eyebrow: "04 / Public observer",
    title: "Public ledger explorer",
    description:
      "Inspect reserve accounting, commitments and claim activity. Private credit openings stay outside this view.",
  },
  "/circuits": {
    eyebrow: "05 / Contract reference",
    title: "Twelve circuits. One protocol.",
    description:
      "A compact reference for who can act, what each circuit proves and what the transaction discloses.",
  },
  "/lab": {
    eyebrow: "06 / Verification",
    title: "Protocol verification",
    description:
      "Try adversarial scenarios in an isolated local simulator and inspect the resulting invariants.",
  },
};

const PRODUCT_PATHS = new Set(["/", "/app", "/organization", "/agents", "/suppliers"]);
const navigationFor = (path: string) => PRODUCT_PATHS.has(path) ? NAV.filter(group => group.label === "Workspace") : NAV;

function Navigation({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Workspace navigation" className="flex flex-col gap-8">
      {navigationFor(path).map((group) => (
        <div className="line-nav-group" key={group.label}>
          <p className="line-nav-caption">{group.label}</p>
          {group.items.map(({ to, label, icon: Icon }) => (
            <a
              key={to}
              href={to}
              onClick={onNavigate}
              aria-current={path === to ? "page" : undefined}
              className="line-nav-link"
            >
              <Icon
                aria-hidden="true"
                weight={path === to ? "duotone" : "regular"}
              />
              {label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}

function WorkspaceSearch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const navigate = (to: string) => {
    if (window.location.pathname !== to) window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo({ top: 0, left: 0 });
    setOpen(false);
  };
  return (
    <>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="workspace-search"
              onClick={() => setOpen(true)}
              aria-label="Search workspace"
            >
              <MagnifyingGlass />
              <span>Jump to...</span>
              <kbd>Ctrl K</kbd>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Jump to a workspace with Ctrl K or Command K
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Jump to a workspace"
        description="Search Line pages and navigate without leaving your current session."
        className="line-command"
      >
        <CommandInput
          placeholder="Where do you want to go?"
          aria-label="Search Line pages"
        />
        <CommandList>
          <CommandEmpty>
            No pages found. Try issuer, agent or checkout.
          </CommandEmpty>
          {navigationFor(window.location.pathname).map((group) => (
            <CommandGroup key={group.label} heading={group.label}>
              {group.items.map(({ to, label, icon: Icon }) => (
                <CommandItem
                  key={to}
                  value={`${label} ${to}`}
                  onSelect={() => navigate(to)}
                >
                  <Icon />
                  <span>{label}</span>
                  <span className="line-command-hint">{to}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}

export type ShellProps = {
  children: ReactNode;
  evaluation?: boolean;
  evaluationMode?: "local" | "preprod";
  hideVault?: boolean;
};
const ProtocolShell = lazy(() => import("./protocol-shell").then(module => ({ default: module.ProtocolShell })));

export function Shell(props: ShellProps) {
  const path = typeof window === "undefined" ? "/" : window.location.pathname;
  return PRODUCT_PATHS.has(path) || props.evaluation
    ? <ShellLayout {...props} />
    : <Suspense fallback={<p role="status" className="line-container py-6">Loading protocol tools...</p>}><ProtocolShell {...props} /></Suspense>;
}

export function ShellLayout({ children, evaluationMode = "local", runtimeControl, setup, vault }: ShellProps & {
  runtimeControl?: ReactNode; setup?: ReactNode; vault?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname =
    typeof window !== "undefined" ? window.location.pathname : "/";
  const landing = pathname === "/";
  const intro = INTRO[pathname];
  return (
    <div className={cn("min-h-dvh", landing ? "line-landing" : "line-app")}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-elevated focus:p-4"
      >
        Skip to content
      </a>
      <header className="line-header">
        <div className="line-container line-header-inner">
          <a href="/" className="line-wordmark" aria-label="Line home">
            <img src="/brand/logo-pixel.svg" alt="" />
            <span>
              Line<span className="text-accent">.</span>
            </span>
          </a>
          {landing ? (
            <nav className="line-topnav" aria-label="Main navigation">
              <a href="#how-it-works">How it works</a>
              <a href="#privacy">The privacy boundary</a>
              <a href="#proof">Network proof</a>
            </nav>
          ) : (
            <div className="hidden text-xs text-muted md:block">
              Agent purchasing /{" "}
              <span className="text-navy">
                {NAV.flatMap((group) => group.items).find(
                  (item) => item.to === pathname,
                )?.label ?? "Line"}
              </span>
            </div>
          )}
          <div className="flex items-center gap-3">
            {!landing && <WorkspaceSearch />}
            <div className="line-header-runtime">{PRODUCT_PATHS.has(pathname) ? <span className="line-runtime">Midnight Preprod</span> : runtimeControl ?? <span className="line-runtime">{evaluationMode === "preprod" ? "Midnight Preprod \u00b7 live proofs" : "Generated Compact \u00b7 local evaluation"}</span>}</div>
            <WalletButton />
            {landing && (
              <a
                className="line-button line-button-primary line-desktop-cta"
                href="/app"
              >
                Open app <ArrowRight aria-hidden="true" />
              </a>
            )}
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <button
                  className="line-button line-button-ghost line-mobile-menu"
                  aria-label="Open navigation"
                >
                  <List aria-hidden="true" />
                </button>
              </SheetTrigger>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle>Line workspace</SheetTitle>
                  <SheetDescription>
                    Credit, purchasing and protocol tools.
                  </SheetDescription>
                </SheetHeader>
                <div className="overflow-y-auto px-4 pb-8">
                  <Navigation
                    path={pathname}
                    onNavigate={() => setMenuOpen(false)}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
      {setup}
      {landing ? (
        <main id="main-content">{children}</main>
      ) : (
        <div className="line-container line-workspace">
          <aside className="line-sidebar">
            <Navigation path={pathname} />
            <div className="line-workspace-note">
              <p className="line-eyebrow">Built on Midnight</p>
              <p>
                Private witnesses.
                <br />
                Verifiable purchasing rules.
              </p>
              <a
                href="/privacy"
                className="mt-4 inline-flex items-center gap-2 text-navy"
              >
                Understand the boundary{" "}
                <ArrowRight size={14} aria-hidden="true" />
              </a>
            </div>
          </aside>
          <div className="line-workspace-main">
            {vault && <div className="line-vault-wrap">{vault}</div>}
            <main id="main-content">
              {intro && (
                <div className="line-page-intro">
                  <div>
                    <p className="line-eyebrow">{intro.eyebrow}</p>
                    <h1>{intro.title}</h1>
                  </div>
                  <p>{intro.description}</p>
                </div>
              )}
              {children}
            </main>
            <div className="mt-12 flex flex-wrap justify-between gap-4 border-t border-border pt-6 text-xs text-muted">
              <span>Line / agent purchasing infrastructure</span>
              <a href="/privacy" className="flex items-center gap-2">
                <ShieldCheck aria-hidden="true" />
                Privacy & demo scope
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
