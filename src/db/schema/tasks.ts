import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, timestamps, createdAtOnly } from "./common";
import { employees } from "./employees";
import { users } from "./identity";
import { projects } from "./projects";
import { sites } from "./sites";
import { files } from "./files";

export const tasks = pgTable("tasks", {
  id: idColumn(),
  title: text("title").notNull(),
  description: text("description"),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  siteId: text("site_id").references(() => sites.id, { onDelete: "set null" }),
  assignedToId: text("assigned_to_id")
    .notNull()
    .references(() => employees.id),
  assignedById: text("assigned_by_id")
    .notNull()
    .references(() => users.id),
  priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
    .notNull()
    .default("normal"),
  dueDate: timestamp("due_date"),
  instructions: text("instructions"),
  status: text("status", {
    enum: [
      "to_do",
      "in_progress",
      "submitted",
      "modification_required",
      "approved",
      "overdue",
      "rescheduled",
      "cancelled",
    ],
  })
    .notNull()
    .default("to_do"),
  // when a task is carried forward / rescheduled, the new task points back
  // at the one it replaced so the full lineage stays visible
  previousTaskId: text("previous_task_id"),
  ...timestamps(),
});

export const taskAttachments = pgTable("task_attachments", {
  id: idColumn(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  fileId: text("file_id")
    .notNull()
    .references(() => files.id),
  uploadedBy: text("uploaded_by")
    .notNull()
    .references(() => users.id),
  ...createdAtOnly(),
});

/** The task's work conversation: text / voice / photo / document, in order. */
export const taskComments = pgTable("task_comments", {
  id: idColumn(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id),
  type: text("type", { enum: ["text", "voice", "photo", "document"] }).notNull(),
  text_: text("text"),
  voiceNoteId: text("voice_note_id"),
  fileId: text("file_id").references(() => files.id),
  ...createdAtOnly(),
});

/**
 * Every submit/approve/request-modification/resubmit cycle is a NEW row —
 * nothing is overwritten, so the manager (and later, an auditor) can see
 * every previous submission and every review decision.
 */
export const taskSubmissions = pgTable("task_submissions", {
  id: idColumn(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id),
  version: integer("version").notNull().default(1),
  note: text("note"),
  submittedAt: timestamp("submitted_at")
    .notNull()
    .$defaultFn(() => new Date()),
  status: text("status", {
    enum: ["pending_review", "approved", "modification_requested"],
  })
    .notNull()
    .default("pending_review"),
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  reviewVoiceNoteId: text("review_voice_note_id"),
});

export const taskSubmissionAttachments = pgTable("task_submission_attachments", {
  id: idColumn(),
  submissionId: text("submission_id")
    .notNull()
    .references(() => taskSubmissions.id, { onDelete: "cascade" }),
  fileId: text("file_id")
    .notNull()
    .references(() => files.id),
});

/** Status-change ledger, independent of comments — powers the task history view + audit. */
export const taskHistory = pgTable("task_history", {
  id: idColumn(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // "created" | "reassigned" | "status_changed" | "due_date_changed" | ...
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  actorId: text("actor_id")
    .notNull()
    .references(() => users.id),
  note: text("note"),
  ...createdAtOnly(),
});
