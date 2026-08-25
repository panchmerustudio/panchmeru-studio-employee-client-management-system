import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { buildAuthenticationOptions } from "@/lib/webauthn";
import { stashChallenge } from "@/lib/webauthn-challenge";

/**
 * We look up the user by email first so we can scope allowCredentials —
 * this is what lets the platform authenticator prompt directly (Face
 * ID / fingerprint) instead of asking the user to pick from every
 * passkey on the device.
 */
export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({ email: undefined }));
  let userId: string | undefined;
  if (email) {
    const user = await db.query.users.findFirst({
      where: (u, { or, eq }) => or(eq(u.email, email), eq(u.phone, email)),
    });
    userId = user?.id;
  }
  const options = await buildAuthenticationOptions(userId);
  await stashChallenge(options.challenge);
  return NextResponse.json(options);
}
