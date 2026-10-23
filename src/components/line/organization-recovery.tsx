import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MAX_ORGANIZATION_BACKUP_BYTES, isOrganizationEmpty } from "@/lib/organization/backup";
import { useOrganization } from "./organization-session";
import { OrganizationField, organizationField, downloadOrganizationFile } from "./organization-ui";
import { matchesExpiredOpeningScope } from "@/lib/organization/expired-opening-policy";
import type { ExpiredOpeningReview } from "@/lib/organization/expired-opening";
import { matchesExpiredDisableScope } from "@/lib/organization/expired-disable-policy";
import type { ExpiredDisableReview } from "@/lib/organization/expired-disable";
import type { OriginalOrganizationSubmissionDetails } from "@/lib/organization/transactions";

export function OrganizationPendingRecovery() {
  const { recoveries, pending, busy, run } = useOrganization();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [submissionDetails, setSubmissionDetails] = useState<OriginalOrganizationSubmissionDetails | null>(null);
  const [expiryReview, setExpiryReview] = useState<ExpiredOpeningReview | ExpiredDisableReview | null>(null);
  if (!pending) {
    return recoveries.length ? <details className="organization-create"><summary>Expired operation recovery history ({recoveries.length})</summary><p>The original signed operation and private candidate remain in encrypted storage and backups. Recovery evidence comes from the configured TLS Preprod providers; it is separate from finalized transaction receipts.</p>{recoveries.map(entry => <p key={entry.txId} className="[overflow-wrap:anywhere]"><code>{entry.txId}</code> · nonapplication checked at finalized block {entry.blockHeight.toLocaleString()}.</p>)}</details> : null;
  }
  const disabling = matchesExpiredDisableScope(pending);
  const label = pending.kind === "key" ? `Register ${pending.circuit} verifier` : pending.circuit;
  return <section className="scope-callout"><div className="min-w-0 w-full">
    <h2>Resolve the saved operation first.</h2>
    <p className="[overflow-wrap:anywhere]">{label}{pending.txId ? ` · ${pending.txId}` : " has not crossed the submission boundary"}. New transactions are blocked to prevent a duplicate payment.</p>
    {pending.contractAddress && <p className="[overflow-wrap:anywhere]">Facility: <code>{pending.contractAddress}</code></p>}
    <div className="flex flex-wrap gap-3">
      <Button disabled={busy} onClick={() => void run(client => client.reconcile())}>Check original transaction</Button>
      {!!pending.txId && !!pending.transaction && <>
        <Dialog open={submissionDetails?.operationId === pending.id && submissionDetails.identifier === pending.txId && submissionDetails.transaction === pending.transaction} onOpenChange={open => { if (!open) setSubmissionDetails(null); }}>
          <DialogTrigger asChild><Button variant="outline" disabled={busy} onClick={() => { setSubmissionDetails(null); void run(async client => setSubmissionDetails(await client.savedSubmissionDetails()), "Saved transaction details loaded. No transaction was submitted."); }}>Inspect saved transaction</Button></DialogTrigger>
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogHeader><DialogTitle>Saved transaction details</DialogTitle><DialogDescription>Read from the original signed bytes. These deadlines are separate from your allowance and merchant claim deadlines. Expiry does not prove nonapplication.</DialogDescription></DialogHeader>
            {submissionDetails && <>
              <code className="wallet-address block w-full">{submissionDetails.identifier}</code>
              {submissionDetails.intentTtls.map((ttl, index) => <p key={index}>Signed intent {index + 1} TTL: {ttl}</p>)}
              <p>Diagnostics include the original signed transaction and public metadata. They exclude your vault password, role secrets and private candidate. Exporting does not submit or clear the operation.</p>
              <DialogFooter><Button variant="outline" disabled={busy} onClick={() => downloadOrganizationFile("line-submission-diagnostics.json", JSON.stringify(submissionDetails, null, 2))}>Download submission diagnostics</Button><Button variant="ghost" onClick={() => setSubmissionDetails(null)}>Close details</Button></DialogFooter>
            </>}
          </DialogContent>
        </Dialog>
      </>}

      {(matchesExpiredOpeningScope(pending) || disabling) && <>
        <Button variant="outline" disabled={busy} onClick={() => { setExpiryReview(null); void run(async client => setExpiryReview(await (disabling ? client.reviewExpiredDisable() : client.reviewExpiredOpening()))); }}>{disabling ? "Review expired merchant disable recovery" : "Review expired opening recovery"}</Button>
        <Dialog open={expiryReview?.operationId === pending.id} onOpenChange={open => { if (!open) setExpiryReview(null); }}>
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogHeader><DialogTitle>{disabling ? "Archive the expired merchant disable?" : "Archive the expired opening?"}</DialogTitle><DialogDescription>{disabling ? "The configured Preprod providers report that this facility is unchanged since the verified purchase checkpoint, Merchant 2 is still active, and finalized ledger time is past the signed transaction TTL. Its disable candidate has been checked against the original signed action." : "The configured Preprod providers report that this facility is unchanged since the verified closure and finalized ledger time is past the signed transaction TTL. Its opening candidate has been checked against the original signed action."}</DialogDescription></DialogHeader>
            {expiryReview && <>
              <code className="wallet-address block w-full">{expiryReview.txId}</code>
              <p>Signed transaction TTL: {new Date(expiryReview.ttl).toISOString()}.</p>
              <p>Finalized checkpoint: block {expiryReview.evidence.finalized.height.toLocaleString()}, {new Date(expiryReview.evidence.finalized.timestamp).toISOString()}.</p>
              <p>This saves the original signed bytes, private candidate and provider evidence in encrypted recovery history, then unblocks the workspace. It does not count as a failed receipt or approve a replacement transaction. Network fees may still have been charged. This relies on configured TLS providers.</p>
            </>}
            <DialogFooter><Button variant="outline" onClick={() => setExpiryReview(null)}>Keep operation pending</Button><Button disabled={busy || !expiryReview} onClick={() => { const review = expiryReview!; setExpiryReview(null); void run(client => disabling ? client.recoverExpiredDisable(review as ExpiredDisableReview) : client.recoverExpiredOpening(review as ExpiredOpeningReview)); }}>Archive original with evidence</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </>}
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
  const { snapshot, pending, recoveries, busy, run } = useOrganization();
  const [file, setFile] = useState<File | null>(null), [password, setPassword] = useState("");
  const empty = !!snapshot && !recoveries.length && isOrganizationEmpty({ snapshot, pending });
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
