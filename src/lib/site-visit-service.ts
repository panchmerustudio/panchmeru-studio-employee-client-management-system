import "server-only";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { siteVisits, siteLocationPoints, siteReports, sites } from "@/db/schema";
import { recordAttendanceEvent, AttendanceError } from "./attendance-service";
import { recordAudit } from "./audit";
import type { CurrentUser } from "./auth";

export { AttendanceError as SiteVisitError };

export async function startSiteVisit(opts: {
  actor: CurrentUser;
  employeeId: string;
  siteId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  address?: string | null;
  authMethod: "password_session" | "webauthn";
  clientEventId: string;
}) {
  const existingActive = await db.query.siteVisits.findFirst({
    where: and(eq(siteVisits.employeeId, opts.employeeId), eq(siteVisits.status, "active")),
  });
  if (existingActive) {
    throw new AttendanceError("You already have an active site visit. Check out of it first.");
  }

  const site = await db.query.sites.findFirst({ where: eq(sites.id, opts.siteId) });
  if (!site) throw new AttendanceError("Site not found.");

  const [visit] = await db
    .insert(siteVisits)
    .values({ siteId: opts.siteId, employeeId: opts.employeeId, startedAt: new Date(), status: "active" })
    .returning();

  try {
    const event = await recordAttendanceEvent({
      actor: opts.actor,
      employeeId: opts.employeeId,
      type: "check_in",
      source: "site",
      latitude: opts.latitude,
      longitude: opts.longitude,
      accuracy: opts.accuracy,
      address: opts.address,
      authMethod: opts.authMethod,
      clientEventId: opts.clientEventId,
      capturedAtClient: Date.now(),
      siteVisitId: visit.id,
      geofenceIdOverride: site.geofenceId,
    });
    await db.update(siteVisits).set({ checkInEventId: event.id }).where(eq(siteVisits.id, visit.id));
  } catch (err) {
    // roll back the visit row if the geofence/accuracy check failed
    await db.delete(siteVisits).where(eq(siteVisits.id, visit.id));
    throw err;
  }

  await recordAudit({ actor: opts.actor, action: "site_visit.started", entityType: "site_visit", entityId: visit.id, newState: { siteId: opts.siteId } });
  return visit;
}

export async function trackSiteVisitPoint(opts: { siteVisitId: string; latitude: number; longitude: number; accuracy: number }) {
  const visit = await db.query.siteVisits.findFirst({ where: eq(siteVisits.id, opts.siteVisitId) });
  if (!visit || visit.status !== "active") return null; // visit ended — stop silently, tracking has no effect post-checkout
  const [point] = await db
    .insert(siteLocationPoints)
    .values({ siteVisitId: opts.siteVisitId, latitude: opts.latitude, longitude: opts.longitude, accuracy: opts.accuracy, recordedAt: new Date() })
    .returning();
  return point;
}

export async function checkoutSiteVisit(opts: {
  actor: CurrentUser;
  employeeId: string;
  siteVisitId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  address?: string | null;
  authMethod: "password_session" | "webauthn";
  clientEventId: string;
  report: {
    workCompleted?: string;
    discussion?: string;
    issues?: string;
    materialRequirement?: string;
    nextAction?: string;
    voiceNoteId?: string;
  };
}) {
  const visit = await db.query.siteVisits.findFirst({ where: eq(siteVisits.id, opts.siteVisitId) });
  if (!visit) throw new AttendanceError("Site visit not found.");
  if (visit.status !== "active") throw new AttendanceError("This site visit has already been checked out.");

  const site = await db.query.sites.findFirst({ where: eq(sites.id, visit.siteId) });

  const event = await recordAttendanceEvent({
    actor: opts.actor,
    employeeId: opts.employeeId,
    type: "check_out",
    source: "site",
    latitude: opts.latitude,
    longitude: opts.longitude,
    accuracy: opts.accuracy,
    address: opts.address,
    authMethod: opts.authMethod,
    clientEventId: opts.clientEventId,
    capturedAtClient: Date.now(),
    siteVisitId: opts.siteVisitId,
    geofenceIdOverride: site?.geofenceId,
  });

  await db.update(siteVisits).set({ status: "completed", endedAt: new Date(), checkOutEventId: event.id }).where(eq(siteVisits.id, opts.siteVisitId));

  const [report] = await db
    .insert(siteReports)
    .values({
      siteVisitId: opts.siteVisitId,
      siteId: visit.siteId,
      workCompleted: opts.report.workCompleted || null,
      discussion: opts.report.discussion || null,
      issues: opts.report.issues || null,
      materialRequirement: opts.report.materialRequirement || null,
      nextAction: opts.report.nextAction || null,
      voiceNoteId: opts.report.voiceNoteId || null,
      createdBy: opts.actor.id,
    })
    .returning();

  await recordAudit({ actor: opts.actor, action: "site_visit.completed", entityType: "site_visit", entityId: opts.siteVisitId, newState: { reportId: report.id } });
  return { report, visit };
}
