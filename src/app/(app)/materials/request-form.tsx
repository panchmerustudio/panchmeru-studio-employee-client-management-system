"use client";

import { useActionState } from "react";
import { createMaterialRequest, type FormState } from "./actions";

const initialState: FormState = {};

export function MaterialRequestForm({ sites }: { sites: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createMaterialRequest, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <select name="siteId" className="input" required defaultValue="">
        <option value="" disabled>Site…</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <div className="grid grid-cols-3 gap-2">
        <input name="materialName" className="input col-span-2" placeholder="Material (e.g. Cement)" required />
        <input name="quantity" type="number" step="any" className="input" placeholder="Qty" required />
      </div>
      <input name="unit" className="input" placeholder="Unit (bags, sq ft, pcs…)" required />
      <input name="requiredDate" type="date" className="input" />
      <textarea name="reason" className="input" rows={2} placeholder="Reason / notes" />
      {state.error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Submitting…" : "Request material"}
      </button>
    </form>
  );
}
