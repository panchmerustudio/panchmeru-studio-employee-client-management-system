"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteFile } from "./actions";
import { Icon } from "@/components/icon";

export function DeleteFileButton({ fileId, fileName }: { fileId: string; fileName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    setError(null);
    if (!window.confirm(`Delete "${fileName}"? This can't be undone.`)) return;
    startTransition(async () => {
      try {
        await deleteFile(fileId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete this file.");
      }
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button onClick={onClick} disabled={pending} className="btn btn-danger px-2.5 py-1.5" aria-label={`Delete ${fileName}`}>
        <Icon name="trash" className="h-4 w-4" />
      </button>
      {error && <p className="max-w-[10rem] text-right text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
