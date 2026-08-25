import { NextRequest, NextResponse } from "next/server";
import { verifyAuthentication } from "@/lib/webauthn";
import { popChallenge } from "@/lib/webauthn-challenge";
import { createSession, findOrCreateDevice } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const challenge = await popChallenge();
  if (!body || !challenge) {
    return NextResponse.json({ error: "Biometric sign-in session expired. Please try again." }, { status: 400 });
  }
  try {
    const user = await verifyAuthentication({ response: body, expectedChallenge: challenge });
    if (!user || user.status !== "active") {
      return NextResponse.json({ error: "This account is not active." }, { status: 403 });
    }
    const deviceId = await findOrCreateDevice(user.id, "web", "Biometric device");
    await createSession(user.id, deviceId);
    await recordAudit({ actor: null, action: "user.login", entityType: "user", entityId: user.id, newState: { method: "webauthn" } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Biometric sign-in failed." }, { status: 401 });
  }
}
