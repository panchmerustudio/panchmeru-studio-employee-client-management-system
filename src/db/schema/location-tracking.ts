import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { idColumn, timestamps, createdAtOnly } from "./common";
import { users } from "./identity";
import { attendanceEvents } from "./attendance";

/**
 * EMPLOYEE LIVE LOCATION (sections 36-48). Explicitly NOT 24/7
 * surveillance — there is no new "always tracking" table here. Live
 * status is derived entirely from data the app already collects for
 * other reasons: siteLocationPoints (GPS pings only while a site visit
 * is active — see sites.ts / ActiveVisit's 45s foreground polling, which
 * stops the instant checkout happens) and attendanceEvents' own
 * lat/lng/withinGeofence (a single point captured at office/site check-in
 * and check-out). See lib/location-tracking.ts for how those get turned
 * into LIVE/RECENT/OFFLINE status. This file adds only what that data
 * doesn't already cover: a retention setting, and a place to record that
 * an owner/manager reviewed an out-of-geofence event.
 */

export const locationSettings = pgTable("location_settings", {
  id: text("id").primaryKey(), // fixed at "singleton", lazily created — same pattern as storage_settings
  retentionDays: integer("retention_days").notNull().default(90),
  updatedBy: text("updated_by").references(() => users.id),
  ...timestamps(),
});

/** An owner/manager's acknowledgement of an out-of-geofence check-in/out — framed as "reviewed", never auto-flagged as misconduct (section 41). */
export const locationExceptionReviews = pgTable("location_exception_reviews", {
  id: idColumn(),
  attendanceEventId: text("attendance_event_id")
    .notNull()
    .unique()
    .references(() => attendanceEvents.id, { onDelete: "cascade" }),
  reviewedByUserId: text("reviewed_by_user_id")
    .notNull()
    .references(() => users.id),
  note: text("note"),
  ...createdAtOnly(),
});
