import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { WalletSessionProvider } from "./components/line/wallet-connect";
import { OrganizationSessionProvider } from "./components/line/organization-session";
import "./styles.css";
import "./modern.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WalletSessionProvider><OrganizationSessionProvider><App /></OrganizationSessionProvider></WalletSessionProvider>
  </StrictMode>,
);
