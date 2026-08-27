"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustSurveyBoundary } from "../../sites/[id]/survey/actions";
import { computeBoundaryStats } from "@/lib/geo";
import { SurveyEditMapClient } from "./survey-edit-map-client";
import type { EditPoint } from "./survey-edit-map";

export function AdjustBoundaryForm({ surveyId, initialPoints, rawPoints }: { surveyId: string; initialPoints: EditPoint[]; rawPoints: EditPoint[] }) {
  const [points, setPoints] = useState<EditPoint[]>(initialPoints);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const stats = computeBoundaryStats(points);
  const changed = JSON.stringify(points) !== JSON.stringify(initialPoints);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await adjustSurveyBoundary(surveyId, points, reason);
        setReason("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save the adjustment.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <SurveyEditMapClient points={points} onChange={setPoints} />
      <div className="card p-4">
        <div className="mb-3 flex justify-around text-center text-sm">
          <div>
            <div className="text-xs text-muted">Adjusted area</div>
            <div className="font-semibold">{stats.areaSqFt?.toLocaleString() ?? "—"} sq ft</div>
          </div>
          <div>
            <div className="text-xs text-muted">Adjusted perimeter</div>
            <div className="font-semibold">{stats.perimeterFt?.toLocaleString() ?? "—"} ft</div>
          </div>
        </div>
        <label className="mb-1.5 block text-sm font-medium">Reason for adjustment</label>
        <textarea className="input mb-2" rows={2} placeholder="Why is this correction needed? (kept in the audit trail)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button className="btn btn-secondary" disabled={pending} onClick={() => setPoints(rawPoints)}>
            Reset to raw walk
          </button>
          <button className="btn btn-primary flex-1" disabled={pending || !changed || !reason.trim()} onClick={save}>
            {pending ? "Saving…" : "Save adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}
