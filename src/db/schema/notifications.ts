import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, createdAtOnly } from "./common";
import { users } from "./identity";

/**
 * Deliberately generic so future client notifications (drawing shared,
 * revision requested, approval) reuse this exact table — no redesign
 * needed when Client Management turns on (section 68).
 */
export const notifications = pgTable("notifications", {
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
  readAt: timestamp("read_at"),
  ...createdAtOnly(),
});

export const notificationPreferences = pgTable("notification_preferences", {
  id: idColumn(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  channel: text("channel", { enum: ["in_app", "push", "email", "sms"] }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
});
