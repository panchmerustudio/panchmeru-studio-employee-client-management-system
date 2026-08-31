import { NextRequest, NextResponse } from "next/server";
import { getCurrentClient } from "@/lib/client-auth";
import { createPresignedUpload } from "@/lib/storage";

/**
 * Step 1 of a direct-to-R2 upload, for the client portal specifically —
 * signed-in client sessions only (see /api/uploads/presign for the staff
 * equivalent, /api/uploads/presign-public for the unauthenticated /apply
 * page). Used for a revision request's optional photo/voice attachment
 * (see src/app/client/actions.ts).
 */
export async function POST(req: NextRequest) {
  const client = await getCurrentClient();
  if (!client) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

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
