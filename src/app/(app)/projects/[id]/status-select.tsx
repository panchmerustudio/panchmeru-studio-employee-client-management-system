"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProjectStatus } from "../actions";

const STATUSES = ["active", "delayed", "on_hold", "completed", "cancelled"] as const;

export function StatusSelect({ projectId, status }: { projectId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <select
      className="input w-auto"
      value={status}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as (typeof STATUSES)[number];
        startTransition(async () => {
          await updateProjectStatus(projectId, next);
          router.refresh();
        });
      }}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>{s.replace("_", " ")}</option>
      ))}
    </select>
  );
}
