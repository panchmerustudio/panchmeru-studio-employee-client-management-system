"use client";

import { useActionState } from "react";
import { applyLeave, type FormState } from "./actions";

const initialState: FormState = {};

export function ApplyLeaveForm({ types }: { types: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(applyLeave, initialState);

  if (state.ok) {
    return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Leave request submitted. You&apos;ll be notified once it&apos;s reviewed.</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Leave type</label>
        <select name="leaveTypeId" className="input" required defaultValue="">
          <option value="" disabled>Choose…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">From</label>
          <input className="input" type="date" name="startDate" required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">To</label>
          <input className="input" type="date" name="endDate" required />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isHalfDay" /> Half day
      </label>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Reason</label>
        <textarea className="input" name="reason" rows={2} required />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Attachment (optional)</label>
        <input className="w-full text-xs" type="file" name="attachment" />
      </div>
      {state.error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Submitting…" : "Apply for leave"}
      </button>
    </form>
  );
}
