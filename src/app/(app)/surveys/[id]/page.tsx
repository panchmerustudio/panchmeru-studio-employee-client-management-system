import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { plotSurveys, sites, users, surveyPoints, surveyNotes, siteVisits, voiceNotes, files as filesTable } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { formatDateTime, timeAgo } from "@/lib/format";
import { ReviewForm } from "./review-form";
import { AdjustBoundaryForm } from "./adjust-boundary-form";
import { SurveyCommentBox } from "./survey-comment-box";

export default async function SurveyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const survey = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, id) });
  if (!survey) notFound();

  const canViewAll = user.permissions.includes(PERMISSIONS.SURVEY_APPROVE) || user.permissions.includes(PERMISSIONS.SITE_MANAGE) || user.permissions.includes(PERMISSIONS.SITE_VIEW_ALL);
  if (!canViewAll && survey.capturedBy !== user.id) redirect("/surveys");

  const canApprove = user.permissions.includes(PERMISSIONS.SURVEY_APPROVE);
  const canEdit = user.permissions.includes(PERMISSIONS.SURVEY_EDIT);

  const site = await db.query.sites.findFirst({ where: eq(sites.id, survey.siteId) });
  const surveyor = await db.query.users.findFirst({ where: eq(users.id, survey.capturedBy) });
  const reviewer = survey.reviewedBy ? await db.query.users.findFirst({ where: eq(users.id, survey.reviewedBy) }) : null;
  const adjuster = survey.adjustedBy ? await db.query.users.findFirst({ where: eq(users.id, survey.adjustedBy) }) : null;
  const supersedes = survey.supersedesId ? await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, survey.supersedesId) }) : null;
  const supersededBy = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.supersedesId, survey.id) });
  const visit = survey.siteVisitId ? await db.query.siteVisits.findFirst({ where: eq(siteVisits.id, survey.siteVisitId) }) : null;
  const allPoints = await db.query.surveyPoints.findMany({ where: eq(surveyPoints.surveyId, id), orderBy: surveyPoints.sequence });

  const notes = await db.select().from(surveyNotes).where(eq(surveyNotes.surveyId, id)).orderBy(asc(surveyNotes.createdAt));
  const noteAuthors = await Promise.all(notes.map((n) => db.query.users.findFirst({ where: eq(users.id, n.authorId) })));
  const noteVoiceNotes = await Promise.all(notes.map((n) => (n.voiceNoteId ? db.query.voiceNotes.findFirst({ where: eq(voiceNotes.id, n.voiceNoteId) }) : null)));
  const noteFiles = await Promise.all(notes.map((n) => (n.fileId ? db.query.files.findFirst({ where: eq(filesTable.id, n.fileId) }) : null)));

  const activePoints = (survey.isAdjusted ? survey.adjustedPoints : survey.rawPoints) ?? [];
  const activeArea = survey.isAdjusted ? survey.adjustedAreaSqFt : survey.rawAreaSqFt;
  const activePerimeter = survey.isAdjusted ? survey.adjustedPerimeterFt : survey.rawPerimeterFt;
  const activeSegments = (survey.isAdjusted ? survey.adjustedSegments : survey.rawSegments) ?? [];
  const startPoint = activePoints[0];
  const endPoint = activePoints[activePoints.length - 1];

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${site?.name ?? "Site"} — Survey #${survey.surveyNumber}`}
        subtitle={`Captured by ${surveyor?.name ?? "—"} · ${formatDateTime(survey.startedAt)}`}
        action={
          <div className="flex items-center gap-2">
            <Badge status={survey.status} />
            <Link href="/surveys" className="btn btn-secondary">
              <Icon name="arrow-left" className="h-4 w-4" /> Back
            </Link>
          </div>
        }
      />

      <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Approximate — a phone-GPS boundary walk, not a legal survey. This is the plot&apos;s physical boundary, separate from this site&apos;s attendance check-in radius (the geofence)
        — adjusting one never changes the other.
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <div className="space-y-5 md:col-span-2">
          <SectionCard title={survey.isAdjusted ? "Adjusted measurements" : "Measurements"}>
            <div className="mb-3 flex justify-around text-center">
              <div>
                <div className="text-xs text-muted">Area</div>
                <div className="text-lg font-semibold">{activeArea?.toLocaleString() ?? "—"} sq ft</div>
              </div>
              <div>
                <div className="text-xs text-muted">Perimeter</div>
                <div className="text-lg font-semibold">{activePerimeter?.toLocaleString() ?? "—"} ft</div>
              </div>
              <div>
                <div className="text-xs text-muted">Shape</div>
                <div className="text-lg font-semibold capitalize">{(survey.shapeType ?? "irregular").replace("_", " ")}</div>
              </div>
            </div>
            {activeSegments.length > 0 && (
              <ul className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
                {activeSegments.map((s, i) => (
                  <li key={i}>Segment {i + 1} ({s.label}): {s.lengthFt.toLocaleString()} ft</li>
                ))}
              </ul>
            )}
            {startPoint && endPoint && (
              <p className="text-xs text-muted">
                Start: {startPoint.lat.toFixed(6)}, {startPoint.lng.toFixed(6)} · End: {endPoint.lat.toFixed(6)}, {endPoint.lng.toFixed(6)}
              </p>
            )}
            {survey.isAdjusted && (
              <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
                Manually adjusted by {adjuster?.name ?? "—"} {timeAgo(survey.adjustedAt)}: &quot;{survey.adjustmentReason}&quot;.
                {survey.rawAreaSqFt != null && ` Original raw walk: ${survey.rawAreaSqFt.toLocaleString()} sq ft, ${survey.rawPerimeterFt?.toLocaleString()} ft — kept, never overwritten.`}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Capture details">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Points captured" value={String(survey.pointCount)} />
              <Info label="Flagged / outliers" value={String(survey.outlierCount)} />
              <Info label="Average accuracy" value={survey.avgAccuracyM != null ? `±${survey.avgAccuracyM}m` : "—"} />
              <Info label="Duration" value={survey.endedAt ? `${Math.round((new Date(survey.endedAt).getTime() - new Date(survey.startedAt).getTime()) / 60000)} min (${Math.round(survey.pausedSeconds / 60)} min paused)` : "In progress"} />
            </dl>
            {visit && (
              <p className="mt-3 text-xs text-muted">
                Captured during a site visit — see the <Link href={`/sites/${survey.siteId}`} className="text-accent hover:underline">visit timeline</Link>.
              </p>
            )}
            {survey.reviewNote && (
              <p className="mt-3 text-sm">
                <span className="text-xs text-muted">Review note from {reviewer?.name ?? "—"}:</span> {survey.reviewNote}
              </p>
            )}
            {supersedes && (
              <p className="mt-2 text-xs text-muted">
                Re-measurement of <Link href={`/surveys/${supersedes.id}`} className="text-accent hover:underline">survey #{supersedes.surveyNumber}</Link>.
              </p>
            )}
            {supersededBy && (
              <p className="mt-2 text-xs text-muted">
                Superseded by <Link href={`/surveys/${supersededBy.id}`} className="text-accent hover:underline">survey #{supersededBy.surveyNumber}</Link>.
              </p>
            )}
          </SectionCard>

          <SectionCard
            title="Raw GPS coordinate log"
            action={
              <a href={`/api/surveys/${survey.id}/csv`} className="text-xs font-medium text-accent">
                Export CSV
              </a>
            }
          >
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white text-muted">
                  <tr>
                    <th className="py-1 pr-2">#</th>
                    <th className="py-1 pr-2">Latitude</th>
                    <th className="py-1 pr-2">Longitude</th>
                    <th className="py-1 pr-2">Accuracy</th>
                    <th className="py-1">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {allPoints.map((p) => (
                    <tr key={p.id} className={p.isOutlier ? "text-red-600" : ""}>
                      <td className="py-0.5 pr-2">{p.sequence + 1}</td>
                      <td className="py-0.5 pr-2">{p.latitude.toFixed(6)}</td>
                      <td className="py-0.5 pr-2">{p.longitude.toFixed(6)}</td>
                      <td className="py-0.5 pr-2">{p.accuracy != null ? `±${Math.round(p.accuracy)}m` : "—"}</td>
                      <td className="py-0.5">{p.isOutlier ? p.outlierReason?.replace("_", " ") : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {canEdit && survey.status !== "superseded" && survey.status !== "cancelled" && activePoints.length >= 3 && (
            <SectionCard title="Manually correct boundary">
              <AdjustBoundaryForm surveyId={survey.id} initialPoints={activePoints} rawPoints={survey.rawPoints ?? []} />
            </SectionCard>
          )}

          <SectionCard title="Notes">
            {notes.length === 0 ? (
              <p className="mb-3 text-sm text-muted">No notes yet.</p>
            ) : (
              <div className="mb-4 space-y-3">
                {notes.map((n, i) => (
                  <div key={n.id} className="flex gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold">
                      {noteAuthors[i]?.name?.[0] ?? "?"}
                    </div>
                    <div className="flex-1 rounded-lg bg-background px-3 py-2">
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className="text-xs font-semibold">{noteAuthors[i]?.name}</span>
                        <span className="text-[10px] text-muted">{timeAgo(n.createdAt)}</span>
                      </div>
                      {n.type === "text" && <p className="text-sm">{n.text_}</p>}
                      {n.type === "photo" && noteFiles[i] && (
                        <a href={`/api/files/${n.fileId}`} target="_blank" rel="noreferrer">
                          <img src={`/api/files/${n.fileId}`} alt="attachment" className="mt-1 max-h-48 rounded-lg border border-border" />
                        </a>
                      )}
                      {n.type === "document" && noteFiles[i] && (
                        <a href={`/api/files/${n.fileId}`} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1.5 text-sm font-medium text-accent">
                          <Icon name="file" className="h-4 w-4" /> {noteFiles[i]?.originalName}
                        </a>
                      )}
                      {n.type === "voice" && noteVoiceNotes[i] && (
                        <div className="mt-1">
                          <audio controls src={`/api/files/${noteVoiceNotes[i]?.audioFileId}`} className="h-9 w-full max-w-xs" />
                          {noteVoiceNotes[i]?.transcript && <p className="mt-1 text-xs italic text-muted">&quot;{noteVoiceNotes[i]?.transcript}&quot;</p>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <SurveyCommentBox surveyId={survey.id} />
          </SectionCard>
        </div>

        <div className="space-y-5">
          {canApprove && survey.status === "needs_review" && <ReviewForm surveyId={survey.id} />}
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}
