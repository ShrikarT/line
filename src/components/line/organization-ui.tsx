import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DownloadSimple } from "@phosphor-icons/react";
export const organizationField = "mt-2 w-full rounded-md border border-border bg-elevated px-3 py-2.5 text-sm text-fg focus-visible:outline-2 focus-visible:outline-navy";
export function OrganizationField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="organization-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function downloadOrganizationFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function OrganizationPackage({ title, value }: { title: string; value: string }) {
  return <section className="workspace-welcome"><h2>{title}</h2><textarea className={`${organizationField} font-mono`} aria-label={title} rows={8} readOnly value={value} /><Button variant="outline" onClick={() => downloadOrganizationFile("line-transfer.json", value)}><DownloadSimple aria-hidden="true" />Download package</Button></section>;
}
