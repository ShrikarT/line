import { useState } from "react";
import { ArrowRight, Bank, Code, Eye, Flask, House, Lightning, List, MapTrifold, Robot, ShieldCheck, Storefront, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { getRuntime, setRuntime, LocalDevelopmentRuntime, MidnightNetworkRuntime } from "@/lib/runtime";
import { NetworkSetupScreen } from "./network-setup";
import { VaultBar } from "./vault-bar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";

const NAV = [
  { label: "Workspace", items: [
    { to: "/", label: "Overview", icon: House },
    { to: "/preprod", label: "Live Preprod", icon: Lightning },
    { to: "/checkout", label: "API checkout", icon: ArrowRight },
  ] },
  { label: "Participants", items: [
    { to: "/issuer", label: "Issuer", icon: Bank },
    { to: "/agent", label: "Agent", icon: Robot },
    { to: "/merchant", label: "Merchant", icon: Storefront },
  ] },
  { label: "Protocol", items: [
    { to: "/explorer", label: "Explorer", icon: Eye },
    { to: "/circuits", label: "Circuits", icon: Code },
    { to: "/lab", label: "Attack lab", icon: Flask },
    { to: "/roadmap", label: "Roadmap", icon: MapTrifold },
  ] },
];
const INTRO: Record<string, { eyebrow: string; title: string; description: string }> = {
  "/issuer": { eyebrow: "01 / Issuer workspace", title: "Your credit. Your rules.", description: "Set the facility, manage reserve capacity and reconcile the agent's credit book from one place." },
  "/agent": { eyebrow: "02 / Agent workspace", title: "Room to work. Rules to follow.", description: "Read your private allowance, request a purchase and carry a merchant claim through its lifecycle." },
  "/merchant": { eyebrow: "03 / Merchant workspace", title: "Quote clearly. Claim once.", description: "Switch between suppliers, publish terms and redeem the claims addressed to your merchant key." },
  "/explorer": { eyebrow: "04 / Public observer", title: "The public side of the ledger.", description: "Inspect reserve accounting, commitments and claim activity. Private credit openings stay outside this view." },
  "/circuits": { eyebrow: "05 / Contract reference", title: "Twelve circuits. One protocol.", description: "A compact reference for who can act, what each circuit proves and what the transaction discloses." },
  "/lab": { eyebrow: "06 / Verification", title: "Put the rules under pressure.", description: "Try adversarial scenarios in an isolated local simulator and inspect the resulting invariants." },
};

function Navigation({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return <nav aria-label="Workspace navigation" className="flex flex-col gap-8">{NAV.map(group => <div className="line-nav-group" key={group.label}>
    <p className="line-nav-caption">{group.label}</p>
    {group.items.map(({ to, label, icon: Icon }) => <a key={to} href={to} onClick={onNavigate} aria-current={path === to ? "page" : undefined} className="line-nav-link"><Icon aria-hidden="true" weight={path === to ? "duotone" : "regular"} />{label}</a>)}
  </div>)}</nav>;
}

export function Shell({ children, evaluation = false, evaluationMode = "local", hideVault = false }: { children: React.ReactNode; evaluation?: boolean; evaluationMode?: "local" | "preprod"; hideVault?: boolean }) {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const landing = pathname === "/";
  const [showNetworkSetup, setShowNetworkSetup] = useState(false), [menuOpen, setMenuOpen] = useState(false);
  const runtime = getRuntime(), isNetwork = runtime.mode === "network", isConnected = runtime.isConnected(), contractAddr = runtime.getContractAddress();
  const handleToggleMode = () => {
    if (isNetwork) { setRuntime(new LocalDevelopmentRuntime()); window.location.reload(); }
    else { setRuntime(new MidnightNetworkRuntime()); setShowNetworkSetup(true); }
  };
  const runtimeLabel = evaluation ? evaluationMode === "preprod" ? "Midnight Preprod · live proofs" : "Generated Compact · local evaluation" : isNetwork ? isConnected && contractAddr ? "Midnight connected" : "Midnight Network" : "Local Simulator";
  const runtimeControl = evaluation ? <span className="line-runtime"><span className={cn("line-runtime-dot", evaluationMode === "preprod" && "is-live")} />{runtimeLabel}</span> : <button className="line-runtime" onClick={() => isNetwork ? setShowNetworkSetup(!showNetworkSetup) : handleToggleMode()} title="Configure runtime and wallet"><span className={cn("line-runtime-dot", isNetwork && isConnected && "is-live")} />{runtimeLabel}</button>;
  const intro = INTRO[pathname];
  return <div className={cn("min-h-dvh", landing ? "line-landing" : "line-app")}>
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-elevated focus:p-4">Skip to content</a>
    <header className="line-header"><div className="line-container line-header-inner">
      <a href="/" className="line-wordmark" aria-label="Line home"><img src="/brand/logo-pixel.svg" alt="" /><span>Line<span className="text-accent">.</span></span></a>
      {landing ? <nav className="line-topnav" aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#privacy">The privacy boundary</a><a href="#proof">Network proof</a></nav> : <div className="hidden text-xs text-muted md:block">Agent purchasing / <span className="text-navy">{NAV.flatMap(group => group.items).find(item => item.to === pathname)?.label ?? "Line"}</span></div>}
      <div className="flex items-center gap-3">{runtimeControl}{landing && <a className="line-button line-button-primary line-desktop-cta" href="/preprod">Open app <ArrowRight aria-hidden="true" /></a>}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}><SheetTrigger asChild><button className="line-button line-button-ghost line-mobile-menu" aria-label="Open navigation"><List aria-hidden="true" /></button></SheetTrigger><SheetContent side="left"><SheetHeader><SheetTitle>Line workspace</SheetTitle><SheetDescription>Credit, purchasing and protocol tools.</SheetDescription></SheetHeader><div className="overflow-y-auto px-4 pb-8"><Navigation path={pathname} onNavigate={() => setMenuOpen(false)} /></div></SheetContent></Sheet>
      </div>
    </div></header>
    {!evaluation && showNetworkSetup && <section aria-label="Network setup" className="line-container py-6"><div className="mb-4 flex justify-end"><button className="line-button line-button-ghost" onClick={() => setShowNetworkSetup(false)}><X aria-hidden="true" />Close Setup</button></div><NetworkSetupScreen onConnected={() => setShowNetworkSetup(false)} onSwitchToLocal={() => { setRuntime(new LocalDevelopmentRuntime()); setShowNetworkSetup(false); }} /></section>}
    {!evaluation && isNetwork && (!isConnected || !contractAddr) && !showNetworkSetup && <div className="line-container my-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red/30 bg-red/5 p-4 text-sm"><span><strong>Midnight Network Mode:</strong> Connect a wallet and contract to continue.</span><div className="flex gap-4"><button className="underline" onClick={() => setShowNetworkSetup(true)}>Configure Connection</button><button className="underline" onClick={handleToggleMode}>Switch to Simulator</button></div></div>}
    {landing ? <main id="main-content">{children}</main> : <div className="line-container line-workspace">
      <aside className="line-sidebar"><Navigation path={pathname} /><div className="line-workspace-note"><p className="line-eyebrow">Built on Midnight</p><p>Private witnesses.<br />Verifiable purchasing rules.</p><a href="/privacy" className="mt-4 inline-flex items-center gap-2 text-navy">Understand the boundary <ArrowRight size={14} aria-hidden="true" /></a></div></aside>
      <div className="line-workspace-main">{!evaluation && !hideVault && <div className="line-vault-wrap"><VaultBar /></div>}
        <main id="main-content">{intro && <div className="line-page-intro"><div><p className="line-eyebrow">{intro.eyebrow}</p><h1>{intro.title}</h1></div><p>{intro.description}</p></div>}{children}</main>
        <div className="mt-12 flex flex-wrap justify-between gap-4 border-t border-border pt-6 text-xs text-muted"><span>Line / agent purchasing infrastructure</span><a href="/privacy" className="flex items-center gap-2"><ShieldCheck aria-hidden="true" />Privacy & demo scope</a></div>
      </div>
    </div>}
  </div>;
}
