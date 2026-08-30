"use client";

import { useActionState, useState } from "react";
import { createClient, type CreateClientState } from "./actions";

const initialState: CreateClientState = {};

export function AddClientForm() {
  const [state, formAction, pending] = useActionState(createClient, initialState);
  const [open, setOpen] = useState(false);

  if (state.ok && state.tempPassword) {
    return (
      <div className="card space-y-3 border-emerald-200 bg-emerald-50 p-5">
        <p className="text-sm font-medium text-emerald-900">Client added — save these login details now, the password won&apos;t be shown again:</p>
        <div className="rounded-lg bg-white p-3 text-sm">
          <div>
            Portal: <span className="font-mono">/client/login</span>
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
        + Add client
      </button>
    );
  }

  return (
    <form action={formAction} className="card space-y-4 p-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Client name</label>
        <input className="input" name="name" required placeholder="Mr. & Mrs. Sharma" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Company (optional)</label>
        <input className="input" name="companyName" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Email (portal login)</label>
          <input className="input" name="email" type="email" required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Mobile</label>
          <input className="input" name="mobile" />
        </div>
      </div>
      {state.error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="btn btn-accent flex-1">
          {pending ? "Adding…" : "Add client & create login"}
        </button>
      </div>
    </form>
  );
}
