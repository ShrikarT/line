import { useState } from "react";
import { MagnifyingGlass, Code } from "@phosphor-icons/react";
import { Shell } from "@/components/line/shell";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CIRCUITS } from "@/lib/line/circuits.ts";

export function CircuitsPage() {
  const [role, setRole] = useState("All"), [query, setQuery] = useState("");
  const circuits = CIRCUITS.filter(c => (role === "All" || c.caller.includes(role)) && `${c.name} ${c.proves}`.toLowerCase().includes(query.toLowerCase()));
  return <Shell hideVault><div className="flex flex-col gap-6">
    <div className="reference-toolbar"><Tabs value={role} onValueChange={setRole}><TabsList aria-label="Filter circuits by role">{["All", "Issuer", "Agent", "Merchant"].map(value => <TabsTrigger key={value} value={value}>{value}</TabsTrigger>)}</TabsList></Tabs><label className="reference-search"><MagnifyingGlass aria-hidden="true" /><input aria-label="Search circuits" placeholder="Search circuits..." value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    <div className="section-label-row"><p>Compact is the source of truth.</p><span>{circuits.length} of 12 shown</span></div>
    <Accordion type="multiple" className="circuit-list">{circuits.map(c => <AccordionItem key={c.name} value={c.name}>
      <AccordionTrigger><div className="circuit-heading"><span className="circuit-index">{String(CIRCUITS.indexOf(c) + 1).padStart(2, "0")}</span><div><h2>{c.name}</h2><Badge variant="outline">{c.caller}</Badge></div></div></AccordionTrigger>
      <AccordionContent><div className="circuit-detail"><div><h3>What it proves</h3><p>{c.proves}</p></div><div><h3>Public disclosure</h3><p>{c.discloses}</p></div><div><h3>Private inputs</h3><p>{c.hides}</p></div></div></AccordionContent>
    </AccordionItem>)}</Accordion>
    {circuits.length === 0 && <div className="line-empty-state"><Code aria-hidden="true" /><h3>No matching circuits.</h3><p>Try another name or switch the role filter.</p><button className="line-button line-button-ghost" onClick={() => { setQuery(""); setRole("All"); }}>Clear filters</button></div>}
    <p className="text-sm text-muted">This is a reading guide to the canonical contract. Private inputs can still be inferred from public history. <a className="underline" href="/privacy">Read the privacy boundary.</a></p>
  </div></Shell>;
}
