"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewLocationException } from "./actions";

export function ExceptionRow({ attendanceEventId, reviewed, note }: { attendanceEventId: string; reviewed: boolean; note: string | null }) {
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(note ?? "");
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function submit() {
    startTransition(async () => {
      await reviewLocationException(attendanceEventId, text);
      setOpen(false);
      router.refresh();
    });
  }

  if (reviewed && !open) {
    return (
      <div className="mt-1 flex items-center justify-between text-xs text-muted">
        <span>{note ? `Reviewed: "${note}"` : "Reviewed."}</span>
        <button onClick={() => setOpen(true)} className="text-brand-ink underline">
          Edit
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-1 text-xs text-brand-ink underline">
        Mark reviewed
      </button>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Note (optional)" className="input flex-1 text-xs" />
      <button onClick={submit} disabled={pending} className="btn btn-secondary text-xs">
        Save
      </button>
    </div>
  );
}
