import "server-only";
import { eq, and, desc, gte, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { siteVisits, siteLocationPoints, sites, employees, users, attendanceEvents, locationSettings, locationExceptionReviews, geofences } from "@/db/schema";

/**
 * Turns data the app already collects for other reasons into a live
 * whereabouts picture — no new "always tracking" table (section 26/36:
 * NOT 24/7 surveillance). Two sources, both foreground/event-scoped:
 *  - siteLocationPoints: GPS pings only while a site visit is ACTIVE
 *    (45s polling, stops the instant checkout happens — see ActiveVisit).
 *  - attendanceEvents: one lat/lng point captured at each office/site
 *    check-in and check-out (always existed, just never surfaced here).
 */

const LIVE_WINDOW_MS = 150_000; // ~3 missed 45s pings and we call it stale, not live
const RECENT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export type LiveLocation = {
  employeeId: string;
  employeeName: string;
  siteVisitId: string;
  siteId: string;
  siteName: string;
  latitude: number;
  longitude: number;
  lastUpdatedAt: Date;
  status: "live" | "stale"; // "stale" = visit still active but no recent ping (GPS gap, not an accusation)
};

/** Employees on an ACTIVE site visit right now, with their most recent GPS ping. */
export async function getActiveSiteVisitLocations(): Promise<LiveLocation[]> {
  const active = await db
    .select({
      siteVisitId: siteVisits.id,
      employeeId: employees.id,
      employeeName: users.name,
      siteId: sites.id,
      siteName: sites.name,
    })
    .from(siteVisits)
    .innerJoin(employees, eq(employees.id, siteVisits.employeeId))
    .innerJoin(users, eq(users.id, employees.userId))
    .innerJoin(sites, eq(sites.id, siteVisits.siteId))
    .where(eq(siteVisits.status, "active"));

  const results: LiveLocation[] = [];
  for (const v of active) {
    const lastPoint = await db.query.siteLocationPoints.findFirst({
      where: eq(siteLocationPoints.siteVisitId, v.siteVisitId),
      orderBy: desc(siteLocationPoints.recordedAt),
    });
    if (!lastPoint) continue; // just started, no ping yet — don't show a marker with no coordinates
    const status: "live" | "stale" = Date.now() - lastPoint.recordedAt.getTime() < LIVE_WINDOW_MS ? "live" : "stale";
    results.push({ ...v, latitude: lastPoint.latitude, longitude: lastPoint.longitude, lastUpdatedAt: lastPoint.recordedAt, status });
  }
  return results;
}

export type RecentLocation = {
  employeeId: string;
  employeeName: string;
  siteId: string | null;
  siteName: string | null;
  latitude: number;
  longitude: number;
  lastUpdatedAt: Date;
  context: "site_visit_ended" | "office";
};

/**
 * Employees NOT currently on an active visit but who had activity in the
 * last 30 minutes — a completed site visit's last ping, or an office
 * check-in/out today. The "RECENT" bucket (section 40).
 */
export async function getRecentLocations(excludeEmployeeIds: Set<string>): Promise<RecentLocation[]> {
  const since = new Date(Date.now() - RECENT_WINDOW_MS);
  const results: RecentLocation[] = [];

  const recentlyEnded = await db
    .select({
      siteVisitId: siteVisits.id,
      employeeId: employees.id,
      employeeName: users.name,
      siteId: sites.id,
      siteName: sites.name,
      endedAt: siteVisits.endedAt,
    })
    .from(siteVisits)
    .innerJoin(employees, eq(employees.id, siteVisits.employeeId))
    .innerJoin(users, eq(users.id, employees.userId))
    .innerJoin(sites, eq(sites.id, siteVisits.siteId))
    .where(and(eq(siteVisits.status, "completed"), gte(siteVisits.endedAt, since)));

  for (const v of recentlyEnded) {
    if (excludeEmployeeIds.has(v.employeeId)) continue;
    const lastPoint = await db.query.siteLocationPoints.findFirst({ where: eq(siteLocationPoints.siteVisitId, v.siteVisitId), orderBy: desc(siteLocationPoints.recordedAt) });
    if (!lastPoint || !v.endedAt) continue;
    results.push({ employeeId: v.employeeId, employeeName: v.employeeName, siteId: v.siteId, siteName: v.siteName, latitude: lastPoint.latitude, longitude: lastPoint.longitude, lastUpdatedAt: v.endedAt, context: "site_visit_ended" });
    excludeEmployeeIds.add(v.employeeId);
  }

  const recentOfficeEvents = await db
    .select({
      employeeId: employees.id,
      employeeName: users.name,
      latitude: attendanceEvents.latitude,
      longitude: attendanceEvents.longitude,
      capturedAtClient: attendanceEvents.capturedAtClient,
    })
    .from(attendanceEvents)
    .innerJoin(employees, eq(employees.id, attendanceEvents.employeeId))
    .innerJoin(users, eq(users.id, employees.userId))
    .where(and(eq(attendanceEvents.source, "office"), gte(attendanceEvents.capturedAtClient, since)))
    .orderBy(desc(attendanceEvents.capturedAtClient));

  const seenOffice = new Set<string>();
  for (const e of recentOfficeEvents) {
    if (excludeEmployeeIds.has(e.employeeId) || seenOffice.has(e.employeeId)) continue;
    seenOffice.add(e.employeeId);
    results.push({ employeeId: e.employeeId, employeeName: e.employeeName, siteId: null, siteName: null, latitude: e.latitude, longitude: e.longitude, lastUpdatedAt: e.capturedAtClient, context: "office" });
  }

  return results;
}

export type LocationException = {
  id: string;
  employeeId: string;
  employeeName: string;
  type: "check_in" | "check_out";
  source: "office" | "site";
  latitude: number;
  longitude: number;
  distanceMeters: number | null;
  address: string | null;
  capturedAtClient: Date;
  reviewed: boolean;
  reviewNote: string | null;
};

/** Out-of-geofence check-ins/outs — shown for review, never auto-flagged as misconduct (section 41). */
export async function getLocationExceptions(limit = 30): Promise<LocationException[]> {
  const rows = await db
    .select({
      id: attendanceEvents.id,
      employeeId: employees.id,
      employeeName: users.name,
      type: attendanceEvents.type,
      source: attendanceEvents.source,
      latitude: attendanceEvents.latitude,
      longitude: attendanceEvents.longitude,
      distanceMeters: attendanceEvents.distanceMeters,
      address: attendanceEvents.address,
      capturedAtClient: attendanceEvents.capturedAtClient,
    })
    .from(attendanceEvents)
    .innerJoin(employees, eq(employees.id, attendanceEvents.employeeId))
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(attendanceEvents.withinGeofence, false))
    .orderBy(desc(attendanceEvents.capturedAtClient))
    .limit(limit);

  const reviews = await db.query.locationExceptionReviews.findMany({});
  const reviewByEventId = new Map(reviews.map((r) => [r.attendanceEventId, r]));

  return rows.map((r) => ({ ...r, reviewed: reviewByEventId.has(r.id), reviewNote: reviewByEventId.get(r.id)?.note ?? null }));
}

export async function getLocationSettings() {
  const existing = await db.query.locationSettings.findFirst({ where: eq(locationSettings.id, "singleton") });
  if (existing) return existing;
  const [created] = await db.insert(locationSettings).values({ id: "singleton" }).onConflictDoNothing().returning();
  return created ?? (await db.query.locationSettings.findFirst({ where: eq(locationSettings.id, "singleton") }))!;
}

/** Manual purge (section 39: configurable retention) — there's no cron in this deployment, so this is triggered from Settings rather than running automatically overnight. */
export async function purgeOldLocationPoints(): Promise<number> {
  const settings = await getLocationSettings();
  const cutoff = new Date(Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db.delete(siteLocationPoints).where(lt(siteLocationPoints.recordedAt, cutoff)).returning({ id: siteLocationPoints.id });
  return deleted.length;
}

export async function getEmployeeRecentSiteVisits(employeeId: string, limit = 10) {
  return db
    .select({
      id: siteVisits.id,
      siteId: sites.id,
      siteName: sites.name,
      startedAt: siteVisits.startedAt,
      endedAt: siteVisits.endedAt,
      status: siteVisits.status,
    })
    .from(siteVisits)
    .innerJoin(sites, eq(sites.id, siteVisits.siteId))
    .where(eq(siteVisits.employeeId, employeeId))
    .orderBy(desc(siteVisits.startedAt))
    .limit(limit);
}

export async function getSiteVisitTrail(siteVisitId: string) {
  return db.query.siteLocationPoints.findMany({ where: eq(siteLocationPoints.siteVisitId, siteVisitId), orderBy: (p, { asc }) => asc(p.recordedAt) });
}

export async function getActiveGeofences() {
  return db.query.geofences.findMany({ where: eq(geofences.active, true) });
}
