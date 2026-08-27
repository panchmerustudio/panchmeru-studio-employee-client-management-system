"use client";

/**
 * Live GPS boundary-walk capture (section 1-16 of the spec). Intelligent
 * point-gating (never a blind continuous dump of every watchPosition tick),
 * live accuracy + GPS-jump warnings, pause/resume with retained history,
 * a growing live map, and a Finish -> auto-close -> employee self-review
 * (Confirm / Redo) step before anything goes to an approver. Manual
 * boundary correction ("Edit") happens later, from the survey detail page.
 *
 * Durability: every captured point is pushed through the offline-queue
 * (IndexedDB-backed, see lib/offline-queue.ts) rather than a bare fetch, so
 * a dropped connection or a killed app never silently loses the raw walk —
 * the queue retries on its own once back online. A still-open draft (an
 * `in_progress` plotSurveys row) is reloaded from the server on next visit
 * to this page, so navigating away mid-walk doesn't lose the survey itself
 * either, only whatever points hadn't been flushed yet.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { watchPosition } from "@/lib/use-geolocation";
import { enqueue } from "@/lib/offline-queue";
import { Icon } from "@/components/icon";
import {
  shouldCapturePoint,
  isGpsJump,
  MIN_ACCEPTABLE_ACCURACY_METERS,
  computeBoundaryStats,
} from "@/lib/geo";
import { startSurvey, pauseSurvey, resumeSurvey, finishSurvey, submitSurveyForReview, redoSurveyDraft } from "./actions";
import { SurveyLiveMapClient } from "./survey-live-map-client";

type CapturedPoint = { lat: number; lng: number; accuracy?: number; capturedAt: number; isOutlier: boolean; outlierReason?: string };

type ExistingSurvey = {
  id: string;
  surveyNumber: number;
  startedAt: string;
  pausedSeconds: number;
  endedAt: string | null;
  rawAreaSqFt: number | null;
  rawPerimeterFt: number | null;
  rawSegments: { label: string; lengthFt: number }[] | null;
  shapeType: string | null;
  pointCount: number;
  outlierCount: number;
} | null;

type Phase = "idle" | "capturing" | "paused" | "reviewing" | "submitted" | "discarded";

const FLUSH_EVERY_N_POINTS = 5;
const FLUSH_INTERVAL_MS = 15000;

export function SurveyCapture({
  siteId,
  siteName,
  existingSurvey,
  existingPoints,
  wasPaused,
}: {
  siteId: string;
  siteName: string;
  existingSurvey: ExistingSurvey;
  existingPoints: { lat: number; lng: number; isOutlier: boolean }[];
  wasPaused: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(existingSurvey ? (existingSurvey.endedAt ? "reviewing" : wasPaused ? "paused" : "capturing") : "idle");
  const [survey, setSurvey] = useState<{ id: string; surveyNumber: number } | null>(existingSurvey ? { id: existingSurvey.id, surveyNumber: existingSurvey.surveyNumber } : null);
  const [points, setPoints] = useState<CapturedPoint[]>(existingPoints.map((p) => ({ ...p, capturedAt: Date.now() })));
  const [current, setCurrent] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info" | "success"; text: string } | null>(null);
  const [reviewStats, setReviewStats] = useState(
    existingSurvey?.endedAt
      ? { areaSqFt: existingSurvey.rawAreaSqFt, perimeterFt: existingSurvey.rawPerimeterFt, segments: existingSurvey.rawSegments ?? [], shapeType: existingSurvey.shapeType }
      : null
  );

  const pointsRef = useRef(points);
  pointsRef.current = points;
  const syncedCountRef = useRef(existingPoints.length);
  const stopWatchRef = useRef<(() => void) | null>(null);
  const surveyRef = useRef(survey);
  surveyRef.current = survey;

  async function flush() {
    const s = surveyRef.current;
    if (!s) return;
    const unsynced = pointsRef.current.slice(syncedCountRef.current);
    if (unsynced.length === 0) return;
    syncedCountRef.current = pointsRef.current.length;
    await enqueue({
      id: crypto.randomUUID(),
      url: "/api/sites/survey/points",
      method: "POST",
      body: { surveyId: s.id, points: unsynced.map((p) => ({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, capturedAt: new Date(p.capturedAt).toISOString() })) },
      label: `Survey #${s.surveyNumber} points — ${siteName}`,
    });
  }

  function onFix(pos: { latitude: number; longitude: number; accuracy: number }) {
    setCurrent({ lat: pos.latitude, lng: pos.longitude, accuracy: pos.accuracy });
    const last = pointsRef.current[pointsRef.current.length - 1];
    const now = Date.now();
    const candidate = { lat: pos.latitude, lng: pos.longitude, capturedAt: now };
    const capture = shouldCapturePoint({
      isFirstPoint: pointsRef.current.length === 0,
      lastPoint: last ? { lat: last.lat, lng: last.lng, capturedAt: last.capturedAt } : null,
      candidate,
    });
    if (!capture) return;

    let isOutlier = false;
    let outlierReason: string | undefined;
    if (pos.accuracy > MIN_ACCEPTABLE_ACCURACY_METERS) {
      isOutlier = true;
      outlierReason = "low_accuracy";
    } else if (last) {
      const jump = isGpsJump({ lat: last.lat, lng: last.lng, capturedAt: last.capturedAt }, candidate);
      if (jump.isJump) {
        isOutlier = true;
        outlierReason = "implausible_jump";
      }
    }

    const next = [...pointsRef.current, { lat: pos.latitude, lng: pos.longitude, accuracy: pos.accuracy, capturedAt: now, isOutlier, outlierReason }];
    pointsRef.current = next;
    setPoints(next);
    if (next.length - syncedCountRef.current >= FLUSH_EVERY_N_POINTS) void flush();
  }

  function beginWatch() {
    setMessage(null);
    const stop = watchPosition(
      onFix,
      (err) => setMessage({ tone: "error", text: err.message })
    );
    stopWatchRef.current = stop;
  }

  useEffect(() => {
    if (phase === "capturing") beginWatch();
    const interval = setInterval(() => {
      if (phase === "capturing") void flush();
    }, FLUSH_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      stopWatchRef.current?.();
      stopWatchRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function handleStart() {
    setBusy(true);
    setMessage(null);
    try {
      const created = await startSurvey(siteId);
      setSurvey({ id: created.id, surveyNumber: created.surveyNumber });
      setPoints([]);
      pointsRef.current = [];
      syncedCountRef.current = 0;
      setPhase("capturing");
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't start the survey." });
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    if (!survey) return;
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    setBusy(true);
    try {
      await flush();
      await pauseSurvey(survey.id);
      setPhase("paused");
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't pause." });
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    if (!survey) return;
    setBusy(true);
    try {
      await resumeSurvey(survey.id);
      setPhase("capturing");
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't resume." });
    } finally {
      setBusy(false);
    }
  }

  async function handleFinish() {
    if (!survey) return;
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    setBusy(true);
    setMessage(null);
    try {
      await flush();
      const updated = await finishSurvey(survey.id);
      setReviewStats({ areaSqFt: updated.rawAreaSqFt, perimeterFt: updated.rawPerimeterFt, segments: (updated.rawSegments as { label: string; lengthFt: number }[]) ?? [], shapeType: updated.shapeType });
      setPhase("reviewing");
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't finish the survey." });
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (!survey) return;
    setBusy(true);
    try {
      await submitSurveyForReview(survey.id);
      setPhase("submitted");
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't submit for review." });
    } finally {
      setBusy(false);
    }
  }

  async function handleRedo() {
    if (!survey) return;
    setBusy(true);
    try {
      await redoSurveyDraft(survey.id);
      setSurvey(null);
      setPoints([]);
      pointsRef.current = [];
      syncedCountRef.current = 0;
      setReviewStats(null);
      setPhase("idle");
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't discard this draft." });
    } finally {
      setBusy(false);
    }
  }

  const liveStats = computeBoundaryStats(points.filter((p) => !p.isOutlier));
  const lowAccuracy = !!current && current.accuracy > MIN_ACCEPTABLE_ACCURACY_METERS;

  if (phase === "submitted") {
    return (
      <div className="card p-5 text-center">
        <Icon name="check-circle" className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
        <p className="font-medium">Survey #{survey?.surveyNumber} submitted for review.</p>
        <p className="mt-1 text-sm text-muted">An approver will confirm it or send it back for re-measurement.</p>
        <button className="btn btn-primary mt-4 w-full" onClick={() => router.push(`/sites/${siteId}`)}>
          Back to site
        </button>
      </div>
    );
  }

  if (phase === "reviewing") {
    return (
      <div className="space-y-4">
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Survey #{survey?.surveyNumber} — review before submitting</h3>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <div className="text-xs text-muted">Area</div>
              <div className="text-lg font-semibold">{reviewStats?.areaSqFt?.toLocaleString() ?? "—"} sq ft</div>
            </div>
            <div>
              <div className="text-xs text-muted">Perimeter</div>
              <div className="text-lg font-semibold">{reviewStats?.perimeterFt?.toLocaleString() ?? "—"} ft</div>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-muted">Shape: {reviewStats?.shapeType ?? "irregular"}</p>
          {!!reviewStats?.segments?.length && (
            <ul className="mt-3 space-y-1 text-xs text-muted">
              {reviewStats.segments.map((s, i) => (
                <li key={i}>Segment {i + 1} ({s.label}): {s.lengthFt.toLocaleString()} ft</li>
              ))}
            </ul>
          )}
          <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">Approximate — not a legal survey.</p>
        </div>

        {message && <Message {...message} />}

        <div className="grid grid-cols-2 gap-2">
          <button className="btn btn-secondary" disabled={busy} onClick={handleRedo}>
            Redo
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={handleSubmit}>
            {busy ? "Submitting…" : "Confirm & submit"}
          </button>
        </div>
        <p className="text-center text-xs text-muted">Need to move a point instead of redoing the whole walk? You can adjust the boundary later from the survey&apos;s detail page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {phase === "idle" && (
        <div className="card p-4">
          <p className="mb-3 text-sm text-muted">
            Walk the full perimeter of the plot with your phone. Points are captured automatically as you move — you don&apos;t need to tap anything.
          </p>
          <button className="btn btn-accent w-full" disabled={busy} onClick={handleStart}>
            <Icon name="ruler" className="h-4 w-4" /> {busy ? "Starting…" : "Start survey"}
          </button>
        </div>
      )}

      {(phase === "capturing" || phase === "paused") && (
        <>
          <SurveyLiveMapClient points={points} current={current} />

          <div className="card p-4">
            <div className="flex items-center justify-between text-sm">
              <span>Points captured: <strong>{points.length}</strong> {points.some((p) => p.isOutlier) && <span className="text-red-600">({points.filter((p) => p.isOutlier).length} flagged)</span>}</span>
              {current && <span className="text-xs text-muted">±{Math.round(current.accuracy)}m</span>}
            </div>
            {points.filter((p) => !p.isOutlier).length >= 3 && (
              <div className="mt-2 flex justify-around text-center">
                <div>
                  <div className="text-xs text-muted">Area so far</div>
                  <div className="text-base font-semibold">{liveStats.areaSqFt?.toLocaleString()} sq ft</div>
                </div>
                <div>
                  <div className="text-xs text-muted">Perimeter so far</div>
                  <div className="text-base font-semibold">{liveStats.perimeterFt?.toLocaleString()} ft</div>
                </div>
              </div>
            )}
          </div>

          {lowAccuracy && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <Icon name="alert" className="mr-1 inline h-4 w-4" /> Low GPS accuracy (±{Math.round(current!.accuracy)}m). Move to open sky for a more precise boundary.
            </div>
          )}
          {message && <Message {...message} />}

          <div className="grid grid-cols-2 gap-2">
            {phase === "capturing" ? (
              <button className="btn btn-secondary" disabled={busy} onClick={handlePause}>
                Pause
              </button>
            ) : (
              <button className="btn btn-secondary" disabled={busy} onClick={handleResume}>
                Resume
              </button>
            )}
            <button className="btn btn-primary" disabled={busy || points.filter((p) => !p.isOutlier).length < 3} onClick={handleFinish}>
              {busy ? "Finishing…" : "Finish"}
            </button>
          </div>
          <p className="text-center text-xs text-muted">Walk at least 3 usable points before finishing.</p>
        </>
      )}
    </div>
  );
}

function Message({ tone, text }: { tone: "error" | "info" | "success"; text: string }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-sm ${tone === "error" ? "bg-red-50 text-red-700" : tone === "success" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
      {text}
    </div>
  );
}
