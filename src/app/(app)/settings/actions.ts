"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { setFeatureFlag } from "@/lib/feature-flags";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";

export async function toggleFeatureFlag(key: string, enabled: boolean) {
  const actor = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  await setFeatureFlag(key, enabled, actor.id);
  await recordAudit({ actor, action: enabled ? "feature_flag.enabled" : "feature_flag.disabled", entityType: "feature_flag", entityId: key });
  revalidatePath("/settings");
}
