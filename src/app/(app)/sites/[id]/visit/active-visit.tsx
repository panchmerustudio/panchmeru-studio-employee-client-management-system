"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { getCurrentPosition } from "@/lib/use-geolocation";
import { reverseGeocode } from "@/lib/reverse-geocode";
import { VoiceRecorder } from "@/components/voice-recorder";
import { Icon } from "@/components/icon";

const TRACK_INTERVAL_MS = 45000;

export function ActiveVisit({ siteId, siteVisitId, siteName, hasBiometric, startedAt }: { siteId: string; siteVisitId: string; siteName: string; hasBiometric: boolean; startedAt: string }) {
  const router = useRouter();
  const [trackPoints, setTrackPoints] = useState(0);
  const [report, setReport] = useState({ workCompleted: "", discussion: "", issues: "", materialRequirement: "", nextAction: "" });
  const [voice, setVoice] = useState<{ blob: Blob; transcript: string | null; seconds: number } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const track = async () => {
      try {
        const pos = await getCurrentPosition(false);
        const res = await fetch("/api/sites/visits/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteVisitId, latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy }),
        });
        if (res.ok) setTrackPoints((n) => n + 1);
      } catch {
        // best-effort; tracking gaps are fine, we're not doing 24/7 surveillance (section 26)
      }
    };
    track();
    const interval = setInterval(track, TRACK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [siteVisitId]);

  async function uploadPhoto() {
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setPhotoMsg(null);
    try {
      const fd = new FormData();
      fd.set("siteId", siteId);
      fd.set("siteVisitId", siteVisitId);
      fd.set("file", file);
      const res = await fetch("/api/sites/photos", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPhotoMsg("Photo added.");
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } catch (err) {
      setPhotoMsg(err instanceof Error ? err.message : "Couldn't upload photo. It's still on your device — try again.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function checkout() {
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const pos = await getCurrentPosition();

      let authMethod: "password_session" | "webauthn" = "password_session";
      if (hasBiometric) {
        try {
          const optionsRes = await fetch("/api/auth/webauthn/login-options", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          const options = await optionsRes.json();
          await startAuthentication(options);
          authMethod = "webauthn";
        } catch {
          /* fall back to session auth */
        }
      }

      const address = await reverseGeocode(pos.latitude, pos.longitude);

      const fd = new FormData();
      fd.set("siteVisitId", siteVisitId);
      fd.set("latitude", String(pos.latitude));
      fd.set("longitude", String(pos.longitude));
      fd.set("accuracy", String(pos.accuracy));
      if (address) fd.set("address", address);
      fd.set("authMethod", authMethod);
      fd.set("clientEventId", crypto.randomUUID());
      Object.entries(report).forEach(([k, v]) => fd.set(k, v));
      if (voice) {
        fd.set("voice", new File([voice.blob], "report-voice.webm", { type: "audio/webm" }));
        if (voice.transcript) fd.set("transcript", voice.transcript);
        fd.set("duration", String(voice.seconds));
      }

      const res = await fetch("/api/sites/visits/checkout", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setCheckoutError(data.error || "Couldn't check out. Your report text is still here — please try again.");
        return;
      }
      router.push(`/sites/${siteId}`);
      router.refresh();
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Couldn't get your location. Your report text is still here — please try again.");
    } finally {
      setCheckoutBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Icon name="map-pin" className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">Visit in progress — {siteName}</div>
            <div className="text-xs text-muted">Started {new Date(startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · {trackPoints} location update{trackPoints === 1 ? "" : "s"} recorded</div>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold">Add a photo</h3>
        <div className="flex items-center gap-2">
          <input ref={fileInput} type="file" accept="image/*" capture="environment" className="flex-1 text-xs" />
          <button onClick={uploadPhoto} disabled={photoBusy} className="btn btn-secondary shrink-0">
            <Icon name="camera" className="h-4 w-4" /> Upload
          </button>
        </div>
        {photoMsg && <p className="mt-2 text-xs text-muted">{photoMsg}</p>}
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="text-sm font-semibold">Site report</h3>
        <Field label="Work completed" value={report.workCompleted} onChange={(v) => setReport((r) => ({ ...r, workCompleted: v }))} />
        <Field label="Discussion" value={report.discussion} onChange={(v) => setReport((r) => ({ ...r, discussion: v }))} />
        <Field label="Issues" value={report.issues} onChange={(v) => setReport((r) => ({ ...r, issues: v }))} />
        <Field label="Material requirement" value={report.materialRequirement} onChange={(v) => setReport((r) => ({ ...r, materialRequirement: v }))} />
        <Field label="Next action" value={report.nextAction} onChange={(v) => setReport((r) => ({ ...r, nextAction: v }))} />

        <div>
          <label className="mb-1.5 block text-sm font-medium">Voice note (optional)</label>
          {voice ? (
            <div className="flex items-center gap-2">
              <audio controls src={URL.createObjectURL(voice.blob)} className="h-9 flex-1" />
              <button onClick={() => setVoice(null)} className="text-xs text-red-600">Remove</button>
            </div>
          ) : (
            <VoiceRecorder onComplete={(blob, transcript, seconds) => setVoice({ blob, transcript, seconds })} />
          )}
          {voice?.transcript && <p className="mt-1 text-xs italic text-muted">&quot;{voice.transcript}&quot;</p>}
        </div>
      </div>

      {checkoutError && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{checkoutError}</div>}

      <button onClick={checkout} disabled={checkoutBusy} className="btn btn-danger w-full">
        {checkoutBusy ? "Checking out…" : "Check out & save report"}
      </button>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <textarea className="input" rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
