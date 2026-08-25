"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { projects, projectMilestones, projectMembers } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";

const createSchema = z.object({
  name: z.string().min(2, "Give the project a name."),
  projectTypeId: z.string().optional(),
  startDate: z.string().optional(),
  expectedCompletion: z.string().optional(),
});

export type FormState = { error?: string; ok?: boolean; projectId?: string };

export async function createProject(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission(PERMISSIONS.SITE_MANAGE).catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const data = parsed.data;

  const [project] = await db
    .insert(projects)
    .values({
      name: data.name,
      projectTypeId: data.projectTypeId || null,
      status: "active",
      startDate: data.startDate ? new Date(data.startDate) : null,
      expectedCompletion: data.expectedCompletion ? new Date(data.expectedCompletion) : null,
      createdBy: actor.id,
    })
    .returning();

  await recordAudit({ actor, action: "project.created", entityType: "project", entityId: project.id, newState: { name: data.name } });
  revalidatePath("/projects");
  return { ok: true, projectId: project.id };
}

export async function updateProjectStatus(projectId: string, status: "active" | "delayed" | "on_hold" | "completed" | "cancelled") {
  const actor = await requirePermission(PERMISSIONS.SITE_MANAGE);
  const before = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  await db.update(projects).set({ status }).where(eq(projects.id, projectId));
  await recordAudit({ actor, action: "project.status_changed", entityType: "project", entityId: projectId, previousState: { status: before?.status }, newState: { status } });
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
}

export async function addMilestone(projectId: string, formData: FormData) {
  const actor = await requirePermission(PERMISSIONS.SITE_MANAGE);
  const name = String(formData.get("name") || "").trim();
  const dueDate = formData.get("dueDate") as string | null;
  if (!name) throw new Error("Give the milestone a name.");

  const [milestone] = await db
    .insert(projectMilestones)
    .values({ projectId, name, dueDate: dueDate ? new Date(dueDate) : null, status: "pending" })
    .returning();

  await recordAudit({ actor, action: "milestone.created", entityType: "project_milestone", entityId: milestone.id, newState: { projectId, name } });
  revalidatePath(`/projects/${projectId}`);
}

export async function setMilestoneStatus(milestoneId: string, projectId: string, status: "pending" | "in_progress" | "done" | "missed") {
  const actor = await requirePermission(PERMISSIONS.SITE_MANAGE);
  await db
    .update(projectMilestones)
    .set({ status, completedAt: status === "done" ? new Date() : null })
    .where(eq(projectMilestones.id, milestoneId));
  await recordAudit({ actor, action: "milestone.status_changed", entityType: "project_milestone", entityId: milestoneId, newState: { status } });
  revalidatePath(`/projects/${projectId}`);
}

export async function addProjectMember(projectId: string, employeeId: string, roleOnProject: string) {
  const actor = await requirePermission(PERMISSIONS.SITE_MANAGE);
  if (!employeeId) throw new Error("Choose an employee.");
  const [member] = await db.insert(projectMembers).values({ projectId, employeeId, roleOnProject: roleOnProject || null }).returning();
  await recordAudit({ actor, action: "project_member.added", entityType: "project_member", entityId: member.id, newState: { projectId, employeeId } });
  revalidatePath(`/projects/${projectId}`);
}

export async function removeProjectMember(memberId: string, projectId: string) {
  const actor = await requirePermission(PERMISSIONS.SITE_MANAGE);
  await db.delete(projectMembers).where(eq(projectMembers.id, memberId));
  await recordAudit({ actor, action: "project_member.removed", entityType: "project_member", entityId: memberId, newState: { projectId } });
  revalidatePath(`/projects/${projectId}`);
}
