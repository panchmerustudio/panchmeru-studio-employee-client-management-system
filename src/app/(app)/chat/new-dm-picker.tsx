"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startDm } from "./actions";
import { Icon } from "@/components/icon";

export function NewDmPicker({ coworkers }: { coworkers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function pick(id: string) {
    startTransition(async () => {
      const convo = await startDm(id);
      setOpen(false);
      router.push(`/chat/${convo.id}`);
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-secondary">
        <Icon name="plus" className="h-4 w-4" /> New message
      </button>
    );
  }

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Message someone</span>
        <button onClick={() => setOpen(false)} className="text-muted">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {coworkers.map((c) => (
          <button key={c.id} onClick={() => pick(c.id)} disabled={pending} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
