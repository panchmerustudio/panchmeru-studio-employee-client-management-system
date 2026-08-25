import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { sitePhotos } from "@/db/schema";
import { saveFile } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const siteId = form?.get("siteId") as string | null;
  const siteVisitId = form?.get("siteVisitId") as string | null;
  const caption = form?.get("caption") as string | null;
  const file = form?.get("file") as File | null;
  if (!siteId || !file || file.size === 0) return NextResponse.json({ error: "Choose a photo to upload." }, { status: 400 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveFile({
      buffer,
      originalName: file.name,
      mimeType: file.type || "image/jpeg",
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
