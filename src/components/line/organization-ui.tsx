import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy, DownloadSimple } from "@phosphor-icons/react";
export const organizationField = "mt-2 w-full rounded-md border border-border bg-elevated px-3 py-2.5 text-sm text-fg focus-visible:outline-2 focus-visible:outline-navy";
export function OrganizationField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="organization-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function downloadOrganizationFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function OrganizationPackage({ title, value, onClose }: { title: string; value: string; onClose: () => void }) {
  const text = useRef<HTMLTextAreaElement>(null), opener = useRef<HTMLElement | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null), [failedValue, setFailedValue] = useState<string | null>(null);
  const copy = async () => {
    const selected = value;
    setCopiedValue(null); setFailedValue(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(selected);
      setCopiedValue(selected);
    } catch {
      setFailedValue(selected);
      if (text.current?.value === selected) { text.current.focus(); text.current.select(); }
    }
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl" onOpenAutoFocus={event => {
      event.preventDefault();
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      text.current?.focus(); text.current?.select();
    }} onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); }}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Copy the complete package below, or download it to share.</DialogDescription></DialogHeader>
      <textarea ref={text} className={`${organizationField} min-w-0 max-h-[45dvh] font-mono`} aria-label={title} rows={8} spellCheck={false} readOnly value={value} />
      {copiedValue === value && <p role="status">Package copied.</p>}
      {failedValue === value && <p role="alert">Clipboard access is unavailable. The package text is selected; copy it manually or download the package.</p>}
      <DialogFooter>
        <Button onClick={() => void copy()}><Copy data-icon="inline-start" aria-hidden="true" />Copy package</Button>
        <Button variant="outline" onClick={() => downloadOrganizationFile("line-transfer.json", value)}><DownloadSimple data-icon="inline-start" aria-hidden="true" />Download package</Button>
        <DialogClose asChild><Button variant="ghost">Close package</Button></DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
