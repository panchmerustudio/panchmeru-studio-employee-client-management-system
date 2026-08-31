"use client";

import { useMemo, useState } from "react";
import { DrawingCard } from "../drawing-card";
import type { VendorDrawingRow } from "@/lib/vendor-portal";

export function DrawingLibrary({ drawings }: { drawings: VendorDrawingRow[] }) {
  const [q, setQ] = useState("");
  const [project, setProject] = useState<string | "all">("all");

  const projects = useMemo(() => Array.from(new Set(drawings.map((d) => d.projectName).filter((n): n is string => !!n))), [drawings]);

  const filtered = drawings.filter((d) => {
    if (project !== "all" && d.projectName !== project) return false;
    if (q && !d.documentName.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const byCategory = new Map<string, VendorDrawingRow[]>();
  for (const d of filtered) {
    const key = d.categoryName ?? "Uncategorized";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(d);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <input className="input" placeholder="Search drawings…" value={q} onChange={(e) => setQ(e.target.value)} />
        {projects.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setProject("all")} className={`badge ${project === "all" ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}>
              All projects
            </button>
            {projects.map((p) => (
              <button key={p} onClick={() => setProject(p)} className={`badge ${project === p ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}>
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {Array.from(byCategory.entries()).map(([category, items]) => (
        <div key={category}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{category}</h3>
          <div className="space-y-2">
            {items.map((d) => (
              <DrawingCard key={d.versionId} drawing={d} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
