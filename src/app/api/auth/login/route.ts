import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createSession, verifyPassword, findOrCreateDevice } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

const schema = z.object({
  email: z.string().min(1, "Enter your email or phone."),
  password: z.string().min(1, "Enter your password."),
  deviceName: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { email, password, deviceName } = parsed.data;

  const user = await db.query.users.findFirst({
    where: (u, { or, eq: eqOp }) => or(eqOp(u.email, email), eqOp(u.phone, email)),
  });

  // Same generic error for "no such user" and "wrong password" — never confirm which part was wrong.
  const genericError = "Incorrect email/phone or password.";
  if (!user || !user.passwordHash) {
    return NextResponse.json({ error: genericError }, { status: 401 });
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: genericError }, { status: 401 });
  }
  if (user.status !== "active") {
    return NextResponse.json({ error: "This account is not active. Contact your studio admin." }, { status: 403 });
  }

  const deviceId = await findOrCreateDevice(user.id, "web", deviceName || "Web browser");
  await createSession(user.id, deviceId);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await recordAudit({ actor: null, action: "user.login", entityType: "user", entityId: user.id, newState: { method: "password" } });

  return NextResponse.json({ ok: true });
}
