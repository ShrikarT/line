import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_ORGANIZATION_BACKUP_BYTES, isOrganizationEmpty } from "@/lib/organization/backup";
import { useOrganization } from "./organization-session";
import { OrganizationField, organizationField } from "./organization-ui";

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
