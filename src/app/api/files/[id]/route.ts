import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentClient } from "@/lib/client-auth";
import { getFileById, readStoredFile } from "@/lib/storage";
import { db } from "@/db/client";
import { documentVersions } from "@/db/schema";
import { PERMISSIONS } from "@/lib/rbac";

/**
 * Every file read goes through here rather than a public disk path
 * (section 54: private/signed URLs for sensitive documents). This is the
 * "signed URL" seam for local dev; swapping storage.ts for S3/Supabase in
 * production means this route can instead 302 to a real signed URL.
 *
 * Files with kind "drawing" back the Documents module. For those, the raw
 * bytes are always served inline (never as a browser "Save As" download)
 * unless the caller both passes ?download=1 AND holds FILE_DOWNLOAD
 * (owner only by default) — everyone else gets in-app viewing through
 * ProtectedViewer, which fetches this same inline response and renders it
 * to canvas rather than a native file download.
 *
 * Every other file kind (avatars, chat attachments, task submissions,
 * receipts, CAD source files, voice notes, etc.) keeps its original,
 * unrestricted-beyond-sign-in behavior — this route is shared across the
 * whole app and widening that is out of scope for this feature.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wantsDownload = req.nextUrl.searchParams.get("download") === "1";

  const file = await getFileById(id);
  if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });

  const staffUser = await getCurrentUser();

  if (staffUser) {
    if (file.kind === "drawing") {
      const canDownload = staffUser.permissions.includes(PERMISSIONS.FILE_DOWNLOAD);
      if (wantsDownload && !canDownload) {
        return NextResponse.json({ error: "Only the studio owner can download this file to a device." }, { status: 403 });
      }
      const buffer = await readStoredFile(file.storageKey);
      return new NextResponse(buffer as unknown as BodyInit, {
        headers: {
          "Content-Type": file.mimeType,
          "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(file.originalName)}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    // Non-document files: unchanged prior behavior.
    const buffer = await readStoredFile(file.storageKey);
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalName)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  // Not staff — check for a client-portal session with a share that grants exactly this file.
  const client = await getCurrentClient();
  if (client) {
    const version = await db.query.documentVersions.findFirst({ where: eq(documentVersions.fileId, id) });
    const share = version
      ? await db.query.clientDrawingShares.findFirst({
          where: (s, { and: a, eq: e }) => a(e(s.documentVersionId, version.id), e(s.clientId, client.clientId)),
        })
      : null;
    if (!share) return NextResponse.json({ error: "This file hasn't been shared with you." }, { status: 403 });

    // Clients never get a real download — ?download=1 is ignored for them.
    const buffer = await readStoredFile(file.storageKey);
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return NextResponse.json({ error: "Please sign in." }, { status: 401 });
}
