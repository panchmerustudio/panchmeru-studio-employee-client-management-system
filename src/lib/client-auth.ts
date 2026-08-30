import "server-only";
import { cookies, headers } from "next/headers";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { clientUsers, clientSessions, clients, clientContacts } from "@/db/schema";

/**
 * Client-portal auth — a deliberately separate identity space from staff
 * `users`/`userSessions` (see future-client.ts). A client can never sign
 * into the staff app and a staff member can never sign into /client; the
 * two session cookies and DB tables never overlap.
 */
const CLIENT_SESSION_COOKIE = "pms_client_session";
const CLIENT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, revocable server-side any time

export async function hashClientPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

function newToken() {
  return randomBytes(32).toString("hex");
}

export async function createClientSession(clientUserId: string) {
  const token = newToken();
  const hdrs = await headers();
  await db.insert(clientSessions).values({
    clientUserId,
    sessionToken: token,
    expiresAt: new Date(Date.now() + CLIENT_SESSION_TTL_MS),
    ipAddress: hdrs.get("x-forwarded-for") ?? undefined,
    userAgent: hdrs.get("user-agent") ?? undefined,
  });
  const cookieStore = await cookies();
  cookieStore.set(CLIENT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: CLIENT_SESSION_TTL_MS / 1000,
    path: "/",
  });
  return token;
}

export async function destroyClientSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;
  if (token) {
    await db.update(clientSessions).set({ revokedAt: new Date() }).where(eq(clientSessions.sessionToken, token));
  }
  cookieStore.delete(CLIENT_SESSION_COOKIE);
}

export type CurrentClient = {
  clientUserId: string;
  clientId: string;
  clientContactId: string | null;
  email: string;
  clientName: string;
  contactName: string | null;
};

export async function getCurrentClient(): Promise<CurrentClient | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.query.clientSessions.findFirst({
    where: and(eq(clientSessions.sessionToken, token), isNull(clientSessions.revokedAt), gt(clientSessions.expiresAt, new Date())),
  });
  if (!session) return null;

  const cu = await db.query.clientUsers.findFirst({ where: eq(clientUsers.id, session.clientUserId) });
  if (!cu || cu.status !== "active") return null;

  const client = await db.query.clients.findFirst({ where: eq(clients.id, cu.clientId) });
  if (!client) return null;

  const contact = cu.clientContactId ? await db.query.clientContacts.findFirst({ where: eq(clientContacts.id, cu.clientContactId) }) : null;

  return {
    clientUserId: cu.id,
    clientId: client.id,
    clientContactId: contact?.id ?? null,
    email: cu.email,
    clientName: client.name,
    contactName: contact?.name ?? null,
  };
}

export async function requireClient(): Promise<CurrentClient> {
  const client = await getCurrentClient();
  if (!client) throw new Error("Not signed in to the client portal.");
  return client;
}

/** Straight password check against clientUsers.passwordHash — no lockout/rate-limit yet, matches staff login's current scope. */
export async function verifyClientLogin(email: string, password: string) {
  const cu = await db.query.clientUsers.findFirst({ where: eq(clientUsers.email, email.trim().toLowerCase()) });
  if (!cu || !cu.passwordHash || cu.status !== "active") return null;
  const ok = await bcrypt.compare(password, cu.passwordHash);
  if (!ok) return null;
  await db.update(clientUsers).set({ lastLoginAt: new Date() }).where(eq(clientUsers.id, cu.id));
  return cu;
}
