"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { setFeatureFlag } from "@/lib/feature-flags";
import { syncPermissions } from "@/lib/permissions-sync";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";

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
