import { NextRequest, NextResponse } from "next/server";
import { syncPermissions } from "@/lib/permissions-sync";

export const maxDuration = 30;

/**
 * Secret-gated entry point for the same sync logic used by the owner-facing
 * "Sync permissions" button in Settings (see lib/permissions-sync.ts) — kept
 * around for first-time bootstrap and scripted/CI use where no one is
 * signed in yet. Once an owner can log in, Settings → Permissions is the
 * easier way to do this.
 */
async function handle(req: NextRequest) {
  const secret = process.env.SETUP_SECRET;
  if (!secret) return NextResponse.json({ error: "SETUP_SECRET is not configured." }, { status: 403 });
  if (req.nextUrl.searchParams.get("secret") !== secret) return NextResponse.json({ error: "Invalid or missing secret." }, { status: 401 });

  const result = await syncPermissions();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
