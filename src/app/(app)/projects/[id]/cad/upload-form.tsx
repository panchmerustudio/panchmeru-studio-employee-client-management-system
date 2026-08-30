"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadCadModel } from "./actions";
import { Icon } from "@/components/icon";

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
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError("Choose a DXF file.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("units", units);
    if (name.trim()) fd.set("name", name.trim());
    startTransition(async () => {
      try {
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
        DXF only for now (export/save-as DXF from AutoCAD — DWG isn&apos;t supported yet). Walls, doors, windows, columns, furniture, and rooms are read directly from your drawing&apos;s
        layers and blocks — dimensions are never invented.
      </p>
      <div>
        <label className="mb-1.5 block text-sm font-medium">DXF file</label>
        <input ref={fileInput} type="file" accept=".dxf" className="input" />
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
        <Icon name="upload" className="h-4 w-4" /> {pending ? "Parsing…" : "Upload & parse"}
      </button>
    </form>
  );
}
