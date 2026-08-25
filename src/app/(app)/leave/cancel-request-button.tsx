"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelLeaveRequest } from "./actions";

export function CancelRequestButton({ leaveId }: { leaveId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="mt-1">
      <button
        className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-40"
        disabled={pending}
        onClick={() => {
          setError(null);
          if (!window.confirm("Cancel this leave request?")) return;
          startTransition(async () => {
            try {
              await cancelLeaveRequest(leaveId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't cancel this request.");
            }
          });
        }}
      >
        {pending ? "Cancelling…" : "Cancel request"}
      </button>
      {error && <p className="mt-0.5 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
