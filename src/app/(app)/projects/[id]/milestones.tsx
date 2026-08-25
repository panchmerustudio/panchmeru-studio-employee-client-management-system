"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMilestone, setMilestoneStatus } from "../actions";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";

type Milestone = { id: string; name: string; dueDate: Date | null; status: string };

export function Milestones({ projectId, milestones }: { projectId: string; milestones: Milestone[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function submit(fd: FormData) {
    startTransition(async () => {
      try {
        await addMilestone(projectId, fd);
        formRef.current?.reset();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't add milestone.");
      }
    });
  }

  function cycleStatus(m: Milestone) {
    const next = m.status === "pending" ? "in_progress" : m.status === "in_progress" ? "done" : "pending";
    startTransition(async () => {
      await setMilestoneStatus(m.id, projectId, next);
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
                <div className="font-medium">{m.name}</div>
                {m.dueDate && <div className="text-xs text-muted">Due {formatDate(m.dueDate)}</div>}
              </div>
              <button onClick={() => cycleStatus(m)} disabled={pending} className="shrink-0">
                <Badge status={m.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form ref={formRef} action={submit} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <input name="name" placeholder="Milestone name" className="input flex-1 min-w-[140px]" required />
        <input name="dueDate" type="date" className="input w-auto" />
        <button type="submit" disabled={pending} className="btn btn-secondary">Add</button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <p className="mt-2 text-[11px] text-muted">Tap a milestone&apos;s status badge to cycle pending → in progress → done.</p>
    </div>
  );
}
