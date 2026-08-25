"use client";

import { useActionState } from "react";
import { changePassword, type FormState } from "./actions";

const initialState: FormState = {};

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <input className="input" type="password" name="current" placeholder="Current password" required />
      <input className="input" type="password" name="next" placeholder="New password" required />
      <input className="input" type="password" name="confirm" placeholder="Confirm new password" required />
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-emerald-700">Password updated.</p>}
      <button type="submit" disabled={pending} className="btn btn-secondary w-full">
        {pending ? "Updating…" : "Change password"}
      </button>
    </form>
  );
}
