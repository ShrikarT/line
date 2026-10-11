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

const PAGES: Record<string, ComponentType> = {
  "/": Home,
  "/issuer": IssuerPage,
  "/merchant": MerchantPage,
  "/agent": AgentPage,
  "/explorer": ExplorerPage,
  "/lab": LabPage,
  "/circuits": CircuitsPage,
  "/roadmap": RoadmapPage,
  "/checkout": CheckoutPage,
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

  const Page = PAGES[path] ?? Home;
  return <Page />;
}
