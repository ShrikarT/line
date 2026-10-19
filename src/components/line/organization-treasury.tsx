import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useOrganization } from "./organization-session";
import { OrganizationField as Field, organizationField as field } from "./organization-ui";
import { decodeMerchant } from "@/lib/organization/transfers";
import { encodeMerchant } from "@/lib/organization/transfers";
import { units } from "@/lib/organization/account";
import type { OrganizationCatalog, OrganizationNetwork } from "@/lib/organization/network";

export function OrganizationTreasury({ facilityId, onSelect }: { facilityId: string; onSelect: (id: string) => void }) {
  const { account, network, snapshot, busy, pending, run } = useOrganization();
  const facility = snapshot?.facilities.find(item => item.id === facilityId);
  const [name, setName] = useState(""), [asset, setAsset] = useState("0".repeat(64)), [profile, setProfile] = useState("");
  const [amount, setAmount] = useState(""), [limit, setLimit] = useState(""), [days, setDays] = useState("7");
  const [status, setStatus] = useState<Awaited<ReturnType<OrganizationNetwork["facilitySummary"]>> | null>(null), [error, setError] = useState("");
  const [catalog, setCatalog] = useState<OrganizationCatalog | null>(null);
  const [formError, setFormError] = useState("");
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (formError) formErrorRef.current?.focus(); }, [formError]);
  const [catalogError, setCatalogError] = useState(""), [refresh, setRefresh] = useState(0), [walletUnits, setWalletUnits] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (network) void network.catalog().then(value => { if (!cancelled) { setCatalog(value); setCatalogError(""); const first = value.services[0]; if (first) setProfile(current => current || encodeMerchant(first.profile)); } }).catch(() => { if (!cancelled) setCatalogError("API suppliers could not be loaded. Retry, or paste an independent supplier's public profile."); });
    return () => { cancelled = true; };
  }, [network, refresh]);
  useEffect(() => {
    let cancelled = false; setWalletUnits(null);
    if (account) void account.wallet.getUnshieldedBalances().then(balances => { if (!cancelled) setWalletUnits((balances[facility?.assetColor ?? asset] ?? 0n).toString()); }).catch(() => {});
    return () => { cancelled = true; };
  }, [account, facility?.assetColor, asset, snapshot?.receipts.length, refresh]);
  const disabled = busy || !!pending || !network;
  useEffect(() => {
    let stopped = false; setStatus(null); setError("");
    if (network && facility?.address) void network.facilitySummary(facility.id).then(value => { if (!stopped) setStatus(value); }).catch(failure => { if (!stopped) setError(failure instanceof Error ? failure.message : "Could not read the facility."); });
    return () => { stopped = true; };
  }, [network, facility?.id, snapshot?.receipts.length]);
  const act = (action: Parameters<typeof run>[0]) => void run(action);
  return <div className="organization-tab">
    <div className="workspace-section-heading"><div><p className="line-eyebrow">Treasury / Your facilities</p><h2>Fund the work your agents do.</h2></div><span className="text-xs text-muted">Existing assets · explicit wallet approvals</span></div>
    <div className="organization-wallet-balance"><span>Available in connected wallet</span><strong>{walletUnits === null ? "Balance unavailable" : `${walletUnits} asset base units`}</strong><Button variant="ghost" size="sm" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh balances and suppliers</Button></div>
    {catalogError && <p role="alert" className="wallet-error">{catalogError}</p>}
    {catalog?.hostedSupplierAutomation === false && <section className="workspace-welcome"><h2>Choose an independent merchant.</h2><p>Ask your merchant to copy their public profile from the Merchant workspace, then paste it below. Your wallet signs each contract action. Automated API suppliers are unavailable on this host.</p></section>}
    <details className="organization-create" open={!snapshot?.facilities.length}><summary>Create an agent facility</summary><p>Deploy your own contract and delegated agent. Deployment and verifier setup require twelve wallet-approved transactions. Save an encrypted backup before depositing.</p>
      {catalog && catalog.services.length > 0 && <div className="mt-4"><Field label="Initial API supplier"><select className={field} disabled={disabled} onChange={event => { const service = catalog.services.find(service => service.id === event.target.value); if (service) setProfile(encodeMerchant(service.profile)); }}><option value="">Choose a supplier or paste your own profile</option>{catalog.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field></div>}
      <form className="organization-form-grid" onInvalidCapture={() => { setFormError("Complete the required name, asset and supplier profile before creating your facility."); formErrorRef.current?.focus(); }} onInputCapture={() => setFormError("")} onSubmit={event => { event.preventDefault(); setFormError(""); act(async (client, account) => { await client.createFacility(name, asset, decodeMerchant(profile)); onSelect(account.snapshot().facilities.at(-1)?.id ?? ""); }); }}>
        <Field label="Organization / agent name"><input className={field} value={name} onChange={event => setName(event.target.value)} maxLength={80} disabled={disabled} required /></Field>
        <Field label="Settlement asset color" hint="64 hex characters. All zeroes selects native tNIGHT on Preprod."><input className={`${field} font-mono`} value={asset} onChange={event => setAsset(event.target.value)} pattern="[0-9a-f]{64}" disabled={disabled} required /></Field>
        <div className="col-span-full"><Field label="Initial merchant profile" hint="Ask the supplier to share their profile from their own Merchant workspace. Only their public key and receiving address are included."><textarea className={field} value={profile} onChange={event => setProfile(event.target.value)} maxLength={16384} rows={4} disabled={disabled} required /></Field></div>
        <Button type="submit" disabled={disabled}>Create facility</Button>
        {formError && <p ref={formErrorRef} tabIndex={-1} role="alert" className="wallet-error col-span-full">{formError}</p>}
      </form>
    </details>
    {facility && <>
      <div className="organization-metrics"><div><span>Private allowance</span><strong>{facility.limit.toString()}</strong></div><div><span>Agent spending balance</span><strong>{facility.outstanding.toString()}</strong></div><div><span>Remaining allowance</span><strong>{(facility.limit - facility.outstanding).toString()}</strong></div></div>
      <div className="organization-contract"><span>Facility address</span><code>{facility.address}</code><span>Settlement asset</span><code>{facility.assetColor}</code><p>{status ? `${status.status} · ${status.registeredCircuits}/12 circuit keys · Reserve inflow ${status.reserve} · Principal paid ${status.paid}` : "Reading your facility from Midnight…"}</p></div>
      {status && status.registeredCircuits < 12 && <div className="scope-callout"><div><h2>Finish contract setup.</h2><p>Register the remaining circuit keys. Each is a network transaction; confirmed registrations are retained when you resume.</p><Button disabled={disabled} onClick={() => act(client => client.registerVerifierKeys(facility.id))}>Finish facility setup</Button></div></div>}
      <div className="workspace-start-grid"><section className="workspace-welcome"><p className="line-eyebrow">01 / Actual asset custody</p><h2>Fund your reserve.</h2><p>Deposit existing tokens from your connected wallet. This facility has no mint operation.</p><Field label="Amount in asset base units" hint="Native NIGHT uses 1,000,000 base units per token."><input className={field} value={amount} inputMode="numeric" pattern="[0-9]+" onChange={event => setAmount(event.target.value)} disabled={disabled} placeholder="1000000" /></Field><div className="flex flex-wrap gap-2"><Button disabled={disabled || !amount || status?.registeredCircuits !== 12} onClick={() => act(client => client.reserve(facility.id, "fundReserve", units(amount)))}>Deposit assets</Button><Button variant="outline" disabled={disabled || !amount || status?.registeredCircuits !== 12} onClick={() => act(client => client.reserve(facility.id, "withdrawUnencumberedReserve", units(amount)))}>Withdraw available assets</Button></div><Button variant="ghost" disabled={disabled || !amount || facility.outstanding === 0n} onClick={() => act(client => client.replenish(facility.id, units(amount)))}>Deposit and replenish allowance</Button><small>Replenishment requires an equal asset deposit before reducing the spending balance.</small></section>
      <section className="workspace-launch"><p className="line-eyebrow">02 / Agent policy</p><h2>Set the allowance.</h2><p>Your organization owns its delegated agent. Compact checks purchases against the committed private book.</p><Field label="Allowance in asset base units"><input className={field} value={limit} inputMode="numeric" pattern="[0-9]+" onChange={event => setLimit(event.target.value)} disabled={disabled} /></Field><Field label="Expires after (days)"><input className={field} value={days} type="number" min="1" max="365" onChange={event => setDays(event.target.value)} disabled={disabled} /></Field><Button disabled={disabled || !limit || status?.registeredCircuits !== 12 || status?.status === "OPEN" || status?.status === "DEFAULTED"} onClick={() => act(client => { const duration = Number(days); if (!Number.isInteger(duration) || duration < 1 || duration > 365) throw new Error("Choose an expiry between one and 365 days."); return client.openAllowance(facility.id, units(limit), BigInt(Math.floor(Date.now() / 1000) + duration * 86400)); })}>Set agent allowance</Button><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={disabled || facility.limit === 0n} onClick={() => act(client => client.status(facility.id, "pause"))}>Pause agent</Button><Button variant="outline" disabled={disabled || facility.limit === 0n} onClick={() => act(client => client.status(facility.id, "resume"))}>Resume agent</Button><Button variant="ghost" disabled={disabled || facility.limit === 0n || facility.outstanding !== 0n} onClick={() => act(client => client.status(facility.id, "close"))}>Close allowance</Button></div></section></div>
      {catalog && catalog.services.length > 0 && <section className="workspace-welcome"><p className="line-eyebrow">API suppliers / Merchant permissions</p><h2>Choose who your agent can pay.</h2><p>Each supplier receives assets in its own registered wallet. Authorizing a supplier does not give it your organization keys.</p><div className="flex flex-wrap gap-3">{catalog.services.map(service => <Button key={service.id} variant="outline" disabled={disabled || facility.merchants.some(merchant => merchant.publicKey === service.profile.publicKey)} onClick={() => act(client => client.registerMerchant(facility.id, service.profile))}>{facility.merchants.some(merchant => merchant.publicKey === service.profile.publicKey && merchant.disabled) ? "Disabled: " : facility.merchants.some(merchant => merchant.publicKey === service.profile.publicKey) ? "Authorized: " : "Authorize: "}{service.name}</Button>)}</div></section>}
      <details className="organization-create"><summary>Merchant permissions</summary><p>Paste another supplier’s own public profile. Their receiving address is fixed at registration. Disabled keys cannot be registered again in this contract version.</p><Field label="Additional merchant profile"><textarea className={field} rows={4} maxLength={16384} value={profile} onChange={event => setProfile(event.target.value)} disabled={disabled} /></Field><Button className="mt-4" disabled={disabled || !profile} onClick={() => act(client => client.registerMerchant(facility.id, decodeMerchant(profile)))}>Register merchant</Button><div className="mt-4 space-y-3">{facility.merchants.map(merchant => <div key={merchant.publicKey} className="organization-merchant-row"><strong>{merchant.name}</strong><code>{merchant.address}</code><Button variant="ghost" size="sm" disabled={disabled || merchant.disabled} onClick={() => act(client => client.disableMerchant(facility.id, merchant.publicKey))}>{merchant.disabled ? "Disabled" : "Disable new quotes"}</Button></div>)}</div></details>
    </>}
    {error && <p role="alert" className="wallet-error">{error}</p>}
  </div>;
}
