import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { buildRegistrationOptions } from "@/lib/webauthn";
import { stashChallenge } from "@/lib/webauthn-challenge";

/** Must already be signed in (e.g. via password) to enroll a device for biometric sign-in. */
export async function POST() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const options = await buildRegistrationOptions(user.id, user.name);
  await stashChallenge(options.challenge);
  return NextResponse.json(options);
}
