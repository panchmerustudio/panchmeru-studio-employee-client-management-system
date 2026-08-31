"use server";

/**
 * Mobile GPS plot measurement / boundary survey — server actions for the
 * full lifecycle: start -> (points captured live via /api/sites/survey/points)
 * -> pause/resume -> finish (auto-close + compute stats) -> employee
 * self-review (submit for review / redo) -> approver confirm/reject ->
 * (optionally) manual boundary correction at any later point.
 *
 * This is ADDITIVE alongside the existing simple tap-to-point boundary flow
 * (src/app/api/sites/boundary/route.ts, siteBoundaries table) — that flow is
 * left untouched. A plot survey is a separate, richer, permanently-retained
 * record (see src/db/schema/survey.ts for the full rationale).
 */

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { plotSurveys, surveyPauses, surveyPoints, surveyNotes, sites, siteVisits, users, roles, rolePermissions, notifications } from "@/db/schema";
import { requireUser, requirePermission, type CurrentUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { computeBoundaryStats, computeSegments, detectShape } from "@/lib/geo";
import { registerUploadedFile } from "@/lib/storage";
import { saveVoiceNote } from "@/lib/voice";

/** Everyone whose role currently grants `permissionKey` — the DB is the source of truth for RBAC, not a hardcoded role list (see rbac.ts header). */
async function usersWithPermission(permissionKey: string) {
  return db
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .innerJoin(rolePermissions, and(eq(rolePermissions.roleId, roles.id), eq(rolePermissions.permissionKey, permissionKey)));
}

function requireCapturedBy(actor: CurrentUser, survey: { capturedBy: string }) {
  if (survey.capturedBy !== actor.id) throw new Error("Only the person who started this survey can do that.");
}

export async function startSurvey(siteId: string) {
  const actor = await requirePermission(PERMISSIONS.SURVEY_CREATE);
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site) throw new Error("Site not found.");

  const priorSurveys = await db.query.plotSurveys.findMany({ where: eq(plotSurveys.siteId, siteId) });
  const surveyNumber = priorSurveys.length + 1;

  // Auto-link to an active site visit, if the surveyor is currently checked in here (section 44/45) — never asked for manually.
  const activeVisit = actor.employeeId
    ? await db.query.siteVisits.findFirst({
        where: and(eq(siteVisits.siteId, siteId), eq(siteVisits.employeeId, actor.employeeId), eq(siteVisits.status, "active")),
        orderBy: desc(siteVisits.startedAt),
      })
    : undefined;

  // Auto-wire the supersede chain: if this site already has a confirmed survey, this new one is presumed to be a re-measurement of it. It only actually supersedes anything once THIS survey is confirmed (see confirmSurvey below) — starting one doesn't retire the old survey.
  const currentConfirmed = priorSurveys
    .filter((s) => s.status === "confirmed")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const [survey] = await db
    .insert(plotSurveys)
    .values({
      siteId,
      siteVisitId: activeVisit?.id,
      surveyNumber,
      status: "in_progress",
      startedAt: new Date(),
      capturedBy: actor.id,
      supersedesId: currentConfirmed?.id,
    })
    .returning();

  await recordAudit({ actor, action: "survey.started", entityType: "plot_survey", entityId: survey.id, newState: { siteId, surveyNumber } });
  revalidatePath(`/sites/${siteId}`);
  return survey;
}

export async function pauseSurvey(surveyId: string) {
  const actor = await requireUser();
  const survey = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, surveyId) });
  if (!survey) throw new Error("Survey not found.");
  requireCapturedBy(actor, survey);
  if (survey.status !== "in_progress" || survey.endedAt) throw new Error("This survey isn't currently in progress.");

  const openPause = await db.query.surveyPauses.findFirst({ where: and(eq(surveyPauses.surveyId, surveyId), isNull(surveyPauses.resumedAt)) });
  if (openPause) return; // already paused — nothing to do

  await db.insert(surveyPauses).values({ surveyId, pausedAt: new Date() });
  await recordAudit({ actor, action: "survey.paused", entityType: "plot_survey", entityId: surveyId });
}

export async function resumeSurvey(surveyId: string) {
  const actor = await requireUser();
  const survey = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, surveyId) });
  if (!survey) throw new Error("Survey not found.");
  requireCapturedBy(actor, survey);

  const openPause = await db.query.surveyPauses.findFirst({
    where: and(eq(surveyPauses.surveyId, surveyId), isNull(surveyPauses.resumedAt)),
    orderBy: desc(surveyPauses.pausedAt),
  });
  if (!openPause) return; // wasn't paused — nothing to do

  const now = new Date();
  const elapsedSeconds = Math.round((now.getTime() - new Date(openPause.pausedAt).getTime()) / 1000);
  await db.update(surveyPauses).set({ resumedAt: now }).where(eq(surveyPauses.id, openPause.id));
  await db.update(plotSurveys).set({ pausedSeconds: survey.pausedSeconds + elapsedSeconds }).where(eq(plotSurveys.id, surveyId));
  await recordAudit({ actor, action: "survey.resumed", entityType: "plot_survey", entityId: surveyId });
}

/** Auto-close the walked polygon and compute stats. Leaves status "in_progress" (endedAt now set) — the survey enters employee self-review; nothing is submitted to an approver until submitSurveyForReview(). */
export async function finishSurvey(surveyId: string) {
  const actor = await requireUser();
  const survey = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, surveyId) });
  if (!survey) throw new Error("Survey not found.");
  requireCapturedBy(actor, survey);
  if (survey.status !== "in_progress") throw new Error("This survey has already been finished.");

  const allPoints = await db.query.surveyPoints.findMany({ where: eq(surveyPoints.surveyId, surveyId), orderBy: surveyPoints.sequence });
  const usablePoints = allPoints.filter((p) => !p.isOutlier).map((p) => ({ lat: p.latitude, lng: p.longitude }));
  if (usablePoints.length < 3) throw new Error("Walk at least 3 usable points around the boundary before finishing.");

  const stats = computeBoundaryStats(usablePoints);
  const segments = computeSegments(usablePoints);
  const shapeType = detectShape(usablePoints);
  const accuracies = allPoints.map((p) => p.accuracy).filter((a): a is number => a != null);
  const avgAccuracyM = accuracies.length > 0 ? Math.round((accuracies.reduce((a, b) => a + b, 0) / accuracies.length) * 10) / 10 : null;

  const [updated] = await db
    .update(plotSurveys)
    .set({
      endedAt: new Date(),
      rawPoints: usablePoints,
      rawAreaSqFt: stats.areaSqFt ?? undefined,
      rawPerimeterFt: stats.perimeterFt ?? undefined,
      rawSegments: segments,
      shapeType,
      avgAccuracyM: avgAccuracyM ?? undefined,
      pointCount: allPoints.length,
      outlierCount: allPoints.filter((p) => p.isOutlier).length,
    })
    .where(eq(plotSurveys.id, surveyId))
    .returning();

  await recordAudit({ actor, action: "survey.finished", entityType: "plot_survey", entityId: surveyId, newState: { areaSqFt: stats.areaSqFt, perimeterFt: stats.perimeterFt, shapeType } });
  revalidatePath(`/sites/${survey.siteId}`);
  return updated;
}

/** Employee taps "Confirm" during self-review — actually submits the finished survey to an approver. */
export async function submitSurveyForReview(surveyId: string) {
  const actor = await requireUser();
  const survey = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, surveyId) });
  if (!survey) throw new Error("Survey not found.");
  requireCapturedBy(actor, survey);
  if (survey.status !== "in_progress" || !survey.endedAt) throw new Error("Finish measuring before submitting this survey.");

  await db.update(plotSurveys).set({ status: "needs_review" }).where(eq(plotSurveys.id, surveyId));

  const approvers = await usersWithPermission(PERMISSIONS.SURVEY_APPROVE);
  const site = await db.query.sites.findFirst({ where: eq(sites.id, survey.siteId) });
  if (approvers.length > 0) {
    await db.insert(notifications).values(
      approvers.map((a) => ({
        recipientId: a.id,
        type: "plot_survey",
        title: "Plot survey ready for review",
        message: `${actor.name} finished a boundary survey (#${survey.surveyNumber}) at ${site?.name ?? "a site"} — ${survey.rawAreaSqFt ? `${survey.rawAreaSqFt.toLocaleString()} sq ft` : "review pending"}.`,
        relatedEntityType: "plot_survey",
        relatedEntityId: surveyId,
      }))
    );
  }

  await recordAudit({ actor, action: "survey.submitted", entityType: "plot_survey", entityId: surveyId });
  revalidatePath(`/sites/${survey.siteId}`);
}

/** Employee taps "Redo" during self-review — discards this draft (never deleted, just marked cancelled) so they can start a fresh walk. */
export async function redoSurveyDraft(surveyId: string) {
  const actor = await requireUser();
  const survey = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, surveyId) });
  if (!survey) throw new Error("Survey not found.");
  requireCapturedBy(actor, survey);
  if (survey.status !== "in_progress") throw new Error("This survey can no longer be discarded — it has already been submitted.");

  await db.update(plotSurveys).set({ status: "cancelled" }).where(eq(plotSurveys.id, surveyId));
  await recordAudit({ actor, action: "survey.discarded", entityType: "plot_survey", entityId: surveyId });
  revalidatePath(`/sites/${survey.siteId}`);
}

/** Manual boundary correction (section 22-24) — writes only the adjusted* columns, raw* stays untouched forever. */
export async function adjustSurveyBoundary(surveyId: string, adjustedPoints: { lat: number; lng: number }[], reason: string) {
  const actor = await requirePermission(PERMISSIONS.SURVEY_EDIT);
  const survey = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, surveyId) });
  if (!survey) throw new Error("Survey not found.");
  if (survey.status === "superseded" || survey.status === "cancelled") throw new Error(`This survey is ${survey.status} — nothing to adjust.`);
  if (adjustedPoints.length < 3) throw new Error("A boundary needs at least 3 points.");
  if (!reason.trim()) throw new Error("Explain why you're adjusting this boundary — it's kept in the audit trail.");

  const stats = computeBoundaryStats(adjustedPoints);
  const segments = computeSegments(adjustedPoints);
  const shapeType = detectShape(adjustedPoints);

  await db
    .update(plotSurveys)
    .set({
      isAdjusted: true,
      adjustedPoints,
      adjustedAreaSqFt: stats.areaSqFt ?? undefined,
      adjustedPerimeterFt: stats.perimeterFt ?? undefined,
      adjustedSegments: segments,
      shapeType,
      adjustedBy: actor.id,
      adjustedAt: new Date(),
      adjustmentReason: reason.trim(),
    })
    .where(eq(plotSurveys.id, surveyId));

  await recordAudit({
    actor,
    action: "survey.adjusted",
    entityType: "plot_survey",
    entityId: surveyId,
    previousState: { rawAreaSqFt: survey.rawAreaSqFt, rawPerimeterFt: survey.rawPerimeterFt },
    newState: { adjustedAreaSqFt: stats.areaSqFt, adjustedPerimeterFt: stats.perimeterFt, reason: reason.trim() },
  });
  revalidatePath(`/sites/${survey.siteId}`);
  revalidatePath(`/surveys/${surveyId}`);
}

/** Text/voice/photo/document notes on a survey — same shape and upload flow as task comments. */
export async function addSurveyNote(surveyId: string, formData: FormData) {
  const actor = await requireUser();
  const survey = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, surveyId) });
  if (!survey) throw new Error("Survey not found.");

  const type = String(formData.get("type") || "text") as "text" | "voice" | "photo" | "document";
  const text = formData.get("text") as string | null;
  const fileKey = formData.get("fileKey") as string | null;
  const fileMimeType = formData.get("fileMimeType") as string | null;
  const fileOriginalName = formData.get("fileOriginalName") as string | null;
  const voiceFile = formData.get("voice") as File | null;
  const transcript = formData.get("transcript") as string | null;
  const durationRaw = formData.get("duration") as string | null;

  let fileId: string | undefined;
  let voiceNoteId: string | undefined;

  if (type === "voice" && voiceFile && voiceFile.size > 0) {
    const note = await saveVoiceNote({ file: voiceFile, transcript, durationSeconds: durationRaw ? Number(durationRaw) : null, recordedBy: actor.id });
    voiceNoteId = note.id;
  } else if ((type === "photo" || type === "document") && fileKey && fileMimeType && fileOriginalName) {
    const saved = await registerUploadedFile({
      key: fileKey,
      originalName: fileOriginalName,
      mimeType: fileMimeType,
      kind: type === "photo" ? "photo" : "document",
      uploadedBy: actor.id,
      relatedEntityType: "plot_survey",
      relatedEntityId: surveyId,
    });
    fileId = saved.id;
  } else if (type === "text" && !text?.trim()) {
    throw new Error("Write a note first.");
  }

  await db.insert(surveyNotes).values({ surveyId, authorId: actor.id, type, text_: text || null, fileId, voiceNoteId });
  await recordAudit({ actor, action: "survey.note_added", entityType: "plot_survey", entityId: surveyId, newState: { type } });
  revalidatePath(`/surveys/${surveyId}`);
}

export async function confirmSurvey(surveyId: string, note?: string) {
  const actor = await requirePermission(PERMISSIONS.SURVEY_APPROVE);
  const survey = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, surveyId) });
  if (!survey) throw new Error("Survey not found.");
  if (survey.status !== "needs_review") throw new Error(`This survey is ${survey.status} — nothing to review.`);

  await db.update(plotSurveys).set({ status: "confirmed", reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note || null }).where(eq(plotSurveys.id, surveyId));

  if (survey.supersedesId) {
    const previous = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, survey.supersedesId) });
    if (previous && previous.status === "confirmed") {
      await db
        .update(plotSurveys)
        .set({ status: "superseded", supersededReason: `Replaced by survey #${survey.surveyNumber}, confirmed ${new Date().toLocaleDateString("en-IN")}.` })
        .where(eq(plotSurveys.id, previous.id));
    }
  }

  await db.insert(notifications).values({
    recipientId: survey.capturedBy,
    type: "plot_survey",
    title: "Survey confirmed",
    message: `Your boundary survey #${survey.surveyNumber} was confirmed${note ? `: ${note}` : "."}`,
    relatedEntityType: "plot_survey",
    relatedEntityId: surveyId,
  });

  await recordAudit({ actor, action: "survey.confirmed", entityType: "plot_survey", entityId: surveyId, newState: { note } });
  revalidatePath(`/sites/${survey.siteId}`);
  revalidatePath(`/surveys/${surveyId}`);
}

export async function rejectSurvey(surveyId: string, note: string) {
  const actor = await requirePermission(PERMISSIONS.SURVEY_APPROVE);
  if (!note.trim()) throw new Error("Explain why this survey needs to be re-measured.");
  const survey = await db.query.plotSurveys.findFirst({ where: eq(plotSurveys.id, surveyId) });
  if (!survey) throw new Error("Survey not found.");
  if (survey.status !== "needs_review") throw new Error(`This survey is ${survey.status} — nothing to review.`);

  await db.update(plotSurveys).set({ status: "rejected", reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note.trim() }).where(eq(plotSurveys.id, surveyId));

  await db.insert(notifications).values({
    recipientId: survey.capturedBy,
    type: "plot_survey",
    title: "Survey needs re-measurement",
    message: `Your boundary survey #${survey.surveyNumber} was sent back: ${note.trim()}`,
    relatedEntityType: "plot_survey",
    relatedEntityId: surveyId,
  });

  await recordAudit({ actor, action: "survey.rejected", entityType: "plot_survey", entityId: surveyId, newState: { note: note.trim() } });
  revalidatePath(`/sites/${survey.siteId}`);
  revalidatePath(`/surveys/${surveyId}`);
}
