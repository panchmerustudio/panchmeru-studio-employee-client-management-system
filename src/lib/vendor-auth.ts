import "server-only";
import { cookies, headers } from "next/headers";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { vendorUsers, vendorSessions, vendors } from "@/db/schema";

/**
 * Vendor-portal auth — a third, deliberately separate identity space from
 * staff `users`/`userSessions` AND from `clientUsers`/`clientSessions`
 * (see future-vendor.ts). A vendor can never sign into the staff app or
 * the client portal, and neither of those can sign into /vendor. Mirrors
 * client-auth.ts exactly, down to the TTL and revocation model.
 */
const VENDOR_SESSION_COOKIE = "pms_vendor_session";
const VENDOR_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, revocable server-side any time

export async function hashVendorPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

function newToken() {
  return randomBytes(32).toString("hex");
}

export async function createVendorSession(vendorUserId: string) {
  const token = newToken();
  const hdrs = await headers();
  await db.insert(vendorSessions).values({
    vendorUserId,
    sessionToken: token,
    expiresAt: new Date(Date.now() + VENDOR_SESSION_TTL_MS),
    ipAddress: hdrs.get("x-forwarded-for") ?? undefined,
    userAgent: hdrs.get("user-agent") ?? undefined,
  });
  const cookieStore = await cookies();
  cookieStore.set(VENDOR_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: VENDOR_SESSION_TTL_MS / 1000,
    path: "/",
  });
  return token;
}

export async function destroyVendorSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(VENDOR_SESSION_COOKIE)?.value;
  if (token) {
    await db.update(vendorSessions).set({ revokedAt: new Date() }).where(eq(vendorSessions.sessionToken, token));
  }
  cookieStore.delete(VENDOR_SESSION_COOKIE);
}

export type CurrentVendor = {
  vendorUserId: string;
  vendorId: string;
  email: string;
  vendorName: string;
  category: string | null;
  contactName: string | null;
};

export async function getCurrentVendor(): Promise<CurrentVendor | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(VENDOR_SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.query.vendorSessions.findFirst({
    where: and(eq(vendorSessions.sessionToken, token), isNull(vendorSessions.revokedAt), gt(vendorSessions.expiresAt, new Date())),
  });
  if (!session) return null;

  const vu = await db.query.vendorUsers.findFirst({ where: eq(vendorUsers.id, session.vendorUserId) });
  if (!vu || vu.status !== "active") return null;

  const vendor = await db.query.vendors.findFirst({ where: eq(vendors.id, vu.vendorId) });
  if (!vendor || vendor.status !== "active") return null;

  return {
    vendorUserId: vu.id,
    vendorId: vendor.id,
    email: vu.email,
    vendorName: vendor.name,
    category: vendor.category,
    contactName: vu.contactName,
  };
}

export async function requireVendor(): Promise<CurrentVendor> {
  const vendor = await getCurrentVendor();
  if (!vendor) throw new Error("Not signed in to the vendor portal.");
  return vendor;
}

/** Straight password check against vendorUsers.passwordHash — same scope as client/staff login (no lockout/rate-limit yet). */
export async function verifyVendorLogin(email: string, password: string) {
  const vu = await db.query.vendorUsers.findFirst({ where: eq(vendorUsers.email, email.trim().toLowerCase()) });
  if (!vu || !vu.passwordHash || vu.status !== "active") return null;
  const ok = await bcrypt.compare(password, vu.passwordHash);
  if (!ok) return null;
  await db.update(vendorUsers).set({ lastLoginAt: new Date() }).where(eq(vendorUsers.id, vu.id));
  return vu;
}
