import { useEffect, useState, type ComponentType } from "react";
import { Home } from "@/pages/home.tsx";
import { IssuerPage } from "@/pages/issuer.tsx";
import { MerchantPage } from "@/pages/merchant.tsx";
import { AgentPage } from "@/pages/agent.tsx";
import { ExplorerPage } from "@/pages/explorer.tsx";
import { LabPage } from "@/pages/lab.tsx";
import { CircuitsPage } from "@/pages/circuits.tsx";
import { RoadmapPage } from "@/pages/roadmap.tsx";
import { CheckoutPage } from "@/pages/checkout.tsx";
import { PreprodPage, TestSettlementPage } from "@/pages/preprod.tsx";
import { PrivacyPage, NotFoundPage } from "@/pages/privacy.tsx";
import { WorkspacePage } from "@/pages/workspace";
import { ConnectPage } from "@/pages/connect";

const PAGES: Record<string, ComponentType> = {
  "/": Home,
  "/app": WorkspacePage,
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
  return <Page />;
}
