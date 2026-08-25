import "server-only";
import { cookies, headers } from "next/headers";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { users, userSessions, roles, rolePermissions, employees, devices } from "@/db/schema";
import { DEFAULT_ROLE_PERMISSIONS, type PermissionKey, type RoleKey } from "./rbac";

const SESSION_COOKIE = "pms_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, revocable server-side any time

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

function newToken() {
  return randomBytes(32).toString("hex");
}

/**
 * Custom, DB-backed session (rather than a JWT-only approach) so a session
 * can be listed and individually revoked per device — spec section 23/59
 * explicitly calls for device/session management, which a stateless token
 * can't give you.
 */
export async function createSession(userId: string, deviceId?: string) {
  const token = newToken();
  const hdrs = await headers();
  await db.insert(userSessions).values({
    userId,
    deviceId: deviceId ?? null,
    sessionToken: token,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ipAddress: hdrs.get("x-forwarded-for") ?? undefined,
    userAgent: hdrs.get("user-agent") ?? undefined,
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
  });
  return token;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.sessionToken, token));
  }
  cookieStore.delete(SESSION_COOKIE);
}

export type CurrentUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleKey: RoleKey;
  roleName: string;
  employeeId: string | null;
  permissions: PermissionKey[];
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.query.userSessions.findFirst({
    where: and(eq(userSessions.sessionToken, token), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, new Date())),
  });
  if (!session) return null;

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user || user.status !== "active") return null;

  const role = await db.query.roles.findFirst({ where: eq(roles.id, user.roleId) });
  if (!role) return null;

  const perms = await db
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, role.id));

  const employee = await db.query.employees.findFirst({ where: eq(employees.userId, user.id) });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    roleKey: role.key as RoleKey,
    roleName: role.name,
    employeeId: employee?.id ?? null,
    permissions: perms.map((p) => p.key as PermissionKey),
  };
}

export function hasPermission(user: CurrentUser | null, permission: PermissionKey): boolean {
  return !!user && user.permissions.includes(permission);
}

/** Throws-style guard for server actions/route handlers. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Not authenticated");
  return user;
}

export async function requirePermission(permission: PermissionKey): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasPermission(user, permission)) throw new AuthError("You do not have permission to perform this action.");
  return user;
}

export class AuthError extends Error {}

export async function findOrCreateDevice(userId: string, platform: string, deviceName: string) {
  const existing = await db.query.devices.findFirst({
    where: and(eq(devices.userId, userId), eq(devices.deviceName, deviceName)),
  });
  if (existing) {
    await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, existing.id));
    return existing.id;
  }
  const [created] = await db
    .insert(devices)
    .values({ userId, platform, deviceName, lastSeenAt: new Date() })
    .returning();
  return created.id;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const DEFAULT_ROLE_PERMISSIONS_EXPORT = DEFAULT_ROLE_PERMISSIONS;
