import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useOrganization } from "./organization-session";
import { OrganizationField as Field, organizationField as field } from "./organization-ui";
import { decodeMerchant, encodeMerchant } from "@/lib/organization/transfers";
import { units } from "@/lib/organization/account";
import { requiredDrawFee } from "@/lib/line/encoding";
import { withinDeadline } from "@/lib/organization/finality";
import type { OrganizationCatalog, OrganizationNetwork } from "@/lib/organization/network";

export function OrganizationTreasury({ facilityId, onSelect }: { facilityId: string; onSelect: (id: string) => void }) {
  const { account, network, snapshot, busy, pending, run } = useOrganization();
  const facility = snapshot?.facilities.find(item => item.id === facilityId);
  const [name, setName] = useState(""), [asset, setAsset] = useState("0".repeat(64)), [profile, setProfile] = useState("");
  const [amount, setAmount] = useState(""), [limit, setLimit] = useState(""), [days, setDays] = useState("7");
  const [flatFee, setFlatFee] = useState("0"), [feeBps, setFeeBps] = useState("0");
  const [status, setStatus] = useState<Awaited<ReturnType<OrganizationNetwork["facilitySummary"]>> | null>(null), [error, setError] = useState("");
  const [catalog, setCatalog] = useState<OrganizationCatalog | null>(null);
  const [formError, setFormError] = useState("");
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (formError) formErrorRef.current?.focus(); }, [formError]);
  const [catalogError, setCatalogError] = useState(""), [refresh, setRefresh] = useState(0), [walletBalances, setWalletBalances] = useState<Record<string, bigint> | null>(null);
  const [reading, setReading] = useState(false);
  const readQueue = useRef<Promise<void>>(Promise.resolve());
  const walletUnits = walletBalances === null ? null : (walletBalances[facility?.assetColor ?? asset] ?? 0n).toString();
  useEffect(() => {
    let cancelled = false;
    if (network) void network.catalog().then(value => { if (!cancelled) { setCatalog(value); setCatalogError(""); const first = value.services[0]; if (first) setProfile(current => current || encodeMerchant(first.profile)); } }).catch(() => { if (!cancelled) setCatalogError("API suppliers could not be loaded. Retry, or paste an independent supplier's public profile."); });
    return () => { cancelled = true; };
  }, [network, refresh]);

  const feeTerms = (() => {
    if (!/^[0-9]{1,20}$/.test(flatFee) || !/^[0-9]{1,5}$/.test(feeBps)) return null;
    try {
      const flat = BigInt(flatFee), bps = BigInt(feeBps);
      requiredDrawFee(0n, flat, bps);
      return { flat, bps };
    } catch { return null; }
  })();
  const feesWithdrawable = !!status && status.registeredCircuits === 12 && status.fees !== undefined && BigInt(status.fees) > 0n;
  const disabled = busy || reading || !!pending || !network || !!facility?.address && !status;
  const contractUnits = status ? status.balances.find(balance => balance.color === facility?.assetColor)?.units ?? "0" : null;
  useEffect(() => {
    let stopped = false; setStatus(null); setWalletBalances(null); setError(""); setReading(!!account && !!network);
    // The summary verifies wallet identity. Keep its RPCs separate from balance
    // requests, including refreshes that arrive before an older read settles.
    readQueue.current = readQueue.current.catch(() => {}).then(async () => {
      if (stopped || !account || !network) return;
      try {
        if (facility?.address) {
          try { const value = await network.facilitySummary(facility.id); if (!stopped) setStatus(value); }
          catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : "Could not read the facility."); }
        }
        if (stopped) return;
        try {
          const balances = await withinDeadline(account.wallet.getUnshieldedBalances(), 25_000, "The wallet balance request timed out.");
          if (!stopped) setWalletBalances(balances);
        } catch { /* A missing wallet balance stays unavailable, not zero. */ }
      } finally { if (!stopped) setReading(false); }
    });
    return () => { stopped = true; };
  }, [account, network, facility?.id, facility?.address, snapshot?.receipts.length, refresh]);
  const act = (action: Parameters<typeof run>[0]) => void run(action);
  return <div className="organization-tab">
    <div className="workspace-section-heading"><div><p className="line-eyebrow">Treasury / Your facilities</p><h2>Fund the work your agents do.</h2></div><span className="text-xs text-muted">Existing assets · explicit wallet approvals</span></div>
    <div className="organization-wallet-balance"><span>Available in connected wallet</span><strong>{walletUnits === null ? "Balance unavailable" : `${walletUnits} asset base units`}</strong><Button variant="ghost" size="sm" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh balances and suppliers</Button></div>
    {catalogError && <p role="alert" className="wallet-error">{catalogError}</p>}
    {catalog?.hostedSupplierAutomation === false && <section className="workspace-welcome"><h2>Choose your first merchant.</h2><p>Use your connected wallet as the receiving merchant, or paste another merchant’s public profile from their Merchant workspace. Your wallet signs each contract action. Automated API suppliers are unavailable on this host.</p></section>}
    <details className="organization-create" open={!snapshot?.facilities.length}><summary>Create an agent facility</summary><p>Deploy your own contract and delegated agent. Deployment and verifier setup require twelve wallet-approved transactions. Save an encrypted backup before depositing.</p>
      {catalog && catalog.services.length > 0 && <div className="mt-4"><Field label="Initial API supplier"><select className={field} disabled={disabled} onChange={event => { const service = catalog.services.find(service => service.id === event.target.value); if (service) setProfile(encodeMerchant(service.profile)); }}><option value="">Choose a supplier or paste your own profile</option>{catalog.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field></div>}
      <form className="organization-form-grid" onInvalidCapture={() => { setFormError("Complete the required name, asset and supplier profile before creating your facility."); formErrorRef.current?.focus(); }} onInputCapture={() => setFormError("")} onSubmit={event => { event.preventDefault(); setFormError(""); act(async (client, account) => { await client.createFacility(name, asset, decodeMerchant(profile)); onSelect(account.snapshot().facilities.at(-1)?.id ?? ""); }); }}>
        <Field label="Organization / agent name"><input className={field} value={name} onChange={event => setName(event.target.value)} maxLength={80} disabled={disabled} required /></Field>
        <Field label="Settlement asset color" hint="64 hex characters. All zeroes selects native tNIGHT on Preprod."><input className={`${field} font-mono`} value={asset} onChange={event => setAsset(event.target.value)} pattern="[0-9a-f]{64}" disabled={disabled} required /></Field>
        <div className="col-span-full flex flex-col items-start gap-3"><Field label="Initial merchant profile" hint="Paste a merchant’s public profile, or choose your own wallet below. Payouts go to the selected address; registering your own wallet does not connect an independent supplier."><textarea className={field} value={profile} onChange={event => setProfile(event.target.value)} maxLength={16384} rows={4} disabled={disabled} required /></Field><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { if (network) { setProfile(encodeMerchant(network.merchantProfile("My receiving wallet"))); setFormError(""); } }}>Use my receiving wallet</Button></div>
        <Button type="submit" disabled={disabled}>Create facility</Button>
        {formError && <p ref={formErrorRef} tabIndex={-1} role="alert" className="wallet-error col-span-full">{formError}</p>}
      </form>
    </details>
    {facility && <>
      <div className="organization-metrics"><div><span>Private allowance</span><strong>{facility.limit.toString()}</strong></div><div><span>Agent spending balance</span><strong>{facility.outstanding.toString()}</strong></div><div><span>Remaining allowance</span><strong>{(facility.limit - facility.outstanding).toString()}</strong></div></div>
      <div className="organization-contract"><span>Facility address</span><code>{facility.address}</code><span>Settlement asset</span><code>{facility.assetColor}</code><span>Assets held by contract</span><strong>{contractUnits === null ? "Balance unavailable" : `${contractUnits} base units`}</strong><p>{status ? `${status.status} · ${status.registeredCircuits}/12 circuit keys · Reserve accounting ${status.reserve} · Principal paid ${status.paid}` : error ? "Facility data unavailable. Refresh balances and suppliers to retry." : "Reading your facility from Midnight…"}</p></div>
      {status && status.registeredCircuits < 12 && <div className="scope-callout"><div><h2>Finish contract setup.</h2><p>Register the remaining circuit keys. Each is a network transaction; confirmed registrations are retained when you resume.</p><Button disabled={disabled} onClick={() => act(client => client.registerVerifierKeys(facility.id))}>Finish facility setup</Button></div></div>}
      <div className="workspace-start-grid"><section className="workspace-welcome"><p className="line-eyebrow">01 / Actual asset custody</p><h2>Fund your reserve.</h2><p>Deposit existing tokens from your connected wallet. This facility has no mint operation.</p><Field label="Amount in asset base units" hint="Native NIGHT uses 1,000,000 base units per token."><input className={field} value={amount} inputMode="numeric" pattern="[0-9]+" onChange={event => setAmount(event.target.value)} disabled={disabled} placeholder="1000000" /></Field><div className="flex flex-wrap gap-2"><Button disabled={disabled || !amount || status?.registeredCircuits !== 12} onClick={() => act(client => client.reserve(facility.id, "fundReserve", units(amount)))}>Deposit assets</Button><Button variant="outline" disabled={disabled || !amount || status?.registeredCircuits !== 12} onClick={() => act(client => client.reserve(facility.id, "withdrawUnencumberedReserve", units(amount)))}>Withdraw available assets</Button></div><Button variant="ghost" disabled={disabled || !amount || facility.outstanding === 0n} onClick={() => act(client => client.replenish(facility.id, units(amount)))}>Deposit and replenish allowance</Button><small>Replenishment requires an equal asset deposit before reducing the spending balance.</small></section>
      <section className="workspace-launch"><p className="line-eyebrow">02 / Agent policy</p><h2>Set the allowance.</h2><p>Your organization owns its delegated agent. Compact checks purchases against the committed private book.</p><Field label="Allowance in asset base units"><input className={field} value={limit} inputMode="numeric" pattern="[0-9]+" onChange={event => setLimit(event.target.value)} disabled={disabled} /></Field><Field label="Expires after (days)"><input className={field} value={days} type="number" min="1" max="365" onChange={event => setDays(event.target.value)} disabled={disabled} /></Field><details className="organization-create"><summary>Fee policy (optional)</summary><p>Fees are public, consume the agent's allowance and are fixed when this allowance opens. Zero keeps purchases fee-free. Changing these fields does not change an open allowance.</p><Field label="Flat fee in asset base units"><input className={field} value={flatFee} onChange={event => setFlatFee(event.target.value)} inputMode="numeric" pattern="[0-9]+" maxLength={20} aria-label="Flat fee in asset base units" aria-invalid={!feeTerms} aria-describedby="organization-fee-policy-help" disabled={disabled} /></Field><Field label="Fee rate in basis points"><input className={field} value={feeBps} onChange={event => setFeeBps(event.target.value)} inputMode="numeric" pattern="[0-9]+" maxLength={5} aria-label="Fee rate in basis points" aria-invalid={!feeTerms} aria-describedby="organization-fee-policy-help" disabled={disabled} /></Field><small id="organization-fee-policy-help" role={feeTerms ? undefined : "alert"}>{feeTerms ? "100 basis points = 1%. The proportional fee rounds up to a whole base unit." : "Use a flat fee from 0 to 18446744073709551615 base units and a rate from 0 to 10000 basis points."}</small></details><Button disabled={disabled || !limit || !feeTerms || status?.registeredCircuits !== 12 || status?.status === "OPEN" || status?.status === "DEFAULTED"} onClick={() => act(client => { if (!feeTerms) throw new Error("Enter a valid fee policy before opening the allowance."); const duration = Number(days); if (!Number.isInteger(duration) || duration < 1 || duration > 365) throw new Error("Choose an expiry between one and 365 days."); return client.openAllowance(facility.id, units(limit), BigInt(Math.floor(Date.now() / 1000) + duration * 86400), feeTerms.flat, feeTerms.bps); })}>Set agent allowance</Button><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={disabled || facility.limit === 0n} onClick={() => act(client => client.status(facility.id, "pause"))}>Pause agent</Button><Button variant="outline" disabled={disabled || facility.limit === 0n} onClick={() => act(client => client.status(facility.id, "resume"))}>Resume agent</Button><Button variant="ghost" disabled={disabled || facility.limit === 0n || facility.outstanding !== 0n} onClick={() => act(client => client.status(facility.id, "close"))}>Close allowance</Button></div></section></div>
      <details className="organization-create"><summary>Organization fees</summary>{status ? <><p>Current policy: {status.feeFlat} base units + {status.feeBps} basis points per purchase.</p><p>Finalized fees: {status.fees} base units</p><p>Pending fees: {status.pendingFees} base units</p></> : <p>Fee data unavailable. Refresh the facility before requesting a withdrawal.</p>}<p>Withdraw all finalized fees to your fixed organization receiving address. Pending fees remain locked until the merchant redeems.</p><code className="wallet-address block w-full">{facility.issuerRecipient}</code><Button variant="outline" disabled={disabled || !feesWithdrawable} onClick={() => act(client => client.reserve(facility.id, "withdrawFees"))}>Withdraw finalized fees</Button></details>
      {catalog && catalog.services.length > 0 && <section className="workspace-welcome"><p className="line-eyebrow">API suppliers / Merchant permissions</p><h2>Choose who your agent can pay.</h2><p>Each supplier receives assets in its own registered wallet. Authorizing a supplier does not give it your organization keys.</p><div className="flex flex-wrap gap-3">{catalog.services.map(service => <Button key={service.id} variant="outline" disabled={disabled || facility.merchants.some(merchant => merchant.publicKey === service.profile.publicKey)} onClick={() => act(client => client.registerMerchant(facility.id, service.profile))}>{facility.merchants.some(merchant => merchant.publicKey === service.profile.publicKey && merchant.disabled) ? "Disabled: " : facility.merchants.some(merchant => merchant.publicKey === service.profile.publicKey) ? "Authorized: " : "Authorize: "}{service.name}</Button>)}</div></section>}
      <details className="organization-create"><summary>Merchant permissions</summary><p>Paste another supplier’s own public profile. Their receiving address is fixed at registration. Disabled keys cannot be registered again in this contract version.</p><Field label="Additional merchant profile"><textarea className={field} rows={4} maxLength={16384} value={profile} onChange={event => setProfile(event.target.value)} disabled={disabled} /></Field><Button className="mt-4" disabled={disabled || !profile} onClick={() => act(client => client.registerMerchant(facility.id, decodeMerchant(profile)))}>Register merchant</Button><div className="mt-4 space-y-3">{facility.merchants.map(merchant => <div key={merchant.publicKey} className="organization-merchant-row"><strong>{merchant.name}</strong><code>{merchant.address}</code><Button variant="ghost" size="sm" disabled={disabled || merchant.disabled} onClick={() => act(client => client.disableMerchant(facility.id, merchant.publicKey))}>{merchant.disabled ? "Disabled" : "Disable new quotes"}</Button></div>)}</div></details>
    </>}
    {error && <p role="alert" className="wallet-error">{error}</p>}
  </div>;
}
