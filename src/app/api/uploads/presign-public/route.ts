import { NextRequest, NextResponse } from "next/server";
import { createPresignedUpload } from "@/lib/storage";

// Only the public /apply careers page uploads without a signed-in session.
// Kept deliberately tighter than the authenticated presign route — a
// smaller allowlist and a lower size cap — since anyone on the internet
// can call this, not just staff.
const PUBLIC_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);
const PUBLIC_MAX_BYTES = 8 * 1024 * 1024; // 8MB — plenty for a resume/portfolio file

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "";
  const originalName = typeof body?.originalName === "string" ? body.originalName : "";
  const sizeBytes = typeof body?.sizeBytes === "number" ? body.sizeBytes : 0;
  if (!mimeType || !originalName) return NextResponse.json({ error: "Missing file details." }, { status: 400 });
  if (!PUBLIC_ALLOWED_MIME_TYPES.has(mimeType)) return NextResponse.json({ error: "Please upload a PDF, Word document, or image." }, { status: 400 });
  if (sizeBytes > PUBLIC_MAX_BYTES) return NextResponse.json({ error: "This file is too large (8MB limit)." }, { status: 400 });

  try {
    const result = await createPresignedUpload({ mimeType, originalName, sizeBytes });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't prepare upload." }, { status: 400 });
  }
}
