import { boolean, integer, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, timestamps, createdAtOnly } from "./common";
import { users } from "./identity";
import { sites, siteVisits } from "./sites";
import { files } from "./files";

/**
 * MOBILE GPS PLOT MEASUREMENT / BOUNDARY SURVEY.
 *
 * One row per boundary-walk session. A site can be (and often will be)
 * measured more than once — a re-measurement never overwrites the
 * survey before it, it supersedes it via `supersedesId`, the same
 * explicit-status pattern `documentVersions` already uses ("never
 * overwritten or deleted"). See the status pipeline below.
 *
 * Raw vs. adjusted is a hard separation: the polygon/area/perimeter
 * computed straight from the GPS walk (raw*) is never overwritten by a
 * manual correction — that writes into the adjusted* columns instead,
 * so the original walk stays fully recoverable and auditable.
 *
 * Status pipeline:
 *   in_progress -> (Finish) -> employee reviews on-screen, may adjust or
 *   redo -> needs_review (submitted) -> confirmed | rejected (by an
 *   approver). A "rejected" survey stays rejected in history — the
 *   employee starts a new one (supersedesId points back at it). A
 *   "confirmed" survey later replaced by an even better remeasurement
 *   gets flipped to "superseded" only once the new one is confirmed —
 *   never deleted, never silently overwritten.
 */
export const plotSurveys = pgTable("plot_surveys", {
  id: idColumn(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  // Links the survey into that visit's activity timeline when it was done during an active site visit (section 44/45) — nullable, a survey can also stand alone.
  siteVisitId: text("site_visit_id").references(() => siteVisits.id),
  surveyNumber: integer("survey_number").notNull(), // #1, #2, ... per site — assigned at creation like taskSubmissions.version

  status: text("status", {
    enum: ["in_progress", "needs_review", "confirmed", "rejected", "superseded", "cancelled"],
  })
    .notNull()
    .default("in_progress"),

  startedAt: timestamp("started_at").notNull(),
  endedAt: timestamp("ended_at"),
  pausedSeconds: integer("paused_seconds").notNull().default(0), // total time spent paused — subtracted from wall-clock duration

  capturedBy: text("captured_by")
    .notNull()
    .references(() => users.id),

  // RAW — straight from the GPS walk (outlier points excluded from the ring, but never deleted — see surveyPoints). Never overwritten.
  rawPoints: jsonb("raw_points").$type<{ lat: number; lng: number }[]>(),
  rawAreaSqFt: real("raw_area_sq_ft"),
  rawPerimeterFt: real("raw_perimeter_ft"),
  rawSegments: jsonb("raw_segments").$type<{ label: string; lengthFt: number }[]>(),
  shapeType: text("shape_type"), // "square" | "rectangle" | "l_shaped" | "irregular"

  // ADJUSTED — only set once a manual correction happens (section 22-24).
  isAdjusted: boolean("is_adjusted").notNull().default(false),
  adjustedPoints: jsonb("adjusted_points").$type<{ lat: number; lng: number }[]>(),
  adjustedAreaSqFt: real("adjusted_area_sq_ft"),
  adjustedPerimeterFt: real("adjusted_perimeter_ft"),
  adjustedSegments: jsonb("adjusted_segments").$type<{ label: string; lengthFt: number }[]>(),
  adjustedBy: text("adjusted_by").references(() => users.id),
  adjustedAt: timestamp("adjusted_at"),
  adjustmentReason: text("adjustment_reason"),

  avgAccuracyM: real("avg_accuracy_m"),
  pointCount: integer("point_count").notNull().default(0),
  outlierCount: integer("outlier_count").notNull().default(0),

  // Approval (section 21/40).
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),

  // Supersede chain (section 20/21/41) — plain text self-reference, same convention as documentVersions.parentVersionId (not a DB-level FK, deliberately, to avoid a circular-reference migration headache).
  supersedesId: text("supersedes_id"),
  supersededReason: text("superseded_reason"),

  // Future extension seam (section 26) — always false from this mobile-GPS flow; reserved for when professional/RTK survey data can be imported alongside.
  isProfessionalSurvey: boolean("is_professional_survey").notNull().default(false),

  ...timestamps(),
});

/**
 * Raw GPS log — every point captured during the walk, sequence-numbered,
 * kept even if later flagged as an outlier (section 4/7/12/43). This is
 * the audit trail; plotSurveys.rawPoints is the derived closed ring used
 * for area/perimeter math.
 */
export const surveyPoints = pgTable("survey_points", {
  id: idColumn(),
  surveyId: text("survey_id")
    .notNull()
    .references(() => plotSurveys.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  accuracy: real("accuracy"),
  capturedAt: timestamp("captured_at").notNull(),
  // Flagged as an implausible GPS jump or too-poor-accuracy — excluded from the boundary ring but never deleted (section 7/43).
  isOutlier: boolean("is_outlier").notNull().default(false),
  outlierReason: text("outlier_reason"),
});

/** Pause/resume history within one survey session (section 15). */
export const surveyPauses = pgTable("survey_pauses", {
  id: idColumn(),
  surveyId: text("survey_id")
    .notNull()
    .references(() => plotSurveys.id, { onDelete: "cascade" }),
  pausedAt: timestamp("paused_at").notNull(),
  resumedAt: timestamp("resumed_at"),
});

/** Text/voice/photo/document notes on a survey — same shape as taskComments (section 30/31). */
export const surveyNotes = pgTable("survey_notes", {
  id: idColumn(),
  surveyId: text("survey_id")
    .notNull()
    .references(() => plotSurveys.id, { onDelete: "cascade" }),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id),
  type: text("type", { enum: ["text", "voice", "photo", "document"] }).notNull(),
  text_: text("text"),
  voiceNoteId: text("voice_note_id"),
  fileId: text("file_id").references(() => files.id),
  ...createdAtOnly(),
});
