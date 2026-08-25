import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { attendanceEvents, attendanceRecords, geofences, devices } from "@/db/schema";
import { isWithinGeofence, isAccuracyAcceptable } from "./geo";
import { recordAudit } from "./audit";
import type { CurrentUser } from "./auth";

export class AttendanceError extends Error {}

export async function recordAttendanceEvent(opts: {
  actor: CurrentUser;
  employeeId: string;
  type: "check_in" | "check_out";
  source: "office" | "site";
  latitude: number;
  longitude: number;
  accuracy: number;
  address?: string | null; // best-effort reverse-geocoded address, see lib/reverse-geocode.ts
  authMethod: "password_session" | "webauthn";
  clientEventId: string;
  capturedAtClient: number;
  deviceId?: string | null;
  siteVisitId?: string | null;
  geofenceIdOverride?: string | null; // pass explicit site geofence when checking into a site
}) {
  // Idempotency: a retried offline-queue POST must never create a second record.
  const dup = await db.query.attendanceEvents.findFirst({ where: eq(attendanceEvents.clientEventId, opts.clientEventId) });
  if (dup) return dup;

  if (!isAccuracyAcceptable(opts.accuracy)) {
    throw new AttendanceError("Your GPS accuracy is currently low. Please move to an open area and try again.");
  }

  let geofence = null;
  if (opts.geofenceIdOverride) {
    geofence = await db.query.geofences.findFirst({ where: eq(geofences.id, opts.geofenceIdOverride) });
  } else {
    geofence = await db.query.geofences.findFirst({ where: and(eq(geofences.type, "office"), eq(geofences.active, true)) });
  }

  let withinGeofence = true;
  let distance: number | undefined;
  if (geofence) {
    const check = isWithinGeofence(
      { lat: opts.latitude, lng: opts.longitude, accuracy: opts.accuracy },
      { lat: geofence.latitude, lng: geofence.longitude, radiusMeters: geofence.radiusMeters }
    );
    withinGeofence = check.within;
    distance = check.distance;
  }

  if (!withinGeofence) {
    throw new AttendanceError(
      `You appear to be ${Math.round(distance ?? 0)}m away from ${geofence?.name ?? "the expected location"}. Move closer and try again, or contact your manager if this seems wrong.`
    );
  }

  // Prevent an obviously duplicate check-in/out (same type twice in a row).
  if (opts.source === "office") {
    const today = new Date().toISOString().slice(0, 10);
    const todayRecord = await db.query.attendanceRecords.findFirst({
      where: and(eq(attendanceRecords.employeeId, opts.employeeId), eq(attendanceRecords.date, today)),
    });
    if (opts.type === "check_in" && todayRecord?.checkInEventId && !todayRecord.checkOutEventId) {
      throw new AttendanceError("You are already checked in.");
    }
    if (opts.type === "check_out" && (!todayRecord || !todayRecord.checkInEventId)) {
      throw new AttendanceError("You need to check in before you can check out.");
    }
    if (opts.type === "check_out" && todayRecord?.checkOutEventId) {
      throw new AttendanceError("You are already checked out for today.");
    }
  }

  const [event] = await db
    .insert(attendanceEvents)
    .values({
      employeeId: opts.employeeId,
      type: opts.type,
      source: opts.source,
      siteVisitId: opts.siteVisitId ?? null,
      latitude: opts.latitude,
      longitude: opts.longitude,
      accuracy: opts.accuracy,
      address: opts.address ?? null,
      geofenceId: geofence?.id,
      withinGeofence,
      distanceMeters: distance,
      deviceId: opts.deviceId ?? null,
      authMethod: opts.authMethod,
      clientEventId: opts.clientEventId,
      capturedAtClient: new Date(opts.capturedAtClient),
      syncedAt: new Date(),
    })
    .returning();

  if (opts.source === "office") {
    const today = new Date().toISOString().slice(0, 10);
    const existingRecord = await db.query.attendanceRecords.findFirst({
      where: and(eq(attendanceRecords.employeeId, opts.employeeId), eq(attendanceRecords.date, today)),
    });
    if (opts.type === "check_in") {
      if (existingRecord) {
        await db.update(attendanceRecords).set({ checkInEventId: event.id, status: "present" }).where(eq(attendanceRecords.id, existingRecord.id));
      } else {
        await db.insert(attendanceRecords).values({ employeeId: opts.employeeId, date: today, checkInEventId: event.id, status: "present" });
      }
    } else if (existingRecord) {
      const minutes = existingRecord.checkInEventId
        ? Math.round((event.capturedAtClient.getTime() - (await db.query.attendanceEvents.findFirst({ where: eq(attendanceEvents.id, existingRecord.checkInEventId) }))!.capturedAtClient.getTime()) / 60000)
        : null;
      await db.update(attendanceRecords).set({ checkOutEventId: event.id, totalMinutes: minutes ?? undefined }).where(eq(attendanceRecords.id, existingRecord.id));
    }
  }

  await recordAudit({
    actor: opts.actor,
    action: opts.type === "check_in" ? "attendance.checked_in" : "attendance.checked_out",
    entityType: "attendance_event",
    entityId: event.id,
    newState: { source: opts.source, withinGeofence, distance },
  });

  return event;
}

export async function touchDeviceLastSeen(deviceId: string | null | undefined) {
  if (!deviceId) return;
  await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, deviceId));
}
