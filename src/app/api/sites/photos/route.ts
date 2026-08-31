import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { sitePhotos } from "@/db/schema";
import { registerUploadedFile } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const siteId = typeof body?.siteId === "string" ? body.siteId : null;
  const siteVisitId = typeof body?.siteVisitId === "string" ? body.siteVisitId : null;
  const caption = typeof body?.caption === "string" ? body.caption : null;
  const fileKey = typeof body?.fileKey === "string" ? body.fileKey : null;
  const fileMimeType = typeof body?.fileMimeType === "string" ? body.fileMimeType : null;
  const fileOriginalName = typeof body?.fileOriginalName === "string" ? body.fileOriginalName : null;
  if (!siteId || !fileKey || !fileMimeType || !fileOriginalName) return NextResponse.json({ error: "Choose and upload a photo first." }, { status: 400 });

  try {
    const saved = await registerUploadedFile({
      key: fileKey,
      originalName: fileOriginalName,
      mimeType: fileMimeType,
      kind: "photo",
      uploadedBy: user.id,
      relatedEntityType: "site",
      relatedEntityId: siteId,
    });
    const [photo] = await db
      .insert(sitePhotos)
      .values({ siteId, siteVisitId: siteVisitId || null, fileId: saved.id, caption: caption || null, uploadedBy: user.id })
      .returning();
    await recordAudit({ actor: user, action: "site.photo_uploaded", entityType: "site", entityId: siteId, newState: { photoId: photo.id } });
    return NextResponse.json({ ok: true, photo });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed." }, { status: 400 });
  }
}
