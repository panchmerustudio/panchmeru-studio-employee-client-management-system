"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { getCurrentPosition } from "@/lib/use-geolocation";
import { enqueue, startOfflineSync } from "@/lib/offline-queue";
import { Icon } from "@/components/icon";
import { isAccuracyAcceptable } from "@/lib/geo";
import { reverseGeocode } from "@/lib/reverse-geocode";

type Props = {
  checkedIn: boolean;
  hasBiometric: boolean;
};

export function CheckInOut({ checkedIn, hasBiometric }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);

  useEffect(() => {
    startOfflineSync();
  }, []);

  async function handlePress() {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: "info", text: "Getting your location…" });
      const pos = await getCurrentPosition();

      if (!isAccuracyAcceptable(pos.accuracy)) {
        setMessage({ tone: "error", text: `Your GPS accuracy is currently low (±${Math.round(pos.accuracy)}m). Please move to an open area and try again.` });
        setBusy(false);
        return;
      }

      let authMethod: "password_session" | "webauthn" = "password_session";
      if (hasBiometric) {
        setMessage({ tone: "info", text: "Confirm with Face ID / fingerprint…" });
        try {
          const optionsRes = await fetch("/api/auth/webauthn/login-options", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          const options = await optionsRes.json();
          await startAuthentication(options);
          authMethod = "webauthn";
        } catch {
          setMessage({ tone: "info", text: "Biometric confirmation skipped — continuing with your signed-in session." });
        }
      }

      const address = await reverseGeocode(pos.latitude, pos.longitude);

      const clientEventId = crypto.randomUUID();
      const payload = {
        type: checkedIn ? "check_out" : "check_in",
        source: "office",
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy: pos.accuracy,
        address,
        authMethod,
        clientEventId,
        capturedAtClient: Date.now(),
      };

      setMessage({ tone: "info", text: "Saving…" });
      try {
        const res = await fetch("/api/attendance/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          setMessage({ tone: "error", text: data.error || "Couldn't save. Please try again." });
          setBusy(false);
          return;
        }
        setMessage({ tone: "success", text: checkedIn ? "Checked out. Have a good day!" : "Checked in successfully." });
        router.refresh();
      } catch {
        await enqueue({ id: clientEventId, url: "/api/attendance/event", method: "POST", body: payload, label: checkedIn ? "Check-out" : "Check-in" });
        setMessage({ tone: "info", text: "No connection — saved on this device. Will sync automatically when you're back online. (PENDING SYNC)" });
      }
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6 text-center">
      <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${checkedIn ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
        <Icon name="clock" className="h-8 w-8" />
      </div>
      <p className="mb-1 text-sm text-muted">{checkedIn ? "You're checked in" : "You're not checked in yet"}</p>
      <button onClick={handlePress} disabled={busy} className={`btn ${checkedIn ? "btn-danger" : "btn-accent"} mt-3 w-full max-w-xs`}>
        {busy ? "Working…" : checkedIn ? "Check out" : "Check in"}
      </button>
      {hasBiometric && <p className="mt-2 text-xs text-muted">Biometric confirmation enabled on this account</p>}
      {message && (
        <div
          role="status"
          className={`mt-4 rounded-lg px-3 py-2 text-left text-sm ${
            message.tone === "error" ? "bg-red-50 text-red-700" : message.tone === "success" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
