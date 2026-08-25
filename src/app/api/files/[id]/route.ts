import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getFileById, readStoredFile } from "@/lib/storage";

/**
 * Every file read goes through here rather than a public disk path
 * (section 54: private/signed URLs for sensitive documents). This is the
 * "signed URL" seam for local dev; swapping storage.ts for S3/Supabase in
 * production means this route can instead 302 to a real signed URL.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const file = await getFileById(id);
  if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });

  // Internal-visibility files are staff-only (which everyone with a session already is);
  // this is the seam where client-portal visibility checks plug in once that module is on.
  const buffer = await readStoredFile(file.storageKey);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalName)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
