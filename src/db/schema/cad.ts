import { boolean, integer, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, timestamps, createdAtOnly } from "./common";
import { users } from "./identity";
import { projects } from "./projects";
import { files } from "./files";

/**
 * AI CAD -> 3D architectural modeler (Phase 1: DXF only). CAD measurements
 * are the source of truth — nothing in this pipeline invents or alters a
 * dimension. Geometry is extracted directly from the DXF entities and
 * classified by layer/block-name heuristics; anything the classifier can't
 * confidently identify, or can't measure (e.g. door/window height, which a
 * plan-view drawing never contains), is surfaced for the user to confirm —
 * never guessed. See src/lib/dxf for the parsing/classification engine.
 */
export const cadModels = pgTable("cad_models", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceFileId: text("source_file_id")
    .notNull()
    .references(() => files.id),
  units: text("units", { enum: ["mm", "cm", "m", "in", "ft"] }).notNull().default("mm"), // what the DXF's raw coordinates are drawn in — normalized to mm internally

  status: text("status", { enum: ["parsing", "needs_info", "ready", "approved", "failed"] })
    .notNull()
    .default("parsing"),
  parseError: text("parse_error"),

  // Missing-information values, once resolved (never invented — see cadMissingInputs). A plan-view
  // DXF has no Z-axis, so floor height is always missing; door/window height likewise.
  floorHeightMm: real("floor_height_mm"),
  doorHeightMm: real("door_height_mm"),
  windowHeightMm: real("window_height_mm"),
  windowSillMm: real("window_sill_mm"),
  wallDefaultThicknessMm: real("wall_default_thickness_mm"), // only used for single-line walls where no parallel pair was found to measure thickness from

  entityCounts: jsonb("entity_counts").$type<Record<string, number>>(), // {wall: 12, door: 4, window: 6, ...} — for the review summary
  unclassifiedCount: integer("unclassified_count").notNull().default(0),
  ignoredAnnotationCount: integer("ignored_annotation_count").notNull().default(0), // dimension/hatch/text entities that aren't building geometry

  approvedBy: text("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  ...timestamps(),
});

/**
 * The structured building database (spec section 4) — one row per
 * classified CAD entity. `geometry` shape depends on `type`:
 *   wall:                  { start: {x,y}, end: {x,y} }              (mm, project coordinates)
 *   door/window/column/furniture: { position: {x,y} }
 *   room/stair:             { points: [{x,y}, ...] }
 *   unclassified:            { points: [{x,y}, ...], entityType: "LINE" | ... }
 */
export const cadEntities = pgTable("cad_entities", {
  id: idColumn(),
  modelId: text("model_id")
    .notNull()
    .references(() => cadModels.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["wall", "door", "window", "column", "stair", "furniture", "room", "unclassified"] }).notNull(),
  layerName: text("layer_name").notNull(),
  label: text("label"), // block name / room name / raw DXF entity type for unclassified rows
  geometry: jsonb("geometry").notNull(),
  widthMm: real("width_mm"),
  depthMm: real("depth_mm"), // wall thickness, or footprint depth for columns/furniture/doors/windows
  heightMm: real("height_mm"), // filled in once the relevant missing-input is resolved
  rotationDeg: real("rotation_deg").default(0),
  locked: boolean("locked").notNull().default(true), // measurement lock (spec section 5) — every dimension read from CAD is locked by default
  sourceHandle: text("source_handle"), // DXF entity handle — traceability back to the original file
  ...createdAtOnly(),
});

export const cadMissingInputs = pgTable("cad_missing_inputs", {
  id: idColumn(),
  modelId: text("model_id")
    .notNull()
    .references(() => cadModels.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["floor_height", "door_height", "window_height", "window_sill_height", "wall_default_thickness"] }).notNull(),
  question: text("question").notNull(),
  resolvedValueMm: real("resolved_value_mm"),
  resolvedBy: text("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  ...createdAtOnly(),
});
