"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { locationExceptionReviews, locationSettings } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { purgeOldLocationPoints, getLocationSettings } from "@/lib/location-tracking";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";

/** Marks an out-of-geofence event as reviewed — an acknowledgement, not an accusation (section 41). */
export async function reviewLocationException(attendanceEventId: string, note: string) {
  const actor = await requirePermission(PERMISSIONS.ATTENDANCE_VIEW_ALL);
  await db
    .insert(locationExceptionReviews)
    .values({ attendanceEventId, reviewedByUserId: actor.id, note: note || null })
    .onConflictDoUpdate({ target: locationExceptionReviews.attendanceEventId, set: { reviewedByUserId: actor.id, note: note || null } });
  await recordAudit({ actor, action: "location.exception_reviewed", entityType: "attendance_event", entityId: attendanceEventId });
  revalidatePath("/live-locations");
}

export async function updateRetentionDays(days: number) {
  const actor = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  if (!Number.isFinite(days) || days < 7) throw new Error("Retention must be at least 7 days.");
  await getLocationSettings();
  await db.update(locationSettings).set({ retentionDays: Math.round(days), updatedBy: actor.id }).where(eq(locationSettings.id, "singleton"));
  await recordAudit({ actor, action: "location.retention_changed", entityType: "location_settings", entityId: "singleton", newState: { days } });
  revalidatePath("/settings");
  revalidatePath("/live-locations");
}

export async function purgeLocationHistoryNow() {
  const actor = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  const count = await purgeOldLocationPoints();
  await recordAudit({ actor, action: "location.history_purged", entityType: "location_settings", entityId: "singleton", newState: { deletedCount: count } });
  revalidatePath("/settings");
  return count;
}
