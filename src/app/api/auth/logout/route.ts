import { NextResponse } from "next/server";
import { destroySession, getCurrentUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    await recordAudit({ actor: user, action: "user.logout", entityType: "user", entityId: user.id });
  }
  await destroySession();
  return NextResponse.json({ ok: true });
}
