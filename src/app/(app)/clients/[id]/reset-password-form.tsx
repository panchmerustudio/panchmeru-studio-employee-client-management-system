"use client";

import { useActionState } from "react";
import { resetClientPassword, type ResetPasswordState } from "../actions";

const initialState: ResetPasswordState = {};

export function ResetPasswordForm({ clientUserId }: { clientUserId: string }) {
  const [state, formAction, pending] = useActionState(resetClientPassword, initialState);

  if (state.ok && state.tempPassword) {
    return (
      <div className="rounded-lg bg-emerald-50 p-3 text-sm">
        New temporary password (save it now, won&apos;t be shown again): <span className="font-mono font-bold">{state.tempPassword}</span>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="clientUserId" value={clientUserId} />
      {state.error && <p className="mb-2 text-xs text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? "Resetting…" : "Reset password"}
      </button>
    </form>
  );
}
