"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentPosition } from "@/lib/use-geolocation";
import { computeBoundaryStats } from "@/lib/geo";
import { enqueue } from "@/lib/offline-queue";
import { Icon } from "@/components/icon";

type Point = { lat: number; lng: number; accuracy: number };

export function BoundaryCapture({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [points, setPoints] = useState<Point[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const stats = computeBoundaryStats(points);

  async function addPoint() {
    setBusy(true);
    setMessage(null);
    try {
      const pos = await getCurrentPosition();
      setPoints((p) => [...p, { lat: pos.latitude, lng: pos.longitude, accuracy: pos.accuracy }]);
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't get your location." });
    } finally {
      setBusy(false);
    }
  }

  function removeLast() {
    setPoints((p) => p.slice(0, -1));
  }

  function clearAll() {
    if (points.length > 0 && !window.confirm(`Discard all ${points.length} captured points and start over?`)) return;
    setPoints([]);
    setMessage(null);
  }

  async function save() {
    if (points.length < 3) {
      setMessage({ tone: "error", text: "Walk at least 3 points around the boundary before saving." });
      return;
    }
    setSaving(true);
    setMessage(null);
    const payload = { siteId, points: points.map((p) => ({ lat: p.lat, lng: p.lng })) };
    try {
      const res = await fetch("/api/sites/boundary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/sites/${siteId}`);
      router.refresh();
    } catch (err) {
      if (err instanceof Error && err.message.includes("Walk at least")) {
        setMessage({ tone: "error", text: err.message });
      } else {
        await enqueue({ id: crypto.randomUUID(), url: "/api/sites/boundary", method: "POST", body: payload, label: "Site boundary" });
        setMessage({ tone: "info", text: "No connection — saved on this device. It will sync automatically when you're back online. (PENDING SYNC)" });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="mb-3 text-sm text-muted">
          Walk to each corner of the plot and tap &quot;Add point&quot; there. This uses your phone&apos;s GPS and gives an approximate area — it is <strong>not a legal survey</strong>.
          A professional survey can be imported later if needed.
        </p>
        <button onClick={addPoint} disabled={busy} className="btn btn-accent w-full">
          <Icon name="map-pin" className="h-4 w-4" /> {busy ? "Getting location…" : `Add point (${points.length} captured)`}
        </button>
      </div>

      {points.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Captured points</h3>
          <ul className="mb-3 space-y-1 text-xs text-muted">
            {points.map((p, i) => (
              <li key={i}>#{i + 1} · {p.lat.toFixed(5)}, {p.lng.toFixed(5)} (±{Math.round(p.accuracy)}m)</li>
            ))}
          </ul>
          <div className="flex gap-3">
            <button onClick={removeLast} className="text-xs font-medium text-red-600">Remove last point</button>
            <button onClick={clearAll} className="text-xs font-medium text-red-600">Restart (clear all)</button>
          </div>
        </div>
      )}

      {points.length >= 3 && (
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Estimated dimensions</h3>
          <div className="flex justify-around text-center">
            <div>
              <div className="text-xs text-muted">Area</div>
              <div className="text-lg font-semibold">{stats.areaSqFt?.toLocaleString()} sq ft</div>
            </div>
            <div>
              <div className="text-xs text-muted">Perimeter</div>
              <div className="text-lg font-semibold">{stats.perimeterFt?.toLocaleString()} ft</div>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className={`rounded-lg px-3 py-2 text-sm ${message.tone === "error" ? "bg-red-50 text-red-700" : message.tone === "success" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
          {message.text}
        </div>
      )}

      <button onClick={save} disabled={saving || points.length < 3} className="btn btn-primary w-full">
        {saving ? "Saving…" : "Save boundary"}
      </button>
    </div>
  );
}
