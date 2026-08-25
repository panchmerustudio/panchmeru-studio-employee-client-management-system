"use server";

import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { users, userSessions, webauthnCredentials } from "@/db/schema";
import { requireUser, hashPassword, verifyPassword } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export type FormState = { error?: string; ok?: boolean };

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser().catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const current = formData.get("current") as string;
  const next = formData.get("next") as string;
  const confirm = formData.get("confirm") as string;

  if (!next || next.length < 8) return { error: "New password must be at least 8 characters." };
  if (next !== confirm) return { error: "New passwords don't match." };

  const user = await db.query.users.findFirst({ where: eq(users.id, actor.id) });
  if (!user?.passwordHash || !(await verifyPassword(current, user.passwordHash))) {
    return { error: "Current password is incorrect." };
  }

  await db.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(users.id, actor.id));
  await recordAudit({ actor, action: "user.password_changed", entityType: "user", entityId: actor.id });
  revalidatePath("/profile");
  return { ok: true };
}

export async function revokeSession(sessionId: string) {
  const actor = await requireUser();
  await db.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, actor.id)));
  await recordAudit({ actor, action: "user.session_revoked", entityType: "user_session", entityId: sessionId });
  revalidatePath("/profile");
}

export async function removeWebauthnCredential(credentialId: string) {
  const actor = await requireUser();
  await db.delete(webauthnCredentials).where(and(eq(webauthnCredentials.id, credentialId), eq(webauthnCredentials.userId, actor.id)));
  await recordAudit({ actor, action: "user.webauthn_removed", entityType: "user", entityId: actor.id });
  revalidatePath("/profile");
}
