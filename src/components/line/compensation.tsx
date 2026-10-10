import { useState } from "react";
import { useAppStore } from "@/app/store.ts";
import { Button, Mono } from "./ui";
import { Deadline } from "./deadline";

export function Compensation({ issuer = false }: { issuer?: boolean }) {
  const notes = useAppStore(state => state.drawNotes);
  const refunds = useAppStore(state => state.refunds);
  const allocate = useAppStore(state => state.doExpireNote);
  const report = useAppStore(state => state.doRefundAck);
  const unavailable = useAppStore(state => state.operationBusy || state.recoveryRequired || !state.isVaultUnlocked);
  const canReconcileHistory = useAppStore(state => !state.operationBusy && state.isVaultUnlocked);
  const generation = useAppStore(state => state.ledger.lineGeneration);
  const [references, setReferences] = useState<Record<string, string>>({});
  const claims = notes.filter(note => note.status !== "redeemed");

  if (claims.length === 0 && refunds.length === 0) return null;
  return (
    <section className="border-t border-border pt-4 space-y-3" aria-label="Expired claim compensation">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Expired claim compensation</h2>
      <p className="text-xs text-muted">After the deadline, the issuer or original agent can allocate the full purchase cost against debt. Any remainder is a private cash refund obligation. This action does not refund cash.</p>
      <ul className="space-y-3">
        {claims.map(note => {
          const refund = refunds.find(item => item.noteCommitment === note.noteCommitment);
          return (
            <li key={note.noteCommitment} className="border border-border p-3 space-y-2 text-xs">
              <p>Original claim: {note.amount} principal + {note.fee} fee</p>
              <Mono value={note.noteCommitment} />
              <Deadline seconds={note.expiry} />
              {refund ? (
                <>
                  <p>Private debt credit: {refund.allocatedCredit} units. Private cash refund obligation: {refund.amount} units.</p>
                  <p>{(refund.status === "issuer-reported" || refund.issuerReportObserved) ? "Issuer reported the refund; cash transfer remains unverified and full backing stays locked."
                    : refund.amount > 0 ? "Cash refund is due. Full original claim backing remains locked." : "Debt credit allocated. No cash refund is due."}</p>
                  {issuer && refund.amount > 0 && refund.status === "allocated" && !refund.issuerReportObserved ? (
                    <form className="space-y-2" onSubmit={async event => {
                      event.preventDefault();
                      if (await report(note.noteCommitment, references[note.noteCommitment] ?? "")) {
                        setReferences(previous => ({ ...previous, [note.noteCommitment]: "" }));
                      }
                    }}>
                      <label className="block">Actual off-chain refund reference
                        <input value={references[note.noteCommitment] ?? ""}
                          onChange={event => setReferences(previous => ({ ...previous, [note.noteCommitment]: event.target.value }))}
                          disabled={unavailable} required className="mt-1 w-full border border-border bg-elevated p-2 text-fg" />
                      </label>
                      <Button type="submit" disabled={unavailable || !(references[note.noteCommitment] ?? "").trim()}>Record issuer refund report</Button>
                    </form>
                  ) : null}
                </>
              ) : (
                <Button onClick={() => allocate(note.noteCommitment)} disabled={note.lineGeneration < generation ? !canReconcileHistory : unavailable}>Allocate expired claim compensation</Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
