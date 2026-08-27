import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { plotSurveys, surveyPoints } from "@/db/schema";
import { isGpsJump, MIN_ACCEPTABLE_ACCURACY_METERS } from "@/lib/geo";

/**
 * Live boundary-walk point sync — called repeatedly (batched, not per-tick)
 * while a survey is in progress, and offline-queue compatible (see
 * src/lib/offline-queue.ts): construction sites have poor connectivity, and
 * the raw GPS log must never be silently lost. The client already applies
 * shouldCapturePoint()/isGpsJump() for live UI feedback (accuracy warnings,
 * the growing map polyline) — this endpoint re-checks isGpsJump server-side
 * against the last *stored* point as a safety net (a client could be
 * offline for a while and batch-submit points whose ordering/gaps it can't
 * fully judge on its own) and flags low-accuracy fixes too. Flagged points
 * are still stored — never dropped — just excluded from the boundary ring
 * at finish time (see finishSurvey in the survey actions file).
 */

const schema = z.object({
  surveyId: z.string(),
  points: z
    .array(
      z.object({
        lat: z.number(),
        lng: z.number(),
        accuracy: z.number().optional(),
        capturedAt: z.string(), // ISO timestamp, assigned client-side at capture time
      })
    )
    .min(1),
});

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const { surveyId, points } = parsed.data;

  const survey = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, surveyId) });
  if (!survey) return NextResponse.json({ error: "Survey not found." }, { status: 404 });
  if (survey.capturedBy !== user.id) return NextResponse.json({ error: "Only the person who started this survey can add points to it." }, { status: 403 });
  if (survey.status !== "in_progress" || survey.endedAt) return NextResponse.json({ error: "This survey is no longer accepting points." }, { status: 409 });

  const lastStored = await db.query.surveyPoints.findFirst({ where: eq(surveyPoints.surveyId, surveyId), orderBy: desc(surveyPoints.sequence) });
  let sequence = lastStored?.sequence ?? -1;
  let prev = lastStored ? { lat: lastStored.latitude, lng: lastStored.longitude, capturedAt: new Date(lastStored.capturedAt).getTime() } : null;

  const rows = points
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
    .map((p) => {
      sequence += 1;
      const capturedAtMs = new Date(p.capturedAt).getTime();
      let isOutlier = false;
      let outlierReason: string | null = null;

      if (p.accuracy != null && p.accuracy > MIN_ACCEPTABLE_ACCURACY_METERS) {
        isOutlier = true;
        outlierReason = "low_accuracy";
      } else if (prev) {
        const jump = isGpsJump(prev, { lat: p.lat, lng: p.lng, capturedAt: capturedAtMs });
        if (jump.isJump) {
          isOutlier = true;
          outlierReason = "implausible_jump";
        }
      }

      prev = { lat: p.lat, lng: p.lng, capturedAt: capturedAtMs };
      return {
        surveyId,
        sequence,
        latitude: p.lat,
        longitude: p.lng,
        accuracy: p.accuracy ?? null,
        capturedAt: new Date(p.capturedAt),
        isOutlier,
        outlierReason,
      };
    });

  await db.insert(surveyPoints).values(rows);

  const agg = await db.query.surveyPoints.findMany({ where: eq(surveyPoints.surveyId, surveyId) });
  const pointCount = agg.length;
  const outlierCount = agg.filter((p) => p.isOutlier).length;
  await db.update(plotSurveys).set({ pointCount, outlierCount }).where(eq(plotSurveys.id, surveyId));

  return NextResponse.json({ ok: true, inserted: rows.length, pointCount, outlierCount, outliersInBatch: rows.filter((r) => r.isOutlier).length });
}
