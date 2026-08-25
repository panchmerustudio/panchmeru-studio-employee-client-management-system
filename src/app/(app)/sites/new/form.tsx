"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { createSite, type FormState } from "../actions";
import { getCurrentPosition } from "@/lib/use-geolocation";
import { Icon } from "@/components/icon";

const initialState: FormState = {};

export function NewSiteForm({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await createSite(prev, fd);
    if (result.ok && result.siteId) router.push(`/sites/${result.siteId}`);
    return result;
  }, initialState);

  async function useMyLocation() {
    setLocating(true);
    setLocError(null);
    try {
      const pos = await getCurrentPosition();
      setCoords(pos);
    } catch (err) {
      setLocError(err instanceof Error ? err.message : "Couldn't get location.");
    } finally {
      setLocating(false);
    }
  }

  return (
    <form action={formAction} className="card space-y-4 p-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Site name</label>
        <input className="input" name="name" required placeholder="Sharma Residence — Phase 2 Interiors" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Project</label>
        <select name="projectId" className="input" required defaultValue="">
          <option value="" disabled>Choose project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">City</label>
          <input className="input" name="city" required placeholder="Mohali" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Geofence radius (m)</label>
          <input className="input" type="number" name="radiusMeters" defaultValue={100} min={20} max={2000} />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Address</label>
        <input className="input" name="addressLine" placeholder="Street / plot / landmark" />
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Location</span>
          <button type="button" onClick={useMyLocation} disabled={locating} className="btn btn-secondary">
            <Icon name="map-pin" className="h-4 w-4" /> {locating ? "Locating…" : "Use my current location"}
          </button>
        </div>
        {coords && <p className="text-xs text-muted">Captured: {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}</p>}
        {locError && <p className="text-xs text-red-600">{locError}</p>}
        <div className="mt-2 grid grid-cols-2 gap-3">
          <input className="input" type="number" step="any" name="latitude" required placeholder="Latitude" value={coords?.latitude ?? ""} onChange={(e) => setCoords((c) => ({ latitude: Number(e.target.value), longitude: c?.longitude ?? 0 }))} />
          <input className="input" type="number" step="any" name="longitude" required placeholder="Longitude" value={coords?.longitude ?? ""} onChange={(e) => setCoords((c) => ({ latitude: c?.latitude ?? 0, longitude: Number(e.target.value) }))} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Start date</label>
          <input className="input" type="date" name="startDate" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Expected completion</label>
          <input className="input" type="date" name="expectedCompletion" />
        </div>
      </div>

      {state.error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}

      <button type="submit" disabled={pending} className="btn btn-accent w-full">
        {pending ? "Adding…" : "Add site"}
      </button>
    </form>
  );
}
