import { Component, lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const Home = lazy(() => import("@/pages/home").then(module => ({ default: module.Home })));
const IssuerPage = lazy(() => import("@/pages/issuer").then(module => ({ default: module.IssuerPage })));
const MerchantPage = lazy(() => import("@/pages/merchant").then(module => ({ default: module.MerchantPage })));
const AgentPage = lazy(() => import("@/pages/agent").then(module => ({ default: module.AgentPage })));
const ExplorerPage = lazy(() => import("@/pages/explorer").then(module => ({ default: module.ExplorerPage })));
const LabPage = lazy(() => import("@/pages/lab").then(module => ({ default: module.LabPage })));
const CircuitsPage = lazy(() => import("@/pages/circuits").then(module => ({ default: module.CircuitsPage })));
const RoadmapPage = lazy(() => import("@/pages/roadmap").then(module => ({ default: module.RoadmapPage })));
const CheckoutPage = lazy(() => import("@/pages/checkout").then(module => ({ default: module.CheckoutPage })));
const PreprodPage = lazy(() => import("@/pages/preprod").then(module => ({ default: module.PreprodPage })));
const TestSettlementPage = lazy(() => import("@/pages/preprod").then(module => ({ default: module.TestSettlementPage })));
const PrivacyPage = lazy(() => import("@/pages/privacy").then(module => ({ default: module.PrivacyPage })));
const NotFoundPage = lazy(() => import("@/pages/privacy").then(module => ({ default: module.NotFoundPage })));
const OrganizationWorkspacePage = lazy(() => import("@/pages/organization-workspace").then(module => ({ default: module.OrganizationWorkspacePage })));
const OrganizationPage = lazy(() => import("@/pages/organization-workspace").then(module => ({ default: module.OrganizationPage })));
const AgentWorkspacePage = lazy(() => import("@/pages/organization-workspace").then(module => ({ default: module.AgentWorkspacePage })));
const SupplierWorkspacePage = lazy(() => import("@/pages/organization-workspace").then(module => ({ default: module.SupplierWorkspacePage })));
const ConnectPage = lazy(() => import("@/pages/connect").then(module => ({ default: module.ConnectPage })));

const PAGES: Record<string, ComponentType> = {
  "/": Home,
  "/app": OrganizationWorkspacePage,
  "/organization": OrganizationPage,
  "/agents": AgentWorkspacePage,
  "/suppliers": SupplierWorkspacePage,
  "/connect": ConnectPage,
  "/issuer": IssuerPage,
  "/merchant": MerchantPage,
  "/agent": AgentPage,
  "/explorer": ExplorerPage,
  "/lab": LabPage,
  "/circuits": CircuitsPage,
  "/roadmap": RoadmapPage,
  "/checkout": CheckoutPage,
  "/preprod": PreprodPage,
  "/test-payout": TestSettlementPage,
  "/privacy": PrivacyPage,
};

export function App() {
  const [path, setPath] = useState(
    typeof window === "undefined" ? "/" : window.location.pathname,
  );

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    const onNavigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || !PAGES[url.pathname] || url.hash) return;
      event.preventDefault();
      if (url.href !== window.location.href) window.history.pushState(null, "", url.pathname + url.search);
      setPath(url.pathname);
      window.scrollTo({ top: 0, left: 0 });
    };
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onNavigate);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onNavigate);
    };
  }, []);

  useEffect(() => {
    const title = path === "/" ? "Credit for agents. Control for you." : path === "/preprod" ? "Live Midnight Preprod" : path.slice(1).replaceAll("-", " ") || "Workspace";
    document.title = `${title.charAt(0).toUpperCase() + title.slice(1)} · Line`;
  }, [path]);

  const Page = PAGES[path] ?? NotFoundPage;
  return <PageLoadBoundary key={path}><Suspense fallback={<div role="status" className="line-container py-12"><p>Loading workspace...</p><Skeleton className="mt-4 h-8 w-64" /></div>}><Page /></Suspense></PageLoadBoundary>;
}

class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main className="line-container py-12"><h1>Line could not load this workspace.</h1><p role="alert">Check your connection, then refresh to load the current application. Your saved encrypted records stay in this browser.</p><button className="line-button line-button-primary mt-4" onClick={() => window.location.reload()}>Refresh Line</button></main> : this.props.children;
  }
}
