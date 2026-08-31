"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadEmployeeDocument } from "../actions";
import { uploadFileDirect } from "@/lib/upload-client";
import { fileTooLarge, MAX_DIRECT_UPLOAD_BYTES, MAX_DIRECT_UPLOAD_LABEL } from "@/lib/upload-limits";

const DOC_TYPES = ["identity", "pan", "resume", "qualification", "experience", "bank_details", "joining_document", "other"];

export function DocumentUploadForm({ employeeId }: { employeeId: string }) {
  const [docType, setDocType] = useState("other");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    if (fileTooLarge(file, MAX_DIRECT_UPLOAD_BYTES)) {
      setError(`This file is too large (max ${MAX_DIRECT_UPLOAD_LABEL}).`);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const uploaded = await uploadFileDirect(file);
        const fd = new FormData();
        fd.set("docType", docType);
        fd.set("fileKey", uploaded.key);
        fd.set("fileMimeType", uploaded.mimeType);
        fd.set("fileOriginalName", uploaded.originalName);
        await uploadEmployeeDocument(employeeId, fd);
        if (fileInput.current) fileInput.current.value = "";
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't upload.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <select value={docType} onChange={(e) => setDocType(e.target.value)} className="input w-auto flex-1 min-w-[140px]">
        {DOC_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.replace("_", " ")}
          </option>
        ))}
      </select>
      <input ref={fileInput} type="file" required className="flex-1 min-w-[160px] text-xs" title={`Up to ${MAX_DIRECT_UPLOAD_LABEL}`} />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? "Uploading…" : "Upload"}
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
