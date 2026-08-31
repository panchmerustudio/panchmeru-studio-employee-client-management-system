"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { projectPaymentSettings, paymentMilestones, paymentRecords, clientActivities, notifications, projects } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { registerUploadedFile } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";

const PAYMENT_MODES = ["cash", "cheque", "bank_transfer", "upi", "card", "other"] as const;

async function ensureSettingsRow(projectId: string, clientId: string) {
  const existing = await db.query.projectPaymentSettings.findFirst({ where: eq(projectPaymentSettings.projectId, projectId) });
  if (existing) return existing;
  const [row] = await db.insert(projectPaymentSettings).values({ projectId, clientId, enabled: false }).returning();
  return row;
}

/** The per-project ON/OFF switch (section 34) plus the total fee it's tracked against. */
export async function setPaymentSettings(clientId: string, projectId: string, enabled: boolean, totalFeeAmount: number | null) {
  const actor = await requirePermission(PERMISSIONS.CLIENT_MANAGE);
  await ensureSettingsRow(projectId, clientId);
  await db.update(projectPaymentSettings).set({ enabled, totalFeeAmount }).where(eq(projectPaymentSettings.projectId, projectId));
  await recordAudit({ actor, action: "client.payment_settings_changed", entityType: "project", entityId: projectId, newState: { enabled, totalFeeAmount } });
  revalidatePath(`/clients/${clientId}/payments`);
  revalidatePath("/client/payments");
}

export async function addPaymentMilestone(clientId: string, projectId: string, formData: FormData) {
  const actor = await requirePermission(PERMISSIONS.CLIENT_MANAGE);
  const name = (formData.get("name") as string | null)?.trim();
  const amount = Number(formData.get("amount"));
  const dueDateRaw = formData.get("dueDate") as string | null;
  if (!name) throw new Error("Give the milestone a name.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid amount.");

  const existingCount = await db.query.paymentMilestones.findMany({ where: eq(paymentMilestones.projectId, projectId), columns: { id: true } });

  await db.insert(paymentMilestones).values({
    projectId,
    name,
    amount,
    dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
    sequenceOrder: existingCount.length,
    createdBy: actor.id,
  });

  await recordAudit({ actor, action: "client.payment_milestone_added", entityType: "project", entityId: projectId, newState: { name, amount } });
  revalidatePath(`/clients/${clientId}/payments`);
  revalidatePath("/client/payments");
}

export async function deletePaymentMilestone(clientId: string, milestoneId: string) {
  const actor = await requirePermission(PERMISSIONS.CLIENT_MANAGE);
  await db.delete(paymentMilestones).where(eq(paymentMilestones.id, milestoneId));
  await recordAudit({ actor, action: "client.payment_milestone_deleted", entityType: "payment_milestone", entityId: milestoneId });
  revalidatePath(`/clients/${clientId}/payments`);
  revalidatePath("/client/payments");
}

export type RecordPaymentState = { error?: string; ok?: boolean };

export async function recordPayment(clientId: string, projectId: string, _prev: RecordPaymentState, formData: FormData): Promise<RecordPaymentState> {
  const actor = await requirePermission(PERMISSIONS.CLIENT_MANAGE).catch((e) => e as Error);
  if (actor instanceof Error) return { error: actor.message };

  const amount = Number(formData.get("amount"));
  const paidDateRaw = formData.get("paidDate") as string | null;
  const mode = formData.get("mode") as string | null;
  const reference = (formData.get("reference") as string | null)?.trim() || null;
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  const milestoneId = (formData.get("milestoneId") as string | null) || null;
  const receiptKey = formData.get("receiptKey") as string | null;
  const receiptMimeType = formData.get("receiptMimeType") as string | null;
  const receiptOriginalName = formData.get("receiptOriginalName") as string | null;

  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a valid amount." };
  if (!paidDateRaw) return { error: "Enter the payment date." };
  if (!mode || !PAYMENT_MODES.includes(mode as (typeof PAYMENT_MODES)[number])) return { error: "Choose a payment mode." };

  let receiptFileId: string | undefined;
  if (receiptKey && receiptMimeType && receiptOriginalName) {
    const saved = await registerUploadedFile({
      key: receiptKey,
      originalName: receiptOriginalName,
      mimeType: receiptMimeType,
      kind: "document",
      relatedEntityType: "payment_record",
    });
    receiptFileId = saved.id;
  }

  await ensureSettingsRow(projectId, clientId);

  const [record] = await db
    .insert(paymentRecords)
    .values({
      projectId,
      clientId,
      milestoneId: milestoneId || null,
      amount,
      paidDate: new Date(paidDateRaw),
      mode: mode as (typeof PAYMENT_MODES)[number],
      reference,
      receiptFileId,
      notes,
      recordedByUserId: actor.id,
    })
    .returning();

  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });

  await db.insert(clientActivities).values({
    clientId,
    projectId,
    activityType: "payment_received",
    description: `${actor.name} recorded a payment of ₹${amount.toLocaleString("en-IN")} for ${project?.name ?? "your project"}.`,
    relatedEntityType: "payment_record",
    relatedEntityId: record.id,
  });

  // Owner/manager should know money came in even if they weren't the one who recorded it — reuse the staff notifications table (see notifications.ts's pattern elsewhere in this codebase).
  if (project?.createdBy && project.createdBy !== actor.id) {
    await db.insert(notifications).values({
      recipientId: project.createdBy,
      type: "client_payment_received",
      title: "Payment recorded",
      message: `${actor.name} recorded a payment of ₹${amount.toLocaleString("en-IN")} for ${project.name}.`,
      relatedEntityType: "payment_record",
      relatedEntityId: record.id,
    });
  }

  await recordAudit({ actor, action: "client.payment_recorded", entityType: "payment_record", entityId: record.id, newState: { amount, mode } });
  revalidatePath(`/clients/${clientId}/payments`);
  revalidatePath("/client/payments");
  revalidatePath("/client");
  return { ok: true };
}
