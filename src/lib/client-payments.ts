import "server-only";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { projects, projectPaymentSettings, paymentMilestones, paymentRecords } from "@/db/schema";

/**
 * Client-payments read models — server-only. Every function here takes a
 * clientId (or a projectId already known to belong to one) and every
 * query is scoped by it; this is what stands between one client's
 * payment history and another's, same discipline as client-portal.ts.
 */

export type MilestoneWithPaid = {
  id: string;
  name: string;
  amount: number;
  dueDate: Date | null;
  sequenceOrder: number;
  paidAmount: number;
  status: "paid" | "partial" | "due_today" | "overdue" | "upcoming";
};

export type ProjectPaymentSummary = {
  projectId: string;
  projectName: string;
  enabled: boolean;
  totalFeeAmount: number | null;
  currency: string;
  totalPaid: number;
  totalPending: number;
  milestones: MilestoneWithPaid[];
  nextMilestone: MilestoneWithPaid | null;
  records: {
    id: string;
    amount: number;
    paidDate: Date;
    mode: string;
    reference: string | null;
    notes: string | null;
    receiptFileId: string | null;
    milestoneName: string | null;
  }[];
};

function milestoneStatus(amount: number, paidAmount: number, dueDate: Date | null): MilestoneWithPaid["status"] {
  if (paidAmount >= amount) return "paid";
  if (paidAmount > 0) return "partial";
  if (!dueDate) return "upcoming";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  if (due.getTime() < today.getTime()) return "overdue";
  if (due.getTime() === today.getTime()) return "due_today";
  return "upcoming";
}

/** Every project's payment summary for one client — only projects where payment tracking is switched ON, unless includeDisabled is set (staff view). */
export async function getClientPaymentOverview(clientId: string, includeDisabled = false): Promise<ProjectPaymentSummary[]> {
  const linkedProjects = await db.query.projects.findMany({ where: eq(projects.clientId, clientId) });
  if (linkedProjects.length === 0) return [];

  const settingsRows = await db.query.projectPaymentSettings.findMany({
    where: inArray(
      projectPaymentSettings.projectId,
      linkedProjects.map((p) => p.id)
    ),
  });
  const settingsByProject = new Map(settingsRows.map((s) => [s.projectId, s]));

  const summaries: ProjectPaymentSummary[] = [];
  for (const project of linkedProjects) {
    const settings = settingsByProject.get(project.id);
    if (!includeDisabled && !settings?.enabled) continue;

    const milestoneRows = await db.query.paymentMilestones.findMany({
      where: eq(paymentMilestones.projectId, project.id),
      orderBy: asc(paymentMilestones.sequenceOrder),
    });
    const recordRows = await db.query.paymentRecords.findMany({
      where: eq(paymentRecords.projectId, project.id),
      orderBy: desc(paymentRecords.paidDate),
    });

    const paidByMilestone = new Map<string, number>();
    let totalPaid = 0;
    for (const r of recordRows) {
      totalPaid += r.amount;
      if (r.milestoneId) paidByMilestone.set(r.milestoneId, (paidByMilestone.get(r.milestoneId) ?? 0) + r.amount);
    }

    const milestones: MilestoneWithPaid[] = milestoneRows.map((m) => {
      const paidAmount = paidByMilestone.get(m.id) ?? 0;
      return { id: m.id, name: m.name, amount: m.amount, dueDate: m.dueDate, sequenceOrder: m.sequenceOrder, paidAmount, status: milestoneStatus(m.amount, paidAmount, m.dueDate) };
    });
    const nextMilestone = milestones.find((m) => m.status !== "paid") ?? null;

    const milestoneNameById = new Map(milestoneRows.map((m) => [m.id, m.name]));
    const records = recordRows.map((r) => ({
      id: r.id,
      amount: r.amount,
      paidDate: r.paidDate,
      mode: r.mode,
      reference: r.reference,
      notes: r.notes,
      receiptFileId: r.receiptFileId,
      milestoneName: r.milestoneId ? (milestoneNameById.get(r.milestoneId) ?? null) : null,
    }));

    const totalFeeAmount = settings?.totalFeeAmount ?? null;
    summaries.push({
      projectId: project.id,
      projectName: project.name,
      enabled: settings?.enabled ?? false,
      totalFeeAmount,
      currency: settings?.currency ?? "INR",
      totalPaid,
      totalPending: totalFeeAmount != null ? Math.max(0, totalFeeAmount - totalPaid) : 0,
      milestones,
      nextMilestone,
      records,
    });
  }
  return summaries;
}

export async function getProjectPaymentSettings(projectId: string) {
  return db.query.projectPaymentSettings.findFirst({ where: eq(projectPaymentSettings.projectId, projectId) });
}

export async function findPaymentRecordOwnedByClient(recordId: string, clientId: string) {
  const record = await db.query.paymentRecords.findFirst({ where: and(eq(paymentRecords.id, recordId), eq(paymentRecords.clientId, clientId)) });
  return record ?? null;
}
