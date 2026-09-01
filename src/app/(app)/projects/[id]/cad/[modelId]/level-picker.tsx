"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regenerateCadModelLevel } from "../actions";

/**
 * "If some drawing has two or three drawings, it should ask me which
 * drawing" — a real report. A DWG/DXF sheet can carry more than one titled
 * plan-kind view (GROUND FLOOR PLAN + FIRST FLOOR PLAN + TERRACE FLOOR
 * PLAN, say); this app only ever models one of them (see
 * partitionByViewTitles' doc in classify.ts), and used to note the rest
 * only as a passive suffix buried in the model's name. This makes that an
 * explicit, one-tap choice instead — otherLevelTitles/primaryLevelTitle
 * come straight from what the same parser already found at upload time, so
 * picking one just re-parses the SAME source file with that title
 * preferred (see regenerateCadModelLevel), replacing this model's geometry
 * in place rather than requiring a whole re-upload.
 */
export function LevelPicker({
  modelId,
  currentTitle,
  otherTitles,
  otherLevelEntityCount,
}: {
  modelId: string;
  currentTitle: string | null;
  otherTitles: string[];
  otherLevelEntityCount: number;
}) {
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function pick(title: string) {
    setError(null);
    setPendingTitle(title);
    startTransition(async () => {
      try {
        await regenerateCadModelLevel(modelId, title);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't switch to that drawing.");
      } finally {
        setPendingTitle(null);
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        This file has more than one titled drawing on it — only one is modeled at a time (multi-storey isn&apos;t supported yet). Currently modeled:{" "}
        <strong>{currentTitle ?? "an untitled view"}</strong>. Pick a different one below to switch{otherLevelEntityCount > 0 ? ` (${otherLevelEntityCount} more entities on the others)` : ""}.
      </p>
      <div className="flex flex-wrap gap-2">
        {currentTitle && <span className="btn btn-primary cursor-default">{currentTitle} (current)</span>}
        {otherTitles.map((title) => (
          <button key={title} type="button" disabled={pending} onClick={() => pick(title)} className="btn btn-secondary">
            {pending && pendingTitle === title ? "Switching…" : title}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
