import { NextRequest, NextResponse } from "next/server";
import { seedDatabase } from "@/db/seed";

/**
 * One-time production seeding endpoint. Not linked from any UI — it exists
 * purely so a freshly-deployed database (schema already applied via the SQL
 * migration) can be populated once, from anywhere, without needing a local
 * Node environment with network access to the database.
 *
 * Gated behind SETUP_SECRET (set it in Vercel's env vars, then remove it —
 * or leave the env var unset — once you've seeded, so the endpoint can
 * never be called again). seedDatabase() itself is also idempotent: if
 * roles already exist, it no-ops instead of inserting duplicate data.
 */
async function handle(req: NextRequest) {
  const secret = process.env.SETUP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SETUP_SECRET is not configured — seeding is disabled." }, { status: 403 });
  }
  const provided = req.nextUrl.searchParams.get("secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Invalid or missing secret." }, { status: 401 });
  }

  try {
    const result = await seedDatabase();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("Seeding failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// GET is also accepted (in addition to POST) purely so this one-time,
// secret-gated setup step can be triggered with a plain URL visit —
// convenient for running it right after deploy without extra tooling.
export async function GET(req: NextRequest) {
  return handle(req);
}
