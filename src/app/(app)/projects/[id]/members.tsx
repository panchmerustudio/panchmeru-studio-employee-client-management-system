"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProjectMember, removeProjectMember } from "../actions";

type Member = { id: string; employeeId: string; name: string; roleOnProject: string | null };

export function Members({ projectId, members, employees }: { projectId: string; members: Member[]; employees: { id: string; name: string }[] }) {
  const [employeeId, setEmployeeId] = useState("");
  const [role, setRole] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const available = employees.filter((e) => !members.some((m) => m.employeeId === e.id));

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) return;
    startTransition(async () => {
      await addProjectMember(projectId, employeeId, role);
      setEmployeeId("");
      setRole("");
      router.refresh();
    });
  }

  function remove(memberId: string) {
    startTransition(async () => {
      await removeProjectMember(memberId, projectId);
      router.refresh();
    });
  }

  return (
    <div>
      {members.length === 0 ? (
        <p className="mb-3 text-sm text-muted">No team members assigned yet.</p>
      ) : (
        <ul className="mb-3 divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2 text-sm">
              <span>{m.name} {m.roleOnProject && <span className="text-xs text-muted">· {m.roleOnProject}</span>}</span>
              <button onClick={() => remove(m.id)} disabled={pending} className="text-xs font-medium text-red-600">Remove</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <select className="input flex-1 min-w-[140px]" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Choose employee…</option>
          {available.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        <input placeholder="Role on project" value={role} onChange={(e) => setRole(e.target.value)} className="input w-auto min-w-[120px]" />
        <button type="submit" disabled={pending || !employeeId} className="btn btn-secondary">Add</button>
      </form>
    </div>
  );
}
