import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, createdAtOnly } from "./common";
import { users } from "./identity";
import { projects } from "./projects";
import { sites } from "./sites";
import { documentCategories } from "./documents";
import { vendors } from "./future-commercial";

/**
 * VENDOR ACCESS (sections 19-26, 50, 52). A vendor is NOT an employee and
 * NOT a client — a third, deliberately narrow identity space, mirroring
 * client-auth.ts exactly (separate cookie/session table, never overlaps
 * staff `users` or `clientUsers`).
 *
 * A vendor's visibility is structural rather than per-drawing: which
 * project(s)/site(s) they're assigned to (vendorAssignments) intersected
 * with which drawing categories they're allowed to see
 * (vendorCategoryAccess) — e.g. an Electrician assigned to "Sharma
 * Residence" and granted the "Electrical" category sees every current
 * (non-draft) Electrical drawing on that project, not a one-off share
 * like the client portal's clientDrawingShares. No client info, no other
 * vendors, no payments, no employee info, no internal task threads — a
 * vendor's world is exactly {assigned project(s)} x {granted category(ies)}.
 */

export const vendorUsers = pgTable("vendor_users", {
  id: idColumn(),
  vendorId: text("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "cascade" }),
  contactName: text("contact_name"),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  status: text("status", { enum: ["active", "invited", "disabled"] }).notNull().default("invited"),
  lastLoginAt: timestamp("last_login_at"),
  ...createdAtOnly(),
});

/** DB-backed vendor-portal session — same revocable-per-device design as clientSessions/userSessions. */
export const vendorSessions = pgTable("vendor_sessions", {
  id: idColumn(),
  vendorUserId: text("vendor_user_id")
    .notNull()
    .references(() => vendorUsers.id, { onDelete: "cascade" }),
  sessionToken: text("session_token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  ...createdAtOnly(),
});

/** Which project(s)/site(s) a vendor is currently working on — the first half of their access scope. */
export const vendorAssignments = pgTable("vendor_assignments", {
  id: idColumn(),
  vendorId: text("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  siteId: text("site_id").references(() => sites.id),
  assignedByUserId: text("assigned_by_user_id").references(() => users.id),
  ...createdAtOnly(),
});

/** Category-based default drawing access + admin overrides (sections 22-23) — a row here IS the grant. */
export const vendorCategoryAccess = pgTable("vendor_category_access", {
  id: idColumn(),
  vendorId: text("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "cascade" }),
  documentCategoryId: text("document_category_id")
    .notNull()
    .references(() => documentCategories.id, { onDelete: "cascade" }),
  isDefault: boolean("is_default").notNull().default(false), // auto-granted from the vendor's trade category, vs. an explicit admin override
  grantedByUserId: text("granted_by_user_id").references(() => users.id),
  ...createdAtOnly(),
});

/** Light audit trail — vendor logins/views/downloads, surfaced on the vendor's staff-side detail page. */
export const vendorActivities = pgTable("vendor_activities", {
  id: idColumn(),
  vendorId: text("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id),
  activityType: text("activity_type").notNull(), // "login" | "viewed_drawing" | "downloaded_drawing"
  description: text("description").notNull(),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: text("related_entity_id"),
  ...createdAtOnly(),
});
