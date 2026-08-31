"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { documents, documentVersions } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { registerUploadedFile } from "@/lib/storage";

const schema = z.object({
  name: z.string().min(2, "Give the document a name."),
  categoryId: z.string().optional(),
  projectId: z.string().optional(),
  siteId: z.string().optional(),
  description: z.string().optional(),
});

export type FormState = { error?: string; ok?: boolean; documentId?: string };

export async function createDocument(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission(PERMISSIONS.DOCUMENT_UPLOAD).catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const fileKey = formData.get("fileKey") as string | null;
  const fileMimeType = formData.get("fileMimeType") as string | null;
  const fileOriginalName = formData.get("fileOriginalName") as string | null;
  if (!fileKey || !fileMimeType || !fileOriginalName) return { error: "Choose and upload a file first." };

  const data = parsed.data;
  const [doc] = await db
    .insert(documents)
    .values({
      name: data.name,
      categoryId: data.categoryId || null,
      projectId: data.projectId || null,
      siteId: data.siteId || null,
      description: data.description || null,
      createdBy: actor.id,
    })
    .returning();

  const saved = await registerUploadedFile({
    key: fileKey,
    originalName: fileOriginalName,
    mimeType: fileMimeType,
    kind: "drawing",
    visibility: "internal",
    uploadedBy: actor.id,
    relatedEntityType: "document",
    relatedEntityId: doc.id,
  });

  await db.insert(documentVersions).values({ documentId: doc.id, versionNumber: 1, fileId: saved.id, status: "draft", uploadedBy: actor.id });

  await recordAudit({ actor, action: "document.uploaded", entityType: "document", entityId: doc.id, newState: { name: data.name } });
  revalidatePath("/documents");
  return { ok: true, documentId: doc.id };
}

export async function uploadNewVersion(documentId: string, formData: FormData) {
  const actor = await requirePermission(PERMISSIONS.DOCUMENT_UPLOAD);
  const fileKey = formData.get("fileKey") as string | null;
  const fileMimeType = formData.get("fileMimeType") as string | null;
  const fileOriginalName = formData.get("fileOriginalName") as string | null;
  const changeNote = formData.get("changeNote") as string | null;
  if (!fileKey || !fileMimeType || !fileOriginalName) throw new Error("Choose and upload a file first.");

  const latest = await db.query.documentVersions.findFirst({ where: eq(documentVersions.documentId, documentId), orderBy: (v, { desc: d }) => d(v.versionNumber) });
  const nextVersion = (latest?.versionNumber ?? 0) + 1;

  const saved = await registerUploadedFile({
    key: fileKey,
    originalName: fileOriginalName,
    mimeType: fileMimeType,
    kind: "drawing",
    visibility: "internal",
    uploadedBy: actor.id,
    relatedEntityType: "document",
    relatedEntityId: documentId,
  });

  if (latest) {
    await db.update(documentVersions).set({ status: "superseded" }).where(eq(documentVersions.id, latest.id));
  }

  const [version] = await db
    .insert(documentVersions)
    .values({ documentId, versionNumber: nextVersion, fileId: saved.id, parentVersionId: latest?.id, changeNote: changeNote || null, status: "internal_revised", uploadedBy: actor.id })
    .returning();

  await recordAudit({ actor, action: "document.version_created", entityType: "document", entityId: documentId, newState: { versionNumber: nextVersion } });
  revalidatePath(`/documents/${documentId}`);
  return version;
}
