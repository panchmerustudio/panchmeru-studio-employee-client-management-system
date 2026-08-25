"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateApplicationStatus } from "../actions";

const STATUSES = [
  { key: "new", label: "New" },
  { key: "reviewing", label: "Reviewing" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "rejected", label: "Rejected" },
  { key: "hired", label: "Hired" },
] as const;

export function StatusForm({ applicationId, currentStatus, currentNote }: { applicationId: string; currentStatus: string; currentNote: string | null }) {
  const [status, setStatus] = useState(currentStatus);
  const [note, setNote] = useState(currentNote ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateApplicationStatus(applicationId, status as (typeof STATUSES)[number]["key"], note);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save.");
      }
    });
  }

  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold">Review</h3>
      <label className="mb-1.5 block text-sm font-medium">Status</label>
      <select className="input mb-3" value={status} onChange={(e) => setStatus(e.target.value)}>
        {STATUSES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <label className="mb-1.5 block text-sm font-medium">Note (optional)</label>
      <textarea className="input mb-3" rows={3} placeholder="Internal note — not shared with the applicant" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button onClick={save} disabled={pending} className="btn btn-primary w-full">
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
