"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPayment } from "./actions";
import { uploadFileDirect } from "@/lib/upload-client";
import { fileTooLarge, MAX_DIRECT_UPLOAD_BYTES, MAX_DIRECT_UPLOAD_LABEL } from "@/lib/upload-limits";

const MODES = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
] as const;

export function RecordPaymentForm({ clientId, projectId, milestones }: { clientId: string; projectId: string; milestones: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function submit(fd: FormData) {
    setError(null);
    const receiptFile = receiptRef.current?.files?.[0];
    if (receiptFile && fileTooLarge(receiptFile, MAX_DIRECT_UPLOAD_BYTES)) {
      setError(`This receipt is too large (max ${MAX_DIRECT_UPLOAD_LABEL}).`);
      return;
    }
    startTransition(async () => {
      try {
        if (receiptFile) {
          const uploaded = await uploadFileDirect(receiptFile);
          fd.set("receiptKey", uploaded.key);
          fd.set("receiptMimeType", uploaded.mimeType);
          fd.set("receiptOriginalName", uploaded.originalName);
        }
        const result = await recordPayment(clientId, projectId, {}, fd);
        if (result.error) {
          setError(result.error);
          return;
        }
        formRef.current?.reset();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't record this payment.");
      }
    });
  }

  return (
    <form ref={formRef} action={submit} className="space-y-3 border-t border-border pt-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Amount (₹)</label>
          <input name="amount" type="number" min="0" step="0.01" required className="input" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Date received</label>
          <input name="paidDate" type="date" required className="input" defaultValue={new Date().toISOString().slice(0, 10)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Mode</label>
          <select name="mode" className="input" defaultValue="bank_transfer">
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Milestone (optional)</label>
          <select name="milestoneId" className="input" defaultValue="">
            <option value="">Not tied to a milestone</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Reference (optional)</label>
        <input name="reference" placeholder="Cheque no. / UTR / transaction ID" className="input" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Notes (optional)</label>
        <input name="notes" className="input" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Receipt (optional)</label>
        <input ref={receiptRef} type="file" accept="image/*,application/pdf" className="input" />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Recording…" : "Record payment"}
      </button>
    </form>
  );
}
