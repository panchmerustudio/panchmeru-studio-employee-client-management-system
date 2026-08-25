import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { idColumn, timestamps, createdAtOnly } from "./common";
import { users } from "./identity";
import { employees } from "./employees";

/**
 * PROJECTS. `clientId` is nullable and points at the (currently inactive)
 * `clients` table in future-client.ts — a project can exist without a
 * client today; once Client Management is switched on, existing projects
 * can be linked retroactively. Project types are data, not an enum, so
 * new types don't require a migration.
 */
export const projectTypes = sqliteTable("project_types", {
  id: idColumn(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const projects = sqliteTable("projects", {
  id: idColumn(),
  name: text("name").notNull(),
  projectTypeId: text("project_type_id").references(() => projectTypes.id),
  clientId: text("client_id"), // FK to future clients table, added via relations.ts once client module exists
  status: text("status", {
    enum: ["active", "delayed", "on_hold", "completed", "cancelled"],
  })
    .notNull()
    .default("active"),
  startDate: integer("start_date", { mode: "timestamp" }),
  expectedCompletion: integer("expected_completion", { mode: "timestamp" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  ...timestamps(),
});

export const projectMembers = sqliteTable("project_members", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  roleOnProject: text("role_on_project"),
  ...createdAtOnly(),
});

export const projectMilestones = sqliteTable("project_milestones", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dueDate: integer("due_date", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  status: text("status", { enum: ["pending", "in_progress", "done", "missed"] })
    .notNull()
    .default("pending"),
  ...createdAtOnly(),
});
