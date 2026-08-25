import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { idColumn } from "./common";
import { users } from "./identity";

/**
 * Module activation switches (section 66). Reading this table (via
 * lib/feature-flags.ts) is how the UI decides whether to show Clients,
 * Client Portal, Drawing Approvals, Commercials, Vendors, etc. Turning a
 * flag on never requires a schema change — the tables already exist.
 */
export const featureFlags = sqliteTable("feature_flags", {
  id: idColumn(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  updatedBy: text("updated_by").references(() => users.id),
});
