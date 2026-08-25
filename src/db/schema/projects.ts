import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
export const projectTypes = pgTable("project_types", {
  id: idColumn(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

export const projects = pgTable("projects", {
  id: idColumn(),
  name: text("name").notNull(),
  projectTypeId: text("project_type_id").references(() => projectTypes.id),
  clientId: text("client_id"), // FK to future clients table, added via relations.ts once client module exists
  status: text("status", {
    enum: ["active", "delayed", "on_hold", "completed", "cancelled"],
  })
    .notNull()
    .default("active"),
  startDate: timestamp("start_date"),
  expectedCompletion: timestamp("expected_completion"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  ...timestamps(),
});

export const projectMembers = pgTable("project_members", {
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

export const projectMilestones = pgTable("project_milestones", {
  id: idColumn(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  status: text("status", { enum: ["pending", "in_progress", "done", "missed"] })
    .notNull()
    .default("pending"),
  ...createdAtOnly(),
});
