"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { documentCategories } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { setFeatureFlag } from "@/lib/feature-flags";
import { syncPermissions } from "@/lib/permissions-sync";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";

// The spec's suggested category list for the client-facing drawing library
// — inserted only if not already present by key, so re-running this is
// always safe (same idempotent pattern as syncPermissions()).
const STANDARD_DOCUMENT_CATEGORIES = [
  { key: "electrical", name: "Electrical" },
  { key: "plumbing", name: "Plumbing" },
  { key: "hvac", name: "HVAC" },
  { key: "furniture", name: "Furniture" },
  { key: "flooring", name: "Flooring" },
  { key: "ceiling", name: "Ceiling" },
  { key: "structural", name: "Structural" },
];

function slugifyCategoryKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function addDocumentCategory(_prev: { error?: string; ok?: boolean }, formData: FormData) {
  const actor = await requirePermission(PERMISSIONS.SETTINGS_MANAGE).catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const name = (formData.get("name") as string | null)?.trim();
  if (!name || name.length < 2) return { error: "Give the category a name." };
  const key = slugifyCategoryKey(name);
  if (!key) return { error: "Give the category a name." };

  const existing = await db.query.documentCategories.findFirst({ where: eq(documentCategories.key, key) });
  if (existing) return { error: "A category with this name already exists." };

  await db.insert(documentCategories).values({ key, name });
  await recordAudit({ actor, action: "document_category.created", entityType: "document_category", entityId: key, newState: { name } });
  revalidatePath("/settings");
  revalidatePath("/documents");
  revalidatePath("/documents/new");
  return { ok: true };
}

export async function seedStandardDocumentCategories() {
  const actor = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  const existing = await db.select({ key: documentCategories.key }).from(documentCategories);
  const existingKeys = new Set(existing.map((c) => c.key));
  const toAdd = STANDARD_DOCUMENT_CATEGORIES.filter((c) => !existingKeys.has(c.key));
  if (toAdd.length > 0) {
    await db.insert(documentCategories).values(toAdd);
    await recordAudit({ actor, action: "document_category.standard_seeded", entityType: "document_category", entityId: "batch", newState: { added: toAdd.map((c) => c.key) } });
  }
  revalidatePath("/settings");
  revalidatePath("/documents");
  revalidatePath("/documents/new");
  return { added: toAdd.length };
}

export async function toggleFeatureFlag(key: string, enabled: boolean) {
  const actor = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  await setFeatureFlag(key, enabled, actor.id);
  await recordAudit({ actor, action: enabled ? "feature_flag.enabled" : "feature_flag.disabled", entityType: "feature_flag", entityId: key });
  revalidatePath("/settings");
}

/**
 * The in-app equivalent of visiting /api/setup/sync-permissions?secret=...
 * by hand — same underlying logic (lib/permissions-sync.ts), but gated by
 * an actual signed-in owner session instead of a URL secret, so this is
 * the button to reach for after every feature update from here on.
 */
export async function syncPermissionsAction() {
  const actor = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  const result = await syncPermissions();
  await recordAudit({ actor, action: "permissions.synced", entityType: "permissions", entityId: "all", newState: { changes: result.changes } });
  revalidatePath("/settings");
  return result;
}
