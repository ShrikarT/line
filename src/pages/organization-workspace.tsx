import { useEffect, useState } from "react";
import { Bank, CheckCircle, CircleNotch, DownloadSimple, LockKey, Robot, Storefront, Wallet } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shell } from "@/components/line/shell";
import { WalletButton, useWalletSession } from "@/components/line/wallet-connect";
import { useOrganization } from "@/components/line/organization-session";
import { OrganizationTreasury } from "@/components/line/organization-treasury";
import { OrganizationAgent } from "@/components/line/organization-agent";
import { OrganizationMerchant } from "@/components/line/organization-merchant";
import { downloadOrganizationFile, OrganizationField, OrganizationPackage, organizationField } from "@/components/line/organization-ui";

type View = "organization" | "agent" | "merchant";
export function OrganizationPage() { return <OrganizationWorkspacePage initialView="organization" />; }
export function AgentWorkspacePage() { return <OrganizationWorkspacePage initialView="agent" />; }
export function SupplierWorkspacePage() { return <OrganizationWorkspacePage initialView="merchant" />; }

export function OrganizationWorkspacePage({ initialView = "organization" }: { initialView?: View }) {
  const wallet = useWalletSession(), session = useOrganization();
  const { account, network, snapshot, pending, busy, progress, error, run } = session;
  const [password, setPassword] = useState(""), [view, setView] = useState<View>(initialView), [selectedId, setSelectedId] = useState("");
  const [output, setOutput] = useState<{ title: string; value: string } | null>(null);
  useEffect(() => { setView(initialView); }, [initialView]);
  useEffect(() => { if (!snapshot?.facilities.some(item => item.id === selectedId)) setSelectedId(snapshot?.facilities[0]?.id ?? ""); }, [snapshot, selectedId]);
  useEffect(() => { if (!account) { setOutput(null); setSelectedId(""); setView(initialView); } }, [account, initialView]);
  const showPackage = (title: string, value: string) => setOutput({ title, value });
  return <Shell evaluation evaluationMode="preprod" hideVault><div className="start-workspace">
    <div className="line-page-intro"><div><p className="line-eyebrow">Organization-funded spending / Midnight Preprod</p><h1>Your agents.<br />Your treasury.</h1></div><p>Fund your organization’s own facility, set an agent allowance and settle merchant claims from your wallet.</p></div>
    {!wallet.connected ? <section className="workspace-welcome"><Wallet className="size-8 text-navy" weight="duotone" aria-hidden="true" /><h2>Start with your wallet.</h2><p>Your organization’s keys and funds belong to your wallet. Connect to Midnight Preprod to create or recover your account.</p><WalletButton /><small>Connecting does not create a balance, grant a spending allowance or send a transaction.</small></section> : !network ? <section className="workspace-welcome"><LockKey className="size-8 text-navy" aria-hidden="true" /><h2>Open your organization.</h2><p>Create a password for this wallet’s encrypted organization records, or enter your existing one. This is separate from your wallet password.</p><form className="w-full max-w-md" onSubmit={event => { event.preventDefault(); const entered = password; setPassword(""); void session.unlock(entered); }}><OrganizationField label="Organization vault password"><input className={organizationField} type="password" value={password} minLength={8} onChange={event => setPassword(event.target.value)} autoComplete="current-password" disabled={busy} required /></OrganizationField><Button className="mt-4" type="submit" disabled={busy || password.length < 8}>{busy ? <CircleNotch className="animate-spin" aria-hidden="true" /> : <LockKey aria-hidden="true" />}{busy ? "Opening organization…" : "Open organization"}</Button></form><small>Only encrypted records are saved in this browser. A different connected wallet opens a separate account.</small></section> : <>
      <div className="organization-session-bar"><div><span className="live-dot" /><strong>Organization vault unlocked</strong><span className="text-xs text-muted">Your connected wallet signs your transactions</span></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async (_client, current) => downloadOrganizationFile("line-organization-backup.json", JSON.stringify(await current.encryptedBackup(), null, 2)))}><DownloadSimple aria-hidden="true" />Encrypted backup</Button><Button variant="ghost" size="sm" disabled={busy} onClick={session.lock}>Lock organization</Button></div></div>
      {pending && <section className="scope-callout"><div><h2>Resolve the saved operation first.</h2><p>{pending.circuit}{pending.txId ? ` · ${pending.txId}` : " has not crossed the submission boundary"}. New transactions are blocked to prevent a duplicate payment.</p><Button disabled={busy} onClick={() => void run(client => client.reconcile())}>Check original transaction</Button></div></section>}
      {(view === "organization" || view === "agent") && !!snapshot?.facilities.length && <OrganizationField label="Active organization facility"><select className={organizationField} value={selectedId} onChange={event => setSelectedId(event.target.value)} disabled={busy}>{snapshot.facilities.map(facility => <option key={facility.id} value={facility.id}>{facility.name} · {facility.address?.slice(0, 10) ?? "awaiting deployment"}</option>)}</select></OrganizationField>}
      <Tabs value={view} onValueChange={value => { setView(value as View); setOutput(null); }}><TabsList className="organization-role-tabs" aria-label="Organization roles"><TabsTrigger value="organization"><Bank aria-hidden="true" />Organization</TabsTrigger><TabsTrigger value="agent"><Robot aria-hidden="true" />Agent</TabsTrigger><TabsTrigger value="merchant"><Storefront aria-hidden="true" />Merchant</TabsTrigger></TabsList><TabsContent value="organization"><OrganizationTreasury facilityId={selectedId} onSelect={setSelectedId} /></TabsContent><TabsContent value="agent"><OrganizationAgent facilityId={selectedId} output={showPackage} /></TabsContent><TabsContent value="merchant"><OrganizationMerchant output={showPackage} /></TabsContent></Tabs>
      {output && <OrganizationPackage title={output.title} value={output.value} />}
      <section className="organization-receipts"><div className="workspace-section-heading"><div><p className="line-eyebrow">Evidence / Your transactions</p><h2>Confirmed on Midnight.</h2></div><span className="text-xs text-muted">{snapshot?.receipts.length ?? 0} finalized transactions</span></div>{snapshot?.receipts.length ? <div className="overflow-x-auto"><table><thead><tr><th>Operation</th><th>Transaction</th><th>Block</th></tr></thead><tbody>{snapshot.receipts.slice().reverse().map(receipt => <tr key={receipt.txId}><td>{receipt.circuit}</td><td><code title={receipt.txHash}>{receipt.txHash.slice(0, 14)}…{receipt.txHash.slice(-8)}</code></td><td>{receipt.blockHeight.toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted">Your finalized deployments and payments will appear here after confirmation.</p>}</section>
    </>}
    {(busy || progress) && <div role="status" className="network-status"><div>{busy ? <CircleNotch className="animate-spin" aria-hidden="true" /> : <CheckCircle aria-hidden="true" />}<span>{progress || "Waiting for the current wallet operation"}</span></div></div>}
    {error && <p role="alert" className="wallet-error">{error}</p>}
    <p className="text-xs text-muted">Your own assets back your agents’ spending; this is not third-party borrowing. Preprod assets have no real-money value. Transparent transfers and reserve changes are public. Hidden plaintext book fields do not establish full-history privacy.</p>
  </div></Shell>;
}
