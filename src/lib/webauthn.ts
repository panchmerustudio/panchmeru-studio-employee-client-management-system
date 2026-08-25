import "server-only";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/types";
import { db } from "@/db/client";
import { webauthnCredentials, users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Device biometric authentication (spec section 24/59) via the WebAuthn
 * platform authenticator (Face ID / Touch ID / Android fingerprint /
 * Windows Hello — whatever the device's browser exposes). We only ever
 * see a public key + signature counter; the biometric itself never
 * leaves the user's device, satisfying "never store raw
 * fingerprint/face biometric data" by construction.
 */

export function rpID() {
  return process.env.WEBAUTHN_RP_ID || "localhost";
}
export function rpOrigin() {
  return process.env.WEBAUTHN_ORIGIN || "http://localhost:3000";
}
const rpName = "Panchmeru Studio";

export async function buildRegistrationOptions(userId: string, userName: string) {
  const existing = await db.query.webauthnCredentials.findMany({ where: eq(webauthnCredentials.userId, userId) });
  return generateRegistrationOptions({
    rpName,
    rpID: rpID(),
    userID: userId,
    userName,
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform", // biometric on THIS device, not a roaming security key
      userVerification: "required",
      residentKey: "preferred",
    },
    excludeCredentials: existing.map((c) => ({ id: Buffer.from(c.credentialId, "base64url"), type: "public-key" as const })),
  });
}

export async function verifyAndStoreRegistration(opts: {
  userId: string;
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  nickname?: string;
}) {
  const verification = await verifyRegistrationResponse({
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: rpOrigin(),
    expectedRPID: rpID(),
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("We couldn't verify this device's biometric registration. Please try again.");
  }
  const { credentialID, credentialPublicKey, counter, credentialDeviceType } = verification.registrationInfo;
  await db.insert(webauthnCredentials).values({
    userId: opts.userId,
    credentialId: Buffer.from(credentialID).toString("base64url"),
    publicKey: Buffer.from(credentialPublicKey).toString("base64url"),
    counter,
    deviceType: credentialDeviceType,
    nickname: opts.nickname ?? "This device",
  });
  return true;
}

export async function buildAuthenticationOptions(userId?: string) {
  let allowCredentials: { id: Buffer; type: "public-key" }[] | undefined;
  if (userId) {
    const creds = await db.query.webauthnCredentials.findMany({ where: eq(webauthnCredentials.userId, userId) });
    allowCredentials = creds.map((c) => ({ id: Buffer.from(c.credentialId, "base64url"), type: "public-key" as const }));
  }
  return generateAuthenticationOptions({
    rpID: rpID(),
    userVerification: "required",
    allowCredentials,
  });
}

export async function verifyAuthentication(opts: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
}) {
  const credentialId = opts.response.id;
  const stored = await db.query.webauthnCredentials.findFirst({
    where: eq(webauthnCredentials.credentialId, credentialId),
  });
  if (!stored) throw new Error("This device is not registered for biometric sign-in.");

  const verification = await verifyAuthenticationResponse({
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: rpOrigin(),
    expectedRPID: rpID(),
    authenticator: {
      credentialID: Buffer.from(stored.credentialId, "base64url"),
      credentialPublicKey: Buffer.from(stored.publicKey, "base64url"),
      counter: stored.counter,
    },
  });
  if (!verification.verified) {
    throw new Error("Biometric verification failed.");
  }
  await db
    .update(webauthnCredentials)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(webauthnCredentials.id, stored.id));

  const user = await db.query.users.findFirst({ where: eq(users.id, stored.userId) });
  return user;
}
