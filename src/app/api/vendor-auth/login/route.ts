import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { vendorActivities } from "@/db/schema";
import { verifyVendorLogin, createVendorSession } from "@/lib/vendor-auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });

  const vu = await verifyVendorLogin(email, password);
  if (!vu) return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });

  await createVendorSession(vu.id);
  await db.insert(vendorActivities).values({
    vendorId: vu.vendorId,
    activityType: "login",
    description: "Signed in to the vendor portal.",
  });
  return NextResponse.json({ ok: true });
}
