import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { idColumn, createdAtOnly } from "./common";
import { users } from "./identity";

/**
 * WHO / WHAT / WHEN / previous state / new state, for every important
 * business action (section 42). previousState/newState are JSON snapshots
 * so a change can be diffed later without re-deriving it from other tables.
 */
export const auditLogs = sqliteTable("audit_logs", {
  id: idColumn(),
  actorId: text("actor_id").references(() => users.id),
  actorRole: text("actor_role"),
  action: text("action").notNull(), // "employee.created" | "task.approved" | "drawing.shared_with_client" | ...
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  previousState: text("previous_state", { mode: "json" }),
  newState: text("new_state", { mode: "json" }),
  ipAddress: text("ip_address"),
  ...createdAtOnly(),
});
