"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadCadModel } from "./actions";
import { Icon } from "@/components/icon";
import { fileTooLarge, MAX_DIRECT_UPLOAD_BYTES, MAX_DIRECT_UPLOAD_LABEL } from "@/lib/upload-limits";
import { uploadFileDirect } from "@/lib/upload-client";

const UNITS = [
  { key: "mm", label: "Millimeters (mm)" },
  { key: "cm", label: "Centimeters (cm)" },
  { key: "m", label: "Meters (m)" },
  { key: "in", label: "Inches (in)" },
  { key: "ft", label: "Feet (ft)" },
] as const;

export function UploadForm({ projectId }: { projectId: string }) {
  const [units, setUnits] = useState("mm");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const selectedIsDwg = selectedFileName?.toLowerCase().endsWith(".dwg") ?? false;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError("Choose a DXF or DWG file.");
      return;
    }
    if (fileTooLarge(file, MAX_DIRECT_UPLOAD_BYTES)) {
      setError(`This file is too large (max ${MAX_DIRECT_UPLOAD_LABEL}).`);
      return;
    }
    const isDwg = file.name.toLowerCase().endsWith(".dwg");
    setError(null);
    startTransition(async () => {
      try {
        // Neither DXF nor DWG is a MIME type most browsers recognize, so
        // file.type is often "" or generic — force the real type explicitly.
        const uploaded = await uploadFileDirect(file, "/api/uploads/presign", isDwg ? "application/dwg" : "application/dxf");
        const fd = new FormData();
        fd.set("fileKey", uploaded.key);
        fd.set("fileOriginalName", uploaded.originalName);
        fd.set("units", units);
        if (name.trim()) fd.set("name", name.trim());
        const model = await uploadCadModel(projectId, fd);
        router.push(`/projects/${projectId}/cad/${model.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't upload this file.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-muted">
        DXF and DWG both work — a DWG file is converted to DXF automatically before parsing, which can take up to a couple of minutes for a complex drawing. Walls, doors, windows,
        columns, furniture, and rooms are read directly from your drawing&apos;s layers and blocks — dimensions are never invented.
      </p>
      <div>
        <label className="mb-1.5 block text-sm font-medium">DXF or DWG file</label>
        <input
          ref={fileInput}
          type="file"
          accept=".dxf,.dwg"
          className="input"
          onChange={(e) => setSelectedFileName(e.target.files?.[0]?.name ?? null)}
        />
        <p className="mt-1 text-xs text-muted">Up to {MAX_DIRECT_UPLOAD_LABEL}. A large/complex drawing may need to be simplified or split by floor first.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Drawing units</label>
          <select className="input" value={units} onChange={(e) => setUnits(e.target.value)}>
            {UNITS.map((u) => (
              <option key={u.key} value={u.key}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Name (optional)</label>
          <input className="input" placeholder="e.g. Ground floor plan" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        <Icon name="upload" className="h-4 w-4" /> {pending ? (selectedIsDwg ? "Converting & parsing… (may take a minute or two)" : "Parsing…") : "Upload & parse"}
      </button>
    </form>
  );
}
