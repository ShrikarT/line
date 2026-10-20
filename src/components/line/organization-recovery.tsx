import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MAX_ORGANIZATION_BACKUP_BYTES, isOrganizationEmpty } from "@/lib/organization/backup";
import { useOrganization } from "./organization-session";
import { OrganizationField, organizationField } from "./organization-ui";

export function OrganizationPendingRecovery() {
  const { pending, busy, run } = useOrganization();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  if (!pending) return null;
  const label = pending.kind === "key" ? `Register ${pending.circuit} verifier` : pending.circuit;
  return <section className="scope-callout"><div className="min-w-0 w-full">
    <h2>Resolve the saved operation first.</h2>
    <p className="[overflow-wrap:anywhere]">{label}{pending.txId ? ` · ${pending.txId}` : " has not crossed the submission boundary"}. New transactions are blocked to prevent a duplicate payment.</p>
    {pending.contractAddress && <p className="[overflow-wrap:anywhere]">Facility: <code>{pending.contractAddress}</code></p>}
    <div className="flex flex-wrap gap-3">
      <Button disabled={busy} onClick={() => void run(client => client.reconcile())}>Check original transaction</Button>
      {!!pending.txId && !!pending.transaction && <Dialog open={reviewingId === pending.id} onOpenChange={open => setReviewingId(open ? pending.id : null)}>
        <DialogTrigger asChild><Button variant="outline" disabled={busy}>Retry original submission</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Retry the original transaction?</DialogTitle><DialogDescription>First check the original transaction and close any active wallet approval or submission request. This sends the same signed bytes through your connected wallet, with the original identifier and recipient. It does not prepare another payment or request another proof.</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">An expired transaction remains saved for reconciliation. A missing receipt alone does not establish failure.</p>
          <code className="wallet-address block w-full">{pending.txId}</code>
          <DialogFooter><Button variant="outline" onClick={() => setReviewingId(null)}>Keep checking</Button><Button disabled={busy} onClick={() => {
            const expected = { operationId: pending.id, txId: pending.txId! };
            setReviewingId(null); void run(client => client.resubmitOriginal(expected));
          }}>Resubmit same signed transaction</Button></DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  </div></section>;
}

export function OrganizationRecovery({ onRestored }: { onRestored: () => void }) {
  const { snapshot, pending, busy, run } = useOrganization();
  const [file, setFile] = useState<File | null>(null), [password, setPassword] = useState("");
  const empty = !!snapshot && isOrganizationEmpty({ snapshot, pending });
  return <details className="organization-create">
    <summary>Restore an encrypted organization backup</summary>
    <p>Use the same wallet that created the backup. Its password can differ from the password for this browser's vault. Restoring preserves signed transactions and checks saved facilities against Midnight before saving.</p>
    {!empty && <p>Restore is available in a fresh organization workspace. Existing facilities and purchase records cannot be overwritten by an older backup.</p>}
    <form className="organization-form-grid" onSubmit={event => {
      event.preventDefault(); if (!file) return;
      const selected = file, entered = password; setPassword("");
      void run(async client => {
        if (selected.size > MAX_ORGANIZATION_BACKUP_BYTES) throw new Error("This backup exceeds the supported size.");
        await client.restoreBackup(await selected.text(), entered); onRestored();
      });
    }}>
      <OrganizationField label="Encrypted backup file"><input className={organizationField} type="file" accept=".json,application/json" disabled={busy || !empty} onChange={event => setFile(event.target.files?.[0] ?? null)} required /></OrganizationField>
      <OrganizationField label="Backup vault password"><input className={organizationField} type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} disabled={busy || !empty} required /></OrganizationField>
      <Button type="submit" disabled={busy || !empty || !file || !password}>Restore organization</Button>
    </form>
  </details>;
}
