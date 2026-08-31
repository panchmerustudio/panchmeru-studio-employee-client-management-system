"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadNewVersion } from "../actions";
import { fileTooLarge, MAX_UPLOAD_LABEL } from "@/lib/upload-limits";

export function NewVersionForm({ documentId }: { documentId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    if (fileTooLarge(file)) {
      setError(`This file is too large (max ${MAX_UPLOAD_LABEL}).`);
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("changeNote", noteInput.current?.value ?? "");
    startTransition(async () => {
      try {
        await uploadNewVersion(documentId, fd);
        if (fileInput.current) fileInput.current.value = "";
        if (noteInput.current) noteInput.current.value = "";
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't upload.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-border pt-3">
      <input ref={noteInput} className="input" placeholder="What changed in this version?" />
      <div className="flex items-center gap-2">
        <input ref={fileInput} type="file" required className="flex-1 text-xs" title={`Up to ${MAX_UPLOAD_LABEL}`} />
        <button type="submit" disabled={pending} className="btn btn-secondary shrink-0">
          {pending ? "Uploading…" : "Upload new version"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
