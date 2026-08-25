import { boolean, integer, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, timestamps, createdAtOnly } from "./common";
import { users } from "./identity";
import { employees } from "./employees";
import { projects } from "./projects";
import { files } from "./files";

/** A geofence guards either an office location or a site location. */
export const geofences = pgTable("geofences", {
  id: idColumn(),
  name: text("name").notNull(),
  type: text("type", { enum: ["office", "site"] }).notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  radiusMeters: integer("radius_meters").notNull().default(150),
  active: boolean("active").notNull().default(true),
  ...createdAtOnly(),
});

export const sites = pgTable("sites", {
  id: idColumn(),
  name: text("name").notNull(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  geofenceId: text("geofence_id").references(() => geofences.id),
  addressLine: text("address_line"),
  city: text("city").notNull(), // Ludhiana / Chandigarh / Mohali / Khanna / Mandi Gobindgarh / Samrala / ...
  state: text("state").notNull().default("Punjab"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  status: text("status", {
    enum: ["planning", "active", "on_hold", "completed"],
  })
    .notNull()
    .default("active"),
  healthStatus: text("health_status", { enum: ["normal", "attention", "urgent"] })
    .notNull()
    .default("normal"),
  healthReason: text("health_reason"), // human-readable "No visit for 6 days"
  startDate: timestamp("start_date"),
  expectedCompletion: timestamp("expected_completion"),
  siteManagerId: text("site_manager_id").references(() => employees.id),
  ...timestamps(),
});

export const siteAssignments = pgTable("site_assignments", {
  id: idColumn(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  role: text("role").default("team_member"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  ...createdAtOnly(),
});

/** One row per "start site visit -> check out" cycle. */
export const siteVisits = pgTable("site_visits", {
  id: idColumn(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  checkInEventId: text("check_in_event_id"), // FK to attendance_events, wired in relations.ts
  checkOutEventId: text("check_out_event_id"),
  startedAt: timestamp("started_at").notNull(),
  endedAt: timestamp("ended_at"),
  status: text("status", { enum: ["active", "completed", "abandoned"] })
    .notNull()
    .default("active"),
  trackingEnabled: boolean("tracking_enabled").notNull().default(true),
  ...createdAtOnly(),
});

/** GPS trail captured only while a site visit is active — stops the moment checkout happens. */
export const siteLocationPoints = pgTable("site_location_points", {
  id: idColumn(),
  siteVisitId: text("site_visit_id")
    .notNull()
    .references(() => siteVisits.id, { onDelete: "cascade" }),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  accuracy: real("accuracy"),
  recordedAt: timestamp("recorded_at").notNull(),
});

/** Walk-the-boundary capture. Never a legal survey — always labeled approximate. */
export const siteBoundaries = pgTable("site_boundaries", {
  id: idColumn(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  points: jsonb("points").$type<{ lat: number; lng: number }[]>().notNull(),
  areaSqFt: real("area_sq_ft"),
  perimeterFt: real("perimeter_ft"),
  isManuallyAdjusted: boolean("is_manually_adjusted").notNull().default(false),
  isProfessionalSurvey: boolean("is_professional_survey").notNull().default(false),
  capturedBy: text("captured_by")
    .notNull()
    .references(() => users.id),
  ...createdAtOnly(),
});

export const siteReports = pgTable("site_reports", {
  id: idColumn(),
  siteVisitId: text("site_visit_id")
    .notNull()
    .references(() => siteVisits.id, { onDelete: "cascade" }),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  workCompleted: text("work_completed"),
  discussion: text("discussion"),
  issues: text("issues"),
  materialRequirement: text("material_requirement"),
  nextAction: text("next_action"),
  voiceNoteId: text("voice_note_id"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  ...createdAtOnly(),
});

export const sitePhotos = pgTable("site_photos", {
  id: idColumn(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  siteVisitId: text("site_visit_id").references(() => siteVisits.id),
  fileId: text("file_id")
    .notNull()
    .references(() => files.id),
  caption: text("caption"),
  uploadedBy: text("uploaded_by")
    .notNull()
    .references(() => users.id),
  ...createdAtOnly(),
});
