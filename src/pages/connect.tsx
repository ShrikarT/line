import { useState } from "react";
import { Shell } from "@/components/line/shell";
import { NetworkSetupScreen } from "@/components/line/network-setup";
import { Button } from "@/components/ui/button";

export function ConnectPage() {
  const [connected, setConnected] = useState(false);
  return <Shell evaluation hideVault><div className="line-page-intro"><div><p className="line-eyebrow">Advanced / Own contract</p><h1>Connect a facility.</h1></div><p>For an existing issuer, agent or merchant with matching private role records. Wallet connection alone does not authorize contract operations.</p></div>
    {connected && <div role="status" className="scope-callout"><div><h2>Public contract state loaded.</h2><p>Open your role console and unlock the vault containing this facility’s private records to use it.</p><Button asChild><a href="/agent">Open agent console</a></Button></div></div>}
    <NetworkSetupScreen onConnected={() => setConnected(true)} onSwitchToLocal={() => { window.history.pushState(null, "", "/agent"); window.dispatchEvent(new PopStateEvent("popstate")); }} />
  </Shell>;
}
