import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createPresignedUpload } from "@/lib/storage";

/**
 * Step 1 of a direct-to-R2 upload (see storage.ts). Signed-in staff only —
 * every other file type/flow in the app uploads while authenticated. The
 * public job-application resume upload has its own route below since it
 * has no session to check.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "";
  const originalName = typeof body?.originalName === "string" ? body.originalName : "";
  const sizeBytes = typeof body?.sizeBytes === "number" ? body.sizeBytes : 0;
  if (!mimeType || !originalName) return NextResponse.json({ error: "Missing file details." }, { status: 400 });

  try {
    const result = await createPresignedUpload({ mimeType, originalName, sizeBytes });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't prepare upload." }, { status: 400 });
  }
}
