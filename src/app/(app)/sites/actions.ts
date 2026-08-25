"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sites, geofences, siteAssignments } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";

const schema = z.object({
  name: z.string().min(2, "Give the site a name."),
  projectId: z.string().min(1, "Choose a project."),
  city: z.string().min(1, "City is required."),
  addressLine: z.string().optional(),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  radiusMeters: z.coerce.number().min(20).max(2000).default(100),
  startDate: z.string().optional(),
  expectedCompletion: z.string().optional(),
});

export type FormState = { error?: string; ok?: boolean; siteId?: string };

export async function createSite(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission(PERMISSIONS.SITE_MANAGE).catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const data = parsed.data;

  const [geofence] = await db
    .insert(geofences)
    .values({ name: `${data.name} — geofence`, type: "site", latitude: data.latitude, longitude: data.longitude, radiusMeters: data.radiusMeters })
    .returning();

  const [site] = await db
    .insert(sites)
    .values({
      name: data.name,
      projectId: data.projectId,
      geofenceId: geofence.id,
      city: data.city,
      addressLine: data.addressLine || null,
      latitude: data.latitude,
      longitude: data.longitude,
      status: "active",
      healthStatus: "normal",
      startDate: data.startDate ? new Date(data.startDate) : null,
      expectedCompletion: data.expectedCompletion ? new Date(data.expectedCompletion) : null,
    })
    .returning();

  await recordAudit({ actor, action: "site.created", entityType: "site", entityId: site.id, newState: { name: data.name, city: data.city } });
  revalidatePath("/sites");
  return { ok: true, siteId: site.id };
}

export async function assignEmployeeToSite(siteId: string, employeeId: string, role: string) {
  const actor = await requirePermission(PERMISSIONS.SITE_MANAGE);
  const existing = await db.query.siteAssignments.findFirst({
    where: (a, { and, eq: eqOp }) => and(eqOp(a.siteId, siteId), eqOp(a.employeeId, employeeId)),
  });
  if (existing) throw new Error("This employee is already assigned to the site.");

  await db.insert(siteAssignments).values({ siteId, employeeId, role });
  await recordAudit({ actor, action: "site.employee_assigned", entityType: "site", entityId: siteId, newState: { employeeId, role } });
  revalidatePath(`/sites/${siteId}`);
}

export async function removeEmployeeFromSite(assignmentId: string, siteId: string) {
  const actor = await requirePermission(PERMISSIONS.SITE_MANAGE);
  await db.delete(siteAssignments).where(eq(siteAssignments.id, assignmentId));
  await recordAudit({ actor, action: "site.employee_unassigned", entityType: "site", entityId: siteId });
  revalidatePath(`/sites/${siteId}`);
}
