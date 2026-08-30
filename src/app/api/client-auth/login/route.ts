import { NextRequest, NextResponse } from "next/server";
import { verifyClientLogin, createClientSession } from "@/lib/client-auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });

  const cu = await verifyClientLogin(email, password);
  if (!cu) return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });

  await createClientSession(cu.id);
  return NextResponse.json({ ok: true });
}
