"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui";
import { DrawingCard } from "../drawing-card";
import type { ClientDrawingRow } from "@/lib/client-portal";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "awaiting_response", label: "Pending approval" },
  { key: "revision_requested", label: "Revision requested" },
  { key: "approved", label: "Approved" },
] as const;

export function DrawingLibrary({ drawings }: { drawings: ClientDrawingRow[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["key"]>("all");

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of drawings) seen.set(d.categoryKey ?? "other", d.categoryName ?? "Other");
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [drawings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drawings.filter((d) => {
      if (category !== "all" && (d.categoryKey ?? "other") !== category) return false;
      if (status !== "all" && d.responseStatus !== status) return false;
      if (q && !d.documentName.toLowerCase().includes(q) && !(d.categoryName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [drawings, query, category, status]);

  const grouped = useMemo(() => {
    const groups = new Map<string, { name: string; items: ClientDrawingRow[] }>();
    for (const d of filtered) {
      const key = d.categoryKey ?? "other";
      if (!groups.has(key)) groups.set(key, { name: d.categoryName ?? "Other", items: [] });
      groups.get(key)!.items.push(d);
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  return (
    <div className="space-y-4">
      <input
        className="input"
        placeholder="Search drawings — name, category, version…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setCategory("all")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${category === "all" ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}
        >
          All categories
        </button>
        {categories.map(([key, name]) => (
          <button
            key={key}
            onClick={() => setCategory(key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${category === key ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatus(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${status === f.key ? "bg-brand-ink text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {grouped.length === 0 ? (
        <EmptyState icon="file" title="No drawings match" subtitle="Try a different search term or filter." />
      ) : (
        <div className="space-y-5">
          {grouped.map((g) => (
            <div key={g.name}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.name}</h3>
              <div className="space-y-2">
                {g.items.map((d) => (
                  <DrawingCard key={d.shareId} drawing={d} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
