"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { jobApplications } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";

const STATUSES = ["new", "reviewing", "shortlisted", "rejected", "hired"] as const;

export async function updateApplicationStatus(applicationId: string, status: (typeof STATUSES)[number], note: string) {
  const actor = await requirePermission(PERMISSIONS.RECRUITMENT_MANAGE);
  const before = await db.query.jobApplications.findFirst({ where: eq(jobApplications.id, applicationId) });
  if (!before) throw new Error("Application not found.");

  await db
    .update(jobApplications)
    .set({ status, reviewNote: note || null, reviewedBy: actor.id })
    .where(eq(jobApplications.id, applicationId));

  await recordAudit({
    actor,
    action: "job_application.status_changed",
    entityType: "job_application",
    entityId: applicationId,
    previousState: { status: before.status },
    newState: { status, note },
  });

  revalidatePath("/recruitment");
  revalidatePath(`/recruitment/${applicationId}`);
}
