"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createTask, type FormState } from "../actions";

const initialState: FormState = {};

export function NewTaskForm({
  employees,
  projects,
  sites,
}: {
  employees: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  sites: { id: string; name: string; projectId: string }[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await createTask(prev, fd);
    if (result.ok) router.push("/tasks");
    return result;
  }, initialState);

  const [projectId, setProjectId] = useState("");
  const filteredSites = useMemo(() => sites.filter((s) => !projectId || s.projectId === projectId), [sites, projectId]);

  return (
    <form action={formAction} className="card space-y-4 p-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Title</label>
        <input className="input" name="title" required placeholder="Prepare kitchen layout drawing" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Instructions</label>
        <textarea className="input" name="instructions" rows={3} placeholder="Details for the assignee…" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Assign to</label>
        <select name="assignedToId" className="input" required defaultValue="">
          <option value="" disabled>Choose employee…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Project</label>
          <select name="projectId" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Site</label>
          <select name="siteId" className="input">
            <option value="">None</option>
            {filteredSites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Priority</label>
          <select name="priority" className="input" defaultValue="normal">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Due date</label>
          <input className="input" type="date" name="dueDate" />
        </div>
      </div>

      {state.error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}

      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Creating…" : "Create task"}
      </button>
    </form>
  );
}
