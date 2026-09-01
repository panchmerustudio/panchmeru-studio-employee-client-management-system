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

// "Auto-detect" is what always runs first — reads titles like "GROUND
// FLOOR PLAN"/"FRONT ELEVATION" straight off the drawing (see
// extractViews/partitionByViewTitles in src/lib/dxf/classify.ts). These
// two fields are only for when that isn't enough on its own: a sheet with
// no title text at all, one worded unusually, or one with several floor
// levels where a specific one (not necessarily the ground floor) is
// wanted.
const DRAWING_TYPES = [
  { key: "auto", label: "Auto-detect (recommended)" },
  { key: "plan", label: "It's a floor plan" },
  { key: "elevation", label: "It's an elevation / facade view" },
] as const;

const FLOOR_LEVELS = [
  { key: "", label: "Auto (ground floor preferred)" },
  { key: "ground", label: "Ground floor" },
  { key: "first", label: "First floor" },
  { key: "second", label: "Second floor" },
  { key: "third", label: "Third floor" },
  { key: "basement", label: "Basement" },
  { key: "stilt", label: "Stilt floor" },
  { key: "mezzanine", label: "Mezzanine" },
  { key: "terrace", label: "Terrace floor" },
  { key: "roof", label: "Roof plan" },
] as const;

export function UploadForm({ projectId }: { projectId: string }) {
  const [units, setUnits] = useState("mm");
  const [name, setName] = useState("");
  const [drawingType, setDrawingType] = useState<(typeof DRAWING_TYPES)[number]["key"]>("auto");
  const [floorLevel, setFloorLevel] = useState("");
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
        fd.set("drawingType", drawingType);
        if (drawingType !== "elevation" && floorLevel) fd.set("floorLevel", floorLevel);
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
          <label className="mb-1.5 block text-sm font-medium">What type of drawing is this?</label>
          <select className="input" value={drawingType} onChange={(e) => setDrawingType(e.target.value as (typeof DRAWING_TYPES)[number]["key"])}>
            {DRAWING_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">
            {drawingType === "elevation"
              ? "Builds a facade panel from everything on the sheet, even one with no “ELEVATION” title at all."
              : drawingType === "plan"
                ? "Models it as a floor plan even if a title elsewhere on the sheet would otherwise make it look like an elevation/section."
                : "Reads titles on the sheet (e.g. “GROUND FLOOR PLAN”, “FRONT ELEVATION”) to work out what's what — only override this if that doesn't work."}
          </p>
        </div>
        {drawingType !== "elevation" && (
          <div>
            <label className="mb-1.5 block text-sm font-medium">Floor level (if this sheet has more than one)</label>
            <select className="input" value={floorLevel} onChange={(e) => setFloorLevel(e.target.value)}>
              {FLOOR_LEVELS.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">This app models one storey at a time — pick which one if the sheet has several (e.g. “FIRST FLOOR PLAN” alongside “GROUND FLOOR PLAN”).</p>
          </div>
        )}
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
