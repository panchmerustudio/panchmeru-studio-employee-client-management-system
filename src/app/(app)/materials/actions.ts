"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { materialRequests, materialRequestItems } from "@/db/schema";
import { requireUser, requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";

export type FormState = { error?: string; ok?: boolean };

export async function createMaterialRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser().catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const siteId = formData.get("siteId") as string;
  const materialName = formData.get("materialName") as string;
  const quantity = Number(formData.get("quantity"));
  const unit = formData.get("unit") as string;
  const reason = formData.get("reason") as string;
  const requiredDate = formData.get("requiredDate") as string;

  if (!siteId || !materialName || !quantity || !unit) return { error: "Please fill in the material details." };

  const [request] = await db
    .insert(materialRequests)
    .values({ siteId, requestedBy: actor.id, reason: reason || null, requiredDate: requiredDate ? new Date(requiredDate) : null, status: "pending" })
    .returning();

  await db.insert(materialRequestItems).values({ materialRequestId: request.id, materialName, quantity, unit });

  await recordAudit({ actor, action: "material_request.created", entityType: "material_request", entityId: request.id, newState: { materialName, quantity, unit } });
  revalidatePath("/materials");
  return { ok: true };
}

export async function decideMaterialRequest(id: string, status: "approved" | "rejected" | "ordered" | "received", comment?: string) {
  const actor = await requirePermission(PERMISSIONS.MATERIAL_APPROVE);
  const before = await db.query.materialRequests.findFirst({ where: eq(materialRequests.id, id) });
  await db.update(materialRequests).set({ status, reviewedBy: actor.id, reviewedAt: new Date(), reviewComment: comment || null }).where(eq(materialRequests.id, id));
  await recordAudit({ actor, action: `material_request.${status}`, entityType: "material_request", entityId: id, previousState: { status: before?.status }, newState: { status } });
  revalidatePath("/materials");
}
