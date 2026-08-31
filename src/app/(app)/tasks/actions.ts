"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks, taskComments, taskHistory, taskSubmissions, taskSubmissionAttachments, employees, users, notifications } from "@/db/schema";
import { requirePermission, requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { statusLabel } from "@/lib/format";
import { PERMISSIONS } from "@/lib/rbac";
import { registerUploadedFile } from "@/lib/storage";
import { saveVoiceNote } from "@/lib/voice";

/** A task is still "open" if work on it hasn't finished or been called off — see the duplicate check in createTask. */
const OPEN_TASK_STATUSES = ["to_do", "in_progress", "submitted", "modification_required"] as const;

/**
 * Lightweight self-service progress moves the board (section below) lets an
 * assignee make without going through the structured submit/review flows —
 * e.g. dragging a card from "To Do" to "In Progress" is just a status flip,
 * not a review decision, so it doesn't need SubmitWorkPanel's note/files.
 * Keyed by target status -> the statuses it's valid to come from.
 */
const ASSIGNEE_PROGRESS_MOVES: Record<string, string[]> = {
  in_progress: ["to_do", "modification_required"],
  to_do: ["in_progress"],
};

const createTaskSchema = z.object({
  title: z.string().min(2, "Give the task a title."),
  description: z.string().optional(),
  projectId: z.string().optional(),
  siteId: z.string().optional(),
  assignedToId: z.string().min(1, "Choose who this is assigned to."),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  dueDate: z.string().optional(),
  instructions: z.string().optional(),
});

export type FormState = { error?: string; ok?: boolean };

export async function createTask(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission(PERMISSIONS.TASK_CREATE).catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const raw = Object.fromEntries(formData);
  const parsed = createTaskSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const data = parsed.data;

  // No duplicate task: block if the same person already has an open task
  // with this exact title on the same project/site. Doesn't look at
  // approved/cancelled/rescheduled tasks — a same-titled recurring task
  // (e.g. "Site visit report") is fine once the last one is actually done.
  const duplicateTask = await db.query.tasks.findFirst({
    where: and(
      eq(tasks.assignedToId, data.assignedToId),
      inArray(tasks.status, OPEN_TASK_STATUSES),
      sql`lower(${tasks.title}) = lower(${data.title})`,
      data.projectId ? eq(tasks.projectId, data.projectId) : isNull(tasks.projectId),
      data.siteId ? eq(tasks.siteId, data.siteId) : isNull(tasks.siteId)
    ),
  });
  if (duplicateTask) {
    return {
      error: `This person already has an open task titled "${data.title}" on the same project/site (status: ${statusLabel(duplicateTask.status)}). Update that task instead of creating a duplicate.`,
    };
  }

  const [task] = await db
    .insert(tasks)
    .values({
      title: data.title,
      description: data.description || null,
      projectId: data.projectId || null,
      siteId: data.siteId || null,
      assignedToId: data.assignedToId,
      assignedById: actor.id,
      priority: data.priority,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      instructions: data.instructions || null,
      status: "to_do",
    })
    .returning();

  await db.insert(taskHistory).values({ taskId: task.id, action: "created", toStatus: "to_do", actorId: actor.id });

  const employee = await db.query.employees.findFirst({ where: eq(employees.id, data.assignedToId) });
  if (employee) {
    await db.insert(notifications).values({
      recipientId: employee.userId,
      type: "task_assigned",
      title: "New task assigned",
      message: `You've been assigned: ${data.title}`,
      relatedEntityType: "task",
      relatedEntityId: task.id,
    });
  }

  await recordAudit({ actor, action: "task.created", entityType: "task", entityId: task.id, newState: { title: data.title, assignedToId: data.assignedToId } });
  revalidatePath("/tasks");
  return { ok: true };
}

/**
 * Powers the "To Do" <-> "In Progress" (and "Modification Required" ->
 * "In Progress") moves on the task board — see ASSIGNEE_PROGRESS_MOVES
 * above. Anything that needs a note/attachments or a review decision
 * (submitting work, approving, requesting changes) still goes through
 * submitTask/reviewTask, which the board opens a small modal for instead
 * of moving instantly.
 */
export async function updateTaskProgress(taskId: string, target: "to_do" | "in_progress") {
  const actor = await requireUser();
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) throw new Error("Task not found.");
  if (actor.employeeId !== task.assignedToId) throw new Error("Only the person this task is assigned to can move it here.");

  const allowedFrom = ASSIGNEE_PROGRESS_MOVES[target] ?? [];
  if (!allowedFrom.includes(task.status)) {
    throw new Error(`Can't move this task from "${statusLabel(task.status)}" to "${statusLabel(target)}".`);
  }

  await db.update(tasks).set({ status: target }).where(eq(tasks.id, taskId));
  await db.insert(taskHistory).values({ taskId, action: "status_changed", fromStatus: task.status, toStatus: target, actorId: actor.id });
  await recordAudit({ actor, action: "task.status_changed", entityType: "task", entityId: taskId, previousState: { status: task.status }, newState: { status: target } });

  revalidatePath("/tasks");
  revalidatePath("/tasks/board");
  revalidatePath(`/tasks/${taskId}`);
}

export async function addTaskComment(taskId: string, formData: FormData) {
  const actor = await requireUser();
  const type = String(formData.get("type") || "text") as "text" | "voice" | "photo" | "document";
  const text = formData.get("text") as string | null;
  const fileKey = formData.get("fileKey") as string | null;
  const fileMimeType = formData.get("fileMimeType") as string | null;
  const fileOriginalName = formData.get("fileOriginalName") as string | null;
  const voiceFile = formData.get("voice") as File | null;
  const transcript = formData.get("transcript") as string | null;
  const durationRaw = formData.get("duration") as string | null;

  let fileId: string | undefined;
  let voiceNoteId: string | undefined;

  if (type === "voice" && voiceFile && voiceFile.size > 0) {
    const note = await saveVoiceNote({ file: voiceFile, transcript, durationSeconds: durationRaw ? Number(durationRaw) : null, recordedBy: actor.id });
    voiceNoteId = note.id;
  } else if ((type === "photo" || type === "document") && fileKey && fileMimeType && fileOriginalName) {
    const saved = await registerUploadedFile({
      key: fileKey,
      originalName: fileOriginalName,
      mimeType: fileMimeType,
      kind: type === "photo" ? "photo" : "document",
      uploadedBy: actor.id,
      relatedEntityType: "task",
      relatedEntityId: taskId,
    });
    fileId = saved.id;
  } else if (type === "text" && !text?.trim()) {
    throw new Error("Write a comment first.");
  }

  await db.insert(taskComments).values({
    taskId,
    authorId: actor.id,
    type,
    text_: text || null,
    fileId,
    voiceNoteId,
  });

  await recordAudit({ actor, action: "task.comment_added", entityType: "task", entityId: taskId, newState: { type } });
  revalidatePath(`/tasks/${taskId}`);
}

export async function submitTask(taskId: string, formData: FormData) {
  const actor = await requireUser();
  if (!actor.employeeId) throw new Error("No employee profile linked to your account.");

  const note = formData.get("note") as string | null;
  const filesJson = formData.get("filesJson") as string | null;
  const uploadedFiles: { key: string; mimeType: string; originalName: string }[] = filesJson ? JSON.parse(filesJson) : [];

  const priorSubmissions = await db.query.taskSubmissions.findMany({ where: eq(taskSubmissions.taskId, taskId) });
  const version = priorSubmissions.length + 1;

  const [submission] = await db
    .insert(taskSubmissions)
    .values({ taskId, employeeId: actor.employeeId, version, note: note || null, status: "pending_review" })
    .returning();

  for (const f of uploadedFiles) {
    const saved = await registerUploadedFile({
      key: f.key,
      originalName: f.originalName,
      mimeType: f.mimeType,
      kind: "document",
      uploadedBy: actor.id,
      relatedEntityType: "task_submission",
      relatedEntityId: submission.id,
    });
    await db.insert(taskSubmissionAttachments).values({ submissionId: submission.id, fileId: saved.id });
  }

  const before = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  await db.update(tasks).set({ status: "submitted" }).where(eq(tasks.id, taskId));
  await db.insert(taskHistory).values({ taskId, action: "submitted", fromStatus: before?.status, toStatus: "submitted", actorId: actor.id, note: note || undefined });

  if (before) {
    const assignerNotif = await db.query.users.findFirst({ where: eq(users.id, before.assignedById) });
    if (assignerNotif) {
      await db.insert(notifications).values({
        recipientId: assignerNotif.id,
        type: "task_submitted",
        title: "Work submitted for review",
        message: `${actor.name} submitted work for: ${before.title}`,
        relatedEntityType: "task",
        relatedEntityId: taskId,
      });
    }
  }

  await recordAudit({ actor, action: "task.submitted", entityType: "task", entityId: taskId, newState: { version } });
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");
}

export async function reviewTask(taskId: string, decision: "approved" | "modification_requested", note: string) {
  const actor = await requirePermission(PERMISSIONS.TASK_APPROVE);

  const submission = await db.query.taskSubmissions.findFirst({
    where: eq(taskSubmissions.taskId, taskId),
    orderBy: (s, { desc }) => desc(s.submittedAt),
  });
  if (!submission) throw new Error("No submission to review.");

  await db.update(taskSubmissions).set({ status: decision, reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note || null }).where(eq(taskSubmissions.id, submission.id));

  const newStatus = decision === "approved" ? "approved" : "modification_required";
  const before = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  await db.update(tasks).set({ status: newStatus }).where(eq(tasks.id, taskId));
  await db.insert(taskHistory).values({ taskId, action: decision, fromStatus: before?.status, toStatus: newStatus, actorId: actor.id, note });

  if (before) {
    const employee = await db.query.employees.findFirst({ where: eq(employees.id, before.assignedToId) });
    if (employee) {
      await db.insert(notifications).values({
        recipientId: employee.userId,
        type: decision === "approved" ? "task_approved" : "task_modification_required",
        title: decision === "approved" ? "Task approved" : "Modification requested",
        message: `${before.title}: ${decision === "approved" ? "approved" : "needs changes"}${note ? ` — ${note}` : ""}`,
        relatedEntityType: "task",
        relatedEntityId: taskId,
      });
    }
  }

  await recordAudit({ actor, action: `task.${decision}`, entityType: "task", entityId: taskId, newState: { note } });
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");
}

/** Carry forward / reschedule a pending task (section 30) — creates a new linked task and cancels the old one, preserving full history. */
export async function rescheduleTask(taskId: string, newDueDate: string) {
  const actor = await requirePermission(PERMISSIONS.TASK_CREATE);
  const original = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!original) throw new Error("Task not found.");

  const [next] = await db
    .insert(tasks)
    .values({
      title: original.title,
      description: original.description,
      projectId: original.projectId,
      siteId: original.siteId,
      assignedToId: original.assignedToId,
      assignedById: actor.id,
      priority: original.priority,
      dueDate: new Date(newDueDate),
      instructions: original.instructions,
      status: "to_do",
      previousTaskId: original.id,
    })
    .returning();

  await db.update(tasks).set({ status: "rescheduled" }).where(eq(tasks.id, taskId));
  await db.insert(taskHistory).values({ taskId, action: "rescheduled", fromStatus: original.status, toStatus: "rescheduled", actorId: actor.id, note: `Carried forward to ${newDueDate}` });
  await db.insert(taskHistory).values({ taskId: next.id, action: "created_from_reschedule", toStatus: "to_do", actorId: actor.id });

  await recordAudit({ actor, action: "task.rescheduled", entityType: "task", entityId: taskId, newState: { newTaskId: next.id, newDueDate } });
  revalidatePath("/tasks");
  return next.id;
}

export async function cancelTask(taskId: string, reason: string) {
  const actor = await requirePermission(PERMISSIONS.TASK_CREATE);
  const before = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  await db.update(tasks).set({ status: "cancelled" }).where(eq(tasks.id, taskId));
  await db.insert(taskHistory).values({ taskId, action: "cancelled", fromStatus: before?.status, toStatus: "cancelled", actorId: actor.id, note: reason });
  await recordAudit({ actor, action: "task.cancelled", entityType: "task", entityId: taskId, newState: { reason } });
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");
}
