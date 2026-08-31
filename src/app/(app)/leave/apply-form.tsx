"use client";

import { useActionState, useState } from "react";
import { applyLeave, type FormState } from "./actions";
import { uploadFileDirect } from "@/lib/upload-client";
import { fileTooLarge, MAX_DIRECT_UPLOAD_BYTES, MAX_DIRECT_UPLOAD_LABEL } from "@/lib/upload-limits";

const initialState: FormState = {};

export function ApplyLeaveForm({ types }: { types: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(applyLeave, initialState);
  const [clientError, setClientError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  if (state.ok) {
    return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Leave request submitted. You&apos;ll be notified once it&apos;s reviewed.</p>;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);
    const fd = new FormData(e.currentTarget);
    const file = fd.get("attachment") as File | null;
    if (file && file.size > 0) {
      if (fileTooLarge(file, MAX_DIRECT_UPLOAD_BYTES)) {
        setClientError(`This attachment is too large (max ${MAX_DIRECT_UPLOAD_LABEL}).`);
        return;
      }
      setUploading(true);
      try {
        const uploaded = await uploadFileDirect(file);
        fd.delete("attachment");
        fd.set("attachmentKey", uploaded.key);
        fd.set("attachmentMimeType", uploaded.mimeType);
        fd.set("attachmentOriginalName", uploaded.originalName);
      } catch (err) {
        setUploading(false);
        setClientError(err instanceof Error ? err.message : "Couldn't upload the attachment.");
        return;
      }
      setUploading(false);
    }
    formAction(fd);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Leave type</label>
        <select name="leaveTypeId" className="input" required defaultValue="">
          <option value="" disabled>Choose…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">From</label>
          <input className="input" type="date" name="startDate" required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">To</label>
          <input className="input" type="date" name="endDate" required />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isHalfDay" /> Half day
      </label>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Reason</label>
        <textarea className="input" name="reason" rows={2} required />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Attachment (optional)</label>
        <input className="w-full text-xs" type="file" name="attachment" />
        <p className="mt-1 text-[11px] text-muted">Up to {MAX_DIRECT_UPLOAD_LABEL}.</p>
      </div>
      {(clientError || state.error) && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {clientError || state.error}
        </div>
      )}
      <button type="submit" disabled={pending || uploading} className="btn btn-accent w-full">
        {uploading ? "Uploading…" : pending ? "Submitting…" : "Apply for leave"}
      </button>
    </form>
  );
}
