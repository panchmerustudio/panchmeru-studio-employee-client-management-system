"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPaymentMilestone, deletePaymentMilestone } from "./actions";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { MilestoneWithPaid } from "@/lib/client-payments";

export function MilestoneManager({ clientId, projectId, milestones }: { clientId: string; projectId: string; milestones: MilestoneWithPaid[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function submit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await addPaymentMilestone(clientId, projectId, fd);
        formRef.current?.reset();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't add milestone.");
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await deletePaymentMilestone(clientId, id);
      router.refresh();
    });
  }

  return (
    <div>
      {milestones.length === 0 ? (
        <p className="mb-3 text-sm text-muted">No milestones yet.</p>
      ) : (
        <ul className="mb-3 divide-y divide-border">
          {milestones.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div className="font-medium">
                  {m.name} · ₹{m.amount.toLocaleString("en-IN")}
                </div>
                <div className="text-xs text-muted">
                  {m.dueDate ? `Due ${formatDate(m.dueDate)}` : "No due date"} {m.paidAmount > 0 ? `· ₹${m.paidAmount.toLocaleString("en-IN")} paid` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge status={m.status} />
                <button onClick={() => remove(m.id)} disabled={pending} className="text-xs text-red-600 hover:underline">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form ref={formRef} action={submit} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <input name="name" placeholder="Milestone name" className="input min-w-[140px] flex-1" required />
        <input name="amount" type="number" min="0" step="0.01" placeholder="Amount (₹)" className="input w-32" required />
        <input name="dueDate" type="date" className="input w-auto" />
        <button type="submit" disabled={pending} className="btn btn-secondary">
          Add
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
