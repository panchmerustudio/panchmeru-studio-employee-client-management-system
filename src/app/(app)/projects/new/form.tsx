"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createProject, type FormState } from "../actions";

const initialState: FormState = {};

export function NewProjectForm({ types }: { types: { id: string; name: string }[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await createProject(prev, fd);
    if (result.ok && result.projectId) router.push(`/projects/${result.projectId}`);
    return result;
  }, initialState);

  return (
    <form action={formAction} className="card space-y-4 p-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Project name</label>
        <input className="input" name="name" required placeholder="Sharma Residence" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Project type</label>
        <select name="projectTypeId" className="input" defaultValue="">
          <option value="">None</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Start date</label>
          <input className="input" type="date" name="startDate" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Expected completion</label>
          <input className="input" type="date" name="expectedCompletion" />
        </div>
      </div>

      {state.error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}

      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Creating…" : "Create project"}
      </button>
    </form>
  );
}
