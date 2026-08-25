"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { files as filesTable } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { checkStorageThresholdAndNotify, updateStorageCap } from "@/lib/storage-usage";
import { deleteStoredFile } from "@/lib/storage";

export async function setStorageCap(capGb: number) {
  const actor = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  if (!Number.isFinite(capGb) || capGb < 1 || capGb > 5000) {
    throw new Error("Enter a plan size between 1 and 5000 GB.");
  }
  await updateStorageCap(Math.round(capGb), actor.id);
  await recordAudit({ actor, action: "storage.cap_updated", entityType: "storage_settings", entityId: "singleton", newState: { capGb } });
  revalidatePath("/settings/storage");
}

export async function recheckStorage() {
  await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  await checkStorageThresholdAndNotify();
  revalidatePath("/settings/storage");
}

/**
 * Deletes a file's own row first — Postgres rejects that with a foreign
 * key violation (23503) if any other table (chat message, task
 * attachment, voice note, drawing, etc.) still points at it, which is
 * what backstops this against breaking something still in use. Only once
 * the DB row is gone do we delete the object from R2, so a still-in-use
 * file is never removed from storage either.
 */
export async function deleteFile(fileId: string) {
  const actor = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);

  const file = await db.query.files.findFirst({ where: eq(filesTable.id, fileId) });
  if (!file) throw new Error("File not found — it may already be deleted.");

  try {
    await db.delete(filesTable).where(eq(filesTable.id, fileId));
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23503") {
      throw new Error("This file is still attached to something (a task, message, or document) and can't be deleted from here.");
    }
    throw err;
  }

  try {
    await deleteStoredFile(file.storageKey);
  } catch (err) {
    // DB row is already gone (so the app no longer counts or serves it);
    // the object may be left behind in R2. Not fatal — log and move on.
    console.error(`Failed to delete R2 object for file ${fileId} (storageKey: ${file.storageKey}):`, err);
  }

  await recordAudit({
    actor,
    action: "file.deleted",
    entityType: "file",
    entityId: fileId,
    previousState: { originalName: file.originalName, sizeBytes: file.sizeBytes, kind: file.kind, storageKey: file.storageKey },
  });

  revalidatePath("/settings/storage");
}
