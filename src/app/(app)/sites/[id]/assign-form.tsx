"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignEmployeeToSite, removeEmployeeFromSite } from "../actions";

export function AssignForm({ siteId, employees }: { siteId: string; employees: { id: string; name: string }[] }) {
  const [employeeId, setEmployeeId] = useState("");
  const [role, setRole] = useState("team_member");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) return;
    startTransition(async () => {
      try {
        await assignEmployeeToSite(siteId, employeeId, role);
        setEmployeeId("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't assign.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <select className="input flex-1 min-w-[140px]" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
        <option value="">Choose employee…</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="team_member">Team member</option>
        <option value="site_manager">Site manager</option>
      </select>
      <button type="submit" disabled={pending} className="btn btn-secondary">Assign</button>
      {error && <span className="w-full text-xs text-red-600">{error}</span>}
    </form>
  );
}

export function RemoveAssignmentButton({ assignmentId, siteId }: { assignmentId: string; siteId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(async () => { await removeEmployeeFromSite(assignmentId, siteId); router.refresh(); })}
      className="text-xs font-medium text-red-600"
    >
      Remove
    </button>
  );
}
