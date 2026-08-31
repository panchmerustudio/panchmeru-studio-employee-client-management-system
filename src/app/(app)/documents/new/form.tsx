"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { createDocument, type FormState } from "../actions";
import { fileTooLarge, MAX_UPLOAD_LABEL } from "@/lib/upload-limits";

const initialState: FormState = {};

export function NewDocumentForm({
  categories,
  projects,
  sites,
}: {
  categories: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  sites: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await createDocument(prev, fd);
    if (result.ok && result.documentId) router.push(`/documents/${result.documentId}`);
    return result;
  }, initialState);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const file = (new FormData(e.currentTarget).get("file") as File | null) ?? undefined;
    if (file && file.size > 0 && fileTooLarge(file)) {
      e.preventDefault();
      setClientError(`This file is too large (max ${MAX_UPLOAD_LABEL}).`);
      return;
    }
    setClientError(null);
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="card space-y-4 p-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Name</label>
        <input className="input" name="name" required placeholder="Kitchen Layout" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Category</label>
        <select name="categoryId" className="input" defaultValue="">
          <option value="">Other</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Project</label>
          <select name="projectId" className="input" defaultValue="">
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Site</label>
          <select name="siteId" className="input" defaultValue="">
            <option value="">None</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Description</label>
        <textarea className="input" name="description" rows={2} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">File</label>
        <input className="w-full text-xs" type="file" name="file" required />
        <p className="mt-1 text-[11px] text-muted">Up to {MAX_UPLOAD_LABEL}.</p>
      </div>
      {(clientError || state.error) && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {clientError || state.error}
        </div>
      )}
      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
