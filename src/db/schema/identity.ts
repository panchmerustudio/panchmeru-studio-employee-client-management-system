import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { idColumn, timestamps, createdAtOnly } from "./common";

/**
 * ROLES — small fixed set today (Owner/Admin, Manager, Site Supervisor,
 * Employee) but modeled as a table + permission join so new roles or
 * finer-grained permissions can be added later without a schema change.
 */
export const roles = sqliteTable("roles", {
  id: idColumn(),
  key: text("key").notNull().unique(), // e.g. "owner", "manager", "supervisor", "employee"
  name: text("name").notNull(),
  description: text("description"),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  ...createdAtOnly(),
});

export const permissions = sqliteTable("permissions", {
  id: idColumn(),
  key: text("key").notNull().unique(), // e.g. "task.approve", "employee.manage"
  description: text("description"),
});

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    id: idColumn(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("role_permissions_unique").on(t.roleId, t.permissionKey)]
);

/**
 * USERS — login identity. One user maps to at most one Employee profile
 * (see employees.ts). Future: also referenced by clientUsers for portal
 * login, kept as a *separate* identity space so a client login can never
 * collide with staff permissions.
 */
export const users = sqliteTable("users", {
  id: idColumn(),
  name: text("name").notNull(),
  email: text("email").unique(),
  phone: text("phone").unique(),
  passwordHash: text("password_hash"), // null allowed if user only uses WebAuthn
  roleId: text("role_id")
    .notNull()
    .references(() => roles.id),
  status: text("status", { enum: ["active", "inactive", "suspended"] })
    .notNull()
    .default("active"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  ...timestamps(),
});

/**
 * WEBAUTHN CREDENTIALS — device biometric authentication (Face ID /
 * fingerprint via the platform authenticator). We NEVER store raw
 * biometric data — only the public key + counter the WebAuthn spec
 * exposes to the server, exactly like any password manager would.
 */
export const webauthnCredentials = sqliteTable("webauthn_credentials", {
  id: idColumn(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(), // base64
  counter: integer("counter").notNull().default(0),
  deviceType: text("device_type"),
  transports: text("transports", { mode: "json" }).$type<string[]>(),
  nickname: text("nickname"), // "Rahul's Phone"
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  ...createdAtOnly(),
});

/** Registered devices — used for attendance device-binding + push tokens. */
export const devices = sqliteTable("devices", {
  id: idColumn(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform"), // "ios" | "android" | "web"
  deviceName: text("device_name"),
  pushToken: text("push_token"),
  isTrusted: integer("is_trusted", { mode: "boolean" }).notNull().default(true),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
  ...createdAtOnly(),
});

/** Server-side session tracking so sessions can be listed/revoked per device. */
export const userSessions = sqliteTable("user_sessions", {
  id: idColumn(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceId: text("device_id").references(() => devices.id, { onDelete: "set null" }),
  sessionToken: text("session_token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  ...createdAtOnly(),
});
