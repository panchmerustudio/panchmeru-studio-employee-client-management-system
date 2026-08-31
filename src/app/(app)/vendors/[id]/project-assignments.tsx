"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignVendorToProject, removeVendorAssignment } from "../actions";
import { Icon } from "@/components/icon";

type Assignment = { id: string; projectId: string; projectName: string; siteId: string | null; siteName: string | null };

export function ProjectAssignments({
  vendorId,
  assignments,
  projects,
  sites,
}: {
  vendorId: string;
  assignments: Assignment[];
  projects: { id: string; name: string }[];
  sites: { id: string; name: string; projectId: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const assignedProjectIds = new Set(assignments.map((a) => a.projectId));
  const availableProjects = projects.filter((p) => !assignedProjectIds.has(p.id));
  const sitesForProject = sites.filter((s) => s.projectId === projectId);

  function add() {
    if (!projectId) return;
    setError(null);
    startTransition(async () => {
      try {
        await assignVendorToProject(vendorId, projectId, siteId || null);
        setProjectId("");
        setSiteId("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't assign.");
      }
    });
  }

  function remove(assignmentId: string) {
    startTransition(async () => {
      await removeVendorAssignment(assignmentId, vendorId);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {assignments.length === 0 ? (
        <p className="text-sm text-muted">Not assigned to any project yet — the vendor sees nothing until assigned.</p>
      ) : (
        <ul className="divide-y divide-border">
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {a.projectName}
                {a.siteName ? ` · ${a.siteName}` : ""}
              </span>
              <button onClick={() => remove(a.id)} disabled={pending} className="text-xs text-red-600 hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {availableProjects.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Project</label>
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setSiteId("");
              }}
              className="input w-auto text-xs"
            >
              <option value="">Select…</option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {projectId && sitesForProject.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Site (optional)</label>
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="input w-auto text-xs">
                <option value="">Whole project</option>
                {sitesForProject.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button onClick={add} disabled={!projectId || pending} className="btn btn-secondary text-xs">
            <Icon name="plus" className="h-3.5 w-3.5" /> Assign
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
