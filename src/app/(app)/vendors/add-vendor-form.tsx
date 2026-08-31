"use client";

import { useActionState, useState } from "react";
import { createVendor, type CreateVendorState, VENDOR_TRADE_CATEGORIES } from "./actions";

const initialState: CreateVendorState = {};

export function AddVendorForm() {
  const [state, formAction, pending] = useActionState(createVendor, initialState);
  const [open, setOpen] = useState(false);

  if (state.ok && state.tempPassword) {
    return (
      <div className="card space-y-3 border-emerald-200 bg-emerald-50 p-5">
        <p className="text-sm font-medium text-emerald-900">Vendor added — save these login details now, the password won&apos;t be shown again:</p>
        <div className="rounded-lg bg-white p-3 text-sm">
          <div>
            Portal: <span className="font-mono">/vendor/login</span>
          </div>
          <div>
            Email: <span className="font-mono">{state.loginEmail}</span>
          </div>
          <div>
            Temporary password: <span className="font-mono font-bold">{state.tempPassword}</span>
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="btn btn-secondary">
          Done
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-accent">
        + Add vendor
      </button>
    );
  }

  return (
    <form action={formAction} className="card space-y-4 p-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Vendor / firm name</label>
        <input className="input" name="name" required placeholder="Sharma Electricals" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Trade</label>
          <select className="input" name="category" defaultValue="">
            <option value="" disabled>
              Select a trade
            </option>
            {VENDOR_TRADE_CATEGORIES.map((t) => (
              <option key={t.trade} value={t.trade}>
                {t.trade}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Mobile</label>
          <input className="input" name="mobile" />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Email (portal login)</label>
        <input className="input" name="email" type="email" required />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Address (optional)</label>
        <input className="input" name="address" />
      </div>
      {state.error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
      <p className="text-xs text-muted">Picking a trade with a matching drawing category (e.g. Electrician → Electrical) auto-grants that category — add more or remove it from the vendor&apos;s page after.</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="btn btn-accent flex-1">
          {pending ? "Adding…" : "Add vendor & create login"}
        </button>
      </div>
    </form>
  );
}
