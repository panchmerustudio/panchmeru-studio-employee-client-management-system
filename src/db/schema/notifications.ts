import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { idColumn, createdAtOnly } from "./common";
import { users } from "./identity";

/**
 * Deliberately generic so future client notifications (drawing shared,
 * revision requested, approval) reuse this exact table — no redesign
 * needed when Client Management turns on (section 68).
 */
export const notifications = sqliteTable("notifications", {
  id: idColumn(),
  recipientId: text("recipient_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "task_assigned" | "task_submitted" | "leave_result" | "site_visit_completed" | ...
  title: text("title").notNull(),
  message: text("message").notNull(),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: text("related_entity_id"),
  deliveryStatus: text("delivery_status", { enum: ["queued", "delivered", "failed"] })
    .notNull()
    .default("delivered"), // in-app only for now; push/SMS providers can update this later
  readAt: integer("read_at", { mode: "timestamp" }),
  ...createdAtOnly(),
});

export const notificationPreferences = sqliteTable("notification_preferences", {
  id: idColumn(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  channel: text("channel", { enum: ["in_app", "push", "email", "sms"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});
