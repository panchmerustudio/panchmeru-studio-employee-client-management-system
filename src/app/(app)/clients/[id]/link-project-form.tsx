"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { linkProjectToClient, unlinkProjectFromClient } from "../actions";
import { Icon } from "@/components/icon";

type LinkedProject = { id: string; name: string; status: string };

export function LinkProjectForm({
  clientId,
  linked,
  unlinkedProjects,
}: {
  clientId: string;
  linked: LinkedProject[];
  unlinkedProjects: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function link() {
    if (!projectId) return;
    setError(null);
    startTransition(async () => {
      try {
        await linkProjectToClient(clientId, projectId);
        setProjectId("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't link that project.");
      }
    });
  }

  function unlink(projectId: string) {
    startTransition(async () => {
      await unlinkProjectFromClient(clientId, projectId);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {linked.length === 0 ? (
        <p className="text-sm text-muted">No project linked yet — payments and the client-visible vendor list need at least one.</p>
      ) : (
        <ul className="divide-y divide-border">
          {linked.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2 text-sm">
              <Link href={`/projects/${p.id}`} className="font-medium text-brand-ink underline">
                {p.name}
              </Link>
              <button onClick={() => unlink(p.id)} disabled={pending} className="text-xs text-red-600 hover:underline">
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}

      {unlinkedProjects.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input w-auto text-xs">
            <option value="">Link a project…</option>
            {unlinkedProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={link} disabled={!projectId || pending} className="btn btn-secondary text-xs">
            <Icon name="plus" className="h-3.5 w-3.5" /> Link
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
