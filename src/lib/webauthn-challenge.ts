import "server-only";
import { cookies } from "next/headers";

const CHALLENGE_COOKIE = "pms_webauthn_challenge";

export async function stashChallenge(challenge: string) {
  const cookieStore = await cookies();
  cookieStore.set(CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 5,
    path: "/",
  });
}

export async function popChallenge(): Promise<string | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(CHALLENGE_COOKIE)?.value ?? null;
  cookieStore.delete(CHALLENGE_COOKIE);
  return value;
}
