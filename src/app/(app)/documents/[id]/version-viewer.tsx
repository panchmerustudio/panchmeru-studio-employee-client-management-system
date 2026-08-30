"use client";

import { useState } from "react";
import { ProtectedViewer } from "@/components/protected-viewer";
import { Icon } from "@/components/icon";

export function VersionViewer({
  fileId,
  mimeType,
  originalName,
  watermarkLines,
  canDownload,
}: {
  fileId: string;
  mimeType: string;
  originalName: string;
  watermarkLines: string[];
  canDownload: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full sm:w-auto">
      <button onClick={() => setOpen((o) => !o)} className="btn btn-secondary">
        <Icon name="file" className="h-4 w-4" /> {open ? "Hide" : "Open"}
      </button>
      {open && (
        <div className="mt-3">
          <ProtectedViewer
            fileId={fileId}
            mimeType={mimeType}
            originalName={originalName}
            watermarkLines={watermarkLines}
            downloadHref={canDownload ? `/api/files/${fileId}?download=1` : undefined}
          />
        </div>
      )}
    </div>
  );
}
