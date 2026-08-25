"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { getCurrentPosition } from "@/lib/use-geolocation";
import { isAccuracyAcceptable } from "@/lib/geo";
import { reverseGeocode } from "@/lib/reverse-geocode";
import { Icon } from "@/components/icon";

export function StartVisitButton({ siteId, hasBiometric }: { siteId: string; hasBiometric: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const pos = await getCurrentPosition();
      if (!isAccuracyAcceptable(pos.accuracy)) {
        setError(`Your GPS accuracy is currently low (±${Math.round(pos.accuracy)}m). Please move to an open area and try again.`);
        return;
      }

      let authMethod: "password_session" | "webauthn" = "password_session";
      if (hasBiometric) {
        try {
          const optionsRes = await fetch("/api/auth/webauthn/login-options", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          const options = await optionsRes.json();
          await startAuthentication(options);
          authMethod = "webauthn";
        } catch {
          /* continue with session auth */
        }
      }

      const address = await reverseGeocode(pos.latitude, pos.longitude);

      const res = await fetch("/api/sites/visits/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy, address, authMethod, clientEventId: crypto.randomUUID() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't start the visit.");
        return;
      }
      router.push(`/sites/${siteId}/visit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={start} disabled={busy} className="btn btn-accent w-full">
        <Icon name="map-pin" className="h-4 w-4" /> {busy ? "Checking in…" : "Start site visit"}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
