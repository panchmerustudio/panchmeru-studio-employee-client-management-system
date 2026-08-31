import { NextResponse } from "next/server";
import { destroyVendorSession } from "@/lib/vendor-auth";

export async function POST() {
  await destroyVendorSession();
  return NextResponse.json({ ok: true });
}
