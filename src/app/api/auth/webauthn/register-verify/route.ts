import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { verifyAndStoreRegistration } from "@/lib/webauthn";
import { popChallenge } from "@/lib/webauthn-challenge";
import { recordAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const { response, nickname } = await req.json().catch(() => ({ response: null, nickname: undefined }));
  const challenge = await popChallenge();
  if (!response || !challenge) {
    return NextResponse.json({ error: "Registration session expired. Please try again." }, { status: 400 });
  }
  try {
    await verifyAndStoreRegistration({ userId: user.id, response, expectedChallenge: challenge, nickname });
    await recordAudit({ actor: user, action: "user.webauthn_registered", entityType: "user", entityId: user.id, newState: { nickname } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not register this device." }, { status: 400 });
  }
}
