"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEmployeeStatus } from "../actions";

export function StatusButtons({ employeeId, status }: { employeeId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function set(next: "active" | "on_leave" | "exited") {
    startTransition(async () => {
      await setEmployeeStatus(employeeId, next);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "active" && (
        <button disabled={pending} onClick={() => set("active")} className="btn btn-secondary">
          Mark active
        </button>
      )}
      {status !== "exited" && (
        <button disabled={pending} onClick={() => set("exited")} className="btn btn-danger">
          Deactivate
        </button>
      )}
    </div>
  );
}
