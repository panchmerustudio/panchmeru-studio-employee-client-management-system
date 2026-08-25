import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { idColumn, createdAtOnly } from "./common";
import { employees } from "./employees";
import { geofences, siteVisits } from "./sites";
import { files } from "./files";
import { devices } from "./identity";

/**
 * Event-sourced attendance (section 56/57): every check-in/out is an
 * immutable event. `clientEventId` is a client-generated idempotency key
 * so a retried sync after a dropped connection can never create a
 * duplicate or fraudulent record — the unique index enforces "at most
 * once" no matter how many times the mobile app retries.
 */
export const attendanceEvents = sqliteTable(
  "attendance_events",
  {
    id: idColumn(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["check_in", "check_out"] }).notNull(),
    source: text("source", { enum: ["office", "site"] }).notNull(),
    siteVisitId: text("site_visit_id").references(() => siteVisits.id),

    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    accuracy: real("accuracy").notNull(),
    // Best-effort human-readable reverse-geocoded address for this exact
    // coordinate (free OpenStreetMap Nominatim lookup, done client-side).
    // Never required and never blocks a check-in/out if it fails or times
    // out — the lat/long/accuracy above are always captured regardless.
    address: text("address"),
    geofenceId: text("geofence_id").references(() => geofences.id),
    withinGeofence: integer("within_geofence", { mode: "boolean" }).notNull(),
    distanceMeters: real("distance_meters"),

    deviceId: text("device_id").references(() => devices.id),
    authMethod: text("auth_method", { enum: ["password_session", "webauthn"] }).notNull(),
    selfieFileId: text("selfie_file_id").references(() => files.id),

    clientEventId: text("client_event_id").notNull().unique(),
    capturedAtClient: integer("captured_at_client", { mode: "timestamp" }).notNull(),
    syncedAt: integer("synced_at", { mode: "timestamp" }),

    ...createdAtOnly(),
  },
  (t) => [uniqueIndex("attendance_events_client_event_unique").on(t.clientEventId)]
);

/** Derived per-day summary, recomputed from events — never hand-edited. */
export const attendanceRecords = sqliteTable(
  "attendance_records",
  {
    id: idColumn(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    checkInEventId: text("check_in_event_id").references(() => attendanceEvents.id),
    checkOutEventId: text("check_out_event_id").references(() => attendanceEvents.id),
    status: text("status", {
      enum: ["present", "absent", "half_day", "on_leave", "holiday", "week_off"],
    })
      .notNull()
      .default("present"),
    totalMinutes: integer("total_minutes"),
    ...createdAtOnly(),
  },
  (t) => [uniqueIndex("attendance_records_employee_date_unique").on(t.employeeId, t.date)]
);
