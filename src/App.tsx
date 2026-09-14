import { useEffect, useState, type ComponentType } from "react";
import { Home } from "@/pages/home.tsx";
import { IssuerPage } from "@/pages/issuer.tsx";
import { MerchantPage } from "@/pages/merchant.tsx";
import { AgentPage } from "@/pages/agent.tsx";
import { ExplorerPage } from "@/pages/explorer.tsx";
import { LabPage } from "@/pages/lab.tsx";
import { CircuitsPage } from "@/pages/circuits.tsx";
import { RoadmapPage } from "@/pages/roadmap.tsx";

const PAGES: Record<string, ComponentType> = {
  "/": Home,
  "/issuer": IssuerPage,
  "/merchant": MerchantPage,
  "/agent": AgentPage,
  "/explorer": ExplorerPage,
  "/lab": LabPage,
  "/circuits": CircuitsPage,
  "/roadmap": RoadmapPage,
};

export function App() {
  const [path, setPath] = useState(
    typeof window === "undefined" ? "/" : window.location.pathname,
  );

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const Page = PAGES[path] ?? Home;
  return <Page />;
}
