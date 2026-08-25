import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { idColumn, timestamps, createdAtOnly } from "./common";
import { users } from "./identity";
import { projects } from "./projects";
import { sites } from "./sites";
import { tasks } from "./tasks";
import { files } from "./files";

/**
 * DOCUMENTS / DRAWINGS foundation (section 35). A `document` is the
 * logical thing ("Kitchen Layout"); `documentVersions` is where version
 * control, status and (later) client-share history actually live.
 * Versions are NEVER overwritten or deleted — see section 15.
 */
export const documentCategories = pgTable("document_categories", {
  id: idColumn(),
  key: text("key").notNull().unique(), // architecture / interior / working_drawing / 3d / site / photos / other
  name: text("name").notNull(),
});

export const documents = pgTable("documents", {
  id: idColumn(),
  name: text("name").notNull(),
  categoryId: text("category_id").references(() => documentCategories.id),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  siteId: text("site_id").references(() => sites.id, { onDelete: "set null" }),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
  description: text("description"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  ...timestamps(),
});

export const documentVersions = pgTable("document_versions", {
  id: idColumn(),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  fileId: text("file_id")
    .notNull()
    .references(() => files.id),
  parentVersionId: text("parent_version_id"),
  changeNote: text("change_note"),
  // Draft -> internally revised -> sent to client -> client revision -> approved.
  // Client-facing statuses are only reachable once Client Management is ON;
  // the column exists now so no migration is needed later.
  status: text("status", {
    enum: ["draft", "internal_revised", "sent_to_client", "client_revision_requested", "approved", "superseded"],
  })
    .notNull()
    .default("draft"),
  visibility: text("visibility", {
    enum: ["internal", "project_team", "client_visible", "approved"],
  })
    .notNull()
    .default("internal"),
  relatedTaskId: text("related_task_id").references(() => tasks.id),
  uploadedBy: text("uploaded_by")
    .notNull()
    .references(() => users.id),
  ...createdAtOnly(),
});
