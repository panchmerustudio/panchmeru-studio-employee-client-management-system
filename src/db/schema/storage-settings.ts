import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { timestamps } from "./common";
import { users } from "./identity";

/**
 * Cloud storage tracking (see lib/storage-usage.ts). Always exactly one
 * row, id fixed at "singleton" — created lazily on first read/write
 * rather than seeded, so this ships without a seed-data change.
 *
 * capGb: the plan size to track usage against (defaults to Cloudflare
 * R2's free-tier 10GB — see lib/storage.ts) — editable from
 * /settings/storage so it stays correct if the plan is ever upgraded.
 *
 * lastNotifiedThreshold: the highest of [80, 90, 100] percent-used we've
 * already sent a notification for. Prevents re-notifying on every visit
 * once past a threshold, while still re-notifying if usage drops back
 * down (e.g. after a cleanup) and later climbs past it again — see
 * checkStorageThresholdAndNotify().
 */
export const storageSettings = pgTable("storage_settings", {
  id: text("id").primaryKey(),
  capGb: integer("cap_gb").notNull().default(10),
  lastNotifiedThreshold: integer("last_notified_threshold").notNull().default(0),
  updatedBy: text("updated_by").references(() => users.id),
  ...timestamps(),
});
