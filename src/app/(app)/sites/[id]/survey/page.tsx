import { notFound, redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { sites, plotSurveys, surveyPoints, surveyPauses } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { SurveyCapture } from "./survey-capture";

export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.permissions.includes(PERMISSIONS.SURVEY_CREATE)) redirect(`/sites/${id}`);

  const site = await db.query.sites.findFirst({ where: eq(sites.id, id) });
  if (!site) notFound();

  // Resume a draft this person already started (never lost on navigation/reload) — a survey still
  // "in_progress" with no endedAt is either mid-walk or awaiting self-review after Finish.
  const draft = await db.query.plotSurveys.findFirst({
    where: and(eq(plotSurveys.siteId, id), eq(plotSurveys.capturedBy, user.id), eq(plotSurveys.status, "in_progress")),
    orderBy: (s, { desc }) => desc(s.createdAt),
  });
  const draftPoints = draft
    ? await db.query.surveyPoints.findMany({ where: eq(surveyPoints.surveyId, draft.id), orderBy: surveyPoints.sequence })
    : [];
  const draftOpenPause = draft ? await db.query.surveyPauses.findFirst({ where: and(eq(surveyPauses.surveyId, draft.id), isNull(surveyPauses.resumedAt)) }) : null;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="Measure plot (GPS survey)" subtitle={site.name} />
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        This walks your phone&apos;s GPS around the plot to measure it. It is <strong>approximate — not a legal survey</strong>. It is separate from this site&apos;s attendance
        check-in radius; measuring the plot never changes where employees are allowed to check in.
      </p>
      <SurveyCapture
        siteId={id}
        siteName={site.name}
        existingSurvey={
          draft
            ? {
                id: draft.id,
                surveyNumber: draft.surveyNumber,
                startedAt: draft.startedAt.toISOString(),
                pausedSeconds: draft.pausedSeconds,
                endedAt: draft.endedAt ? draft.endedAt.toISOString() : null,
                rawAreaSqFt: draft.rawAreaSqFt,
                rawPerimeterFt: draft.rawPerimeterFt,
                rawSegments: draft.rawSegments,
                shapeType: draft.shapeType,
                pointCount: draft.pointCount,
                outlierCount: draft.outlierCount,
              }
            : null
        }
        existingPoints={draftPoints.map((p) => ({ lat: p.latitude, lng: p.longitude, isOutlier: p.isOutlier }))}
        wasPaused={!!draftOpenPause}
      />
    </div>
  );
}
