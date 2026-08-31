"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRetentionDays, purgeLocationHistoryNow } from "../live-locations/actions";

export function LocationRetentionForm({ retentionDays }: { retentionDays: number }) {
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState(String(retentionDays));
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateRetentionDays(Number(days));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save.");
      }
    });
  }

  function purgeNow() {
    setPurgeResult(null);
    startTransition(async () => {
      const count = await purgeLocationHistoryNow();
      setPurgeResult(`Deleted ${count} GPS point${count === 1 ? "" : "s"} older than ${days} days.`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Keep GPS trail points for (days)</label>
          <input value={days} onChange={(e) => setDays(e.target.value)} type="number" min="7" className="input w-auto" />
        </div>
        <button onClick={save} disabled={pending} className="btn btn-secondary">
          Save
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div>
        <button onClick={purgeNow} disabled={pending} className="btn btn-secondary text-xs">
          Purge now
        </button>
        <p className="mt-1 text-[11px] text-muted">
          There&apos;s no automatic overnight job in this deployment — run this manually when you want to clear out old site-visit GPS
          trails. Attendance check-in/out records themselves are never purged, only the continuous GPS points from active site visits.
        </p>
        {purgeResult && <p className="mt-1 text-xs text-emerald-700">{purgeResult}</p>}
      </div>
    </div>
  );
}
